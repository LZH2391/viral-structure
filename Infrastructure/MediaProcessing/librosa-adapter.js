const path = require("path");
const { randomUUID } = require("crypto");
const { runCommand } = require("./ffmpeg-runner");

const DEFAULT_PARAMS = {
  sampleRate: 22050,
  hopLength: 512,
  nFft: 2048,
  maxEnergyFrames: 240,
  sourceRole: "original",
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
    analysisParams: {
      librosaVersion: null,
      sampleRate: finalParams.sampleRate,
      hopLength: finalParams.hopLength,
      nFft: finalParams.nFft,
      sourceRole: finalParams.sourceRole,
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
  };
}

function normalizeAnalysisParams(value = {}) {
  return {
    librosaVersion: value.librosaVersion ? String(value.librosaVersion) : null,
    sampleRate: optionalNumber(value.sampleRate),
    hopLength: optionalNumber(value.hopLength),
    nFft: optionalNumber(value.nFft),
    sourceRole: value.sourceRole ? String(value.sourceRole) : DEFAULT_PARAMS.sourceRole,
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
