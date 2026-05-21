const path = require("path");
const { randomUUID, createHash } = require("crypto");

const ROLE = "shot-boundary-analyzer";
const SKILL_PATH = "C:\\ByteDanceFullStack\\.agents\\skills\\shot-boundary-analyzer\\SKILL.md";
const MIN_SHOT_DURATION_SECONDS = 0.01;

function prepareInput(artifact, analysisFps, { runtimeRoot = null } = {}) {
  const durationSeconds = Number(artifact.metadata?.durationSeconds ?? 0);
  const frames = Array.isArray(artifact.frames) ? artifact.frames : [];
  const summary = artifact.frameOutputSummary ?? {};
  const actualFrameCount = Number(summary.actualFrameCount ?? frames.length);
  const requestedFps = Number(summary.frameSampleRateFps ?? artifact.processingOptions?.frameSampleRateFps ?? 1);
  const extractFps = durationSeconds > 0 ? actualFrameCount / durationSeconds : requestedFps;
  if (!durationSeconds || !frames.length || !Number.isFinite(extractFps) || extractFps <= 0) {
    throw codedError("shot_boundary_input_invalid", "抽帧产物不足，无法启动镜头切分");
  }
  if (analysisFps > extractFps) {
    throw codedError("analysis_fps_exceeds_extract_fps", "分析采样率高于抽帧采样率，请重新抽帧或降低分析采样率");
  }
  const stride = Math.max(1, Math.round(extractFps / analysisFps));
  const sourceArtifactId = artifact.sampleVideo?.artifactId ?? null;
  return sanitizeForAppServerText({
    sampleVideoId: artifact.sampleVideoId,
    sourceArtifactId,
    traceId: artifact.trace?.traceId ?? null,
    durationSeconds,
    frameDimensions: {
      width: Number(artifact.metadata?.width ?? 0),
      height: Number(artifact.metadata?.height ?? 0),
    },
    extractSampling: {
      requestedFps,
      targetFrameCount: Number(summary.targetFrameCount ?? frames.length),
      actualFrameCount,
      maxFrames: Number(summary.maxFrames ?? 120),
    },
    analysisSampling: { fps: analysisFps, stride },
    frames: frames.reduce((result, frame, sourceFrameIndex) => {
      if (sourceFrameIndex % stride !== 0) return result;
      result.push({
        inputIndex: result.length,
        sourceFrameIndex,
        frameId: frame.frameId,
        artifactId: frame.artifactId,
        parentArtifactId: frame.parentArtifactId ?? null,
        timestamp: Number(frame.timestamp ?? 0),
        fileName: basename(frame.imageUri),
        filePath: resolveLocalImagePath(frame.imageUri, runtimeRoot),
      });
      return result;
    }, []),
  });
}

function buildTurnInputs({ prepared, contactSheets }) {
  const prompt = [
    "请基于后续多张 localImage 联表做切镜分析，只返回 JSON object。",
    "每张图片都是按时间顺序排列的 contact sheet；sheet 顺序与输入顺序一致。",
    "你的任务只有切镜边界判断，不要做字幕 OCR、内容总结、剧情理解或结构迁移。",
    "只允许输出相邻帧之间的边界，格式必须引用 beforeFrameId 和 afterFrameId，例如 frame-047 -> frame-048。",
    "如果看不清或需要人工复核，请把 needReview 设为 true，而不是编造结论。",
    `输出 schema：${JSON.stringify({
      boundaries: [
        {
          beforeFrameId: "frame_example_047",
          afterFrameId: "frame_example_048",
          confidence: 0.82,
          boundaryType: "hard_cut",
          reason: "画面主体与景别出现明显跳变",
          needReview: false,
        },
      ],
    })}`,
    "返回前自检：JSON 可解析；boundaries 可以为空；每条边界都必须引用输入中存在且相邻的 frameId；不要输出本地路径。",
  ].join("\n");
  const inputs = [{ type: "text", text: prompt, text_elements: [] }];
  for (const sheet of contactSheets) {
    inputs.push({ type: "localImage", path: sheet.localImagePath });
  }
  return sanitizeForAppServerText(inputs);
}

