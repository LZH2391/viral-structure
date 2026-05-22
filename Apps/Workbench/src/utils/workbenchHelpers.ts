import { getLibraryItemDetail, getProcessingJob, getSampleArtifact, getThreadPoolRoleStatus, startShotBoundaryAnalysis } from "../api/client";
import { type WorkbenchAction } from "../state";
import type { AudioFeatureMarker, ProcessingJob, ShotBoundaryAnalysisArtifact, StructureCard, ThreadPoolRoleDetail, WorkbenchState } from "../types";

export type ActiveJobDraft = {
  processingJobId: string;
  sampleVideoId: string;
  traceId: string;
  analysisFps?: number;
};

export type JobDraftWriter = (job: ActiveJobDraft | null) => void;
export type ShotBoundaryCacheHandler = (payload: { job: ProcessingJob; cachedItem: import("../types").LibraryItemSummary }) => Promise<void> | void;

export type ShotBoundaryGuard = {
  state: "loading" | "ready" | "warming" | "blocked";
  buttonLabel: string;
  message: string | null;
  disabled: boolean;
};

export async function runShotBoundaryAnalysis(state: WorkbenchState, analysisFps: number, setAgentJob: (job: ProcessingJob | null) => void, dispatch: (action: WorkbenchAction) => void, writeActiveAgentJob?: JobDraftWriter, onCacheHit?: ShotBoundaryCacheHandler, cacheDecision: "ask" | "reuse" | "refresh" = "ask") {
  if (!state.sampleVideo) return;
  const guard = await getShotBoundaryGuard();
  if (guard.state !== "ready") throw new Error(guard.message ?? "ThreadPool 当前不可用，请稍后再试");
  const started = await startShotBoundaryAnalysis(state.sampleVideo.id, { analysisFps, cacheDecision });
  if ("cacheHit" in started && started.cacheHit) {
    await onCacheHit?.({
      job: { jobId: null, sampleVideoId: state.sampleVideo.id, traceId: "", stage: "shot.cache_lookup", status: "cache_waiting", progress: 55 },
      cachedItem: started.cachedItem,
    });
    return;
  }
  let latest: ProcessingJob = { jobId: started.processingJobId, sampleVideoId: started.sampleVideoId, traceId: started.traceId, stage: "agent.shotBoundary.inputPrepared", status: "pending", progress: 0 };
  setAgentJob(latest);
  writeActiveAgentJob?.({ processingJobId: started.processingJobId, sampleVideoId: started.sampleVideoId, traceId: started.traceId, analysisFps });
  for (let attempt = 0; attempt < 180; attempt += 1) {
    await delay(1000);
    latest = await getProcessingJob(started.processingJobId);
    setAgentJob(latest);
    if (latest.status === "cache_waiting" && latest.cachePrompt?.cachedItem) {
      await onCacheHit?.({ job: latest, cachedItem: latest.cachePrompt.cachedItem });
      return;
    }
    if (latest.status === "processed") {
      const artifact = await getSampleArtifact(started.sampleVideoId);
      dispatch({ type: "set-shot-boundary-analysis", artifact });
      writeActiveAgentJob?.(null);
      return;
    }
    if (latest.status === "failed") {
      setAgentJob(latest);
      writeActiveAgentJob?.(null);
      throw new Error(latest.errorSummary?.message ?? "切镜分析失败");
    }
  }
  setAgentJob(null);
  writeActiveAgentJob?.(null);
  throw new Error("切镜分析超时");
}

