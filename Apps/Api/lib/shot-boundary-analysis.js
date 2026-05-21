const path = require("path");
const fs = require("fs/promises");
const fsSync = require("fs");
const { randomUUID, createHash } = require("crypto");

const ROLE = "shot-boundary-analyzer";
const SKILL_PATH = "C:\\ByteDanceFullStack\\.agents\\skills\\shot-boundary-analyzer\\SKILL.md";
const MIN_SHOT_DURATION_SECONDS = 0.01;
const MAX_REPAIR_ATTEMPTS = 1;

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
  const sampledFrames = frames.reduce((result, frame, sourceFrameIndex) => {
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
  }, []);
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
    frames: sampledFrames,
  });
}

function buildTurnInputs({ prepared, contactSheets }) {
  const manifest = {
    sourceArtifactId: prepared.sourceArtifactId,
    durationSeconds: round(prepared.durationSeconds),
    extractSampling: prepared.extractSampling,
    analysisSampling: prepared.analysisSampling,
    sheetCount: contactSheets.length,
    sheets: contactSheets.map((sheet) => ({
      sheetId: sheet.sheetId,
      sheetIndex: sheet.sheetIndex,
      frameCount: sheet.frameCount,
      startTime: round(resolveSheetStartTime(sheet)),
      endTime: round(resolveSheetEndTime(sheet)),
    })),
  };
  const prompt = [
    "请基于后续多张 localImage 联表做切镜分析，只返回 JSON object。",
    "你只需要输出切镜时间点，不要输出 frameId、路径、完整输入明细、剧情解释或 OCR 结果。",
    `任务输入：${JSON.stringify(manifest)}`,
    `输出 schema：${JSON.stringify({
      boundaries: [
        {
          timestamp: 12.48,
          confidence: 0.82,
          boundaryType: "hard_cut",
          reason: "画面主体与景别出现明显跳变",
          needReview: false,
        },
      ],
    })}`,
    "返回前自检：JSON 可解析；boundaries 不能为空；timestamp 必须在 0 到 durationSeconds 之间；boundaries 必须严格升序且不能重复；不要输出本地路径。",
  ].join("\n");
  const inputs = [{ type: "text", text: prompt, text_elements: [] }];
  for (const sheet of contactSheets) {
    inputs.push({ type: "localImage", path: sheet.localImagePath });
  }
  return sanitizeForAppServerText(inputs);
}

function buildRepairTurnInputs({ prepared, contactSheets, validationError, priorTurnOutput, repairAttemptCount }) {
  const prompt = [
    "上一次切镜输出未通过校验。请在同一任务上修复，只返回 JSON object。",
    `修复轮次：${repairAttemptCount}`,
    `视频时长：${round(prepared.durationSeconds)} 秒`,
    `分析采样：${JSON.stringify(prepared.analysisSampling)}`,
    `校验失败：${JSON.stringify(validationError.debugPayload?.validation ?? { code: validationError.code, message: validationError.message })}`,
    `上次输出摘要：${JSON.stringify(summarizeAgentOutput(priorTurnOutput, null, null))}`,
    `输出 schema：${JSON.stringify({
      boundaries: [
        {
          timestamp: 12.48,
          confidence: 0.82,
          boundaryType: "hard_cut",
          reason: "画面主体与景别出现明显跳变",
          needReview: false,
        },
      ],
    })}`,
    "要求：只保留你能确认的切换时间点；严格按时间升序；不要返回空 boundaries；不要输出 frameId、路径或解释性正文。",
  ].join("\n");
  const inputs = [{ type: "text", text: prompt, text_elements: [] }];
  for (const sheet of contactSheets) {
    inputs.push({ type: "localImage", path: sheet.localImagePath });
  }
  return sanitizeForAppServerText(inputs);
}

