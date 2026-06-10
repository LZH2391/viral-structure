import { runtimeUrl } from "../../api/client";
import { getAnalysisHistoryProjection, type AnalysisHistoryProjectionItem } from "../../api/platformClient";
import type { PlatformRuntimeState } from "../../api/platformClient";
import type { SampleArtifact, WorkflowRun } from "../../types";
import { formatSecondsCompact } from "../../utils/format";

export type AnalysisHistoryItem = AnalysisHistoryProjectionItem & {
  artifact?: SampleArtifact | null;
  workflowRunId?: string | null;
  workflowRun?: WorkflowRun | null;
  runtimeState?: PlatformRuntimeState | null;
};

export type AnalysisHistoryMedia = {
  title: string;
  orientation: "landscape" | "portrait";
  coverUrl: string | null;
  videoUrl: string | null;
  ratioLabel: "16:9" | "9:16";
  durationLabel: string;
  relativeDateLabel: string;
  badgeLabel: "已完成" | "分析中" | "识别中" | "未完成";
  analysisKind: "material" | "structure" | null;
};

export async function listAnalysisHistorySamples(): Promise<AnalysisHistoryItem[]> {
  const response = await getAnalysisHistoryProjection();
  return [...(response.summary?.items ?? [])]
    .sort((a, b) => timestampValue(b.updatedAt ?? b.createdAt) - timestampValue(a.updatedAt ?? a.createdAt))
    .map((item) => ({ ...item, artifact: null }));
}

export function shouldShowAnalysisHistoryItem(item: AnalysisHistoryItem) {
  return Boolean(item.hasFunctionSlotAtomization || item.hasUserMaterialPack || item.isRunning || item.isIncomplete);
}

export function withLoadedAnalysisHistoryArtifact(item: AnalysisHistoryItem, artifact: SampleArtifact | null): AnalysisHistoryItem {
  if (!artifact) return item;
  const visibleArtifact = filterArtifactForWorkflowRun(artifact, item.workflowRun ?? null);
  const latestAnalysis = visibleArtifact.functionSlotAtomizationAnalysis
    ?? visibleArtifact.userMaterialPack
    ?? visibleArtifact.packagingStructureAnalysis
    ?? visibleArtifact.rhythmStructureAnalysis
    ?? visibleArtifact.scriptSegmentAnalysis
    ?? visibleArtifact.shotBoundaryAnalysis
    ?? null;
  return {
    ...item,
    artifact: visibleArtifact,
    title: normalizeMediaTitle(visibleArtifact.sampleVideo.original.summary ?? item.title ?? item.sampleVideoId),
    status: item.workflowRun?.status ?? visibleArtifact.status ?? item.status,
    artifactId: latestAnalysis?.artifactId ?? item.artifactId,
    traceId: analysisTraceField(latestAnalysis, "traceId") ?? item.workflowRun?.traceId ?? visibleArtifact.trace?.traceId ?? item.traceId,
    runId: analysisTraceField(latestAnalysis, "runId") ?? item.workflowRun?.runId ?? visibleArtifact.trace?.runId ?? item.runId,
    stageId: analysisTraceField(latestAnalysis, "stageId") ?? latestWorkflowStageId(item.workflowRun) ?? visibleArtifact.trace?.stageId ?? item.stageId,
    workflowKey: item.workflowRun?.workflowKey ?? resolveLoadedWorkflowKey(item, visibleArtifact),
    durationSeconds: positiveNumber(visibleArtifact.metadata.durationSeconds) ?? item.durationSeconds,
    width: positiveNumber(visibleArtifact.metadata.width) ?? item.width,
    height: positiveNumber(visibleArtifact.metadata.height) ?? item.height,
    coverUri: visibleArtifact.cover?.uri ?? visibleArtifact.frames?.[0]?.imageUri ?? item.coverUri,
    videoUri: visibleArtifact.sampleVideo.normalized.uri ?? visibleArtifact.sampleVideo.original.uri ?? item.videoUri,
    hasFunctionSlotAtomization: Boolean(visibleArtifact.functionSlotAtomizationAnalysis),
    hasUserMaterialPack: Boolean(visibleArtifact.userMaterialPack),
    isIncomplete: isIncompleteAnalysisArtifact(visibleArtifact),
    isRunning: isRunningStatus(item.workflowRun?.status ?? visibleArtifact.status),
  };
}

