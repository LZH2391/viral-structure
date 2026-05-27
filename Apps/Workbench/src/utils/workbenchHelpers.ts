import { getLibraryItemDetail, getProcessingJob, getSampleArtifact, getThreadPoolRoleStatus, startAnalysisRole, startShotBoundaryAnalysis } from "../api/client";
import { type WorkbenchAction } from "../state";
import type { AudioFeatureMarker, LibraryItemSummary, ProcessingJob, ShotBoundaryAnalysisArtifact, StructureCard, ThreadPoolRoleDetail, WorkbenchState } from "../types";
import { pollProcessingJob } from "../hooks/jobPolling";
import { getAnalysisRole, listAnalysisRoles, type AnalysisKind } from "./analysisRoles";

export type AnalysisStageKind = "shotBoundary" | AnalysisKind;

export type ActiveJobDraft = {
  processingJobId: string;
  sampleVideoId: string;
  traceId: string;
  analysisFps?: number;
  enableReview?: boolean;
  stageKind?: AnalysisStageKind;
};

export type JobDraftWriter = (job: ActiveJobDraft | null) => void;
export type ShotBoundaryCacheHandler = (payload: { job: ProcessingJob; cachedItem: import("../types").LibraryItemSummary }) => Promise<void> | void;
export type AnalysisCacheHandler = (payload: { job: ProcessingJob; cachedItem: LibraryItemSummary }) => Promise<void> | void;
export type ScriptSegmentCacheHandler = AnalysisCacheHandler;
export type RhythmStructureCacheHandler = AnalysisCacheHandler;
export type PackagingStructureCacheHandler = AnalysisCacheHandler;
export type FunctionSlotAtomizationCacheHandler = AnalysisCacheHandler;

const ANALYSIS_STAGE_LABELS = Object.fromEntries(listAnalysisRoles().flatMap((role) => Object.entries(role.stageLabels)));
const SHOT_BOUNDARY_POLL_MAX_ATTEMPTS = 1800;
const SHOT_BOUNDARY_IDLE_TIMEOUT_MS = 6 * 60 * 1000;
const SHOT_BOUNDARY_RAW_ROLE = "shot-boundary-raw-analyzer";
const SHOT_BOUNDARY_TRANSFORMER_ROLE = "shot-boundary-transformer";
export type ShotBoundaryGuard = {
  state: "loading" | "ready" | "warming" | "blocked";
  buttonLabel: string;
  message: string | null;
  disabled: boolean;
};

