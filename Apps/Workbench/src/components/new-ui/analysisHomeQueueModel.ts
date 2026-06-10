import { getLatestFullAnalysisBatchRun, getLatestMaterialRecognitionBatchRun, getSampleArtifact, getWorkflowRun, runtimeUrl, type FunctionSlotGovernanceSchedulerState } from "../../api/client";
import type { FullAnalysisBatchItem, FullAnalysisBatchRun, SampleArtifact, WorkflowRun } from "../../types";
import type { AnalysisWorkflowMode } from "./analysisBackend";
import type { AnalysisHistoryItem, AnalysisHistoryMedia } from "./analysisHistoryData";
import { filterArtifactForWorkflowRun } from "./analysisHistoryData";

export type AnalysisHomeQueueItem = {
  key: string;
  status: "done" | "running" | "waiting" | "failed" | "canceled";
  thumbnailUrl: string | null;
  ratio: "wide" | "cinema";
  badgeLabel: "上传中" | "分析中" | "识别中" | "排队中" | "已完成" | "失败" | "已停止";
  title: string;
  historyItem: AnalysisHistoryItem | null;
  batchRunId?: string | null;
  queueItemId?: string | null;
  workflowRunId?: string | null;
  workflowKey?: string | null;
  retryable?: boolean;
  completedAt?: string | null;
};

export type AnalysisHomeQueueState = {
  items: AnalysisHomeQueueItem[];
  loading: boolean;
  governanceSchedulerState?: FunctionSlotGovernanceSchedulerState | null;
  onOpenItem: (item: AnalysisHistoryItem) => void;
  onCancelItem?: (item: AnalysisHomeQueueItem) => void;
  onRetryItem?: (item: AnalysisHomeQueueItem) => void;
  actionBusyKey?: string | null;
};

export const ANALYSIS_PLAYER_QUEUE_REFRESH_MS = 3200;
const ANALYSIS_QUEUE_DONE_VISIBLE_MS = 3000;
const VISIBLE_GOVERNANCE_SCHEDULER_STATUSES = new Set(["scheduled", "running", "dirty", "failed", "skipped"]);

export function resolveVideoProcessingQueueItems(item: AnalysisHistoryItem | null, media: AnalysisHistoryMedia | null, batchItems: AnalysisHomeQueueItem[] | null): AnalysisHomeQueueItem[] {
  if (batchItems?.length) return batchItems;
  return [];
}

function resolveQueueThumbnailRatio(media: AnalysisHistoryMedia | null): AnalysisHomeQueueItem["ratio"] {
  return media?.ratioLabel === "16:9" ? "wide" : "cinema";
}

function resolveQueueBadgeLabel(item: AnalysisHistoryItem | null, media: AnalysisHistoryMedia | null, status: AnalysisHomeQueueItem["status"]): AnalysisHomeQueueItem["badgeLabel"] {
  if (status === "done") return "已完成";
  if (status === "failed") return "失败";
  if (status === "canceled") return "已停止";
  if (status === "waiting") return "排队中";
  if (media?.analysisKind === "material" || item?.workflowRun?.workflowKey === "material-recognition") return "识别中";
  return "分析中";
}

export function toVisibleGovernanceSchedulerState(state: FunctionSlotGovernanceSchedulerState | null) {
  if (!state) return null;
  return VISIBLE_GOVERNANCE_SCHEDULER_STATUSES.has(state.status) ? state : null;
}

export async function loadLatestVideoProcessingQueue(mode: AnalysisWorkflowMode = "structureAnalysis"): Promise<AnalysisHomeQueueItem[]> {
  const loadBatch = mode === "materialRecognition" ? getLatestMaterialRecognitionBatchRun : getLatestFullAnalysisBatchRun;
  const batch = await loadBatch({ active: true }).catch(() => null);
  if (!batch?.items?.length) return [];
  const itemEntries = await Promise.all(
    batch.items.map(async (queueItem) => {
      const [artifact, workflowRun] = await Promise.all([
        queueItem.sampleVideoId ? getSampleArtifact(queueItem.sampleVideoId).catch(() => null) : Promise.resolve(null),
        queueItem.workflowRunId ? getWorkflowRun(queueItem.workflowRunId).catch(() => null) : Promise.resolve(null),
      ]);
      return [queueItem.queueItemId, { artifact, workflowRun }] as const;
    }),
  );
  const itemDataByQueueItemId = new Map<string, { artifact: SampleArtifact | null; workflowRun: WorkflowRun | null }>(itemEntries);
  return batch.items
    .map((queueItem) => {
      const data = itemDataByQueueItemId.get(queueItem.queueItemId) ?? { artifact: null, workflowRun: null };
      return resolveBatchQueueItem(queueItem, batch, data.artifact, data.workflowRun);
    })
    .filter((item) => shouldShowQueueItem(item));
}

