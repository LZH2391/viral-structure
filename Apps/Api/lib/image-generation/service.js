const { randomUUID } = require("crypto");
const { SAMPLE_STATUS } = require("../../../../Core/Workspace/sample-video-contracts");
const { createExecutorRegistry } = require("../executors/registry");
const { buildImagePrompt } = require("./prompt-builder");
const { createPPAPIProvider } = require("./ppapi-provider");
const { parseStoryboardPromptFile } = require("./storyboard-prompt-parser");
const { writeGeneratedImages, writeImageGenerationArtifact } = require("./artifact-writer");
const { STAGES, safeError, sanitizeDebugPayload } = require("./debug");

function createImageGenerationService({
  store,
  logger,
  jobStore,
  executorRegistry = null,
  provider = null,
  ppapi = {},
} = {}) {
  if (!store) throw new Error("store is required for image-generation service");
  if (!logger) throw new Error("logger is required for image-generation service");
  if (!jobStore) throw new Error("jobStore is required for image-generation service");
  const activeExecutorRegistry = executorRegistry ?? createExecutorRegistry();
  const activeProvider = provider ?? createPPAPIProvider(ppapi);

  async function enqueue(options = {}) {
    const sampleVideoId = String(options.sampleVideoId ?? "image-generation").trim();
    const traceId = `trace_${randomUUID()}`;
    const artifactId = options.artifactId ?? `artifact_${randomUUID()}`;
    const parentArtifactId = options.parentArtifactId ?? null;
    const job = jobStore.createJob({ sampleVideoId, traceId });
    const context = {
      sampleVideoId,
      traceContext: { runId: traceId, traceId, stageId: `stage_${randomUUID()}` },
      job,
      jobStore,
      artifactId,
      parentArtifactId,
      activeStage: null,
    };
    runImageGeneration(context, options).catch((error) => markFailed(context, error));
    return { processingJobId: job.jobId, sampleVideoId, traceId, artifactId };
  }

  async function runImageGeneration(context, options) {
    await store.ensureRuntimeDirs?.();
    await store.ensureSampleDirs?.(context.sampleVideoId);
    if (options.storyboardPromptFile) return runStoryboardFileGeneration(context, options);
    return runDirectImageGeneration(context, options);
  }

  async function runDirectImageGeneration(context, options) {
    const prepared = await runStage(context, STAGES.promptPrepared, 15, {
      artifactId: context.artifactId,
      parentArtifactId: context.parentArtifactId,
      inputSummary: {
        mode: options.prompt ? "direct" : "storyboard",
        groupId: options.groupId ?? null,
        selectedShotCount: Array.isArray(options.selectedShots) ? options.selectedShots.length : 0,
      },
      action: () => buildImagePrompt(options),
      outputSummary: (result) => result.inputSummary,
    });
    const providerResult = await runStage(context, STAGES.providerRequested, 55, {
      artifactId: context.artifactId,
      parentArtifactId: context.parentArtifactId,
      inputSummary: {
        provider: activeProvider.providerName ?? "pptoken",
        promptChars: prepared.prompt.length,
        groupId: options.groupId ?? null,
        referenceImage: safeBasename(options.referenceImagePath),
      },
      action: () => activeExecutorRegistry.execute("external-api", {
        providerName: activeProvider.providerName ?? "pptoken",
        provider: activeProvider,
        request: {
          prompt: prepared.prompt,
          referenceImagePath: options.referenceImagePath,
          size: options.size,
          quality: options.quality,
          background: options.background,
          outputFormat: options.outputFormat,
          n: options.n,
        },
        timeoutSeconds: options.timeoutSeconds ?? 300,
      }, { traceContext: context.traceContext }),
      outputSummary: (execution) => ({
        provider: execution.provider,
        imageCount: execution.result?.meta?.imageCount ?? null,
        responseBytes: execution.result?.meta?.responseBytes ?? null,
        durationMs: execution.result?.meta?.durationMs ?? null,
        model: execution.result?.meta?.model ?? null,
        requestMode: execution.result?.meta?.requestMode ?? null,
      }),
    });
    const images = await runStage(context, STAGES.assetWritten, 80, {
      artifactId: context.artifactId,
      parentArtifactId: context.parentArtifactId,
      inputSummary: {
        provider: providerResult.provider,
        imageCount: providerResult.result?.meta?.imageCount ?? null,
        groupId: options.groupId ?? null,
      },
      action: () => writeGeneratedImages({
        store,
        sampleVideoId: context.sampleVideoId,
        artifactId: context.artifactId,
        groupId: options.groupId,
        filenamePrefix: "image",
        providerResult: providerResult.result,
      }),
      outputSummary: (writtenImages) => ({
        imageCount: writtenImages.length,
        totalBytes: writtenImages.reduce((sum, image) => sum + image.bytes, 0),
        uris: writtenImages.map((image) => image.uri),
      }),
    });
    const artifact = await runStage(context, STAGES.artifactAttached, 95, {
      artifactId: context.artifactId,
      parentArtifactId: context.parentArtifactId,
      inputSummary: {
        imageCount: images.length,
        provider: providerResult.provider,
      },
      action: () => writeImageGenerationArtifact({
        store,
        sampleVideoId: context.sampleVideoId,
        artifact: buildArtifact({
          context,
          options,
          providerResult,
          images,
          promptSummary: prepared.inputSummary,
        }),
      }),
      outputSummary: (savedArtifact) => ({
        artifactId: savedArtifact.artifactId,
        artifactType: savedArtifact.artifactType,
        imageCount: savedArtifact.images.length,
        uri: savedArtifact.uri,
      }),
    });
    jobStore.updateJob(context.job.jobId, {
      stage: STAGES.artifactAttached,
      status: SAMPLE_STATUS.processed,
      progress: 100,
      imageGenerationArtifact: artifact,
      outputSummary: {
        artifactId: artifact.artifactId,
        imageCount: artifact.images.length,
        uri: artifact.uri,
      },
    });
    return artifact;
  }

  async function runStoryboardFileGeneration(context, options) {
    const storyboard = await runStage(context, STAGES.promptPrepared, 15, {
      artifactId: context.artifactId,
      parentArtifactId: context.parentArtifactId,
      inputSummary: {
        mode: "storyboard-prompt-file",
        sourceFile: safeBasename(options.storyboardPromptFile),
      },
      action: () => parseStoryboardPromptFile(options.storyboardPromptFile),
      outputSummary: (result) => ({
        mode: "storyboard-prompt-file",
        aspectRatio: result.aspect.ratio,
        orientation: result.aspect.orientation,
        groupCount: result.groups.length,
        shotCount: result.groups.reduce((sum, group) => sum + group.shots.length, 0),
      }),
    });

    const storyboardConcurrency = normalizeConcurrency(options.storyboardConcurrency, storyboard.groups.length);
    const timeoutSeconds = Number(options.timeoutSeconds ?? 300);
    const retryMaxAttempts = normalizeRetryAttempts(options.storyboardRetryAttempts);
    updateStoryboardRunState(context, {
      mode: "storyboard-prompt-file",
      sourceFile: safeBasename(options.storyboardPromptFile),
      aspect: storyboard.aspect,
      referenceImage: safeBasename(storyboard.referenceImagePath ?? options.referenceImagePath),
      concurrency: storyboardConcurrency,
      timeoutSeconds,
      timeoutBudgetSeconds: Math.ceil(storyboard.groups.length / storyboardConcurrency) * timeoutSeconds,
      retryMaxAttempts,
      retryAttemptCount: 0,
      startedAt: new Date().toISOString(),
      groups: storyboard.groups.map((group) => ({
        groupId: group.groupId,
        title: group.title,
        status: "pending",
        shotCount: group.shots.length,
        promptChars: group.prompt.length,
        referenceImage: safeBasename(referenceImageForGroup(group, storyboard, options)),
        imageUris: [],
        errorSummary: null,
      })),
    });

    const groupResults = await runStoryboardGroupsWithRetries(context, options, storyboard.groups, storyboardConcurrency, retryMaxAttempts);

    const allImages = groupResults.flatMap((item) => item.images);
    const artifact = await runStage(context, STAGES.artifactAttached, 95, {
      artifactId: context.artifactId,
      parentArtifactId: context.parentArtifactId,
      inputSummary: {
        mode: "storyboard-prompt-file",
        groupCount: groupResults.length,
        imageCount: allImages.length,
      },
      action: () => writeImageGenerationArtifact({
        store,
        sampleVideoId: context.sampleVideoId,
        artifact: buildStoryboardArtifact({
          context,
          options,
          storyboard,
          groupResults,
          images: allImages,
        }),
      }),
      outputSummary: (savedArtifact) => ({
        artifactId: savedArtifact.artifactId,
        artifactType: savedArtifact.artifactType,
        groupCount: savedArtifact.storyboardGroups.length,
        imageCount: savedArtifact.images.length,
        uri: savedArtifact.uri,
      }),
    });
    jobStore.updateJob(context.job.jobId, {
      stage: STAGES.artifactAttached,
      status: SAMPLE_STATUS.processed,
      progress: 100,
      imageGenerationArtifact: artifact,
      outputSummary: {
        artifactId: artifact.artifactId,
        groupCount: artifact.storyboardGroups.length,
        imageCount: artifact.images.length,
        uri: artifact.uri,
      },
    });
    return artifact;
  }

  async function runStoryboardGroupsWithRetries(context, options, groups, concurrency, retryMaxAttempts) {
    const groupResults = new Array(groups.length);
    let pending = groups.map((group, index) => ({ group, index }));
    for (let attempt = 1; pending.length && attempt <= retryMaxAttempts; attempt += 1) {
      if (attempt > 1) {
        updateStoryboardRunState(context, {
          retryAttemptCount: attempt - 1,
          retryingGroups: pending.map((item) => item.group.groupId),
        });
      }
      const attemptResults = await runWithConcurrency(pending, concurrency, (item) => runStoryboardGroup(context, options, item.group, item.index, attempt));
      const retryableFailures = [];
      for (const result of attemptResults) {
        if (result.ok) {
          groupResults[result.index] = result.value;
        } else if (result.retryable && attempt < retryMaxAttempts) {
          retryableFailures.push({ group: result.group, index: result.index });
        } else {
          throw result.error;
        }
      }
      pending = retryableFailures;
    }
    updateStoryboardRunState(context, { retryingGroups: [] });
    return groupResults;
  }

  async function runStoryboardGroup(context, options, group, index, attempt = 1) {
    const referenceImagePath = referenceImageForGroup(group, null, options);
    markStoryboardGroup(context, group.groupId, {
      status: "requesting",
      attempt,
      startedAt: new Date().toISOString(),
      progress: "provider_request",
    });
    try {
      const providerResult = await runIsolatedStage(context, STAGES.providerRequested, {
        artifactId: context.artifactId,
        parentArtifactId: context.parentArtifactId,
        inputSummary: {
          provider: activeProvider.providerName ?? "pptoken",
          mode: "storyboard-group",
          groupId: group.groupId,
          attempt,
          promptChars: group.prompt.length,
          shotCount: group.shots.length,
          timeoutSeconds: options.timeoutSeconds ?? 300,
          referenceImage: safeBasename(referenceImagePath),
        },
        action: () => activeExecutorRegistry.execute("external-api", {
          providerName: activeProvider.providerName ?? "pptoken",
          provider: activeProvider,
          request: {
            prompt: group.prompt,
            referenceImagePath,
            size: options.size,
            quality: options.quality,
            background: options.background,
            outputFormat: options.outputFormat,
            n: options.n,
          },
          timeoutSeconds: options.timeoutSeconds ?? 300,
        }, { traceContext: context.traceContext }),
        outputSummary: (execution) => ({
          provider: execution.provider,
          groupId: group.groupId,
          attempt,
          imageCount: execution.result?.meta?.imageCount ?? null,
          responseBytes: execution.result?.meta?.responseBytes ?? null,
          durationMs: execution.result?.meta?.durationMs ?? null,
          model: execution.result?.meta?.model ?? null,
          requestMode: execution.result?.meta?.requestMode ?? null,
        }),
      });
      markStoryboardGroup(context, group.groupId, {
        status: "response_received",
        progress: "asset_write",
        providerMeta: providerResult.result?.meta ?? null,
      });
      const images = await runIsolatedStage(context, STAGES.assetWritten, {
        artifactId: context.artifactId,
        parentArtifactId: context.parentArtifactId,
        inputSummary: {
          provider: providerResult.provider,
          groupId: group.groupId,
          imageCount: providerResult.result?.meta?.imageCount ?? null,
        },
        action: () => writeGeneratedImages({
          store,
          sampleVideoId: context.sampleVideoId,
          artifactId: context.artifactId,
          groupId: group.groupId,
          filenamePrefix: "storyboard",
          providerResult: providerResult.result,
        }),
        outputSummary: (writtenImages) => ({
          groupId: group.groupId,
          imageCount: writtenImages.length,
          totalBytes: writtenImages.reduce((sum, image) => sum + image.bytes, 0),
          uris: writtenImages.map((image) => image.uri),
        }),
      });
      markStoryboardGroup(context, group.groupId, {
        status: "completed",
        progress: "completed",
        attempt,
        completedAt: new Date().toISOString(),
        imageUris: images.map((image) => image.uri),
        errorSummary: null,
      });
      updateStoryboardProgress(context);
      return { ok: true, value: { group, providerResult, images, index }, group, index };
    } catch (error) {
      const retryable = typeof error?.retryable === "boolean" ? error.retryable : false;
      markStoryboardGroup(context, group.groupId, {
        status: "failed",
        progress: "failed",
        attempt,
        completedAt: new Date().toISOString(),
        errorSummary: {
          code: error?.code ?? "image_generation_group_failed",
          message: error?.safeSummary ?? error?.message ?? "故事板分组生图失败",
          retryable,
        },
      });
      updateStoryboardProgress(context);
      return { ok: false, error, retryable, group, index };
    }
  }

  async function runStage(context, stageName, progress, options) {
    context.traceContext = { ...context.traceContext, stageId: `stage_${randomUUID()}` };
    const startedAt = Date.now();
    context.activeStage = {
      stageName,
      artifactId: options.artifactId ?? null,
      parentArtifactId: options.parentArtifactId ?? null,
      inputSummary: options.inputSummary ?? null,
      outputSummary: null,
      startedAt,
    };
    jobStore.updateJob(context.job.jobId, { stage: stageName, status: SAMPLE_STATUS.processing, progress });
    await logger.writeStageLog({
      traceContext: context.traceContext,
      stageName,
      event: "stage.start",
      artifactId: options.artifactId ?? null,
      parentArtifactId: options.parentArtifactId ?? null,
      inputSummary: options.inputSummary ?? null,
    });
    const result = await options.action();
    const outputSummary = options.outputSummary ? options.outputSummary(result) : null;
    context.activeStage.outputSummary = outputSummary;
    await logger.writeStageLog({
      traceContext: context.traceContext,
      stageName,
      event: "stage.end",
      artifactId: options.artifactId ?? null,
      parentArtifactId: options.parentArtifactId ?? null,
      outputSummary,
      durationMs: Date.now() - startedAt,
    });
    context.activeStage = null;
    return result;
  }

  async function runIsolatedStage(context, stageName, options) {
    const traceContext = { ...context.traceContext, stageId: `stage_${randomUUID()}` };
    const startedAt = Date.now();
    await logger.writeStageLog({
      traceContext,
      stageName,
      event: "stage.start",
      artifactId: options.artifactId ?? null,
      parentArtifactId: options.parentArtifactId ?? null,
      inputSummary: options.inputSummary ?? null,
    });
    try {
      const result = await options.action();
      const outputSummary = options.outputSummary ? options.outputSummary(result) : null;
      await logger.writeStageLog({
        traceContext,
        stageName,
        event: "stage.end",
        artifactId: options.artifactId ?? null,
        parentArtifactId: options.parentArtifactId ?? null,
        outputSummary,
        durationMs: Date.now() - startedAt,
      });
      return result;
    } catch (error) {
      const snapshot = await logger.writeDebugSnapshot({
        traceContext,
        stageName,
        artifactId: options.artifactId ?? null,
        parentArtifactId: options.parentArtifactId ?? null,
        reason: error?.code ?? "image_generation_group_stage_failed",
        inputSummary: options.inputSummary ?? null,
        outputSummary: null,
        debugPayload: sanitizeDebugPayload(error),
      });
      await logger.writeStageLog({
        traceContext,
        stageName,
        event: "stage.fail",
        artifactId: options.artifactId ?? null,
        parentArtifactId: options.parentArtifactId ?? null,
        inputSummary: options.inputSummary ?? null,
        outputSummary: null,
        durationMs: Date.now() - startedAt,
        errorSummary: {
          ...safeError(error, stageName),
          debugSnapshotUri: snapshot.uri,
        },
      });
      throw error;
    }
  }

  async function markFailed(context, error) {
    const activeStage = context.activeStage ?? {
      stageName: context.job.stage ?? STAGES.providerRequested,
      artifactId: context.artifactId,
      parentArtifactId: context.parentArtifactId,
      inputSummary: null,
      outputSummary: null,
      startedAt: Date.now(),
    };
    const snapshot = await logger.writeDebugSnapshot({
      traceContext: context.traceContext,
      stageName: activeStage.stageName,
      artifactId: activeStage.artifactId,
      parentArtifactId: activeStage.parentArtifactId,
      reason: error?.code ?? "image_generation_failed",
      inputSummary: activeStage.inputSummary,
      outputSummary: activeStage.outputSummary,
      debugPayload: sanitizeDebugPayload(error),
    });
    const errorSummary = {
      ...safeError(error, activeStage.stageName),
      debugSnapshotUri: snapshot.uri,
    };
    await logger.writeStageLog({
      traceContext: context.traceContext,
      stageName: activeStage.stageName,
      event: "stage.fail",
      artifactId: activeStage.artifactId,
      parentArtifactId: activeStage.parentArtifactId,
      outputSummary: activeStage.outputSummary,
      durationMs: activeStage.startedAt ? Date.now() - activeStage.startedAt : null,
      errorSummary,
    });
    jobStore.updateJob(context.job.jobId, {
      stage: activeStage.stageName,
      status: SAMPLE_STATUS.failed,
      progress: 100,
      errorSummary,
    });
    context.activeStage = null;
  }

  return {
    enqueue,
    runImageGeneration,
  };
}

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
  createImageGenerationService,
};