function buildProcessedAnalysis(message, prepared, contactSheets, context, lease, turn) {
  const parsed = extractJsonObject(message);
  const rawBoundaries = Array.isArray(parsed.boundaries) ? parsed.boundaries : [];
  const normalizedBoundaries = normalizeBoundaryCandidates(rawBoundaries, prepared.frames);
  const qualityIssue = detectReasonEncodingIssue(normalizedBoundaries);
  if (qualityIssue) {
    throw codedError("agent_output_quality_failed", "切镜 Agent 输出存在编码异常，已阻止写入 processed 产物", {
      turnId: turn?.turnId ?? null,
      parseFailureReason: qualityIssue.reason,
      outputSummary: summarizeAgentOutput(message, rawBoundaries, normalizedBoundaries),
      suspiciousReason: qualityIssue.suspiciousReason,
    });
  }
  const candidateArtifacts = buildCandidateArtifacts(contactSheets, normalizedBoundaries);
  const mergedBoundaries = normalizedBoundaries;
  const shots = buildShotsFromBoundaries(mergedBoundaries, prepared.frames, prepared.durationSeconds);
  return {
    artifactId: context.artifactId,
    parentArtifactId: prepared.sourceArtifactId,
    type: "shot-boundary-analysis",
    status: "processed",
    sourceFrameArtifactIds: prepared.frames.map((frame) => frame.artifactId),
    extractSampling: prepared.extractSampling,
    analysisSampling: prepared.analysisSampling,
    contactSheets: contactSheets.map(stripLocalImagePath),
    boundaryCandidateArtifacts: candidateArtifacts,
    boundaries: mergedBoundaries.map(stripBoundaryIndices),
    agent: {
      provider: "codex-appserver",
      role: ROLE,
      skillPath: SKILL_PATH,
      threadId: lease.thread_id,
      leaseId: lease.lease_id,
      turnId: turn.turnId,
      sheetCount: contactSheets.length,
      inputMode: "multi_contact_sheet",
    },
    shots,
    createdAt: new Date().toISOString(),
  };
}

function normalizeBoundaryCandidates(rawBoundaries, frames) {
  const framesById = new Map(
    (Array.isArray(frames) ? frames : [])
      .filter((frame) => frame?.frameId)
      .map((frame) => [frame.frameId, frame]),
  );
  const deduped = new Map();
  for (const boundary of Array.isArray(rawBoundaries) ? rawBoundaries : []) {
    const beforeFrameId = typeof boundary?.beforeFrameId === "string" ? boundary.beforeFrameId : "";
    const afterFrameId = typeof boundary?.afterFrameId === "string" ? boundary.afterFrameId : "";
    const beforeFrame = framesById.get(beforeFrameId);
    const afterFrame = framesById.get(afterFrameId);
    if (!beforeFrame || !afterFrame) continue;
    if (Number(afterFrame.inputIndex) - Number(beforeFrame.inputIndex) !== 1) continue;
    const key = `${beforeFrameId}__${afterFrameId}`;
    const normalized = {
      beforeFrameId,
      afterFrameId,
      beforeInputIndex: Number(beforeFrame.inputIndex),
      afterInputIndex: Number(afterFrame.inputIndex),
      beforeTimestamp: Number(beforeFrame.timestamp ?? 0),
      afterTimestamp: Number(afterFrame.timestamp ?? 0),
      confidence: clamp(Number(boundary?.confidence ?? 0.5), 0, 1),
      boundaryType: normalizeBoundaryType(boundary?.boundaryType),
      reason: String(boundary?.reason ?? "视觉变化").slice(0, 160),
      needReview: Boolean(boundary?.needReview),
    };
    const current = deduped.get(key);
    if (!current || normalized.confidence > current.confidence) deduped.set(key, normalized);
  }
  return Array.from(deduped.values()).sort((first, second) => first.afterInputIndex - second.afterInputIndex);
}

