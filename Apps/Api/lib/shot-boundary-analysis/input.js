const {
  FRAME_SAMPLING_POLICY,
  MIN_ANALYSIS_FPS,
  MAX_ANALYSIS_FPS,
  ANALYSIS_SELECTION_POLICY,
  ANALYSIS_DUPLICATE_POLICY,
  SKILL_PATH,
  sanitizeForAppServerText,
  buildSubtitleContextSummary,
  resolveLocalImagePath,
  basename,
  round,
  roundNormalizedTime,
} = require("./shared");

function prepareInput(artifact, analysisFps, { runtimeRoot = null } = {}) {
  const durationSeconds = Number(artifact.metadata?.durationSeconds ?? 0);
  const frames = Array.isArray(artifact.frames) ? artifact.frames : [];
  const summary = artifact.frameOutputSummary ?? {};
  const actualFrameCount = Number(summary.actualFrameCount ?? frames.length);
  const requestedFrameSampleRateFps = Number(summary.frameSampleRateFps ?? artifact.processingOptions?.frameSampleRateFps ?? 1);
  const requestedAnalysisFps = Number(analysisFps ?? 0);
  if (!durationSeconds || !frames.length || !Number.isFinite(requestedFrameSampleRateFps) || requestedFrameSampleRateFps <= 0) {
    throw require("./shared").codedError("shot_boundary_input_invalid", "抽帧产物不足，无法启动镜头切分");
  }
  if (!Number.isFinite(requestedAnalysisFps) || !Number.isInteger(requestedAnalysisFps) || requestedAnalysisFps < MIN_ANALYSIS_FPS || requestedAnalysisFps > MAX_ANALYSIS_FPS) {
    throw require("./shared").codedError("analysis_fps_invalid", "分析采样率无效，请输入 1 到 10 之间的整数");
  }
  if (requestedAnalysisFps > requestedFrameSampleRateFps) {
    throw require("./shared").codedError("analysis_fps_exceeds_extract_fps", "分析采样率高于抽帧采样率，请重新抽帧或降低分析采样率");
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
      startTime: round(require("./shared").resolveSheetStartTime(sheet)),
      endTime: round(require("./shared").resolveSheetEndTime(sheet)),
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

module.exports = {
  prepareInput,
  resolveAnalysisSampling,
  selectAnalysisFramesByTargetGrid,
  buildTargetGridTimes,
  countTargetGridFrames,
  toPromptAnalysisSampling,
  buildTurnInputs,
  buildRepairTurnInputs,
};
