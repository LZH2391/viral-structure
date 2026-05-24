const path = require("path");
const { randomUUID } = require("crypto");
const { runCommand } = require("./ffmpeg-runner");

const DEFAULT_PARAMS = {
  sampleRate: 22050,
  hopLength: 512,
  nFft: 2048,
  maxEnergyFrames: 240,
  maxEventCandidates: 80,
  sourceRole: "original",
  pannsEnabled: true,
  pannsCheckpointPath: process.env.PANNS_CHECKPOINT_PATH || null,
};

async function isLibrosaAvailable({ command = pythonCommand(), runner = runCommand } = {}) {
  try {
    await runner(command, ["-c", "import librosa; print(librosa.__version__)"]);
    return true;
  } catch {
    return false;
  }
}

async function extractAudioFeatures({ audioPath, parentArtifactId, sourceAudioArtifactId = parentArtifactId, store, params = {}, runner = runCommand }) {
  const finalParams = { ...DEFAULT_PARAMS, ...params };
  try {
    const { stdout } = await runner(pythonCommand(), [
      scriptPath(),
      "--input",
      audioPath,
      "--sample-rate",
      String(finalParams.sampleRate),
      "--hop-length",
      String(finalParams.hopLength),
      "--n-fft",
      String(finalParams.nFft),
      "--max-energy-frames",
      String(finalParams.maxEnergyFrames),
      "--source-role",
      finalParams.sourceRole,
      "--max-event-candidates",
      String(finalParams.maxEventCandidates),
      ...(finalParams.pannsEnabled ? [] : ["--disable-panns"]),
      ...(finalParams.pannsCheckpointPath ? ["--panns-checkpoint-path", finalParams.pannsCheckpointPath] : []),
    ]);
    return buildAudioFeaturesArtifact({
      parentArtifactId,
      sourceAudioArtifactId,
      result: validateLibrosaResult(JSON.parse(stdout)),
    });
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw librosaError("audio_feature_invalid_json", "音频基础分析输出格式无效", error);
    }
    throw librosaError(error.code || "audio_feature_analysis_failed", "音频基础分析失败", error);
  }
}

function buildAudioFeaturesArtifact({ parentArtifactId, sourceAudioArtifactId, result, status = "processed", reason = null, debugSnapshotUri = null }) {
  return {
    artifactId: `artifact_${randomUUID()}`,
    parentArtifactId,
    type: "audio-feature-analysis",
    status,
    reason,
    debugSnapshotUri,
    sourceAudioArtifactId,
    durationSeconds: result.durationSeconds,
    tempoBpm: result.tempoBpm,
    beats: result.beats,
    onsets: result.onsets,
    energyFrames: result.energyFrames,
    spectralSummary: result.spectralSummary,
    audioEventCandidates: result.audioEventCandidates,
    audioRegions: result.audioRegions,
    classificationSummary: result.classificationSummary,
    analysisParams: result.analysisParams,
  };
}

function audioFeaturesDegraded({ parentArtifactId, sourceAudioArtifactId = parentArtifactId, reason, debugSnapshotUri = null, params = {} }) {
  const finalParams = { ...DEFAULT_PARAMS, ...params };
  return {
    artifactId: `artifact_${randomUUID()}`,
    parentArtifactId,
    type: "audio-feature-analysis",
    status: "degraded",
    reason,
    debugSnapshotUri,
    sourceAudioArtifactId,
    durationSeconds: null,
    tempoBpm: null,
    beats: [],
    onsets: [],
    energyFrames: [],
    spectralSummary: {},
    audioEventCandidates: [],
    audioRegions: [],
    classificationSummary: {
      status: "degraded",
      reason,
      model: finalParams.pannsEnabled ? "panns-cnn14-audioset" : null,
      wholeFileTopLabels: [],
      chunks: [],
    },
    analysisParams: {
      librosaVersion: null,
      sampleRate: finalParams.sampleRate,
      hopLength: finalParams.hopLength,
      nFft: finalParams.nFft,
      sourceRole: finalParams.sourceRole,
      eventWindowSeconds: null,
      pannsEnabled: Boolean(finalParams.pannsEnabled),
      pannsModel: finalParams.pannsEnabled ? "panns-cnn14-audioset" : null,
      pannsCheckpointPath: finalParams.pannsCheckpointPath,
    },
  };
}

function validateLibrosaResult(result) {
  const normalized = {
    durationSeconds: optionalNumber(result.durationSeconds),
    tempoBpm: optionalNumber(result.tempoBpm),
    beats: sortedNumberArray(result.beats),
    onsets: sortedNumberArray(result.onsets),
    energyFrames: normalizeEnergyFrames(result.energyFrames),
    spectralSummary: normalizeSpectralSummary(result.spectralSummary),
    audioEventCandidates: normalizeAudioEventCandidates(result.audioEventCandidates),
    audioRegions: normalizeAudioRegions(result.audioRegions),
    classificationSummary: normalizeClassificationSummary(result.classificationSummary),
    analysisParams: normalizeAnalysisParams(result.analysisParams),
  };
  return normalized;
}

function sortedNumberArray(values) {
  return (Array.isArray(values) ? values : [])
    .map(optionalNumber)
    .filter((value) => value !== null && value >= 0)
    .sort((a, b) => a - b);
}

function normalizeEnergyFrames(values) {
  return (Array.isArray(values) ? values : [])
    .map((item) => ({
      time: optionalNumber(item?.time),
      rms: optionalNumber(item?.rms),
    }))
    .filter((item) => item.time !== null && item.rms !== null && item.time >= 0)
    .sort((a, b) => a.time - b.time);
}