function buildCandidateArtifacts(contactSheets, normalizedBoundaries) {
  return contactSheets.map((sheet) => {
    const frameIds = new Set(sheet.gridItems.map((item) => item.frameId));
    const boundaries = normalizedBoundaries
      .filter((boundary) => frameIds.has(boundary.beforeFrameId) && frameIds.has(boundary.afterFrameId))
      .map(stripBoundaryIndices);
    return {
      artifactId: `artifact_${randomUUID()}`,
      parentArtifactId: sheet.artifactId,
      type: "shot_boundary_candidates",
      artifactType: "shot_boundary_candidates",
      status: "processed",
      sheetId: sheet.sheetId,
      sheetIndex: sheet.sheetIndex,
      frameCount: sheet.frameCount,
      boundaries,
      createdAt: new Date().toISOString(),
    };
  });
}

function buildShotsFromBoundaries(boundaries, frames, durationSeconds) {
  const safeDuration = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 1;
  const normalizedFrames = Array.isArray(frames)
    ? frames
      .map((frame) => ({
        frameId: frame.frameId,
        timestamp: Number(frame.timestamp ?? 0),
        inputIndex: Number(frame.inputIndex ?? 0),
      }))
      .filter((frame) => frame.frameId)
      .sort((first, second) => first.inputIndex - second.inputIndex)
    : [];
  if (!boundaries.length) return [buildFallbackShot(normalizedFrames, safeDuration)];
  const shots = [];
  let start = 0;
  let startInputIndex = normalizedFrames[0]?.inputIndex ?? 0;
  for (const boundary of boundaries) {
    const cutTime = resolveBoundaryCutTime(boundary, safeDuration);
    const safeEnd = shots.length ? clamp(cutTime, shots[shots.length - 1].end + MIN_SHOT_DURATION_SECONDS, safeDuration) : clamp(cutTime, MIN_SHOT_DURATION_SECONDS, safeDuration);
    shots.push({
      id: `shot_${shots.length + 1}`,
      index: shots.length,
      shotNo: formatShotNo(shots.length),
      start: roundNormalizedTime(start),
      end: roundNormalizedTime(safeEnd),
      representativeFrameId: resolveRepresentativeFrameId(normalizedFrames, startInputIndex, Number(boundary.beforeInputIndex), start, safeEnd),
      confidence: boundary.confidence,
      reason: boundary.reason,
    });
    start = safeEnd;
    startInputIndex = Number(boundary.afterInputIndex);
  }
  shots.push({
    id: `shot_${shots.length + 1}`,
    index: shots.length,
    shotNo: formatShotNo(shots.length),
    start: roundNormalizedTime(start),
    end: roundNormalizedTime(safeDuration),
    representativeFrameId: resolveRepresentativeFrameId(normalizedFrames, startInputIndex, normalizedFrames.at(-1)?.inputIndex ?? startInputIndex, start, safeDuration),
    confidence: boundaries.at(-1)?.confidence ?? 0.5,
    reason: boundaries.at(-1)?.reason ?? "视觉连续",
  });
  return shots
    .filter((shot) => shot.end > shot.start && shot.representativeFrameId)
    .map((shot, index) => ({ ...shot, index, shotNo: formatShotNo(index) }));
}

