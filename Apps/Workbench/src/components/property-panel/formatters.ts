import type { AudioFeatureAnalysisArtifact, AudioFeatureMarker, RhythmStructureArtifact, RhythmStructureHistoryEntry, SampleVideo, ScriptSegmentArtifact, ScriptSegmentHistoryEntry, ShotBoundaryAnalysisArtifact, ShotBoundaryAnalysisHistoryEntry } from "../../types";

const MIN_ANALYSIS_FPS = 1;
const MAX_ANALYSIS_FPS = 10;

export function markerLabel(type: AudioFeatureMarker["type"]) {
  return type === "beat" ? "beat 标记" : "onset 标记";
}

export function nearestRms(audioFeatures: AudioFeatureAnalysisArtifact, time: number) {
  const frames = audioFeatures.energyFrames ?? [];
  if (!frames.length) return null;
  let best = frames[0];
  for (const frame of frames) {
    if (Math.abs(frame.time - time) < Math.abs(best.time - time)) best = frame;
  }
  return best.rms;
}

export function findAudioFeatureMarker(audioFeatures: AudioFeatureAnalysisArtifact | null | undefined, markerId: string | null): AudioFeatureMarker | null {
  if (!audioFeatures || !markerId) return null;
  const markers = [
    ...(audioFeatures.beats ?? []).map((time, index) => ({ id: `beat_${index}_${time}`, type: "beat" as const, time, rms: nearestRms(audioFeatures, time) })),
    ...(audioFeatures.onsets ?? []).map((time, index) => ({ id: `onset_${index}_${time}`, type: "onset" as const, time, rms: nearestRms(audioFeatures, time) })),
  ];
  return markers.find((item) => item.id === markerId) ?? null;
}

export function resolveMaxAnalysisFps(sampleVideo: SampleVideo | null): number {
  const summary = sampleVideo?.frameOutputSummary;
  const resolved = Number(summary?.frameSampleRateFps ?? sampleVideo?.processingOptions?.frameSampleRateFps ?? 24);
  const safe = Number.isFinite(resolved) && resolved > 0 ? resolved : 24;
  return Math.max(MIN_ANALYSIS_FPS, Math.min(MAX_ANALYSIS_FPS, Math.floor(safe)));
}

export function countTargetGridFrames(durationSeconds: number, requestedFps: number) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || !Number.isFinite(requestedFps) || requestedFps <= 0) return 0;
  const step = 1 / requestedFps;
  let count = 0;
  for (let targetTime = 0; targetTime < durationSeconds; targetTime += step) count += 1;
  return count;
}

export function resolveAnalysisSamplingPreview(sampleVideo: SampleVideo | null, requestedAnalysisFps: number) {
  const requestedFrameSampleRateFps = Number(sampleVideo?.frameOutputSummary?.frameSampleRateFps ?? sampleVideo?.processingOptions?.frameSampleRateFps ?? 0);
  if (!Number.isFinite(requestedFrameSampleRateFps) || requestedFrameSampleRateFps <= 0) return null;
  if (!Number.isFinite(requestedAnalysisFps) || requestedAnalysisFps <= 0) return null;
  const durationSeconds = Number(sampleVideo?.duration ?? 0);
  const availableFrameCount = Number(sampleVideo?.frameOutputSummary?.actualFrameCount ?? sampleVideo?.frameArtifacts.length ?? 0);
  const targetFrameCount = countTargetGridFrames(durationSeconds, requestedAnalysisFps);
  const selectedFrameCount = Math.min(targetFrameCount, Number.isFinite(availableFrameCount) && availableFrameCount > 0 ? availableFrameCount : targetFrameCount);
  return {
    requestedFps: requestedAnalysisFps,
    targetFrameCount,
    selectedFrameCount,
    effectiveFps: durationSeconds > 0 ? roundToThree(selectedFrameCount / durationSeconds) : null,
    selectionPolicy: "target_grid_nearest_unique",
  };
}

export function resolveAnalysisFpsExceededHint(sampleVideo: SampleVideo | null, requestedAnalysisFps: number) {
  const currentFrameSampleRateFps = Number(sampleVideo?.frameOutputSummary?.frameSampleRateFps ?? sampleVideo?.processingOptions?.frameSampleRateFps ?? 0);
  if (!Number.isFinite(currentFrameSampleRateFps) || currentFrameSampleRateFps <= 0) return null;
  if (!Number.isFinite(requestedAnalysisFps) || requestedAnalysisFps <= currentFrameSampleRateFps) return null;
  return `当前样例抽帧 fps 为 ${formatFpsValue(currentFrameSampleRateFps)}；如需更高分析 fps，请用更高抽帧 fps 重新处理并确认成功。`;
}

