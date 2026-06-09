import {
  checkFullAnalysisUploadCache,
  checkMaterialRecognitionUploadCache,
  getLatestFullAnalysisRunForSample,
  getLatestMaterialRecognitionRunForSample,
  getProcessingJob,
  getSampleArtifact,
  getWorkflowRun,
  startAnalysisRole,
  startFullAnalysisRun,
  startMaterialRecognitionRun,
  startShotBoundaryAnalysis,
} from "../../api/client";
import {
  executePlatformCommand,
  getPlatformRuntimeState,
  getPlatformResourceActions,
  type PlatformRuntimeState,
} from "../../api/platformClient";
import type { SampleArtifact, WorkflowRun } from "../../types";
import type { LibraryItemSummary } from "../../types";
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
  workflowRun?: WorkflowRun | null;
};

const DEFAULT_FRAME_SAMPLE_RATE = 10;
export type AnalysisWorkflowMode = "structureAnalysis" | "materialRecognition";

export async function startAnalysisUpload(file: File, mode: AnalysisWorkflowMode): Promise<AnalysisStartResult> {
  const cacheCheck = mode === "materialRecognition" ? checkMaterialRecognitionUploadCache : checkFullAnalysisUploadCache;
  const cache = await cacheCheck(file, { frameSampleRateFps: DEFAULT_FRAME_SAMPLE_RATE }).catch(() => null);
  if (cache?.cacheHit) {
    return loadAnalysisDetailItem(analysisHistoryItemFromCachedItem(cache.cachedItem, file.name));
  }
  const startRun = mode === "materialRecognition" ? startMaterialRecognitionRun : startFullAnalysisRun;
  const workflowRun = await startRun(file, {
    frameSampleRateFps: DEFAULT_FRAME_SAMPLE_RATE,
    enableAudioSeparation: true,
    enableSubtitleRecognition: true,
    enableAudioFeatureAnalysis: true,
    ...(mode === "structureAnalysis" ? { enableFunctionSlotAtomization: true } : {}),
    cacheDecision: "ask",
  });
  const startedItem = analysisHistoryItemFromWorkflowRun(workflowRun, file.name);
  const loaded = await loadAnalysisDetailItem(startedItem, { workflowRun });
  return { ...loaded, workflowRun };
}

