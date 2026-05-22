const path = require("path");
const fs = require("fs/promises");
const fsSync = require("fs");
const { randomUUID, createHash } = require("crypto");

const ROLE = "shot-boundary-analyzer";
const SKILL_PATH = "C:\\ByteDanceFullStack\\.agents\\skills\\shot-boundary-analyzer\\SKILL.md";
const MIN_SHOT_DURATION_SECONDS = 0.01;
const MAX_REPAIR_ATTEMPTS = 1;
const ANALYSIS_SELECTION_POLICY = "target_grid_nearest_unique";
const ANALYSIS_DUPLICATE_POLICY = "nearest_unselected_tie_later";
const FRAME_SAMPLING_POLICY = "fixed_interval_from_zero";
const MIN_ANALYSIS_FPS = 1;
const MAX_ANALYSIS_FPS = 10;
const MAX_SUBTITLE_SEGMENT_TEXT_LENGTH = 120;
const MAX_SUBTITLE_CONTEXT_TOTAL_CHARS = 1600;

function prepareInput(artifact, analysisFps, { runtimeRoot = null } = {}) {
  const durationSeconds = Number(artifact.metadata?.durationSeconds ?? 0);
  const frames = Array.isArray(artifact.frames) ? artifact.frames : [];
  const summary = artifact.frameOutputSummary ?? {};
  const actualFrameCount = Number(summary.actualFrameCount ?? frames.length);
  const requestedFrameSampleRateFps = Number(summary.frameSampleRateFps ?? artifact.processingOptions?.frameSampleRateFps ?? 1);
  const requestedAnalysisFps = Number(analysisFps ?? 0);
  if (!durationSeconds || !frames.length || !Number.isFinite(requestedFrameSampleRateFps) || requestedFrameSampleRateFps <= 0) {
    throw codedError("shot_boundary_input_invalid", "抽帧产物不足，无法启动镜头切分");
  }
  if (!Number.isFinite(requestedAnalysisFps) || !Number.isInteger(requestedAnalysisFps) || requestedAnalysisFps < MIN_ANALYSIS_FPS || requestedAnalysisFps > MAX_ANALYSIS_FPS) {
    throw codedError("analysis_fps_invalid", "分析采样率无效，请输入 1 到 10 之间的整数");
  }
  if (requestedAnalysisFps > requestedFrameSampleRateFps) {
    throw codedError("analysis_fps_exceeds_extract_fps", "分析采样率高于抽帧采样率，请重新抽帧或降低分析采样率");
  }
  const selectedFrames = selectAnalysisFramesByTargetGrid(frames, durationSeconds, requestedAnalysisFps);
  const analysisSampling = resolveAnalysisSampling({
    requestedFrameSampleRateFps,
    requestedAnalysisFps,
    durationSeconds,
    targetFrameCount: countTargetGridFrames(durationSeconds, requestedAnalysisFps),
    selectedFrameCount: selectedFrames.length,
  });
  const subtitleContextSummary = buildSubtitleContextSummary(artifact.subtitles, durationSeconds);
  const sourceArtifactId = artifact.sampleVideo?.artifactId ?? null;
  const sampledFrames = selectedFrames.map(({ frame, sourceFrameIndex }, inputIndex) => ({
    inputIndex,
    sourceFrameIndex,
    frameId: frame.frameId,
    artifactId: frame.artifactId,
    parentArtifactId: frame.parentArtifactId ?? null,
    timestamp: roundNormalizedTime(Number(frame.timestamp ?? 0)),
    fileName: basename(frame.imageUri),
    filePath: resolveLocalImagePath(frame.imageUri, runtimeRoot),
  }));
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
      requestedFps: requestedFrameSampleRateFps,
      targetFrameCount: Number(summary.targetFrameCount ?? frames.length),
      actualFrameCount,
      maxFrames: Number(summary.maxFrames ?? 120),
      samplingPolicy: summary.samplingPolicy ?? FRAME_SAMPLING_POLICY,
      cappedByMaxFrames: Boolean(summary.cappedByMaxFrames),
    },
    analysisSampling,
    subtitleContextSummary: subtitleContextSummary.summary,
    subtitleContext: subtitleContextSummary.items,
    frames: sampledFrames,
  });
}

