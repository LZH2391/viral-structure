import { getSampleArtifact, runtimeUrl } from "../../api/client";
import { listPlatformResources, type PlatformResourceSummary } from "../../api/platformClient";
import type { SampleArtifact } from "../../types";

export type AnalysisHistoryArtifactStatus = "pending" | "ready" | "failed";

export type AnalysisHistoryItem = {
  sample: PlatformResourceSummary;
  artifact: SampleArtifact | null;
  artifactStatus: AnalysisHistoryArtifactStatus;
};

export type AnalysisHistoryMedia = {
  title: string;
  orientation: "landscape" | "portrait";
  coverUrl: string | null;
  videoUrl: string | null;
  ratioLabel: "16:9" | "9:16";
  durationLabel: string;
  relativeDateLabel: string;
  badgeLabel: "素材识别" | "样例分析" | "分析中";
};

export async function listAnalysisHistorySamples(limit?: number): Promise<AnalysisHistoryItem[]> {
  const response = await listPlatformResources("sample");
  const samples = [...response.resources]
    .sort((a, b) => timestampValue(b.updatedAt ?? b.createdAt) - timestampValue(a.updatedAt ?? a.createdAt))
    .map((sample) => ({
      sample,
      artifact: null,
      artifactStatus: "pending",
    }));
  return typeof limit === "number" ? samples.slice(0, limit) : samples;
}

export async function hydrateAnalysisHistoryArtifacts(
  samples: PlatformResourceSummary[],
  onItem: (sampleVideoId: string, artifact: SampleArtifact | null) => void,
) {
  const queue = [...samples];
  const workerCount = Math.min(2, queue.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (queue.length) {
      const sample = queue.shift();
      if (!sample) return;
      const artifact = await getSampleArtifact(sample.resourceId).catch(() => null);
      onItem(sample.resourceId, artifact);
    }
  }));
}

export function shouldShowAnalysisHistoryItem(item: AnalysisHistoryItem) {
  return Boolean(
    item.artifact?.functionSlotAtomizationAnalysis
    || item.artifact?.userMaterialPack
    || isRunningStatus(item.sample.status),
  );
}

export function resolveAnalysisHistoryMedia(item: AnalysisHistoryItem): AnalysisHistoryMedia {
  const artifact = item.artifact;
  const width = positiveNumber(artifact?.metadata.width ?? item.sample.summary?.width);
  const height = positiveNumber(artifact?.metadata.height ?? item.sample.summary?.height);
  const duration = positiveNumber(artifact?.metadata.durationSeconds ?? item.sample.summary?.durationSeconds);
  const orientation = width && height && height > width ? "portrait" : "landscape";
  const title = normalizeMediaTitle(artifact?.sampleVideo.original.summary ?? item.sample.label ?? item.sample.resourceId);
  const coverUri = artifact?.cover?.uri ?? artifact?.frames?.[0]?.imageUri ?? null;
  const videoUri = artifact?.sampleVideo.normalized.uri ?? artifact?.sampleVideo.original.uri ?? null;
  const ratioLabel = orientation === "portrait" ? "9:16" : "16:9";
  const badgeLabel = resolveHistoryBadge(item);

  return {
    title,
    orientation,
    coverUrl: runtimeUrl(coverUri),
    videoUrl: runtimeUrl(videoUri),
    ratioLabel,
    durationLabel: formatDuration(duration) ?? "0:00",
    relativeDateLabel: formatRelativeDate(item.sample.updatedAt ?? item.sample.createdAt),
    badgeLabel,
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
  if (!seconds) return null;
  const total = Math.max(1, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
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

function resolveHistoryBadge(item: AnalysisHistoryItem): "素材识别" | "样例分析" | "分析中" {
  if (isRunningStatus(item.sample.status)) return "分析中";
  if (item.artifact?.functionSlotAtomizationAnalysis) return "样例分析";
  if (item.artifact?.userMaterialPack) return "素材识别";
  return "分析中";
}

function isRunningStatus(status: string | null | undefined) {
  return ["queued", "pending", "running", "processing", "waiting", "blocked", "cache_waiting"].includes(String(status ?? "").toLowerCase());
}