function buildProcessedAnalysis(message, prepared, contactSheets, context, lease, turn, options = {}) {
  const parsed = extractJsonObject(message);
  const rawBoundaries = Array.isArray(parsed.boundaries) ? parsed.boundaries : null;
  const normalizedBoundaries = normalizeTimestampBoundaries(rawBoundaries);
  const validation = validateTimestampBoundaries(normalizedBoundaries, prepared.durationSeconds);
  if (!validation.ok) {
    throw codedError("shot_boundary_validation_failed", validation.message, {
      turnId: turn?.turnId ?? null,
      outputSummary: summarizeAgentOutput(message, rawBoundaries, normalizedBoundaries),
      validation: validation.summary,
    }, false);
  }
  const qualityIssue = detectReasonEncodingIssue(normalizedBoundaries);
  if (qualityIssue) {
    throw codedError("agent_output_quality_failed", "切镜 Agent 输出存在编码异常，已阻止写入 processed 产物", {
      turnId: turn?.turnId ?? null,
      parseFailureReason: qualityIssue.reason,
      outputSummary: summarizeAgentOutput(message, rawBoundaries, normalizedBoundaries),
      suspiciousReason: qualityIssue.suspiciousReason,
      validation: validation.summary,
    }, false);
  }
  const mergedBoundaries = normalizedBoundaries;
  const shots = buildShotsFromBoundaries(mergedBoundaries, prepared.frames, prepared.durationSeconds);
  return {
    artifactId: context.artifactId,
    parentArtifactId: prepared.sourceArtifactId,
    type: "shot-boundary-analysis",
    status: "processed",
    resultOrigin: options.resultOrigin ?? "new_turn",
    sourceFrameArtifactIds: prepared.frames.map((frame) => frame.artifactId),
    extractSampling: prepared.extractSampling,
    analysisSampling: prepared.analysisSampling,
    contactSheets: contactSheets.map(stripLocalImagePath),
    boundaryCandidateArtifacts: [],
    boundaries: mergedBoundaries,
    validation: {
      status: "passed",
      rawBoundaryCount: rawBoundaries.length,
      normalizedBoundaryCount: mergedBoundaries.length,
      repairAttemptCount: options.repairAttemptCount ?? 0,
      validatorCode: null,
    },
    agent: {
      provider: "codex-appserver",
      role: ROLE,
      skillPath: context.skillPath ?? SKILL_PATH,
      skillHash: context.skillHash ?? skillContentHashSync(context.skillPath ?? SKILL_PATH),
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

function normalizeTimestampBoundaries(rawBoundaries) {
  if (!Array.isArray(rawBoundaries)) return [];
  return rawBoundaries.map((boundary) => ({
    timestamp: roundNormalizedTime(Number(boundary?.timestamp)),
    confidence: clamp(Number(boundary?.confidence ?? 0.5), 0, 1),
    boundaryType: normalizeBoundaryType(boundary?.boundaryType),
    reason: String(boundary?.reason ?? "视觉变化").slice(0, 160),
    needReview: Boolean(boundary?.needReview),
  }));
}

function validateTimestampBoundaries(boundaries, durationSeconds) {
  const safeDuration = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 0;
  if (!Array.isArray(boundaries)) {
    return invalidValidation("shot_boundary_missing_boundaries", "切镜 Agent 未返回 boundaries", {
      rawBoundaryCount: 0,
      normalizedBoundaryCount: 0,
      validatorCode: "shot_boundary_missing_boundaries",
    });
  }
  if (!boundaries.length) {
    return invalidValidation("shot_boundary_empty_boundaries", "切镜 Agent 未返回明确切镜边界", {
      rawBoundaryCount: 0,
      normalizedBoundaryCount: 0,
      validatorCode: "shot_boundary_empty_boundaries",
    });
  }
  let previousTimestamp = null;
  for (let index = 0; index < boundaries.length; index += 1) {
    const boundary = boundaries[index];
    if (!Number.isFinite(boundary.timestamp)) {
      return invalidValidation("shot_boundary_timestamp_invalid", "切镜时间点无效", {
        rawBoundaryCount: boundaries.length,
        normalizedBoundaryCount: boundaries.length,
        validatorCode: "shot_boundary_timestamp_invalid",
        failingIndex: index,
      });
    }
    if (boundary.timestamp <= 0 || (safeDuration > 0 && boundary.timestamp >= safeDuration)) {
      return invalidValidation("shot_boundary_timestamp_out_of_range", "切镜时间点超出允许范围", {
        rawBoundaryCount: boundaries.length,
        normalizedBoundaryCount: boundaries.length,
        validatorCode: "shot_boundary_timestamp_out_of_range",
        failingIndex: index,
        timestamp: boundary.timestamp,
        durationSeconds: safeDuration,
      });
    }
    if (previousTimestamp !== null && boundary.timestamp <= previousTimestamp) {
      return invalidValidation("shot_boundary_timestamp_order_invalid", "切镜时间点重复或未按升序排列", {
        rawBoundaryCount: boundaries.length,
        normalizedBoundaryCount: boundaries.length,
        validatorCode: "shot_boundary_timestamp_order_invalid",
        failingIndex: index,
        timestamp: boundary.timestamp,
        previousTimestamp,
      });
    }
    previousTimestamp = boundary.timestamp;
  }
  return {
    ok: true,
    summary: {
      rawBoundaryCount: boundaries.length,
      normalizedBoundaryCount: boundaries.length,
      validatorCode: null,
    },
  };
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
  const shots = [];
  let start = 0;
  for (const boundary of boundaries) {
    const end = clamp(boundary.timestamp, shots.length ? shots[shots.length - 1].end + MIN_SHOT_DURATION_SECONDS : MIN_SHOT_DURATION_SECONDS, safeDuration);
    shots.push({
      id: `shot_${shots.length + 1}`,
      index: shots.length,
      shotNo: formatShotNo(shots.length),
      start: roundNormalizedTime(start),
      end: roundNormalizedTime(end),
      representativeFrameId: resolveRepresentativeFrameIdByTime(normalizedFrames, start, end),
      confidence: boundary.confidence,
      reason: boundary.reason,
    });
    start = end;
  }
  shots.push({
    id: `shot_${shots.length + 1}`,
    index: shots.length,
    shotNo: formatShotNo(shots.length),
    start: roundNormalizedTime(start),
    end: roundNormalizedTime(safeDuration),
    representativeFrameId: resolveRepresentativeFrameIdByTime(normalizedFrames, start, safeDuration),
    confidence: boundaries.at(-1)?.confidence ?? 0.5,
    reason: boundaries.at(-1)?.reason ?? "视觉连续",
  });
  return shots
    .filter((shot) => shot.end > shot.start && shot.representativeFrameId)
    .map((shot, index) => ({ ...shot, index, shotNo: formatShotNo(index) }));
}

function buildFailedArtifact(context, errorSummary, contactSheets = []) {
  const agentRun = context.job?.agentRun ?? null;
  const validation = context.validationSummary ?? null;
  return {
    artifactId: context.artifactId,
    parentArtifactId: context.sampleArtifact?.sampleVideo?.artifactId ?? null,
    type: "shot-boundary-analysis",
    status: "failed",
    resultOrigin: validation?.repairAttemptCount ? "failed_validation" : "new_turn",
    sourceFrameArtifactIds: [],
    extractSampling: null,
    analysisSampling: { fps: context.analysisFps, stride: null },
    contactSheets: contactSheets.map(stripLocalImagePath),
    boundaryCandidateArtifacts: [],
    boundaries: [],
    validation: {
      status: "failed",
      rawBoundaryCount: validation?.rawBoundaryCount ?? 0,
      normalizedBoundaryCount: validation?.normalizedBoundaryCount ?? 0,
      repairAttemptCount: validation?.repairAttemptCount ?? 0,
      validatorCode: validation?.validatorCode ?? errorSummary.code ?? null,
    },
    agent: {
      provider: "codex-appserver",
      role: ROLE,
      skillPath: context.skillPath ?? SKILL_PATH,
      skillHash: context.skillHash ?? skillContentHashSync(context.skillPath ?? SKILL_PATH),
      threadId: agentRun?.threadId ?? null,
      leaseId: agentRun?.leaseId ?? null,
      turnId: agentRun?.turnId ?? null,
      sheetCount: contactSheets.length || agentRun?.contactSheets?.length || 0,
      inputMode: "multi_contact_sheet",
    },
    shots: [],
    reason: errorSummary.message,
    debugSnapshotUri: errorSummary.debugSnapshotUri ?? null,
    createdAt: new Date().toISOString(),
  };
}

function buildCacheReuseAnalysis(analysis) {
  return {
    ...analysis,
    resultOrigin: "cache_reuse",
    validation: {
      status: analysis.validation?.status ?? "passed",
      rawBoundaryCount: analysis.validation?.rawBoundaryCount ?? analysis.boundaries?.length ?? 0,
      normalizedBoundaryCount: analysis.validation?.normalizedBoundaryCount ?? analysis.boundaries?.length ?? 0,
      repairAttemptCount: analysis.validation?.repairAttemptCount ?? 0,
      validatorCode: analysis.validation?.validatorCode ?? null,
    },
  };
}

function cacheParams(input, contactSheets, options = {}) {
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
      startTime: round(resolveSheetStartTime(sheet)),
      endTime: round(resolveSheetEndTime(sheet)),
    })),
    skillHash: options.skillHash ?? skillContentHashSync(options.skillPath ?? SKILL_PATH),
  };
}