export function resolveRenderedAnalysisSampling(analysis?: ShotBoundaryAnalysisArtifact | null) {
  const requestedFps = Number(analysis?.analysisSampling?.requestedFps ?? analysis?.analysisSampling?.fps ?? Number.NaN);
  return {
    requestedFps,
    effectiveFps: Number(analysis?.analysisSampling?.effectiveFps ?? Number.NaN),
    targetFrameCount: analysis?.analysisSampling?.targetFrameCount ?? null,
    selectedFrameCount: analysis?.analysisSampling?.selectedFrameCount ?? null,
    selectionPolicy: analysis?.analysisSampling?.selectionPolicy ?? "target_grid_nearest_unique",
    stride: analysis?.analysisSampling?.stride ?? null,
    isLegacyStride: false,
    roundingPolicy: analysis?.analysisSampling?.roundingPolicy ?? "target_grid_nearest_unique",
  };
}

export function resolveShotSummary(shot: ShotBoundaryAnalysisArtifact["shots"][number]) {
  return String(shot.summary ?? shot.reason ?? "镜头内容").trim() || "镜头内容";
}

export function resolveShotEndBoundaryReason(shot: ShotBoundaryAnalysisArtifact["shots"][number]) {
  const text = String(shot.endBoundaryReason ?? shot.reason ?? "").trim();
  return text || null;
}

export function formatFpsValue(value?: number | null) {
  if (!Number.isFinite(value)) return "无";
  return trimTrailingZeros(roundToThree(Number(value)).toFixed(3));
}

export function roundToThree(value: number) {
  return Math.round(value * 1000) / 1000;
}

export function trimTrailingZeros(value: string) {
  return value.replace(/\.?0+$/, "");
}

export function formatNumber(value?: number | null, suffix = "") {
  if (!Number.isFinite(value)) return "无";
  const number = Number(value);
  return `${Math.abs(number) >= 10 ? number.toFixed(2) : number.toFixed(4)}${suffix}`;
}

export function resolutionText(sampleVideo: SampleVideo) {
  if (!sampleVideo.width || !sampleVideo.height) return "未知";
  const ratio = Number.isFinite(sampleVideo.aspectRatio) && sampleVideo.aspectRatio ? ` / ${sampleVideo.aspectRatio.toFixed(2)}:1` : "";
  return `${sampleVideo.width} x ${sampleVideo.height}${ratio}`;
}

export function renderResultOrigin(origin?: ShotBoundaryAnalysisArtifact["resultOrigin"]) {
  if (origin === "repaired_turn") return "repaired turn";
  if (origin === "cache_reuse") return "cache reuse";
  if (origin === "failed_validation") return "failed validation";
  return "new turn";
}

export function renderScriptResultOrigin(origin?: ScriptSegmentArtifact["resultOrigin"]) {
  if (origin === "repaired_turn") return "repaired turn";
  if (origin === "cache_reuse") return "cache reuse";
  if (origin === "failed_validation") return "failed validation";
  return "new turn";
}

export function renderRhythmResultOrigin(origin?: RhythmStructureArtifact["resultOrigin"]) {
  if (origin === "repaired_turn") return "repaired turn";
  if (origin === "cache_reuse") return "cache reuse";
  if (origin === "failed_validation") return "failed validation";
  return "new turn";
}

export function shortTurnId(turnId: string) {
  return turnId.length > 10 ? turnId.slice(-10) : turnId;
}

export function isValidShotResult(analysis?: ShotBoundaryAnalysisArtifact | null) {
  if (!analysis) return false;
  if (analysis.status === "failed" || analysis.validation?.status === "failed") return false;
  const boundaries = analysis.boundaries ?? [];
  const shots = analysis.shots ?? [];
  const looksLikeLegacyFallback = boundaries.length === 0
    && shots.length === 1
    && /未检测到明确切镜边界/.test(String(shots[0]?.reason ?? ""));
  if (looksLikeLegacyFallback) return false;
  return boundaries.length > 0 && shots.length > 0;
}

export function formatHistoryMeta(entry: ShotBoundaryAnalysisHistoryEntry) {
  const time = entry.createdAt ? new Date(entry.createdAt).toLocaleString("zh-CN", { hour12: false }) : "未知时间";
  const turn = entry.turnId ? shortTurnId(entry.turnId) : "无";
  const validator = entry.validatorCode ? ` / ${entry.validatorCode}` : "";
  return `${time} / turn ${turn}${validator}`;
}

export function formatScriptHistoryMeta(entry: ScriptSegmentHistoryEntry) {
  const time = entry.createdAt ? new Date(entry.createdAt).toLocaleString("zh-CN", { hour12: false }) : "未知时间";
  const turn = entry.turnId ? shortTurnId(entry.turnId) : "无";
  const validator = entry.validatorCode ? ` / ${entry.validatorCode}` : "";
  const source = entry.sourceTurnId ? ` / source ${shortTurnId(entry.sourceTurnId)}` : "";
  return `${time} / turn ${turn}${source}${validator}`;
}

export function formatRhythmHistoryMeta(entry: RhythmStructureHistoryEntry) {
  const time = entry.createdAt ? new Date(entry.createdAt).toLocaleString("zh-CN", { hour12: false }) : "未知时间";
  const turn = entry.turnId ? shortTurnId(entry.turnId) : "无";
  const validator = entry.validatorCode ? ` / ${entry.validatorCode}` : "";
  const source = entry.sourceTurnId ? ` / source ${shortTurnId(entry.sourceTurnId)}` : "";
  return `${time} / turn ${turn}${source}${validator}`;
}
