import type { ProcessingJob } from "../types";

export type JobUpdateCallback<TJob> = (job: TJob) => void;
export type JobPollOptions<TJob> = {
  maxAttempts?: number;
  intervalMs?: number;
  idleTimeoutMs?: number;
  onUpdate?: JobUpdateCallback<TJob>;
  stopOnNull?: boolean;
  preservePreviousOnNull?: boolean;
};

const DEFAULT_MAX_ATTEMPTS = 360;
const DEFAULT_INTERVAL_MS = 1000;

export async function pollProcessingJob(
  fetchJob: () => Promise<ProcessingJob | null>,
  options: JobPollOptions<ProcessingJob | null> = {},
) {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  let previousJob = null as ProcessingJob | null;
  let latestActivityAt = Date.now();

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (attempt > 0) await delay(intervalMs);
    const job = await fetchJob();
    if (job == null && options.stopOnNull) {
      if (!isSameProcessingJobSnapshot(previousJob, job)) {
        options.onUpdate?.(job);
      }
      return null;
    }
    if (job == null && options.preservePreviousOnNull) {
      continue;
    }
    if (!isSameProcessingJobSnapshot(previousJob, job)) {
      options.onUpdate?.(job);
      previousJob = job;
    }
    const activityTime = resolveAgentActivityTime(job);
    if (activityTime != null && activityTime > latestActivityAt) {
      latestActivityAt = activityTime;
    }
    if (job && (job.status === "processed" || job.status === "failed" || job.status === "cache_waiting")) {
      return job;
    }
    if (job && options.idleTimeoutMs && Date.now() - latestActivityAt >= options.idleTimeoutMs) {
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
    finalMessage: job.finalMessage ?? null,
    agentActivity: normalizeAgentActivity(job.agentActivity ?? null),
    errorSummary: normalizeErrorSummary(job.errorSummary ?? null),
    activeThreadMessage: normalizeActiveThreadMessage(job.activeThreadMessage ?? null),
    cachePrompt: normalizeCachePrompt(job.cachePrompt ?? null),
  };
}

function normalizeAgentActivity(activity: ProcessingJob["agentActivity"]) {
  if (!activity) return null;
  return {
    threadId: activity.threadId ?? null,
    turnId: activity.turnId ?? null,
    status: activity.status ?? null,
    itemCount: activity.itemCount ?? null,
    effectiveItemCount: activity.effectiveItemCount ?? null,
    latestItemType: activity.latestItemType ?? null,
    latestMessagePreview: activity.latestMessagePreview ?? null,
    latestToolName: activity.latestToolName ?? null,
    updatedAt: activity.updatedAt ?? null,
    tokenUsage: activity.tokenUsage
      ? {
          inputTokens: activity.tokenUsage.inputTokens ?? null,
          outputTokens: activity.tokenUsage.outputTokens ?? null,
          totalTokens: activity.tokenUsage.totalTokens ?? null,
          reasoningOutputTokens: activity.tokenUsage.reasoningOutputTokens ?? null,
        }
      : null,
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

function resolveAgentActivityTime(job: ProcessingJob | null | undefined) {
  const candidates = [
    job?.agentActivity?.updatedAt,
    job?.activeThreadMessage?.createdAt,
  ];
  for (const candidate of candidates) {
    const time = Date.parse(String(candidate ?? ""));
    if (Number.isFinite(time)) return time;
  }
  return null;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