function analysisHistoryItemFromCachedItem(cachedItem: LibraryItemSummary, filename: string): AnalysisHistoryItem {
  return {
    sampleVideoId: cachedItem.sampleVideoId,
    title: cachedItem.filename ?? filename,
    status: cachedItem.status ?? null,
    updatedAt: cachedItem.updatedAt ?? null,
    createdAt: cachedItem.updatedAt ?? null,
    artifactId: cachedItem.sourceArtifactId ?? null,
    traceId: cachedItem.sourceTraceId ?? cachedItem.traceId ?? null,
    runId: null,
    stageId: null,
    durationSeconds: cachedItem.durationSeconds ?? null,
    width: cachedItem.width ?? null,
    height: cachedItem.height ?? null,
    coverUri: cachedItem.coverUri ?? null,
    videoUri: cachedItem.videoUri ?? null,
    hasFunctionSlotAtomization: Boolean(cachedItem.hasFunctionSlotAtomization),
    hasUserMaterialPack: Boolean(cachedItem.hasUserMaterialPack),
    isIncomplete: Boolean(cachedItem.isIncomplete),
    isRunning: isRuntimeLikeRunning(cachedItem.status),
    artifact: null,
    workflowRunId: null,
    workflowRun: null,
    runtimeState: null,
  };
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

export async function loadRerunnableWorkflowStageKeys(item: AnalysisHistoryItem | null): Promise<string[]> {
  const workflowRunId = item?.workflowRun?.workflowRunId ?? item?.workflowRunId ?? null;
  if (!workflowRunId) return artifactRerunnableStageKeys(item);
  const response = await getPlatformResourceActions("workflowRun", workflowRunId);
  const action = response.actions.find((item) => item.actionKey === "workflow.stage.rerun" && item.enabled);
  return mergeStageKeys(artifactRerunnableStageKeys(item), action ? stageKeyEnumFromActionSchema(action.inputSchema) : []);
}

export async function rerunAnalysisWorkflowStage(item: AnalysisHistoryItem, stageKey: string | string[]): Promise<AnalysisBackendLoadResult> {
  const workflowRunId = item.workflowRun?.workflowRunId ?? item.workflowRunId ?? null;
  const stageKeys = Array.isArray(stageKey) ? stageKey : [stageKey];
  if (!workflowRunId) return rerunArtifactBackedAnalysisStage(item, stageKeys);
  for (const key of stageKeys) {
    await executePlatformCommand({
      command: "workflow.stage.rerun",
      target: { resourceKind: "workflowRun", resourceId: workflowRunId },
      options: { stageKey: key },
    });
  }
  const workflowRun = await getWorkflowRun(workflowRunId);
  return loadAnalysisDetailItem({ ...item, workflowRunId, workflowRun }, { workflowRun });
}

async function rerunArtifactBackedAnalysisStage(item: AnalysisHistoryItem, stageKeys: string[]): Promise<AnalysisBackendLoadResult> {
  if (!item.sampleVideoId) throw new Error("缺少样例视频，无法重跑");
  if (stageKeys.includes("upload")) {
    const result = await executePlatformCommand({
      command: "sample.full_analysis.refresh",
      target: { resourceKind: "sample", resourceId: item.sampleVideoId },
      options: {},
    });
    const workflowRunRef = result.resourceRefs?.find((ref) => ref.resourceKind === "workflowRun" && ref.resourceId);
    const workflowRun = workflowRunRef?.resourceId ? await getWorkflowRun(workflowRunRef.resourceId) : null;
    return loadAnalysisDetailItem({ ...item, workflowRunId: workflowRun?.workflowRunId ?? null, workflowRun }, { workflowRun });
  }
  for (const key of stageKeys) {
    const job = await startLegacyStageRefresh(item, key);
    if ("processingJobId" in job) {
      await waitForJob(job.processingJobId);
    }
  }
  return loadAnalysisDetailItem(item);
}

async function startLegacyStageRefresh(item: AnalysisHistoryItem, stageKey: string) {
  const sampleVideoId = item.sampleVideoId;
  if (!sampleVideoId) throw new Error("缺少样例视频，无法重跑");
  if (stageKey === "shotBoundary") {
    return startShotBoundaryAnalysis(sampleVideoId, { cacheDecision: "refresh" });
  }
  const artifact = item.artifact ?? await getSampleArtifact(sampleVideoId).catch(() => null);
  const dependencies = {
    expectedShotBoundaryArtifactId: artifact?.shotBoundaryAnalysis?.artifactId ?? null,
    expectedScriptSegmentArtifactId: artifact?.scriptSegmentAnalysis?.artifactId ?? null,
    expectedRhythmStructureArtifactId: artifact?.rhythmStructureAnalysis?.artifactId ?? null,
    expectedPackagingStructureArtifactId: artifact?.packagingStructureAnalysis?.artifactId ?? null,
  };
  const analysisId = analysisIdForStage(stageKey);
  if (!analysisId) throw new Error("该步骤暂不支持刷新");
  return startAnalysisRole(analysisId, sampleVideoId, { cacheDecision: "refresh", ...dependencies });
}

async function waitForJob(jobId: string) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const job = await getProcessingJob(jobId);
    if (job.status === "processed") return job;
    if (job.status === "failed") throw new Error(job.errorSummary?.message ?? "重跑步骤失败");
    await delay(1000);
  }
  throw new Error("重跑步骤超时");
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function analysisIdForStage(stageKey: string) {
  if (stageKey === "scriptSegment") return "script-segments";
  if (stageKey === "rhythmStructure") return "rhythm-structure";
  if (stageKey === "packagingStructure") return "packaging-structure";
  if (stageKey === "functionSlotAtomization") return "function-slot-atomization";
  if (stageKey === "userMaterialTagger") return "user-material-tagger";
  return null;
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

function stageKeyEnumFromActionSchema(schema: Record<string, unknown> | null) {
  const properties = schema?.properties;
  if (!properties || typeof properties !== "object") return [];
  const stageKey = (properties as Record<string, unknown>).stageKey;
  if (!stageKey || typeof stageKey !== "object") return [];
  const enumValues = (stageKey as Record<string, unknown>).enum;
  return Array.isArray(enumValues) ? enumValues.map((value) => String(value)).filter(Boolean) : [];
}

function artifactRerunnableStageKeys(item: AnalysisHistoryItem | null) {
  if (!item?.sampleVideoId) return [];
  const artifact = item.artifact;
  const keys = ["upload"];
  if (artifact?.sampleVideo) keys.push("shotBoundary");
  if (artifact?.shotBoundaryAnalysis) {
    keys.push("scriptSegment", "rhythmStructure", "packagingStructure", "userMaterialTagger");
  }
  if (artifact?.scriptSegmentAnalysis && artifact?.rhythmStructureAnalysis && artifact?.packagingStructureAnalysis) {
    keys.push("functionSlotAtomization");
  }
  return keys;
}

function mergeStageKeys(...groups: string[][]) {
  return Array.from(new Set(groups.flat().filter(Boolean)));
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

function isRuntimeLikeRunning(status: string | null | undefined) {
  return ["queued", "pending", "running", "processing", "waiting", "blocked", "cache_waiting"].includes(String(status ?? "").toLowerCase());
}

export type {
  PlatformRuntimeState,
  WorkflowRun,
  SampleArtifact,
};