function resolveAnalysisSampling(input, maybeRequestedAnalysisFps) {
  const params = typeof input === "object" && input !== null
    ? input
    : { requestedFrameSampleRateFps: input, requestedAnalysisFps: maybeRequestedAnalysisFps };
  const { requestedAnalysisFps, durationSeconds, targetFrameCount, selectedFrameCount } = params;
  const requestedFps = Number(requestedAnalysisFps ?? 0);
  const safeDuration = Number(durationSeconds ?? 0);
  const safeTargetFrameCount = Number(targetFrameCount);
  const safeSelectedFrameCount = Number(selectedFrameCount);
  const effectiveFps = Number.isFinite(safeDuration) && safeDuration > 0 && Number.isFinite(safeSelectedFrameCount)
    ? round(safeSelectedFrameCount / safeDuration)
    : null;
  return {
    fps: requestedFps,
    requestedFps,
    targetFrameCount: Number.isFinite(safeTargetFrameCount) ? safeTargetFrameCount : null,
    selectedFrameCount: Number.isFinite(safeSelectedFrameCount) ? safeSelectedFrameCount : null,
    effectiveFps,
    selectionPolicy: ANALYSIS_SELECTION_POLICY,
    duplicatePolicy: ANALYSIS_DUPLICATE_POLICY,
    roundingPolicy: ANALYSIS_SELECTION_POLICY,
    stride: null,
  };
}

function selectAnalysisFramesByTargetGrid(frames, durationSeconds, requestedAnalysisFps) {
  const availableFrames = Array.isArray(frames) ? frames : [];
  const targetTimes = buildTargetGridTimes(durationSeconds, requestedAnalysisFps);
  if (!availableFrames.length || !targetTimes.length) return [];
  const selectedIndexes = new Set();
  const selected = [];
  for (const targetTime of targetTimes) {
    if (selected.length >= availableFrames.length) break;
    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    let bestTimestamp = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < availableFrames.length; index += 1) {
      if (selectedIndexes.has(index)) continue;
      const timestamp = Number(availableFrames[index]?.timestamp ?? 0);
      const distance = Math.abs(timestamp - targetTime);
      if (
        distance < bestDistance
        || (distance === bestDistance && timestamp > bestTimestamp)
        || (distance === bestDistance && timestamp === bestTimestamp && index > bestIndex)
      ) {
        bestIndex = index;
        bestDistance = distance;
        bestTimestamp = timestamp;
      }
    }
    if (bestIndex >= 0) {
      selectedIndexes.add(bestIndex);
      selected.push({ frame: availableFrames[bestIndex], sourceFrameIndex: bestIndex });
    }
  }
  return selected.sort((first, second) => first.sourceFrameIndex - second.sourceFrameIndex);
}

function buildTargetGridTimes(durationSeconds, requestedAnalysisFps) {
  const safeDuration = Number(durationSeconds ?? 0);
  const safeFps = Number(requestedAnalysisFps ?? 0);
  if (!Number.isFinite(safeDuration) || safeDuration <= 0 || !Number.isFinite(safeFps) || safeFps <= 0) return [];
  const step = 1 / safeFps;
  const targetTimes = [];
  for (let targetTime = 0; targetTime < safeDuration; targetTime += step) {
    targetTimes.push(Number(targetTime.toFixed(6)));
  }
  return targetTimes;
}

function countTargetGridFrames(durationSeconds, requestedAnalysisFps) {
  return buildTargetGridTimes(durationSeconds, requestedAnalysisFps).length;
}

function toPromptAnalysisSampling(analysisSampling) {
  return {
    requestedFps: analysisSampling?.requestedFps ?? analysisSampling?.fps ?? null,
    targetFrameCount: analysisSampling?.targetFrameCount ?? null,
    selectedFrameCount: analysisSampling?.selectedFrameCount ?? null,
    effectiveFps: analysisSampling?.effectiveFps ?? null,
    selectionPolicy: analysisSampling?.selectionPolicy ?? ANALYSIS_SELECTION_POLICY,
    duplicatePolicy: analysisSampling?.duplicatePolicy ?? ANALYSIS_DUPLICATE_POLICY,
    roundingPolicy: analysisSampling?.roundingPolicy ?? ANALYSIS_SELECTION_POLICY,
  };
}