function resolveBatchQueueItem(queueItem: FullAnalysisBatchItem, batch: FullAnalysisBatchRun, artifact: SampleArtifact | null, workflowRun: WorkflowRun | null): AnalysisHomeQueueItem {
  const status = resolveBatchQueueStatus(queueItem, batch, artifact, workflowRun);
  return {
    key: queueItem.queueItemId,
    status,
    thumbnailUrl: resolveArtifactThumbnailUrl(artifact),
    ratio: resolveBatchQueueThumbnailRatio(artifact),
    badgeLabel: resolveBatchQueueBadgeLabel(queueItem, batch, status),
    title: resolveBatchQueueTitle(queueItem, artifact),
    historyItem: resolveBatchQueueHistoryItem(queueItem, batch, artifact, status, workflowRun),
    batchRunId: batch.batchRunId,
    queueItemId: queueItem.queueItemId,
    workflowRunId: queueItem.workflowRunId ?? null,
    workflowKey: batch.workflowKey,
    retryable: Boolean(queueItem.retryable),
    completedAt: queueItem.completedAt ?? null,
  };
}

function resolveBatchQueueStatus(queueItem: FullAnalysisBatchItem, batch: FullAnalysisBatchRun, artifact: SampleArtifact | null, workflowRun: WorkflowRun | null): AnalysisHomeQueueItem["status"] {
  if (workflowRun) return normalizePlayerQueueStatus(workflowRun.status);
  const status = normalizePlayerQueueStatus(queueItem.status ?? artifact?.status);
  if (status === "running" || status === "waiting" || status === "failed" || status === "canceled") return status;
  if (batch.workflowKey === "material-recognition" && artifact?.userMaterialPack) return "done";
  if (batch.workflowKey !== "material-recognition" && artifact?.functionSlotAtomizationAnalysis) return "done";
  return status;
}

function resolveBatchQueueTitle(queueItem: FullAnalysisBatchItem, artifact: SampleArtifact | null) {
  return artifact?.sampleVideo.original.summary ?? queueItem.filename ?? queueItem.sampleVideoId ?? "队列视频";
}

export function resolveBatchQueueHistoryItem(queueItem: FullAnalysisBatchItem, batch: FullAnalysisBatchRun, artifact: SampleArtifact | null, status: AnalysisHomeQueueItem["status"], workflowRun: WorkflowRun | null = null): AnalysisHistoryItem | null {
  if (!queueItem.sampleVideoId) return null;
  const visibleArtifact = artifact ? filterArtifactForWorkflowRun(artifact, workflowRun) : null;
  return {
    sampleVideoId: queueItem.sampleVideoId,
    workflowRunId: workflowRun?.workflowRunId ?? queueItem.workflowRunId ?? null,
    workflowKey: batch.workflowKey,
    title: resolveBatchQueueTitle(queueItem, visibleArtifact),
    status: workflowRun?.status ?? artifact?.status ?? queueItem.status,
    updatedAt: workflowRun?.updatedAt ?? queueItem.updatedAt,
    createdAt: workflowRun?.createdAt ?? queueItem.createdAt,
    artifactId: latestWorkflowArtifactId(workflowRun) ?? latestSampleAnalysisArtifactId(visibleArtifact),
    traceId: workflowRun?.traceId ?? artifact?.trace?.traceId ?? null,
    runId: workflowRun?.runId ?? artifact?.trace?.runId ?? null,
    stageId: latestWorkflowStageId(workflowRun) ?? artifact?.trace?.stageId ?? null,
    durationSeconds: visibleArtifact?.metadata.durationSeconds ?? null,
    width: visibleArtifact?.metadata.width ?? null,
    height: visibleArtifact?.metadata.height ?? null,
    coverUri: visibleArtifact?.cover?.uri ?? visibleArtifact?.frames?.[0]?.imageUri ?? null,
    videoUri: visibleArtifact?.sampleVideo.normalized.uri ?? visibleArtifact?.sampleVideo.original.uri ?? null,
    hasFunctionSlotAtomization: Boolean(visibleArtifact?.functionSlotAtomizationAnalysis),
    hasUserMaterialPack: Boolean(visibleArtifact?.userMaterialPack),
    isIncomplete: status !== "done" && status !== "running" && status !== "waiting",
    isRunning: status === "running" || status === "waiting",
    artifact: visibleArtifact,
    workflowRun,
    runtimeState: null,
  };
}

