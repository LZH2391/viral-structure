import type { ProcessingJob } from "../types";

export type JobUpdateCallback<TJob> = (job: TJob) => void;
export type JobPollOptions<TJob> = {
  maxAttempts?: number;
  intervalMs?: number;
  onUpdate?: JobUpdateCallback<TJob>;
  stopOnNull?: boolean;
  preservePreviousOnNull?: boolean;
};

const DEFAULT_MAX_ATTEMPTS = 180;
const DEFAULT_INTERVAL_MS = 1000;

export async function pollProcessingJob(
  fetchJob: () => Promise<ProcessingJob | null>,
  options: JobPollOptions<ProcessingJob | null> = {},
) {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  let previousJob = null as ProcessingJob | null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (attempt > 0) await delay(intervalMs);
    const job = await fetchJob();
    if (job == null && options.preservePreviousOnNull) {
      if (options.stopOnNull && !previousJob) return null;
      continue;
    }
    if (job == null && options.stopOnNull) {
      if (!isSameProcessingJobSnapshot(previousJob, job)) {
        options.onUpdate?.(job);
      }
      return null;
    }
    if (!isSameProcessingJobSnapshot(previousJob, job)) {
      options.onUpdate?.(job);
      previousJob = job;
    }
    if (job && (job.status === "processed" || job.status === "failed" || job.status === "cache_waiting")) {
      return job;
    }
  }

  return previousJob;
}

export function isSameProcessingJobSnapshot(left: ProcessingJob | null | undefined, right: ProcessingJob | null | undefined) {
  if (!left && !right) return true;
  if (!left || !right) return false;
  return JSON.stringify(normalizeJobSnapshot(left)) === JSON.stringify(normalizeJobSnapshot(right));
}

function normalizeJobSnapshot(job: ProcessingJob) {
  return {
    jobId: job.jobId ?? null,
    sampleVideoId: job.sampleVideoId ?? null,
    stage: job.stage ?? null,
    status: job.status ?? null,
    progress: job.progress ?? null,
    traceId: job.traceId ?? null,
    errorSummary: normalizeErrorSummary(job.errorSummary ?? null),
    activeThreadMessage: normalizeActiveThreadMessage(job.activeThreadMessage ?? null),
    cachePrompt: normalizeCachePrompt(job.cachePrompt ?? null),
  };
}

function normalizeErrorSummary(errorSummary: ProcessingJob["errorSummary"]) {
  if (!errorSummary) return null;
  return {
    code: errorSummary.code ?? null,
    message: errorSummary.message ?? null,
    debugSnapshotUri: errorSummary.debugSnapshotUri ?? null,
    stageName: errorSummary.stageName ?? null,
    retryable: errorSummary.retryable ?? null,
  };
}

function normalizeActiveThreadMessage(message: ProcessingJob["activeThreadMessage"]) {
  if (!message) return null;
  return {
    threadId: message.threadId ?? null,
    turnId: message.turnId ?? null,
    role: message.role ?? null,
    text: message.text ?? null,
    createdAt: message.createdAt ?? null,
  };
}

function normalizeCachePrompt(cachePrompt: ProcessingJob["cachePrompt"]) {
  if (!cachePrompt) return null;
  return {
    cacheKind: cachePrompt.cacheKind ?? null,
    cacheKey: cachePrompt.cacheKey ?? null,
    analysisFps: cachePrompt.analysisFps ?? null,
    sourceSampleVideoId: cachePrompt.sourceSampleVideoId ?? null,
    sourceArtifactId: cachePrompt.sourceArtifactId ?? null,
    sourceTraceId: cachePrompt.sourceTraceId ?? null,
    sourceTurnId: cachePrompt.sourceTurnId ?? null,
    sourceCreatedAt: cachePrompt.sourceCreatedAt ?? null,
    cachedItem: cachePrompt.cachedItem
      ? {
          sampleVideoId: cachePrompt.cachedItem.sampleVideoId,
          traceId: cachePrompt.cachedItem.traceId ?? null,
          cacheKey: cachePrompt.cachedItem.cacheKey ?? null,
          cacheKind: cachePrompt.cachedItem.cacheKind ?? null,
          updatedAt: cachePrompt.cachedItem.updatedAt ?? null,
          sourceArtifactId: cachePrompt.cachedItem.sourceArtifactId ?? null,
          sourceTraceId: cachePrompt.cachedItem.sourceTraceId ?? null,
          analysisFps: cachePrompt.cachedItem.analysisFps ?? null,
          segmentCount: cachePrompt.cachedItem.segmentCount ?? null,
          sectionCount: cachePrompt.cachedItem.sectionCount ?? null,
          cardCount: cachePrompt.cachedItem.cardCount ?? null,
          shotCount: cachePrompt.cachedItem.shotCount ?? null,
          boundaryCount: cachePrompt.cachedItem.boundaryCount ?? null,
        }
      : null,
  };
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