function buildTurnInputs({ prepared, contactSheets }) {
  const manifest = {
    durationSeconds: round(prepared.durationSeconds),
    analysisSampling: toPromptAnalysisSampling(prepared.analysisSampling),
    sheetCount: contactSheets.length,
    sheets: contactSheets.map((sheet) => ({
      sheetIndex: sheet.sheetIndex,
      frameCount: sheet.frameCount,
      startTime: round(resolveSheetStartTime(sheet)),
      endTime: round(resolveSheetEndTime(sheet)),
    })),
    subtitleContextSummary: prepared.subtitleContextSummary ?? { subtitleSegmentCount: 0, subtitleTextHash: null, truncated: false },
  };
  if (Array.isArray(prepared.subtitleContext) && prepared.subtitleContext.length) manifest.subtitleContext = prepared.subtitleContext;
  const outputContract = {
    boundaries: "non-empty array, strictly ascending by timestamp",
    "boundaries[].timestamp": "number, seconds, 0 < timestamp < durationSeconds",
    "boundaries[].confidence": "number, 0..1",
    "boundaries[].boundaryType": "string",
    "boundaries[].reason": "short string",
    "boundaries[].needReview": "boolean",
    shots: "array, should align with detected shots count, each item describes what this shot contains",
    "shots[].summary": "string, 8-24 chars preferred, describe subject/action/scene, no timestamps or local paths",
  };
  const prompt = [
    "请基于后续多张 localImage 联表做切镜分析，只返回 JSON object。",
    "联表中的帧已经按目标时间网格从抽帧结果中选出，模型只需要基于这些帧判断边界，不需要自行重采样。",
    "你只需要输出切镜时间点，不要输出 frameId、路径、完整输入明细、剧情解释或 OCR 结果。",
    "请额外为每一镜输出 shots[].summary，描述“这镜是什么”；shot summary 不是切换原因。",
    "如果提供了 subtitleContext，只把字幕当作语义辅助，不要把普通字幕断句直接当切镜边界；切镜边界仍以视觉变化为主。",
    `任务输入：${JSON.stringify(manifest)}`,
    `输出契约：${JSON.stringify(outputContract)}`,
    "返回前自检：JSON 可解析；boundaries 不能为空；timestamp 必须在 0 到 durationSeconds 之间；boundaries 必须严格升序且不能重复；shots[].summary 应尽量覆盖每一镜；不要输出本地路径。",
  ].join("\n");
  const inputs = [{ type: "text", text: prompt, text_elements: [] }];
  for (const sheet of contactSheets) {
    inputs.push({ type: "localImage", path: sheet.localImagePath });
  }
  return sanitizeForAppServerText(inputs);
}