function buildFailedArtifact(context, errorSummary, contactSheets = []) {
  const agentRun = context.job?.agentRun ?? null;
  return {
    artifactId: context.artifactId,
    parentArtifactId: context.sampleArtifact?.sampleVideo?.artifactId ?? null,
    type: "shot-boundary-analysis",
    status: "failed",
    sourceFrameArtifactIds: [],
    extractSampling: null,
    analysisSampling: { fps: context.analysisFps, stride: null },
    contactSheets: contactSheets.map(stripLocalImagePath),
    boundaryCandidateArtifacts: [],
    boundaries: [],
    agent: {
      provider: "codex-appserver",
      role: ROLE,
      skillPath: SKILL_PATH,
      threadId: agentRun?.threadId ?? null,
      leaseId: agentRun?.leaseId ?? null,
      turnId: agentRun?.turnId ?? null,
      sheetCount: contactSheets.length || agentRun?.contactSheets?.length || 0,
      inputMode: "multi_contact_sheet",
    },
    shots: [],
    reason: errorSummary.message,
    createdAt: new Date().toISOString(),
  };
}

function cacheParams(input, contactSheets) {
  return {
    sourceArtifactId: input.sourceArtifactId,
    extractSampling: input.extractSampling,
    analysisSampling: input.analysisSampling,
    frameDimensions: input.frameDimensions,
    sheetCount: contactSheets.length,
    sheetLayouts: contactSheets.map((sheet) => ({
      frameCount: sheet.frameCount,
      layout: sheet.layout,
      constraints: sheet.constraints,
    })),
    skillHash: createHash("sha256").update(SKILL_PATH).digest("hex").slice(0, 16),
  };
}

function safeError(error, stageName) {
  return {
    code: error?.code ?? "shot_boundary_failed",
    message: error instanceof Error ? error.message : "镜头切分失败",
    stageName,
    retryable: typeof error?.retryable === "boolean" ? error.retryable : true,
  };
}

function sanitizeDebugPayload(error) {
  const details = error?.debugPayload ?? null;
  return {
    code: error?.code ?? null,
    message: error instanceof Error ? error.message : String(error ?? "unknown").slice(0, 240),
    turnId: details?.turnId ?? null,
    outputSummary: details?.outputSummary ?? null,
    parseFailureReason: details?.parseFailureReason ?? null,
    suspiciousReason: details?.suspiciousReason ?? null,
    appServer: details,
  };
}

function sanitizeForAppServerText(value) {
  if (typeof value === "string") return value.replace(/[\uD800-\uDFFF]/g, "");
  if (Array.isArray(value)) return value.map((item) => sanitizeForAppServerText(item));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeForAppServerText(item)]));
}

function codedError(code, message, debugPayload = null, retryable = true) {
  const error = new Error(message);
  error.code = code;
  error.debugPayload = debugPayload;
  error.retryable = retryable;
  return error;
}

function extractJsonObject(text) {
  const value = String(text ?? "").trim();
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start < 0 || end < start) throw codedError("agent_output_parse_failed", "切镜 Agent 未返回 JSON 对象");
  try {
    return JSON.parse(value.slice(start, end + 1));
  } catch (error) {
    error.code = "agent_output_parse_failed";
    throw error;
  }
}

function detectReasonEncodingIssue(boundaries) {
  for (const boundary of boundaries) {
    const reason = String(boundary?.reason ?? "");
    if (reason.includes("\uFFFD")) {
      return { reason: "reason contains replacement character", suspiciousReason: reason.slice(0, 160) };
    }
    if (looksLikeUtf8Mojibake(reason)) {
      return { reason: "reason matches UTF-8 mojibake pattern", suspiciousReason: reason.slice(0, 160) };
    }
    if (looksLikeGbkMojibake(reason)) {
      return { reason: "reason matches GBK mojibake pattern", suspiciousReason: reason.slice(0, 160) };
    }
  }
  return null;
}

function summarizeAgentOutput(message, rawBoundaries, normalizedBoundaries) {
  return {
    messagePreview: String(message ?? "").replace(/\s+/g, " ").slice(0, 200),
    rawBoundaryCount: Array.isArray(rawBoundaries) ? rawBoundaries.length : 0,
    normalizedBoundaryCount: Array.isArray(normalizedBoundaries) ? normalizedBoundaries.length : 0,
    firstReasons: Array.isArray(normalizedBoundaries) ? normalizedBoundaries.slice(0, 3).map((boundary) => String(boundary.reason ?? "").slice(0, 80)) : [],
  };
}

