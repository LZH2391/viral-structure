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
  detail: string;
};

export async function listAnalysisHistorySamples(limit = 12): Promise<AnalysisHistoryItem[]> {
  const response = await listPlatformResources("sample");
  return [...response.resources]
    .sort((a, b) => timestampValue(b.updatedAt ?? b.createdAt) - timestampValue(a.updatedAt ?? a.createdAt))
    .slice(0, limit)
    .map((sample) => ({
      sample,
      artifact: null,
      artifactStatus: "pending",
    }));
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

export function resolveAnalysisHistoryMedia(item: AnalysisHistoryItem): AnalysisHistoryMedia {
  const artifact = item.artifact;
  const width = positiveNumber(artifact?.metadata.width ?? item.sample.summary?.width);
  const height = positiveNumber(artifact?.metadata.height ?? item.sample.summary?.height);
  const duration = positiveNumber(artifact?.metadata.durationSeconds ?? item.sample.summary?.durationSeconds);
  const orientation = width && height && height > width ? "portrait" : "landscape";
  const title = artifact?.sampleVideo.original.summary ?? item.sample.label ?? item.sample.resourceId;
  const coverUri = artifact?.cover?.uri ?? artifact?.frames?.[0]?.imageUri ?? null;
  const videoUri = artifact?.sampleVideo.normalized.uri ?? artifact?.sampleVideo.original.uri ?? null;
  const ratioLabel = orientation === "portrait" ? "9:16" : "16:9";

  return {
    title,
    orientation,
    coverUrl: runtimeUrl(coverUri),
    videoUrl: runtimeUrl(videoUri),
    ratioLabel,
    detail: [formatDuration(duration), ratioLabel, item.artifactStatus === "pending" ? "封面加载中" : null].filter(Boolean).join(" / "),
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
