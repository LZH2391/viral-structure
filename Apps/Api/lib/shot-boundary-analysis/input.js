const {
  FRAME_SAMPLING_POLICY,
  MIN_ANALYSIS_FPS,
  MAX_ANALYSIS_FPS,
  ANALYSIS_SELECTION_POLICY,
  ANALYSIS_DUPLICATE_POLICY,
  sanitizeForAppServerText,
  buildSubtitleContextSummary,
  resolveLocalImagePath,
  basename,
  round,
  roundNormalizedTime,
} = require("./shared");
const { renderTurnTemplate } = require("../role-profile-loader");

function prepareInput(artifact, analysisFps, { runtimeRoot = null } = {}) {
  const durationSeconds = Number(artifact.metadata?.durationSeconds ?? 0);
  const frames = Array.isArray(artifact.frames) ? artifact.frames : [];
  const summary = artifact.frameOutputSummary ?? {};
  const actualFrameCount = Number(summary.actualFrameCount ?? frames.length);
  const requestedFrameSampleRateFps = Number(summary.frameSampleRateFps ?? artifact.processingOptions?.frameSampleRateFps ?? 10);
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
    sheets: contactSheets.map((sheet) => ({
      startTime: round(require("./shared").resolveSheetStartTime(sheet)),
      endTime: round(require("./shared").resolveSheetEndTime(sheet)),
    })),
    subtitleContextSummary: prepared.subtitleContextSummary ?? { subtitleSegmentCount: 0, subtitleTextHash: null, truncated: false },
  };
  if (Array.isArray(prepared.subtitleContext) && prepared.subtitleContext.length) manifest.subtitleContext = prepared.subtitleContext;
  const metadata = {
    analysisSampling: toPromptAnalysisSampling(prepared.analysisSampling),
    sheetCount: contactSheets.length,
    sheets: contactSheets.map((sheet) => ({
      sheetIndex: sheet.sheetIndex,
      frameCount: sheet.frameCount,
      sheetId: sheet.sheetId ?? null,
    })),
  };
  const outputContract = buildShotOutputContract();
  return {
    manifest,
    metadata,
    outputContract,
  };
}

function buildShotOutputContract() {
  return {
    schemaVersion: "shot-centric.v2",
    shots: "non-empty array, sorted by time, each shot directly contains summary/start/end/endBoundary",
    "shots[].summary": "string, 8-24 chars preferred, describe what this shot contains, no timestamps/local paths/frameId/OCR raw text",
    "shots[].start": "number, seconds, first shot must start at 0",
    "shots[].end": "number, seconds, last shot must end at durationSeconds",
    "shots[].endBoundary": "object|null, null only for the last shot",
    "shots[].endBoundary.timestamp": "number, seconds, must equal current shot end, 0 < timestamp < durationSeconds",
    "shots[].endBoundary.confidence": "number, 0..1",
    "shots[].endBoundary.reason": "short string, explain why the cut happens here, not the shot summary",
    "shots[].endBoundary.needReview": "boolean",
  };
}

function buildCommerceBriefOutputContract() {
  return {
    schemaVersion: "commerce-brief.v1",
    commerceBrief: "object, summarize only what can be grounded from frames, subtitle context, and completed shots",
    "commerceBrief.sellingObject": "string, what is being sold, no fabricated brand/price/effect",
    "commerceBrief.proofApproach": "string, how the sample proves value using visuals/subtitles",
    "commerceBrief.promisedOutcome": "string, what problem or result is promised, grounded only",
    "commerceBrief.persuasionTarget": "string, who or what motivation is being persuaded",
    "commerceBrief.conversionAction": "string, must always exist; if absent in sample normalize to 未观察到明显转化动作",
    "commerceBrief.uncertainties": "string array only, uncertain points only, empty array allowed",
  };
}

function renderAnalyzeTurnInputs({ prepared, contactSheets, roleProfile }) {
  const built = buildTurnInputs({ prepared, contactSheets });
  const prompt = renderTurnTemplate(roleProfile, "analyze", {
    manifestJson: JSON.stringify(built.manifest),
    outputContractJson: JSON.stringify(built.outputContract),
  });
  const inputs = [{ type: "text", text: prompt.text, text_elements: [] }];
  for (const sheet of contactSheets) {
    inputs.push({ type: "localImage", path: sheet.localImagePath });
  }
  return {
    ...prompt,
    inputs: sanitizeForAppServerText(inputs),
    manifest: built.manifest,
    metadata: built.metadata,
    outputContract: built.outputContract,
  };
}