function stripLocalImagePath(sheet) {
  const { localImagePath, ...safeSheet } = sheet;
  return {
    ...safeSheet,
    gridItems: Array.isArray(safeSheet.gridItems)
      ? safeSheet.gridItems.map(({ filePath, ...safeItem }) => safeItem)
      : [],
  };
}

function stripBoundaryIndices(boundary) {
  const { beforeInputIndex, afterInputIndex, beforeTimestamp, afterTimestamp, ...safeBoundary } = boundary;
  return safeBoundary;
}

function normalizeBoundaryType(value) {
  const normalized = String(value ?? "").trim();
  return normalized || "hard_cut";
}

function resolveBoundaryCutTime(boundary, safeDuration) {
  const before = Number(boundary.beforeTimestamp ?? 0);
  const after = Number(boundary.afterTimestamp ?? before);
  const midpoint = after > before ? (before + after) / 2 : after;
  return clamp(midpoint, 0, safeDuration);
}

function resolveRepresentativeFrameId(frames, startInputIndex, endInputIndex, startTime, endTime) {
  const candidates = frames.filter((frame) => frame.inputIndex >= startInputIndex && frame.inputIndex <= endInputIndex);
  const pool = candidates.length ? candidates : frames;
  if (!pool.length) return "";
  const midpoint = (startTime + endTime) / 2;
  let best = pool[0];
  for (const frame of pool) {
    if (Math.abs(frame.timestamp - midpoint) < Math.abs(best.timestamp - midpoint)) best = frame;
  }
  return best.frameId ?? "";
}

function buildFallbackShot(frames, durationSeconds) {
  return [
    {
      id: "shot_1",
      index: 0,
      shotNo: formatShotNo(0),
      start: 0,
      end: roundNormalizedTime(durationSeconds),
      representativeFrameId: resolveRepresentativeFrameId(frames, frames[0]?.inputIndex ?? 0, frames.at(-1)?.inputIndex ?? 0, 0, durationSeconds),
      confidence: 0.4,
      reason: "未检测到明确切镜边界",
    },
  ][0];
}

function looksLikeUtf8Mojibake(text) {
  const value = String(text ?? "");
  return /(?:Ã.|Â.|æ[\u0080-\u00FF]|å[\u0080-\u00FF]|ç[\u0080-\u00FF]|ä[\u0080-\u00FF]|é[\u0080-\u00FF]){2,}/.test(value);
}

function looksLikeGbkMojibake(text) {
  const value = String(text ?? "");
  return /(鏈|娴嬪|鏄庢|瑙嗚|鍙樺|锟斤拷)/.test(value);
}

function resolveLocalImagePath(imageUri, runtimeRoot) {
  const value = String(imageUri ?? "");
  if (runtimeRoot && value.startsWith("/runtime/")) {
    return path.join(runtimeRoot, ...value.slice("/runtime/".length).split("/"));
  }
  if (isAbsolutePath(value)) return value;
  return value;
}

function isAbsolutePath(value) {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\") || value.startsWith("/");
}

function formatShotNo(index) {
  return `S${String(index + 1).padStart(3, "0")}`;
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function round(value) {
  return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null;
}

function roundNormalizedTime(value) {
  return round(clamp(value, 0, Number.POSITIVE_INFINITY)) ?? 0;
}

function basename(value) {
  return String(value ?? "").split(/[\\/]/).at(-1) ?? "";
}

module.exports = {
  ROLE,
  SKILL_PATH,
  buildFailedArtifact,
  buildProcessedAnalysis,
  buildTurnInputs,
  cacheParams,
  codedError,
  prepareInput,
  safeError,
  sanitizeDebugPayload,
  sanitizeForAppServerText,
  normalizeBoundaryCandidates,
  buildShotsFromBoundaries,
};
