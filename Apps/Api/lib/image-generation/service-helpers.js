const { SAMPLE_STATUS } = require("../../../../Core/Workspace/sample-video-contracts");
const { STAGES } = require("./debug");

function buildArtifact({ context, options, providerResult, images, promptSummary }) {
  return {
    artifactId: context.artifactId,
    parentArtifactId: context.parentArtifactId,
    artifactType: "image-generation",
    type: "image-generation",
    stageName: STAGES.artifactAttached,
    sampleVideoId: context.sampleVideoId,
    traceId: context.traceContext.traceId,
    createdAt: new Date().toISOString(),
    provider: providerResult.provider ?? "pptoken",
    model: providerResult.result?.meta?.model ?? "gpt-image-2",
    groupId: options.groupId ?? null,
    selectedShots: Array.isArray(options.selectedShots) ? options.selectedShots : [],
    promptSummary,
    providerMeta: providerResult.result?.meta ?? null,
    referenceImage: safeBasename(options.referenceImagePath),
    images: images.map((image) => ({
      index: image.index,
      uri: image.uri,
      bytes: image.bytes,
      sourceUrl: image.sourceUrl,
    })),
  };
}

function buildStoryboardArtifact({ context, options, storyboard, groupResults, images }) {
  const orderedGroupResults = [...groupResults].sort((left, right) => left.index - right.index);
  return {
    artifactId: context.artifactId,
    parentArtifactId: context.parentArtifactId,
    artifactType: "image-generation",
    type: "image-generation",
    stageName: STAGES.artifactAttached,
    sampleVideoId: context.sampleVideoId,
    traceId: context.traceContext.traceId,
    createdAt: new Date().toISOString(),
    mode: "storyboard-prompt-file",
    sourceFile: storyboard.sourceFile,
    provider: groupResults[0]?.providerResult?.provider ?? "pptoken",
    model: groupResults[0]?.providerResult?.result?.meta?.model ?? "gpt-image-2",
    aspect: storyboard.aspect,
    promptSummary: {
      mode: "storyboard-prompt-file",
      sourceFile: safeBasename(options.storyboardPromptFile),
      groupCount: storyboard.groups.length,
      shotCount: storyboard.groups.reduce((sum, group) => sum + group.shots.length, 0),
    },
    storyboardRun: context.job.imageGenerationRun ?? null,
    storyboardGroups: orderedGroupResults.map(({ group, providerResult, images: groupImages }) => ({
      groupId: group.groupId,
      title: group.title,
      shots: group.shots,
      promptChars: group.prompt.length,
      referenceImage: safeBasename(group.referenceImagePath ?? storyboard.referenceImagePath ?? options.referenceImagePath),
      providerMeta: providerResult.result?.meta ?? null,
      images: groupImages.map((image) => ({
        index: image.index,
        uri: image.uri,
        bytes: image.bytes,
        sourceUrl: image.sourceUrl,
      })),
    })),
    images: images.map((image) => ({
      index: image.index,
      uri: image.uri,
      bytes: image.bytes,
      sourceUrl: image.sourceUrl,
    })),
  };
}

function safeBasename(filePath) {
  if (!filePath) return null;
  return String(filePath).split(/[\\/]/).pop() || null;
}

function referenceImageForGroup(group, storyboard, options) {
  return group?.referenceImagePath ?? storyboard?.referenceImagePath ?? options?.referenceImagePath ?? null;
}

function normalizeConcurrency(value, groupCount) {
  const maxConcurrency = 10;
  const parsed = Number(value ?? maxConcurrency);
  if (!Number.isFinite(parsed) || parsed <= 0) return Math.min(maxConcurrency, Math.max(1, groupCount));
  return Math.max(1, Math.min(Math.floor(parsed), maxConcurrency, Math.max(1, groupCount)));
}

function normalizeRetryAttempts(value) {
  const parsed = Number(value ?? 2);
  if (!Number.isFinite(parsed) || parsed <= 0) return 1;
  return Math.max(1, Math.min(Math.floor(parsed), 5));
}

async function runWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function runWorker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }
  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, runWorker));
  return results;
}

function updateStoryboardRunState(context, patch) {
  const current = context.job.imageGenerationRun ?? {};
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  context.job = context.jobStore.updateJob(context.job.jobId, {
    imageGenerationRun: next,
    outputSummary: storyboardRunSummary(next),
  }) ?? { ...context.job, imageGenerationRun: next };
}

function markStoryboardGroup(context, groupId, patch) {
  const currentRun = context.job.imageGenerationRun ?? {};
  const groups = Array.isArray(currentRun.groups) ? currentRun.groups : [];
  updateStoryboardRunState(context, {
    groups: groups.map((group) => group.groupId === groupId ? { ...group, ...patch, updatedAt: new Date().toISOString() } : group),
  });
}

function updateStoryboardProgress(context) {
  const run = context.job.imageGenerationRun ?? {};
  const groups = Array.isArray(run.groups) ? run.groups : [];
  const completed = groups.filter((group) => group.status === "completed").length;
  const failed = groups.filter((group) => group.status === "failed").length;
  const total = groups.length || 1;
  const progress = Math.min(94, 20 + Math.round(((completed + failed) / total) * 65));
  context.job = context.jobStore.updateJob(context.job.jobId, {
    status: SAMPLE_STATUS.processing,
    progress,
    outputSummary: storyboardRunSummary(run),
  }) ?? context.job;
}

function storyboardRunSummary(run) {
  const groups = Array.isArray(run.groups) ? run.groups : [];
  return {
    mode: run.mode ?? "storyboard-prompt-file",
    groupCount: groups.length,
    completedGroups: groups.filter((group) => group.status === "completed").length,
    failedGroups: groups.filter((group) => group.status === "failed").length,
    concurrency: run.concurrency ?? null,
    timeoutSeconds: run.timeoutSeconds ?? null,
    timeoutBudgetSeconds: run.timeoutBudgetSeconds ?? null,
    retryMaxAttempts: run.retryMaxAttempts ?? null,
    retryAttemptCount: run.retryAttemptCount ?? 0,
    retryingGroups: Array.isArray(run.retryingGroups) ? run.retryingGroups : [],
  };
}
module.exports = {
  buildArtifact,
  buildStoryboardArtifact,
  markStoryboardGroup,
  normalizeConcurrency,
  normalizeRetryAttempts,
  referenceImageForGroup,
  runWithConcurrency,
  safeBasename,
  storyboardRunSummary,
  updateStoryboardProgress,
  updateStoryboardRunState,
};
