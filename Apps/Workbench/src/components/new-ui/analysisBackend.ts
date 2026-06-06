import {
  checkFullAnalysisUploadCache,
  getLatestFullAnalysisRunForSample,
  getLatestMaterialRecognitionRunForSample,
  getSampleArtifact,
  getWorkflowRun,
  startFullAnalysisRun,
} from "../../api/client";
import {
  getPlatformRuntimeState,
  type PlatformRuntimeState,
} from "../../api/platformClient";
import type { SampleArtifact, WorkflowRun } from "../../types";
import {
  resolveAnalysisHistoryMedia,
  withLoadedAnalysisHistoryArtifact,
  type AnalysisHistoryItem,
  type AnalysisHistoryMedia,
} from "./analysisHistoryData";

export type AnalysisBackendLoadResult = {
  item: AnalysisHistoryItem;
  media: AnalysisHistoryMedia;
};

export type AnalysisStartResult = AnalysisBackendLoadResult & {
  workflowRun: WorkflowRun;
};

const DEFAULT_FRAME_SAMPLE_RATE = 10;

export async function startAnalysisUpload(file: File): Promise<AnalysisStartResult> {
  const cache = await checkFullAnalysisUploadCache(file, { frameSampleRateFps: DEFAULT_FRAME_SAMPLE_RATE }).catch(() => null);
  const workflowRun = await startFullAnalysisRun(file, {
    frameSampleRateFps: DEFAULT_FRAME_SAMPLE_RATE,
    enableAudioSeparation: true,
    enableSubtitleRecognition: true,
    enableAudioFeatureAnalysis: true,
    enableFunctionSlotAtomization: true,
    cacheDecision: cache?.cacheHit ? "reuse" : "ask",
  });
  const startedItem = analysisHistoryItemFromWorkflowRun(workflowRun, file.name);
  const loaded = await loadAnalysisDetailItem(startedItem, { workflowRun });
  return { ...loaded, workflowRun };
}

export async function loadAnalysisDetailItem(
  item: AnalysisHistoryItem,
  options: { workflowRun?: WorkflowRun | null } = {},
): Promise<AnalysisBackendLoadResult> {
  const workflowRun = options.workflowRun ?? await loadWorkflowRun(item);
  const sampleVideoId = workflowRun?.sampleVideoId ?? item.sampleVideoId;
  const artifact = sampleVideoId ? await getSampleArtifact(sampleVideoId).catch(() => null) : null;
  const loadedItem = withLoadedAnalysisHistoryArtifact({ ...item, sampleVideoId, workflowRunId: workflowRun?.workflowRunId ?? item.workflowRunId ?? null }, artifact);
  const enrichedItem = await enrichAnalysisItem({ ...loadedItem, workflowRun });
  return {
    item: enrichedItem,
    media: resolveAnalysisHistoryMedia(enrichedItem),
  };
}

export async function refreshAnalysisDetailItem(item: AnalysisHistoryItem): Promise<AnalysisBackendLoadResult> {
  return loadAnalysisDetailItem(item);
}

function analysisHistoryItemFromWorkflowRun(workflowRun: WorkflowRun, filename: string): AnalysisHistoryItem {
  return {
    sampleVideoId: workflowRun.sampleVideoId ?? "",
    title: filename,
    status: workflowRun.status,
    updatedAt: workflowRun.updatedAt,
    createdAt: workflowRun.createdAt,
    artifactId: latestWorkflowArtifactId(workflowRun),
    traceId: workflowRun.traceId,
    runId: workflowRun.runId,
    stageId: latestWorkflowStageId(workflowRun),
    durationSeconds: null,
    width: null,
    height: null,
    coverUri: null,
    videoUri: null,
    hasFunctionSlotAtomization: false,
    hasUserMaterialPack: false,
    isIncomplete: false,
    isRunning: isWorkflowRunning(workflowRun.status),
    artifact: null,
    workflowRunId: workflowRun.workflowRunId,
    workflowRun,
    runtimeState: null,
  };
}

async function loadWorkflowRun(item: AnalysisHistoryItem) {
  if (item.workflowRunId) return getWorkflowRun(item.workflowRunId).catch(() => item.workflowRun ?? null);
  if (item.workflowRun) return item.workflowRun;
  if (item.sampleVideoId) return getLatestWorkflowRunForHistoryItem(item);
  return item.workflowRun ?? null;
}

async function getLatestWorkflowRunForHistoryItem(item: AnalysisHistoryItem) {
  const sampleVideoId = item.sampleVideoId;
  const preferMaterialRecognition = Boolean(item.hasUserMaterialPack && !item.hasFunctionSlotAtomization);
  const primary = preferMaterialRecognition ? getLatestMaterialRecognitionRunForSample : getLatestFullAnalysisRunForSample;
  const fallback = preferMaterialRecognition ? getLatestFullAnalysisRunForSample : getLatestMaterialRecognitionRunForSample;
  return primary(sampleVideoId).catch(() => fallback(sampleVideoId).catch(() => item.workflowRun ?? null));
}

async function enrichAnalysisItem(item: AnalysisHistoryItem): Promise<AnalysisHistoryItem> {
  const workflowRunId = item.workflowRun?.workflowRunId ?? item.workflowRunId ?? null;
  const traceId = item.workflowRun?.traceId ?? item.traceId ?? null;
  const artifactId = item.artifactId ?? latestWorkflowArtifactId(item.workflowRun ?? null);
  const runtimeState = workflowRunId ? await getPlatformRuntimeState("workflowRun", workflowRunId).catch(() => null) : null;
  const hasKnownRunningState = Boolean(item.workflowRun || runtimeState);
  const currentlyRunning = isWorkflowRunning(item.workflowRun?.status) || isRuntimeRunning(runtimeState);
  return {
    ...item,
    workflowRunId,
    artifactId,
    traceId,
    runtimeState,
    isRunning: hasKnownRunningState ? currentlyRunning : Boolean(item.isRunning),
  };
}

function latestWorkflowArtifactId(workflowRun: WorkflowRun | null) {
  return [...(workflowRun?.stages ?? [])].reverse().find((stage) => stage.artifactId)?.artifactId ?? null;
}

function latestWorkflowStageId(workflowRun: WorkflowRun) {
  return [...(workflowRun.stages ?? [])].reverse().find((stage) => stage.stageId)?.stageId ?? null;
}

export function isAnalysisItemRunning(item: AnalysisHistoryItem | null) {
  return Boolean(item?.isRunning || isWorkflowRunning(item?.workflowRun?.status) || isRuntimeRunning(item?.runtimeState));
}

function isWorkflowRunning(status: string | null | undefined) {
  const text = String(status ?? "").toLowerCase();
  if (!text) return false;
  return !["processed", "failed", "partial_failed", "canceled", "cache_waiting"].includes(text);
}

function isRuntimeRunning(runtimeState: PlatformRuntimeState | null | undefined) {
  return ["queued", "running", "waiting", "blocked"].includes(String(runtimeState?.status ?? "").toLowerCase());
}

export type {
  PlatformRuntimeState,
  WorkflowRun,
  SampleArtifact,
};