function buildRepairTurnInputs({ prepared, contactSheets, validationError, priorTurnOutput, repairAttemptCount }) {
  const outputContract = buildShotOutputContract();
  const priorOutputText = String(priorTurnOutput ?? "").trim();
  const manifest = {
    durationSeconds: round(prepared.durationSeconds),
    sheets: contactSheets.map((sheet) => ({
      startTime: round(require("./shared").resolveSheetStartTime(sheet)),
      endTime: round(require("./shared").resolveSheetEndTime(sheet)),
    })),
    subtitleContextSummary: prepared.subtitleContextSummary ?? { subtitleSegmentCount: 0, subtitleTextHash: null, truncated: false },
  };
  if (Array.isArray(prepared.subtitleContext) && prepared.subtitleContext.length) manifest.subtitleContext = prepared.subtitleContext;
  const metadata = {
    analysisSampling: toPromptAnalysisSampling(prepared.analysisSampling),
    sheetCount: contactSheets.length,
    sheets: contactSheets.map((sheet) => ({
      sheetIndex: sheet.sheetIndex,
      frameCount: sheet.frameCount,
      sheetId: sheet.sheetId ?? null,
    })),
  };
  return {
    manifest,
    metadata,
    outputContract,
    validation: validationError.debugPayload?.validation ?? { code: validationError.code, message: validationError.message },
    priorOutputSummary: {
      hasPriorOutput: Boolean(priorOutputText),
      outputLength: priorOutputText.length,
    },
  };
}

function renderRepairTurnInputs({ prepared, contactSheets, validationError, priorTurnOutput, repairAttemptCount, roleProfile }) {
  const built = buildRepairTurnInputs({ prepared, contactSheets, validationError, priorTurnOutput, repairAttemptCount });
  const prompt = renderTurnTemplate(roleProfile, "repair", {
    repairAttemptCount,
    manifestJson: JSON.stringify(built.manifest),
    validationJson: JSON.stringify(built.validation),
    priorOutputSummaryJson: JSON.stringify(built.priorOutputSummary),
    outputContractJson: JSON.stringify(built.outputContract),
  });
  const inputs = [{ type: "text", text: prompt.text, text_elements: [] }];
  for (const sheet of contactSheets) {
    inputs.push({ type: "localImage", path: sheet.localImagePath });
  }
  return {
    ...prompt,
    inputs: sanitizeForAppServerText(inputs),
    ...built,
  };
}

function buildSummaryTurnInputs({ shots }) {
  return {
    outputContract: buildCommerceBriefOutputContract(),
    shotSummary: {
      shotCount: Array.isArray(shots) ? shots.length : 0,
      shots: Array.isArray(shots)
        ? shots.map((shot) => ({
          shotNo: shot.shotNo ?? null,
          start: shot.start ?? null,
          end: shot.end ?? null,
          summary: shot.summary ?? null,
          endBoundaryReason: shot.endBoundaryReason ?? null,
        }))
        : [],
    },
  };
}

function renderSummaryTurnInputs({ shots, roleProfile }) {
  const built = buildSummaryTurnInputs({ shots });
  const prompt = renderTurnTemplate(roleProfile, "summary", {
    shotsJson: JSON.stringify(built.shotSummary),
    outputContractJson: JSON.stringify(built.outputContract),
  });
  return {
    ...prompt,
    inputs: sanitizeForAppServerText([{ type: "text", text: prompt.text, text_elements: [] }]),
    ...built,
  };
}

module.exports = {
  prepareInput,
  resolveAnalysisSampling,
  selectAnalysisFramesByTargetGrid,
  buildTargetGridTimes,
  countTargetGridFrames,
  toPromptAnalysisSampling,
  buildTurnInputs,
  buildShotOutputContract,
  buildCommerceBriefOutputContract,
  renderAnalyzeTurnInputs,
  buildRepairTurnInputs,
  renderRepairTurnInputs,
  buildSummaryTurnInputs,
  renderSummaryTurnInputs,
};