export function filterArtifactForWorkflowRun(artifact: SampleArtifact, workflowRun: WorkflowRun | null | undefined): SampleArtifact {
  if (!workflowRun?.workflowRunId || !Array.isArray(workflowRun.stages)) return artifact;
  const visible = { ...artifact };
  if (!stageOwnsArtifact(workflowRun, "shotBoundary", artifact.shotBoundaryAnalysis?.artifactId)) {
    delete visible.shotBoundaryAnalysis;
  }
  if (!stageOwnsArtifact(workflowRun, "scriptSegment", artifact.scriptSegmentAnalysis?.artifactId)) {
    delete visible.scriptSegmentAnalysis;
  }
  if (!stageOwnsArtifact(workflowRun, "rhythmStructure", artifact.rhythmStructureAnalysis?.artifactId)) {
    delete visible.rhythmStructureAnalysis;
  }
  if (!stageOwnsArtifact(workflowRun, "packagingStructure", artifact.packagingStructureAnalysis?.artifactId)) {
    delete visible.packagingStructureAnalysis;
  }
  if (!stageOwnsArtifact(workflowRun, "functionSlotAtomization", artifact.functionSlotAtomizationAnalysis?.artifactId)) {
    delete visible.functionSlotAtomizationAnalysis;
  }
  if (!stageOwnsArtifact(workflowRun, "userMaterialTagger", artifact.userMaterialPack?.artifactId)) {
    delete visible.userMaterialPack;
  }
  return visible;
}

export function resolveAnalysisHistoryMedia(item: AnalysisHistoryItem): AnalysisHistoryMedia {
  const artifact = item.artifact;
  const width = positiveNumber(artifact?.metadata.width ?? item.width);
  const height = positiveNumber(artifact?.metadata.height ?? item.height);
  const duration = positiveNumber(artifact?.metadata.durationSeconds ?? item.durationSeconds);
  const orientation = width && height && height > width ? "portrait" : "landscape";
  const title = normalizeMediaTitle(artifact?.sampleVideo.original.summary ?? item.title ?? item.sampleVideoId);
  const coverUri = artifact?.cover?.uri ?? artifact?.frames?.[0]?.imageUri ?? item.coverUri;
  const videoUri = artifact?.sampleVideo.normalized.uri ?? artifact?.sampleVideo.original.uri ?? item.videoUri;
  const ratioLabel = orientation === "portrait" ? "9:16" : "16:9";
  const badgeLabel = resolveHistoryBadge(item);
  const analysisKind = resolveAnalysisKind(item);

  return {
    title,
    orientation,
    coverUrl: runtimeUrl(coverUri),
    videoUrl: runtimeUrl(videoUri),
    ratioLabel,
    durationLabel: formatDuration(duration),
    relativeDateLabel: formatRelativeDate(item.updatedAt ?? item.createdAt),
    badgeLabel,
    analysisKind,
  };
}

function positiveNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function timestampValue(value: string | null | undefined) {
  const timestamp = Date.parse(value ?? "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function formatDuration(seconds: number | null) {
  return formatSecondsCompact(seconds);
}

function formatRelativeDate(value: string | null | undefined) {
  const timestamp = Date.parse(value ?? "");
  if (!Number.isFinite(timestamp)) return "时间未知";
  const diffDays = dayDiff(new Date(), new Date(timestamp));
  if (diffDays <= 0) return "今天";
  if (diffDays === 1) return "昨天";
  return `${diffDays}天前`;
}

function dayDiff(a: Date, b: Date) {
  const startA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const startB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((startA - startB) / 86400000);
}

export function normalizeMediaTitle(value: string) {
  return value
    .replace(/\.(mp4|mov|m4v|webm|mkv|avi)$/i, "")
    .trim();
}

function resolveHistoryBadge(item: AnalysisHistoryItem): "已完成" | "分析中" | "识别中" | "未完成" {
  const completed = item.hasFunctionSlotAtomization || item.hasUserMaterialPack;
  if (isHistoryItemRunning(item) && (!completed || hasExecutingHistoryStatus(item))) return resolveAnalysisKind(item) === "material" ? "识别中" : "分析中";
  if (completed) return "已完成";
  if (item.isIncomplete) return "未完成";
  return "未完成";
}

function resolveAnalysisKind(item: AnalysisHistoryItem): "material" | "structure" | null {
  if (item.hasFunctionSlotAtomization) return "structure";
  if (item.hasUserMaterialPack) return "material";
  if (item.workflowRun?.workflowKey === "material-recognition" || item.workflowKey === "material-recognition") return "material";
  if (item.workflowRun?.workflowKey === "full-analysis" || item.workflowKey === "full-analysis") return "structure";
  return null;
}

function resolveLoadedWorkflowKey(item: AnalysisHistoryItem, artifact: SampleArtifact) {
  if (artifact.functionSlotAtomizationAnalysis) return "full-analysis";
  if (artifact.userMaterialPack && !artifact.functionSlotAtomizationAnalysis) return "material-recognition";
  return item.workflowKey ?? null;
}

function isIncompleteAnalysisArtifact(artifact: SampleArtifact) {
  const hasCompleteResult = Boolean(artifact.functionSlotAtomizationAnalysis || artifact.userMaterialPack);
  const hasIntermediateResult = Boolean(
    artifact.packagingStructureAnalysis
      || artifact.rhythmStructureAnalysis
      || artifact.scriptSegmentAnalysis
      || artifact.shotBoundaryAnalysis,
  );
  return hasIntermediateResult && !hasCompleteResult && !isRunningStatus(artifact.status);
}

function stageOwnsArtifact(workflowRun: WorkflowRun, stageKey: string, artifactId: string | null | undefined) {
  const id = stringOrNull(artifactId);
  if (!id) return false;
  const stage = workflowRun.stages?.find((item) => item.key === stageKey);
  return String(stage?.status ?? "").toLowerCase() === "processed" && stringOrNull(stage?.artifactId) === id;
}

function latestWorkflowStageId(workflowRun: WorkflowRun | null | undefined) {
  return [...(workflowRun?.stages ?? [])].reverse().find((stage) => stringOrNull(stage.stageId))?.stageId ?? null;
}

function isRunningStatus(status: string | null | undefined) {
  return ["queued", "pending", "running", "processing", "waiting", "blocked", "cache_waiting"].includes(String(status ?? "").toLowerCase());
}

function isExecutingStatus(status: string | null | undefined) {
  return ["queued", "pending", "running", "processing", "in_progress", "inprogress"].includes(String(status ?? "").toLowerCase());
}

function isHistoryItemRunning(item: AnalysisHistoryItem) {
  return Boolean(
    item.isRunning
      || isRunningStatus(item.runtimeState?.status)
      || isRunningStatus(item.workflowRun?.status)
      || isRunningStatus(item.status),
  );
}

function hasExecutingHistoryStatus(item: AnalysisHistoryItem) {
  return Boolean(
    isExecutingStatus(item.runtimeState?.status)
      || isExecutingStatus(item.workflowRun?.status)
      || isExecutingStatus(item.status),
  );
}

function analysisTraceField(analysis: unknown, key: "traceId" | "runId" | "stageId") {
  if (!analysis || typeof analysis !== "object") return null;
  const record = analysis as Record<string, unknown>;
  const direct = stringOrNull(record[key]);
  if (direct) return direct;
  const agent = record.agent;
  if (!agent || typeof agent !== "object") return null;
  return stringOrNull((agent as Record<string, unknown>)[key]);
}

function stringOrNull(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}