function latestSampleAnalysisArtifactId(artifact: SampleArtifact | null) {
  return artifact?.functionSlotAtomizationAnalysis?.artifactId
    ?? artifact?.userMaterialPack?.artifactId
    ?? artifact?.packagingStructureAnalysis?.artifactId
    ?? artifact?.rhythmStructureAnalysis?.artifactId
    ?? artifact?.scriptSegmentAnalysis?.artifactId
    ?? artifact?.shotBoundaryAnalysis?.artifactId
    ?? null;
}

function latestWorkflowArtifactId(workflowRun: WorkflowRun | null) {
  return [...(workflowRun?.stages ?? [])].reverse().find((stage) => stage.artifactId)?.artifactId ?? null;
}

function latestWorkflowStageId(workflowRun: WorkflowRun | null) {
  return [...(workflowRun?.stages ?? [])].reverse().find((stage) => stage.stageId)?.stageId ?? null;
}

function resolveArtifactThumbnailUrl(artifact: SampleArtifact | null) {
  return runtimeUrl(artifact?.cover?.uri ?? artifact?.frames?.[0]?.imageUri ?? null);
}

function resolveBatchQueueThumbnailRatio(artifact: SampleArtifact | null): AnalysisHomeQueueItem["ratio"] {
  const width = Number(artifact?.metadata?.width);
  const height = Number(artifact?.metadata?.height);
  if (Number.isFinite(width) && Number.isFinite(height) && height > width) return "cinema";
  return "wide";
}

function resolveBatchQueueBadgeLabel(queueItem: FullAnalysisBatchItem, batch: FullAnalysisBatchRun, status: AnalysisHomeQueueItem["status"]): AnalysisHomeQueueItem["badgeLabel"] {
  if (status === "done") return "已完成";
  if (status === "failed") return "失败";
  if (status === "canceled") return "已停止";
  if (status === "waiting" || queueItem.status === "queued" || queueItem.position > batch.maxConcurrentRuns) return "排队中";
  if (batch.workflowKey === "material-recognition" || queueItem.currentStageLabel?.includes("素材")) return "识别中";
  return "分析中";
}

export function createUploadingQueueItems(files: File[], mode: AnalysisWorkflowMode, uploadToken: number): AnalysisHomeQueueItem[] {
  return files.map((file, index) => ({
    key: `local_upload_${uploadToken}_${index}`,
    status: "running",
    thumbnailUrl: null,
    ratio: "cinema",
    badgeLabel: "上传中",
    title: stripMediaExtension(file.name || `视频 ${index + 1}`),
    historyItem: null,
    batchRunId: null,
    queueItemId: null,
    workflowRunId: null,
    workflowKey: mode === "materialRecognition" ? "material-recognition" : "full-analysis",
    retryable: false,
    completedAt: null,
  }));
}

export function mergeLocalQueueItems(localItems: AnalysisHomeQueueItem[], currentItems: AnalysisHomeQueueItem[]) {
  if (!localItems.length) return currentItems;
  const localKeys = new Set(localItems.map((item) => item.key));
  return [...localItems, ...currentItems.filter((item) => !localKeys.has(item.key))];
}

export function normalizePlayerQueueStatus(status: string | null | undefined): AnalysisHomeQueueItem["status"] {
  const text = String(status ?? "").toLowerCase();
  if (["processed", "done", "completed", "complete", "success", "succeeded"].includes(text)) return "done";
  if (text === "running" || text === "processing" || text === "cache_waiting") return "running";
  if (text === "failed" || text === "partial_failed") return "failed";
  if (text === "canceled") return "canceled";
  return "waiting";
}

function stripMediaExtension(value?: string | null) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return text.replace(/\.(mp4|mov|m4v|webm|mkv|avi|wmv|flv|mpeg|mpg)$/i, "");
}

function shouldShowQueueItem(item: AnalysisHomeQueueItem) {
  if (item.status !== "done") return true;
  const completedAt = item.completedAt ? Date.parse(item.completedAt) : NaN;
  return Number.isFinite(completedAt) && Date.now() - completedAt <= ANALYSIS_QUEUE_DONE_VISIBLE_MS;
}

export function analysisDetailPollingKey(item: AnalysisHistoryItem) {
  return `${item.sampleVideoId ?? ""}:${item.workflowRunId ?? ""}:${item.artifactId ?? ""}`;
}
