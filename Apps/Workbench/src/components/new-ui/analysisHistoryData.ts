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
  badgeLabel: "已完成" | "分析中" | "未完成";
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
  const latestAnalysis = artifact.functionSlotAtomizationAnalysis
    ?? artifact.userMaterialPack
    ?? artifact.packagingStructureAnalysis
    ?? artifact.rhythmStructureAnalysis
    ?? artifact.scriptSegmentAnalysis
    ?? artifact.shotBoundaryAnalysis
    ?? null;
  return {
    ...item,
    artifact,
    title: normalizeMediaTitle(artifact.sampleVideo.original.summary ?? item.title ?? item.sampleVideoId),
    status: artifact.status ?? item.status,
    artifactId: latestAnalysis?.artifactId ?? item.artifactId,
    traceId: analysisTraceField(latestAnalysis, "traceId") ?? artifact.trace?.traceId ?? item.traceId,
    runId: analysisTraceField(latestAnalysis, "runId") ?? artifact.trace?.runId ?? item.runId,
    stageId: analysisTraceField(latestAnalysis, "stageId") ?? artifact.trace?.stageId ?? item.stageId,
    workflowKey: resolveLoadedWorkflowKey(item, artifact),
    durationSeconds: positiveNumber(artifact.metadata.durationSeconds) ?? item.durationSeconds,
    width: positiveNumber(artifact.metadata.width) ?? item.width,
    height: positiveNumber(artifact.metadata.height) ?? item.height,
    coverUri: artifact.cover?.uri ?? artifact.frames?.[0]?.imageUri ?? item.coverUri,
    videoUri: artifact.sampleVideo.normalized.uri ?? artifact.sampleVideo.original.uri ?? item.videoUri,
    hasFunctionSlotAtomization: Boolean(artifact.functionSlotAtomizationAnalysis),
    hasUserMaterialPack: Boolean(artifact.userMaterialPack),
    isIncomplete: isIncompleteAnalysisArtifact(artifact),
    isRunning: isRunningStatus(artifact.status),
  };
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

function resolveHistoryBadge(item: AnalysisHistoryItem): "已完成" | "分析中" | "未完成" {
  if (item.hasFunctionSlotAtomization || item.hasUserMaterialPack) return "已完成";
  if (isHistoryItemRunning(item)) return "分析中";
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

function isRunningStatus(status: string | null | undefined) {
  return ["queued", "pending", "running", "processing", "waiting", "blocked", "cache_waiting"].includes(String(status ?? "").toLowerCase());
}

function isHistoryItemRunning(item: AnalysisHistoryItem) {
  return Boolean(
    item.isRunning
      || isRunningStatus(item.runtimeState?.status)
      || isRunningStatus(item.workflowRun?.status)
      || isRunningStatus(item.status),
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