export async function attachProcessingJob(jobDraft: ActiveJobDraft, dispatch: (action: WorkbenchAction) => void, writeActiveUploadJob: JobDraftWriter) {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    const job = await getProcessingJob(jobDraft.processingJobId);
    dispatch({ type: "set-upload-state", isUploadingSample: job.status !== "processed" && job.status !== "failed", uploadStatusText: stageLabel(job), processingJob: job, errorSummary: null });
    if (job.status === "processed") {
      const artifact = await getSampleArtifact(jobDraft.sampleVideoId);
      dispatch({ type: "apply-artifact", artifact });
      dispatch({ type: "set-upload-state", isUploadingSample: false, uploadStatusText: "生成产物完成", processingJob: job });
      writeActiveUploadJob(null);
      return artifact;
    }
    if (job.status === "failed") {
      dispatch({ type: "set-error", errorSummary: job.errorSummary ?? null, uploadStatusText: "处理失败" });
      writeActiveUploadJob(null);
      return null;
    }
    await delay(1000);
  }
  return null;
}

export async function attachAgentJob(jobDraft: ActiveJobDraft, setAgentJob: (job: ProcessingJob | null) => void, dispatch: (action: WorkbenchAction) => void, writeActiveAgentJob: JobDraftWriter, onCacheHit?: ShotBoundaryCacheHandler) {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    const job = await getProcessingJob(jobDraft.processingJobId).catch(() => null);
    if (!job) {
      setAgentJob(null);
      writeActiveAgentJob(null);
      return null;
    }
    setAgentJob(job);
    if (job.status === "cache_waiting" && job.cachePrompt?.cachedItem) {
      await onCacheHit?.({ job, cachedItem: job.cachePrompt.cachedItem });
      return null;
    }
    if (job.status === "processed") {
      const artifact = await getSampleArtifact(jobDraft.sampleVideoId);
      dispatch({ type: "set-shot-boundary-analysis", artifact });
      writeActiveAgentJob(null);
      return artifact;
    }
    if (job.status === "failed") {
      setAgentJob(job);
      writeActiveAgentJob(null);
      return null;
    }
    await delay(1000);
  }
  setAgentJob(null);
  writeActiveAgentJob(null);
  return null;
}

export async function getShotBoundaryGuard() {
  try {
    return resolveShotBoundaryGuard(await getThreadPoolRoleStatus("shot-boundary-analyzer"));
  } catch (error) {
    return {
      state: "blocked",
      buttonLabel: "不可用",
      message: error instanceof Error ? error.message : "ThreadPool 状态读取失败",
      disabled: true,
    } satisfies ShotBoundaryGuard;
  }
}

export function resolveShotBoundaryGuard(status: ThreadPoolRoleDetail | null | undefined): ShotBoundaryGuard {
  if (!status) return { state: "loading", buttonLabel: "检查中", message: null, disabled: true };
  if (!status.ok) return { state: "blocked", buttonLabel: "不可用", message: "ThreadPool 当前不可用，请稍后再试", disabled: true };
  if (status.warming) {
    return {
      state: "warming",
      buttonLabel: "warming",
      message: "ThreadPool 正在 warming，请稍后再试",
      disabled: false,
    };
  }
  if (status.startupError) return { state: "blocked", buttonLabel: "不可用", message: status.startupError, disabled: true };
  if (status.warmupError) return { state: "blocked", buttonLabel: "不可用", message: status.warmupError, disabled: true };
  if (!status.readyForLeases) return { state: "blocked", buttonLabel: "不可用", message: "ThreadPool 当前未 ready，请稍后再试", disabled: true };
  if (!status.canAcquire) return { state: "blocked", buttonLabel: "不可用", message: "ThreadPool 当前不可获取 lease，请稍后再试", disabled: true };
  return { state: "ready", buttonLabel: "运行", message: null, disabled: false };
}

export function findCurrentStructureCard(cards: StructureCard[], currentTime: number): StructureCard | null {
  return cards.find((item) => currentTime >= item.start && currentTime <= item.end) ?? null;
}

export function findCurrentShot(
  shots: ShotBoundaryAnalysisArtifact["shots"] | null | undefined,
  currentTime: number,
): ShotBoundaryAnalysisArtifact["shots"][number] | null {
  if (!shots?.length) return null;
  for (let index = 0; index < shots.length; index += 1) {
    const shot = shots[index];
    const isLastShot = index === shots.length - 1;
    const inRange = currentTime >= shot.start && (isLastShot ? currentTime <= shot.end : currentTime < shot.end);
    if (inRange) return shot;
  }
  return null;
}

