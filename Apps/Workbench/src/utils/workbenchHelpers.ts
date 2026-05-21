import { getProcessingJob, getSampleArtifact, startShotBoundaryAnalysis } from "../api/client";
import { type WorkbenchAction } from "../state";
import type { AudioFeatureMarker, ProcessingJob, StructureCard, WorkbenchState } from "../types";

export type ActiveJobDraft = {
  processingJobId: string;
  sampleVideoId: string;
  traceId: string;
  analysisFps?: number;
};

export type JobDraftWriter = (job: ActiveJobDraft | null) => void;

export async function runShotBoundaryAnalysis(state: WorkbenchState, analysisFps: number, setAgentJob: (job: ProcessingJob | null) => void, dispatch: (action: WorkbenchAction) => void, writeActiveAgentJob?: JobDraftWriter) {
  if (!state.sampleVideo) return;
  const started = await startShotBoundaryAnalysis(state.sampleVideo.id, { analysisFps });
  let latest: ProcessingJob = { jobId: started.processingJobId, sampleVideoId: started.sampleVideoId, traceId: started.traceId, stage: "agent.shotBoundary.inputPrepared", status: "pending", progress: 0 };
  setAgentJob(latest);
  writeActiveAgentJob?.({ processingJobId: started.processingJobId, sampleVideoId: started.sampleVideoId, traceId: started.traceId, analysisFps });
  for (let attempt = 0; attempt < 180; attempt += 1) {
    await delay(1000);
    latest = await getProcessingJob(started.processingJobId);
    setAgentJob(latest);
    if (latest.status === "processed") {
      const artifact = await getSampleArtifact(started.sampleVideoId);
      dispatch({ type: "set-shot-boundary-analysis", artifact });
      writeActiveAgentJob?.(null);
      return;
    }
    if (latest.status === "failed") {
      writeActiveAgentJob?.(null);
      throw new Error(latest.errorSummary?.message ?? "切镜分析失败");
    }
  }
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

export async function attachAgentJob(jobDraft: ActiveJobDraft, setAgentJob: (job: ProcessingJob | null) => void, dispatch: (action: WorkbenchAction) => void, writeActiveAgentJob: JobDraftWriter) {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    const job = await getProcessingJob(jobDraft.processingJobId);
    setAgentJob(job);
    if (job.status === "processed") {
      const artifact = await getSampleArtifact(jobDraft.sampleVideoId);
      dispatch({ type: "set-shot-boundary-analysis", artifact });
      writeActiveAgentJob(null);
      return artifact;
    }
    if (job.status === "failed") {
      writeActiveAgentJob(null);
      return null;
    }
    await delay(1000);
  }
  return null;
}

export function findCurrentStructureCard(cards: StructureCard[], currentTime: number): StructureCard | null {
  return cards.find((item) => currentTime >= item.start && currentTime <= item.end) ?? null;
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
    processed: "生成产物完成",
  };
  return labels[job?.stage] ?? job?.stage ?? "处理中";
}

export function buildIngestError(job: ProcessingJob) {
  const summary = job.errorSummary ?? {};
  const error = new Error(summary.message || "样例处理失败") as Error & { code?: string };
  error.code = summary.code || "sample_ingest_failed";
  return error;
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