function normalizeSpectralSummary(value = {}) {
  return {
    centroidMean: optionalNumber(value.centroidMean),
    bandwidthMean: optionalNumber(value.bandwidthMean),
    rolloffMean: optionalNumber(value.rolloffMean),
    zeroCrossingRateMean: optionalNumber(value.zeroCrossingRateMean),
    flatnessMean: optionalNumber(value.flatnessMean),
    entropyMean: optionalNumber(value.entropyMean),
  };
}

function normalizeAudioEventCandidates(values) {
  return (Array.isArray(values) ? values : [])
    .map((item) => {
      const time = optionalNumber(item?.time);
      const start = optionalNumber(item?.start);
      const end = optionalNumber(item?.end);
      const confidence = optionalNumber(item?.confidence);
      return {
        time,
        start,
        end,
        kind: item?.kind ? String(item.kind) : "unknown",
        confidence,
        usableForEdit: Boolean(item?.usableForEdit),
        evidence: normalizeAudioEvidence(item?.evidence),
      };
    })
    .filter((item) => item.time !== null && item.time >= 0 && item.confidence !== null && item.confidence >= 0 && item.confidence <= 1)
    .sort((a, b) => a.time - b.time);
}

function normalizeAudioEvidence(value = {}) {
  return {
    rms: optionalNumber(value.rms),
    onsetPeak: optionalNumber(value.onsetPeak),
    harmonicRms: optionalNumber(value.harmonicRms),
    percussiveRms: optionalNumber(value.percussiveRms),
    spectralFlatness: optionalNumber(value.spectralFlatness),
    spectralEntropy: optionalNumber(value.spectralEntropy),
    bandEnergyRatios: {
      low: optionalNumber(value.bandEnergyRatios?.low),
      mid: optionalNumber(value.bandEnergyRatios?.mid),
      presence: optionalNumber(value.bandEnergyRatios?.presence),
      high: optionalNumber(value.bandEnergyRatios?.high),
    },
    labels: (Array.isArray(value.labels) ? value.labels : []).map((label) => String(label)),
  };
}

function normalizeAudioRegions(values) {
  return (Array.isArray(values) ? values : [])
    .map((item) => ({
      label: item?.label ? String(item.label) : "unknown",
      start: optionalNumber(item?.start),
      end: optionalNumber(item?.end),
      peakRms: optionalNumber(item?.peakRms),
      peakOnset: optionalNumber(item?.peakOnset),
      count: optionalNumber(item?.count),
    }))
    .filter((item) => item.start !== null && item.end !== null && item.start >= 0 && item.end >= item.start)
    .sort((a, b) => a.start - b.start || a.label.localeCompare(b.label));
}

function normalizeClassificationSummary(value = {}) {
  return {
    status: value.status ? String(value.status) : "not_run",
    reason: value.reason ? String(value.reason) : null,
    model: value.model ? String(value.model) : null,
    wholeFileTopLabels: normalizeTopLabels(value.wholeFileTopLabels),
    chunks: (Array.isArray(value.chunks) ? value.chunks : [])
      .map((chunk) => ({
        start: optionalNumber(chunk?.start),
        end: optionalNumber(chunk?.end),
        topLabels: normalizeTopLabels(chunk?.topLabels),
      }))
      .filter((chunk) => chunk.start !== null && chunk.end !== null && chunk.end >= chunk.start)
      .sort((a, b) => a.start - b.start),
  };
}

function normalizeTopLabels(values) {
  return (Array.isArray(values) ? values : [])
    .map((item) => ({
      label: item?.label ? String(item.label) : "unknown",
      score: optionalNumber(item?.score),
    }))
    .filter((item) => item.score !== null && item.score >= 0)
    .sort((a, b) => b.score - a.score);
}

function normalizeAnalysisParams(value = {}) {
  return {
    librosaVersion: value.librosaVersion ? String(value.librosaVersion) : null,
    sampleRate: optionalNumber(value.sampleRate),
    hopLength: optionalNumber(value.hopLength),
    nFft: optionalNumber(value.nFft),
    sourceRole: value.sourceRole ? String(value.sourceRole) : DEFAULT_PARAMS.sourceRole,
    eventWindowSeconds: optionalNumber(value.eventWindowSeconds),
    pannsEnabled: value.pannsEnabled === undefined ? null : Boolean(value.pannsEnabled),
    pannsModel: value.pannsModel ? String(value.pannsModel) : null,
    pannsCheckpointPath: value.pannsCheckpointPath ? String(value.pannsCheckpointPath) : null,
  };
}

function optionalNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function librosaError(code, message, cause) {
  const error = new Error(message);
  error.code = code;
  error.safeSummary = message;
  error.mediaDebug = {
    commandSummary: cause?.commandSummary ?? { command: pythonCommand(), args: ["<path:librosa_features.py>", "--input", "<path:audio>"] },
    stderrSummary: cause?.stderrSummary ?? null,
    exitCode: cause?.exitCode ?? null,
    retryable: false,
    mediaOperation: "audio.features.extract",
  };
  return error;
}

function scriptPath() {
  return path.join(__dirname, "librosa_features.py");
}

function pythonCommand() {
  return process.env.PYTHON || "python";
}

module.exports = {
  DEFAULT_PARAMS,
  isLibrosaAvailable,
  extractAudioFeatures,
  buildAudioFeaturesArtifact,
  audioFeaturesDegraded,
  validateLibrosaResult,
};