function buildRepairTurnInputs({ prepared, contactSheets, validationError, priorTurnOutput, repairAttemptCount }) {
  const outputContract = {
    boundaries: "non-empty array, strictly ascending by timestamp",
    "boundaries[].timestamp": "number, seconds, 0 < timestamp < durationSeconds",
    "boundaries[].confidence": "number, 0..1",
    "boundaries[].boundaryType": "string",
    "boundaries[].reason": "short string",
    "boundaries[].needReview": "boolean",
    shots: "array, should align with detected shots count, each item describes what this shot contains",
    "shots[].summary": "string, 8-24 chars preferred, describe subject/action/scene, no timestamps or local paths",
  };
  const priorOutputText = String(priorTurnOutput ?? "").trim();
  const manifest = {
    durationSeconds: round(prepared.durationSeconds),
    analysisSampling: toPromptAnalysisSampling(prepared.analysisSampling),
    sheetCount: contactSheets.length,
    subtitleContextSummary: prepared.subtitleContextSummary ?? { subtitleSegmentCount: 0, subtitleTextHash: null, truncated: false },
  };
  if (Array.isArray(prepared.subtitleContext) && prepared.subtitleContext.length) manifest.subtitleContext = prepared.subtitleContext;
  const prompt = [
    "上一次切镜输出未通过校验。请在同一任务上修复，只返回 JSON object。",
    "联表中的帧已经按目标时间网格从抽帧结果中选出，模型只需要基于这些帧判断边界，不需要自行重采样。",
    `修复轮次：${repairAttemptCount}`,
    `任务输入：${JSON.stringify(manifest)}`,
    `校验失败：${JSON.stringify(validationError.debugPayload?.validation ?? { code: validationError.code, message: validationError.message })}`,
    `上次输出摘要：${JSON.stringify({
      hasPriorOutput: Boolean(priorOutputText),
      outputLength: priorOutputText.length,
    })}`,
    `输出契约：${JSON.stringify(outputContract)}`,
    "要求：只保留你能确认的切换时间点；严格按时间升序；不要返回空 boundaries；继续输出 shots[].summary；字幕只作语义辅助，不作为唯一切镜依据；不要输出 frameId、路径或解释性正文。",
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
  const rawShots = Array.isArray(parsed.shots) ? parsed.shots : null;
  const normalizedBoundaries = normalizeTimestampBoundaries(rawBoundaries);
  const validation = validateTimestampBoundaries(normalizedBoundaries, prepared.durationSeconds);
  if (!validation.ok) {
    throw codedError("shot_boundary_validation_failed", validation.message, {
      turnId: turn?.turnId ?? null,
      outputSummary: summarizeAgentOutput(message, rawBoundaries, normalizedBoundaries, rawShots),
      validation: validation.summary,
    }, false);
  }
  const qualityIssue = detectReasonEncodingIssue(normalizedBoundaries);
  if (qualityIssue) {
    throw codedError("agent_output_quality_failed", "切镜 Agent 输出存在编码异常，已阻止写入 processed 产物", {
      turnId: turn?.turnId ?? null,
      parseFailureReason: qualityIssue.reason,
      outputSummary: summarizeAgentOutput(message, rawBoundaries, normalizedBoundaries, rawShots),
      suspiciousReason: qualityIssue.suspiciousReason,
      validation: validation.summary,
    }, false);
  }
  const mergedBoundaries = normalizedBoundaries;
  const shots = buildShotsFromBoundaries(mergedBoundaries, prepared.frames, prepared.durationSeconds, rawShots);
  return {
    artifactId: context.artifactId,
    parentArtifactId: prepared.sourceArtifactId,
    type: "shot-boundary-analysis",
    status: "processed",
    resultOrigin: options.resultOrigin ?? "new_turn",
    sourceFrameArtifactIds: prepared.frames.map((frame) => frame.artifactId),
    extractSampling: prepared.extractSampling,
    analysisSampling: prepared.analysisSampling,
    subtitleContextSummary: prepared.subtitleContextSummary ?? null,
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

function buildShotsFromBoundaries(boundaries, frames, durationSeconds, parsedShots = []) {
  const safeDuration = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 1;
  const safeParsedShots = Array.isArray(parsedShots) ? parsedShots : [];
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
      summary: resolveShotSummary(safeParsedShots[shots.length]?.summary, boundary.reason),
      endBoundaryReason: boundary.reason,
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
    summary: resolveShotSummary(safeParsedShots[shots.length]?.summary, boundaries.at(-1)?.reason ?? "视觉连续"),
    endBoundaryReason: null,
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
    analysisSampling: {
      fps: context.analysisFps,
      requestedFps: context.analysisFps,
      targetFrameCount: null,
      selectedFrameCount: null,
      effectiveFps: null,
      selectionPolicy: ANALYSIS_SELECTION_POLICY,
      duplicatePolicy: ANALYSIS_DUPLICATE_POLICY,
      roundingPolicy: ANALYSIS_SELECTION_POLICY,
      stride: null,
    },
    subtitleContextSummary: context.prepared?.subtitleContextSummary ?? null,
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
    validation: analysis.validation ?? null,
    createdAt: new Date().toISOString(),
  };
}

function evaluateCacheEligibility(analysis) {
  const status = analysis?.status === "processed";
  const validationPassed = analysis?.validation?.status === "passed";
  const hasBoundaries = Array.isArray(analysis?.boundaries) && analysis.boundaries.length > 0;
  const hasShots = Array.isArray(analysis?.shots) && analysis.shots.length > 0;
  const validatorClean = !analysis?.validation?.validatorCode;
  return {
    eligible: Boolean(status && validationPassed && hasBoundaries && hasShots && validatorClean),
    status,
    validationPassed,
    hasBoundaries,
    hasShots,
    validatorClean,
  };
}

function buildShotBoundaryCacheParams({
  sourceArtifactId,
  extractSampling,
  analysisSampling,
  frameDimensions,
  contactSheets,
  subtitleContextSummary,
  subtitleArtifactId,
  subtitleSegmentCount,
  subtitleTextHash,
  skillHash,
  skillPath = SKILL_PATH,
} = {}) {
  const sheets = Array.isArray(contactSheets) ? contactSheets : [];
  const resolvedSubtitleSummary = subtitleContextSummary ?? {
    subtitleArtifactId: subtitleArtifactId ?? null,
    subtitleSegmentCount: Number(subtitleSegmentCount ?? 0),
    subtitleTextHash: subtitleTextHash ?? null,
    truncated: false,
  };
  return {
    sourceArtifactId: sourceArtifactId ?? null,
    extractSampling: extractSampling ?? null,
    analysisSampling: analysisSampling ?? null,
    frameDimensions: frameDimensions ?? null,
    sheetCount: sheets.length,
    sheetLayouts: sheets.map((sheet) => ({
      frameCount: Number(sheet?.frameCount ?? 0),
      layout: sheet?.layout ?? null,
      constraints: sheet?.constraints ?? null,
      startTime: round(resolveSheetStartTime(sheet)),
      endTime: round(resolveSheetEndTime(sheet)),
    })),
    subtitleArtifactId: resolvedSubtitleSummary.subtitleArtifactId ?? null,
    subtitleSegmentCount: Number(resolvedSubtitleSummary.subtitleSegmentCount ?? 0),
    subtitleTextHash: resolvedSubtitleSummary.subtitleTextHash ?? null,
    skillHash: skillHash ?? skillContentHashSync(skillPath),
  };
}

function cacheParams(input, contactSheets, options = {}) {
  return buildShotBoundaryCacheParams({
    sourceArtifactId: input?.sourceArtifactId,
    extractSampling: input?.extractSampling,
    analysisSampling: input?.analysisSampling,
    frameDimensions: input?.frameDimensions,
    contactSheets,
    subtitleContextSummary: input?.subtitleContextSummary,
    skillHash: options.skillHash,
    skillPath: options.skillPath,
  });
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
    resultOrigin: details?.resultOrigin ?? null,
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

function summarizeAgentOutput(message, rawBoundaries, normalizedBoundaries, rawShots) {
  return {
    messagePreview: String(message ?? "").replace(/\s+/g, " ").slice(0, 200),
    rawBoundaryCount: Array.isArray(rawBoundaries) ? rawBoundaries.length : 0,
    normalizedBoundaryCount: Array.isArray(normalizedBoundaries) ? normalizedBoundaries.length : 0,
    rawShotCount: Array.isArray(rawShots) ? rawShots.length : 0,
    timestamps: Array.isArray(normalizedBoundaries) ? normalizedBoundaries.slice(0, 5).map((boundary) => boundary.timestamp) : [],
  };
}

function buildSubtitleContextSummary(subtitlesArtifact, durationSeconds) {
  if (!subtitlesArtifact || subtitlesArtifact.status !== "processed" || !Array.isArray(subtitlesArtifact.segments)) {
    return {
      items: [],
      summary: {
        subtitleArtifactId: null,
        subtitleSegmentCount: 0,
        subtitleTextHash: null,
        truncated: false,
      },
    };
  }
  const safeDuration = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : Number.POSITIVE_INFINITY;
  const relevantSegments = subtitlesArtifact.segments
    .map((segment) => ({
      start: roundNormalizedTime(Number(segment?.start ?? 0)),
      end: roundNormalizedTime(Number(segment?.end ?? 0)),
      text: normalizeSubtitleText(segment?.text),
    }))
    .filter((segment) => segment.text && segment.end >= 0 && segment.start <= safeDuration);
  const items = [];
  let totalChars = 0;
  let truncated = false;
  for (const segment of relevantSegments) {
    const nextChars = totalChars + segment.text.length;
    if (nextChars > MAX_SUBTITLE_CONTEXT_TOTAL_CHARS) {
      truncated = true;
      break;
    }
    items.push({
      start: segment.start,
      end: Math.max(segment.start, segment.end),
      text: segment.text,
    });
    totalChars = nextChars;
  }
  if (!items.length && relevantSegments.length > 0) truncated = true;
  return {
    items,
    summary: {
      subtitleArtifactId: subtitlesArtifact.artifactId ?? null,
      subtitleSegmentCount: items.length,
      subtitleTextHash: items.length ? contentHash(items.map((segment) => `${segment.start}-${segment.end}:${segment.text}`).join("\n")) : null,
      truncated,
    },
  };
}

function normalizeSubtitleText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_SUBTITLE_SEGMENT_TEXT_LENGTH);
}

function resolveShotSummary(summary, fallbackReason) {
  const normalized = String(summary ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (normalized) return normalized;
  return String(fallbackReason ?? "镜头内容").replace(/\s+/g, " ").trim().slice(0, 80) || "镜头内容";
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
  MIN_ANALYSIS_FPS,
  MAX_ANALYSIS_FPS,
  buildCacheReuseAnalysis,
  buildFailedArtifact,
  buildShotBoundaryCacheParams,
  buildProcessedAnalysis,
  buildRepairTurnInputs,
  buildTurnInputs,
  buildShotsFromBoundaries,
  cacheParams,
  codedError,
  evaluateCacheEligibility,
  normalizeTimestampBoundaries,
  prepareInput,
  resolveAnalysisSampling,
  resolveSkillHash,
  safeError,
  sanitizeDebugPayload,
  sanitizeForAppServerText,
  selectAnalysisFramesByTargetGrid,
  summarizeAgentOutput,
  validateTimestampBoundaries,
};