export async function runShotBoundaryAnalysis(state: WorkbenchState, analysisFps: number, enableReview: boolean, setAgentJob: (job: ProcessingJob | null) => void, dispatch: (action: WorkbenchAction) => void, writeActiveAgentJob?: JobDraftWriter, onCacheHit?: ShotBoundaryCacheHandler, cacheDecision: "ask" | "reuse" | "refresh" = "ask") {
  if (!state.sampleVideo) return;
  const guard = await getShotBoundaryGuard();
  if (guard.state !== "ready") throw new Error(guard.message ?? "ThreadPool 当前不可用，请稍后再试");
  const started = await startShotBoundaryAnalysis(state.sampleVideo.id, { analysisFps, cacheDecision, enableReview });
  if ("cacheHit" in started && started.cacheHit) {
    await onCacheHit?.({
      job: { jobId: null, sampleVideoId: state.sampleVideo.id, traceId: "", stage: "shot.cache_lookup", status: "cache_waiting", progress: 55 },
      cachedItem: started.cachedItem,
    });
    return;
  }
  let latest: ProcessingJob = { jobId: started.processingJobId, sampleVideoId: started.sampleVideoId, traceId: started.traceId, stage: "agent.shotBoundary.inputPrepared", status: "pending", progress: 0 };
  setAgentJob(latest);
  writeActiveAgentJob?.({ processingJobId: started.processingJobId, sampleVideoId: started.sampleVideoId, traceId: started.traceId, analysisFps, enableReview });
  latest = await pollProcessingJob(() => getProcessingJob(started.processingJobId).catch(() => null), {
    maxAttempts: SHOT_BOUNDARY_POLL_MAX_ATTEMPTS,
    idleTimeoutMs: SHOT_BOUNDARY_IDLE_TIMEOUT_MS,
    onUpdate: setAgentJob,
    preservePreviousOnNull: true,
  }) ?? latest;
  if (latest.status === "cache_waiting" && latest.cachePrompt?.cachedItem) {
    setAgentJob(null);
    writeActiveAgentJob?.(null);
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
  setAgentJob(latest);
  throw new Error(buildAnalysisTimeoutMessage("切镜分析仍在后台运行", latest));
}

export async function runAnalysisRole(
  kind: AnalysisKind,
  state: WorkbenchState,
  dispatch: (action: WorkbenchAction) => void,
  onJobUpdate?: (job: ProcessingJob | null) => void,
  writeActiveJob?: JobDraftWriter,
  onCacheHit?: AnalysisCacheHandler,
  cacheDecision: "ask" | "reuse" | "refresh" = "ask",
) {
  if (!state.sampleVideo) return null;
  const role = getAnalysisRole(kind);
  const dependencyOptions = buildAnalysisDependencyOptions(kind, state);
  const started = await startAnalysisRole(role.analysisId, state.sampleVideo.id, {
    cacheDecision,
    ...dependencyOptions,
  });
  if ("cacheHit" in started && started.cacheHit) {
    await onCacheHit?.({
      job: { jobId: null, sampleVideoId: state.sampleVideo.id, traceId: "", stage: role.cacheLookupStage, status: "cache_waiting", progress: 28 },
      cachedItem: started.cachedItem,
    });
    return null;
  }
  let latest: ProcessingJob = {
    jobId: started.processingJobId,
    sampleVideoId: started.sampleVideoId,
    traceId: started.traceId,
    stage: role.initialStage,
    status: "pending",
    progress: 0,
  };
  onJobUpdate?.(latest);
  writeActiveJob?.({ processingJobId: started.processingJobId, sampleVideoId: started.sampleVideoId, traceId: started.traceId, stageKind: role.kind });
  latest = await pollProcessingJob(() => getProcessingJob(started.processingJobId).catch(() => null), {
    onUpdate: onJobUpdate,
    preservePreviousOnNull: true,
  }) ?? latest;
  if (latest.status === "cache_waiting" && latest.cachePrompt?.cachedItem) {
    writeActiveJob?.(null);
    await onCacheHit?.({ job: latest, cachedItem: latest.cachePrompt.cachedItem });
    return null;
  }
  if (latest.status === "processed") {
    const artifact = await getSampleArtifact(started.sampleVideoId);
    dispatch({ type: "apply-artifact", artifact });
    onJobUpdate?.(null);
    writeActiveJob?.(null);
    return { artifact, job: latest };
  }
  if (latest.status === "failed") {
    onJobUpdate?.(latest);
    const artifact = await getSampleArtifact(started.sampleVideoId).catch(() => null);
    if (artifact) dispatch({ type: "apply-artifact", artifact });
    writeActiveJob?.(null);
    const error = new Error(latest.errorSummary?.message ?? role.failureMessage) as Error & {
      processingJob?: ProcessingJob;
      sampleArtifact?: import("../types").SampleArtifact | null;
    };
    error.processingJob = latest;
    error.sampleArtifact = artifact;
    throw error;
  }
  onJobUpdate?.(latest);
  const error = new Error(buildAnalysisTimeoutMessage(role.timeoutMessage, latest)) as Error & {
    processingJob?: ProcessingJob;
  };
  error.processingJob = latest;
  throw error;
}

export async function runScriptSegmentAnalysis(
  state: WorkbenchState,
  dispatch: (action: WorkbenchAction) => void,
  onJobUpdate?: (job: ProcessingJob | null) => void,
  writeActiveJob?: JobDraftWriter,
  onCacheHit?: ScriptSegmentCacheHandler,
  cacheDecision: "ask" | "reuse" | "refresh" = "ask",
) {
  return runAnalysisRole("scriptSegment", state, dispatch, onJobUpdate, writeActiveJob, onCacheHit, cacheDecision);
}

export async function runRhythmStructureAnalysis(
  state: WorkbenchState,
  dispatch: (action: WorkbenchAction) => void,
  onJobUpdate?: (job: ProcessingJob | null) => void,
  writeActiveJob?: JobDraftWriter,
  onCacheHit?: RhythmStructureCacheHandler,
  cacheDecision: "ask" | "reuse" | "refresh" = "ask",
) {
  return runAnalysisRole("rhythmStructure", state, dispatch, onJobUpdate, writeActiveJob, onCacheHit, cacheDecision);
}

export async function runPackagingStructureAnalysis(
  state: WorkbenchState,
  dispatch: (action: WorkbenchAction) => void,
  onJobUpdate?: (job: ProcessingJob | null) => void,
  writeActiveJob?: JobDraftWriter,
  onCacheHit?: PackagingStructureCacheHandler,
  cacheDecision: "ask" | "reuse" | "refresh" = "ask",
) {
  return runAnalysisRole("packagingStructure", state, dispatch, onJobUpdate, writeActiveJob, onCacheHit, cacheDecision);
}

export async function runFunctionSlotAtomizationAnalysis(
  state: WorkbenchState,
  dispatch: (action: WorkbenchAction) => void,
  onJobUpdate?: (job: ProcessingJob | null) => void,
  writeActiveJob?: JobDraftWriter,
  onCacheHit?: FunctionSlotAtomizationCacheHandler,
) {
  return runAnalysisRole("functionSlotAtomization", state, dispatch, onJobUpdate, writeActiveJob, onCacheHit, "refresh");
}

export async function attachProcessingJob(jobDraft: ActiveJobDraft, dispatch: (action: WorkbenchAction) => void, writeActiveUploadJob: JobDraftWriter) {
  const job = await pollProcessingJob(() => getProcessingJob(jobDraft.processingJobId), {
    onUpdate: (nextJob) => {
      if (!nextJob) return;
      dispatch({ type: "set-upload-state", isUploadingSample: nextJob.status !== "processed" && nextJob.status !== "failed", uploadStatusText: stageLabel(nextJob), processingJob: nextJob, errorSummary: null });
    },
  });
  if (job?.status === "processed") {
    const artifact = await getSampleArtifact(jobDraft.sampleVideoId);
    dispatch({ type: "apply-artifact", artifact });
    dispatch({ type: "set-upload-state", isUploadingSample: false, uploadStatusText: "生成产物完成", processingJob: job });
    writeActiveUploadJob(null);
    return artifact;
  }
  if (job?.status === "failed") {
    dispatch({ type: "set-error", errorSummary: job.errorSummary ?? null, uploadStatusText: "处理失败" });
    writeActiveUploadJob(null);
    return null;
  }
  return null;
}

export async function attachAgentJob(
  jobDraft: ActiveJobDraft,
  setAgentJob: (job: ProcessingJob | null) => void,
  dispatch: (action: WorkbenchAction) => void,
  writeActiveAgentJob: JobDraftWriter,
  onCacheHit?: ShotBoundaryCacheHandler,
  options?: { showCacheWaiting?: boolean },
) {
  const job = await pollProcessingJob(() => getProcessingJob(jobDraft.processingJobId).catch(() => null), {
    stopOnNull: true,
    preservePreviousOnNull: true,
    onUpdate: (nextJob) => {
      if (nextJob) setAgentJob(nextJob);
    },
  });
  if (!job) {
    writeActiveAgentJob(null);
    return null;
  }
  if (job.status === "cache_waiting" && job.cachePrompt?.cachedItem) {
    setAgentJob(null);
    writeActiveAgentJob(null);
    if (options?.showCacheWaiting === false) return null;
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
  return null;
}

export async function attachAnalysisJob(
  jobDraft: ActiveJobDraft,
  setJob: (job: ProcessingJob | null) => void,
  dispatch: (action: WorkbenchAction) => void,
  writeActiveJob: JobDraftWriter,
  options: { artifactAction?: "apply-artifact" | "set-shot-boundary-analysis"; showCacheWaiting?: boolean } = {},
) {
  const job = await pollProcessingJob(() => getProcessingJob(jobDraft.processingJobId).catch(() => null), {
    stopOnNull: true,
    preservePreviousOnNull: true,
    onUpdate: (nextJob) => {
      if (nextJob) setJob(nextJob);
    },
  });
  if (!job) {
    writeActiveJob(null);
    return null;
  }
  if (job.status === "cache_waiting" && options.showCacheWaiting === false) {
    setJob(job);
    return null;
  }
  if (job.status === "processed") {
    const artifact = await getSampleArtifact(jobDraft.sampleVideoId);
    dispatch({ type: options.artifactAction ?? "apply-artifact", artifact });
    writeActiveJob(null);
    setJob(null);
    return artifact;
  }
  if (job.status === "failed") {
    setJob(job);
    const artifact = await getSampleArtifact(jobDraft.sampleVideoId).catch(() => null);
    if (artifact) dispatch({ type: options.artifactAction ?? "apply-artifact", artifact });
    writeActiveJob(null);
    return artifact;
  }
  return null;
}

function buildAnalysisDependencyOptions(kind: AnalysisKind, state: WorkbenchState) {
  if (kind === "functionSlotAtomization") {
    return {
      expectedScriptSegmentArtifactId: state.sampleArtifact?.scriptSegmentAnalysis?.artifactId ?? null,
      expectedRhythmStructureArtifactId: state.sampleArtifact?.rhythmStructureAnalysis?.artifactId ?? null,
      expectedPackagingStructureArtifactId: state.sampleArtifact?.packagingStructureAnalysis?.artifactId ?? null,
    };
  }
  return {
    expectedShotBoundaryArtifactId: state.sampleArtifact?.shotBoundaryAnalysis?.artifactId ?? null,
  };
}

function buildAnalysisTimeoutMessage(baseMessage: string, job: ProcessingJob) {
  const traceText = job.traceId ? `traceId: ${job.traceId}` : null;
  const stageText = job.stage ? `stage: ${job.stage}` : null;
  const progressText = Number.isFinite(job.progress) ? `progress: ${job.progress}%` : null;
  const details = [stageText, progressText, traceText].filter(Boolean).join(" / ");
  return details ? `${baseMessage}，任务仍保留在运行面板（${details}）` : `${baseMessage}，任务仍保留在运行面板`;
}

export async function getShotBoundaryGuard() {
  try {
    const [rawStatus, transformerStatus] = await Promise.all([
      getThreadPoolRoleStatus(SHOT_BOUNDARY_RAW_ROLE),
      getThreadPoolRoleStatus(SHOT_BOUNDARY_TRANSFORMER_ROLE),
    ]);
    return resolveShotBoundaryGuard({
      raw: rawStatus,
      transformer: transformerStatus,
    });
  } catch (error) {
    return {
      state: "blocked",
      buttonLabel: "不可用",
      message: error instanceof Error ? error.message : "ThreadPool 状态读取失败",
      disabled: true,
    } satisfies ShotBoundaryGuard;
  }
}

export function resolveShotBoundaryGuard(status: ThreadPoolRoleDetail | { raw?: ThreadPoolRoleDetail | null; transformer?: ThreadPoolRoleDetail | null } | null | undefined): ShotBoundaryGuard {
  if (isShotBoundaryGuardPair(status)) {
    const raw = resolveSingleShotBoundaryGuard(status.raw, "raw role");
    if (raw.state !== "ready") return raw;
    const transformer = resolveSingleShotBoundaryGuard(status.transformer, "transformer role");
    if (transformer.state !== "ready") return transformer;
    return { state: "ready", buttonLabel: "运行", message: null, disabled: false };
  }
  return resolveSingleShotBoundaryGuard(status, "transformer role");
}

function resolveSingleShotBoundaryGuard(status: ThreadPoolRoleDetail | null | undefined, label: string): ShotBoundaryGuard {
  if (!status) return { state: "loading", buttonLabel: "检查中", message: null, disabled: true };
  if (!status.ok) return { state: "blocked", buttonLabel: "不可用", message: `${label} 不可用：ThreadPool 当前不可用，请稍后再试`, disabled: true };
  if (status.warming) {
    return {
      state: "warming",
      buttonLabel: "warming",
      message: `${label} 正在 warming，请稍后再试`,
      disabled: false,
    };
  }
  if (status.seedMissing) {
    return {
      state: "warming",
      buttonLabel: "warming",
      message: `${label} 正在初始化 seed thread，请稍后再试`,
      disabled: false,
    };
  }
  if (status.replenishing) {
    return {
      state: "warming",
      buttonLabel: "warming",
      message: `${label} 正在补充 idle thread，请稍后再试`,
      disabled: false,
    };
  }
  if (status.startupError) return { state: "blocked", buttonLabel: "不可用", message: `${label} 不可用：${status.startupError}`, disabled: true };
  if (status.warmupError) return { state: "blocked", buttonLabel: "不可用", message: `${label} 不可用：${status.warmupError}`, disabled: true };
  if (!status.readyForLeases) return { state: "blocked", buttonLabel: "不可用", message: `${label} 不可用：ThreadPool 当前未 ready，请稍后再试`, disabled: true };
  if (!status.canAcquire) return { state: "blocked", buttonLabel: "不可用", message: `${label} 不可用：ThreadPool 当前不可获取 lease，请稍后再试`, disabled: true };
  return { state: "ready", buttonLabel: "运行", message: null, disabled: false };
}

function isShotBoundaryGuardPair(value: unknown): value is { raw?: ThreadPoolRoleDetail | null; transformer?: ThreadPoolRoleDetail | null } {
  return Boolean(value && typeof value === "object" && ("raw" in value || "transformer" in value));
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
    "shot.raw_video_analyze.thread_start": "启动原始切镜线程",
    "shot.raw_video_analyze.submit": "提交原始切镜分析",
    "shot.raw_video_analyze.collect": "等待原始切镜结果",
    "shot.boundary_transform.thread_acquire": "等待 Transform lease",
    "shot.boundary_transform.submit": "提交切镜结果转换",
    "shot.boundary_transform.collect": "等待转换结果",
    "shot.boundary_transform.validate": "校验转换结果",
    "shot.boundary_transform.sheets": "生成结果联表",
    "shot.boundary_repair.submit": "提交修复分析",
    "shot.boundary_repair.collect": "等待修复结果",
    "shot.boundary_merge": "合并切镜结果",
    "shot.cache_reuse": "复用切镜缓存",
    ...ANALYSIS_STAGE_LABELS,
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
  const raw = error as {
    code?: string;
    message?: string;
    traceId?: string;
    debugSnapshotUri?: string;
    stageName?: string | null;
    retryable?: boolean | null;
    statusCode?: number;
  };
  const traceId = raw?.traceId ? `traceId: ${raw.traceId}` : null;
  const debugSnapshotUri = raw?.debugSnapshotUri ? `debugSnapshot: ${raw.debugSnapshotUri}` : null;
  const details = [traceId, debugSnapshotUri].filter(Boolean).join(" / ");
  const message = details ? `${raw?.message || fallbackMessage}（${details}）` : (raw?.message || fallbackMessage);
  const next = new Error(message) as Error & {
    code?: string;
    traceId?: string | null;
    debugSnapshotUri?: string | null;
    stageName?: string | null;
    retryable?: boolean | null;
    statusCode?: number;
  };
  next.code = raw?.code || "subtitle_revision_failed";
  next.traceId = raw?.traceId ?? null;
  next.debugSnapshotUri = raw?.debugSnapshotUri ?? null;
  next.stageName = raw?.stageName ?? null;
  next.retryable = raw?.retryable ?? null;
  next.statusCode = raw?.statusCode;
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