async function resolveSkillHash(skillPath = SKILL_PATH) {
  try {
    const content = await fs.readFile(skillPath, "utf8");
    return contentHash(content);
  } catch {
    return contentHash(String(skillPath ?? ""));
  }
}

function contentHash(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex").slice(0, 16);
}

function skillContentHashSync(skillPath = SKILL_PATH) {
  try {
    return contentHash(fsSync.readFileSync(skillPath, "utf8"));
  } catch {
    return contentHash(String(skillPath ?? ""));
  }
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
    validation: details?.validation ?? null,
    repairAttemptCount: details?.repairAttemptCount ?? null,
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
    timestamps: Array.isArray(normalizedBoundaries) ? normalizedBoundaries.slice(0, 5).map((boundary) => boundary.timestamp) : [],
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

function normalizeBoundaryType(value) {
  const normalized = String(value ?? "").trim();
  return normalized || "hard_cut";
}

function resolveRepresentativeFrameIdByTime(frames, startTime, endTime) {
  const midpoint = (startTime + endTime) / 2;
  const candidates = frames.filter((frame) => frame.timestamp >= startTime && frame.timestamp <= endTime);
  const pool = candidates.length ? candidates : frames;
  if (!pool.length) return "";
  let best = pool[0];
  for (const frame of pool) {
    if (Math.abs(frame.timestamp - midpoint) < Math.abs(best.timestamp - midpoint)) best = frame;
  }
  return best.frameId ?? "";
}

function resolveSheetStartTime(sheet) {
  const timestamps = (sheet.gridItems ?? []).map((item) => Number(item.timestamp)).filter(Number.isFinite);
  return timestamps.length ? Math.min(...timestamps) : 0;
}

function resolveSheetEndTime(sheet) {
  const timestamps = (sheet.gridItems ?? []).map((item) => Number(item.timestamp)).filter(Number.isFinite);
  return timestamps.length ? Math.max(...timestamps) : 0;
}

function invalidValidation(code, message, summary) {
  return {
    ok: false,
    code,
    message,
    summary,
  };
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
  MAX_REPAIR_ATTEMPTS,
  buildCacheReuseAnalysis,
  buildFailedArtifact,
  buildProcessedAnalysis,
  buildRepairTurnInputs,
  buildTurnInputs,
  buildShotsFromBoundaries,
  cacheParams,
  codedError,
  normalizeTimestampBoundaries,
  prepareInput,
  resolveSkillHash,
  safeError,
  sanitizeDebugPayload,
  sanitizeForAppServerText,
  summarizeAgentOutput,
  validateTimestampBoundaries,
};