export function stageLabel(job: ProcessingJob): string {
  const labels: Record<string, string> = {
    uploaded: "上传中",
    "sample.upload.received": "上传中",
    "sample.upload.validated": "校验上传",
    "sample.source.saved": "保存素材",
    "sample.metadata.probed": "读取元信息",
    "sample.cover.extracted": "生成封面",
    "sample.frames.extracted": "抽帧中",
    "sample.audio.extracted": "提取音频",
    "sample.audio.features.extracted": "分析音频基础特征",
    "sample.audio.separated": "分离人声/伴奏",
    "sample.subtitle.recognized": "识别字幕",
    "sample.artifact.written": "生成产物",
    "shot.input_prepare": "准备切镜输入",
    "shot.contact_sheet": "生成联表",
    "shot.cache_lookup": "检查切镜缓存",
    "shot.thread_acquire": "等待 ThreadPool lease",
    "shot.boundary_analyze.submit": "提交切镜分析",
    "shot.boundary_analyze.collect": "等待切镜结果",
    "shot.boundary_validate": "校验切镜结果",
    "shot.boundary_repair.submit": "提交修复分析",
    "shot.boundary_repair.collect": "等待修复结果",
    "shot.boundary_merge": "合并切镜结果",
    "shot.cache_reuse": "复用切镜缓存",
    processed: "生成产物完成",
  };
  return labels[job?.stage] ?? job?.stage ?? "处理中";
}

export function buildIngestError(job: ProcessingJob) {
  const summary = job.errorSummary ?? {};
  const traceId = job.traceId ? `traceId: ${job.traceId}` : null;
  const debugSnapshotUri = summary.debugSnapshotUri ? `debugSnapshot: ${summary.debugSnapshotUri}` : null;
  const details = [traceId, debugSnapshotUri].filter(Boolean).join(" / ");
  const message = details
    ? `${summary.message || "样例处理失败"}（${details}）`
    : (summary.message || "样例处理失败");
  const error = new Error(message) as Error & { code?: string };
  error.code = summary.code || "sample_ingest_failed";
  return error;
}

export function buildSubtitleSaveError(error: unknown, fallbackMessage = "字幕保存失败") {
  const raw = error as { code?: string; message?: string; traceId?: string; debugSnapshotUri?: string };
  const traceId = raw?.traceId ? `traceId: ${raw.traceId}` : null;
  const debugSnapshotUri = raw?.debugSnapshotUri ? `debugSnapshot: ${raw.debugSnapshotUri}` : null;
  const details = [traceId, debugSnapshotUri].filter(Boolean).join(" / ");
  const message = details ? `${raw?.message || fallbackMessage}（${details}）` : (raw?.message || fallbackMessage);
  const next = new Error(message) as Error & { code?: string };
  next.code = raw?.code || "subtitle_revision_failed";
  return next;
}

export function findAudioFeatureMarker(audioFeatures: WorkbenchState["audioFeatures"], markerId: string): AudioFeatureMarker | null {
  if (!audioFeatures) return null;
  const markers = [
    ...(audioFeatures.beats ?? []).map((time, index) => ({ id: `beat_${index}_${time}`, type: "beat" as const, time })),
    ...(audioFeatures.onsets ?? []).map((time, index) => ({ id: `onset_${index}_${time}`, type: "onset" as const, time })),
  ];
  return markers.find((marker) => marker.id === markerId) ?? null;
}

export function resolveAudioFeatureSourceId(state: WorkbenchState) {
  const sourceArtifactId = state.audioFeatures?.sourceAudioArtifactId ?? null;
  if (sourceArtifactId && state.mediaDerivatives.some((entry) => entry.artifactId === sourceArtifactId)) return sourceArtifactId;
  return state.sampleArtifact?.audio?.artifactId ?? state.mediaDerivatives.find((entry) => entry.type === "audio-track")?.artifactId ?? null;
}

export function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
