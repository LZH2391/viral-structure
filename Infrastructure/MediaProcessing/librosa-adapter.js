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
    loudnessSummary: result.loudnessSummary,
    beatFrames: result.beatFrames,
    onsetFrames: result.onsetFrames,
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
    loudnessSummary: emptyLoudnessSummary("degraded"),
    beatFrames: [],
    onsetFrames: [],
    spectralSummary: {},
    analysisParams: {
      librosaVersion: null,
      sampleRate: finalParams.sampleRate,
      hopLength: finalParams.hopLength,
      nFft: finalParams.nFft,
      sourceRole: finalParams.sourceRole,
      energyGate: defaultEnergyGate(null),
    },
  };
}

function validateLibrosaResult(result) {
  const energyFrames = normalizeEnergyFrames(result.energyFrames);
  const loudnessSummary = normalizeLoudnessSummary(result.loudnessSummary, energyFrames);
  const energyGate = defaultEnergyGate(loudnessSummary.noiseFloorDbfs);
  const rawBeats = sortedNumberArray(result.beats);
  const rawOnsets = sortedNumberArray(result.onsets);
  const beatFrames = normalizeMarkerFrames(result.beatFrames, rawBeats, "beat", energyFrames, loudnessSummary, energyGate);
  const onsetFrames = normalizeMarkerFrames(result.onsetFrames, rawOnsets, "onset", energyFrames, loudnessSummary, energyGate);
  return {
    durationSeconds: optionalNumber(result.durationSeconds),
    tempoBpm: optionalNumber(result.tempoBpm),
    beats: beatFrames.filter((marker) => marker.valid).map((marker) => marker.time),
    onsets: onsetFrames.filter((marker) => marker.valid).map((marker) => marker.time),
    energyFrames,
    loudnessSummary,
    beatFrames,
    onsetFrames,
    spectralSummary: normalizeSpectralSummary(result.spectralSummary),
    analysisParams: normalizeAnalysisParams(result.analysisParams, energyGate),
  };
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
      dbfs: optionalNumber(item?.dbfs) ?? rmsToDbfs(optionalNumber(item?.rms)),
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

function normalizeAnalysisParams(value = {}, energyGate = defaultEnergyGate(null)) {
  return {
    librosaVersion: value.librosaVersion ? String(value.librosaVersion) : null,
    sampleRate: optionalNumber(value.sampleRate),
    hopLength: optionalNumber(value.hopLength),
    nFft: optionalNumber(value.nFft),
    sourceRole: value.sourceRole ? String(value.sourceRole) : DEFAULT_PARAMS.sourceRole,
    energyGate: normalizeEnergyGate(value.energyGate, energyGate),
  };
}

function normalizeLoudnessSummary(value = {}, energyFrames = []) {
  const dbfsValues = energyFrames.map((frame) => frame.dbfs).filter((item) => item !== null).sort((a, b) => a - b);
  if (!dbfsValues.length) return emptyLoudnessSummary("no_energy_frames");
  const noiseFloorDbfs = optionalNumber(value.noiseFloorDbfs) ?? percentile(dbfsValues, 0.1);
  const activeThresholdDbfs = Math.max(-48, noiseFloorDbfs + 10);
  const measuredActiveRatio = dbfsValues.length < 3 ? 1 : dbfsValues.filter((item) => item >= activeThresholdDbfs).length / dbfsValues.length;
  const activeRatio = optionalNumber(value.activeRatio) ?? measuredActiveRatio;
  const rmsP95Dbfs = optionalNumber(value.rmsP95Dbfs) ?? percentile(dbfsValues, 0.95);
  const lowSignal = Boolean(value.lowSignal ?? (rmsP95Dbfs < -50 || activeRatio < 0.03));
  return {
    rmsP50Dbfs: optionalNumber(value.rmsP50Dbfs) ?? percentile(dbfsValues, 0.5),
    rmsP95Dbfs,
    peakP95Dbfs: optionalNumber(value.peakP95Dbfs) ?? rmsP95Dbfs,
    noiseFloorDbfs,
    activeRatio,
    lowSignal,
    gateReason: value.gateReason ? String(value.gateReason) : lowSignal ? "low_signal" : null,
  };
}

function emptyLoudnessSummary(gateReason = null) {
  return {
    rmsP50Dbfs: null,
    rmsP95Dbfs: null,
    peakP95Dbfs: null,
    noiseFloorDbfs: null,
    activeRatio: 0,
    lowSignal: gateReason !== null,
    gateReason,
  };
}

function normalizeMarkerFrames(values, fallbackTimes, type, energyFrames, loudnessSummary, energyGate) {
  const source = Array.isArray(values) && values.length ? values : fallbackTimes.map((time) => ({ time }));
  return source
    .map((item) => normalizeMarkerFrame(item, type, energyFrames, loudnessSummary, energyGate))
    .filter((item) => item !== null)
    .sort((a, b) => a.time - b.time);
}

function normalizeMarkerFrame(item, type, energyFrames, loudnessSummary, energyGate) {
  const time = optionalNumber(item?.time ?? item);
  if (time === null || time < 0) return null;
  const nearest = nearestEnergyFrame(energyFrames, time);
  const rms = optionalNumber(item?.rms) ?? nearest?.rms ?? null;
  const dbfs = optionalNumber(item?.dbfs) ?? nearest?.dbfs ?? rmsToDbfs(rms);
  const energyRank = optionalNumber(item?.energyRank) ?? energyRankForDbfs(energyFrames, dbfs);
  const suppliedValid = typeof item?.valid === "boolean" ? item.valid : null;
  const suppliedReason = item?.reason ? String(item.reason) : null;
  const lowSignal = loudnessSummary.lowSignal;
  const belowGate = dbfs === null || dbfs < energyGate.markerThresholdDbfs;
  const valid = lowSignal ? false : suppliedValid ?? !belowGate;
  const reason = lowSignal ? "low_signal" : valid ? null : suppliedReason ?? "below_marker_threshold";
  return { time, rms, dbfs, energyRank, valid, reason };
}

function nearestEnergyFrame(energyFrames, time) {
  if (!energyFrames.length) return null;
  let best = energyFrames[0];
  for (const frame of energyFrames) {
    if (Math.abs(frame.time - time) < Math.abs(best.time - time)) best = frame;
  }
  return best;
}

function energyRankForDbfs(energyFrames, dbfs) {
  if (dbfs === null || !energyFrames.length) return null;
  const valid = energyFrames.map((frame) => frame.dbfs).filter((item) => item !== null).sort((a, b) => a - b);
  if (!valid.length) return null;
  const belowOrEqual = valid.filter((value) => value <= dbfs).length;
  return Number((belowOrEqual / valid.length).toFixed(4));
}

function defaultEnergyGate(noiseFloorDbfs) {
  const floor = optionalNumber(noiseFloorDbfs);
  return {
    noiseFloorDbfs: floor,
    activeThresholdDbfs: floor === null ? -48 : Math.max(-48, floor + 10),
    markerThresholdDbfs: floor === null ? -45 : Math.max(-45, floor + 12),
    lowSignalRmsP95Dbfs: -50,
    lowSignalActiveRatio: 0.03,
  };
}

function normalizeEnergyGate(value = {}, fallback) {
  return {
    noiseFloorDbfs: optionalNumber(value.noiseFloorDbfs) ?? fallback.noiseFloorDbfs,
    activeThresholdDbfs: optionalNumber(value.activeThresholdDbfs) ?? fallback.activeThresholdDbfs,
    markerThresholdDbfs: optionalNumber(value.markerThresholdDbfs) ?? fallback.markerThresholdDbfs,
    lowSignalRmsP95Dbfs: optionalNumber(value.lowSignalRmsP95Dbfs) ?? fallback.lowSignalRmsP95Dbfs,
    lowSignalActiveRatio: optionalNumber(value.lowSignalActiveRatio) ?? fallback.lowSignalActiveRatio,
  };
}

function rmsToDbfs(rms) {
  const value = optionalNumber(rms);
  if (value === null) return null;
  return 20 * Math.log10(Math.max(value, 0.000001));
}

function percentile(values, ratio) {
  if (!values.length) return null;
  return values[Math.min(values.length - 1, Math.max(0, Math.floor(values.length * ratio)))];
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
