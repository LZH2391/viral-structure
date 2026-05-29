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
      },
      action: () => activeExecutorRegistry.execute("external-api", {
        providerName: activeProvider.providerName ?? "pptoken",
        provider: activeProvider,
        request: {
          prompt: prepared.prompt,
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

    const groupResults = [];
    for (let index = 0; index < storyboard.groups.length; index += 1) {
      const group = storyboard.groups[index];
      const providerResult = await runStage(context, STAGES.providerRequested, 35 + Math.min(35, index * 5), {
        artifactId: context.artifactId,
        parentArtifactId: context.parentArtifactId,
        inputSummary: {
          provider: activeProvider.providerName ?? "pptoken",
          mode: "storyboard-group",
          groupId: group.groupId,
          promptChars: group.prompt.length,
          shotCount: group.shots.length,
        },
        action: () => activeExecutorRegistry.execute("external-api", {
          providerName: activeProvider.providerName ?? "pptoken",
          provider: activeProvider,
          request: {
            prompt: group.prompt,
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
          imageCount: execution.result?.meta?.imageCount ?? null,
          responseBytes: execution.result?.meta?.responseBytes ?? null,
          durationMs: execution.result?.meta?.durationMs ?? null,
          model: execution.result?.meta?.model ?? null,
        }),
      });
      const images = await runStage(context, STAGES.assetWritten, 70 + Math.min(20, index * 3), {
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
      groupResults.push({ group, providerResult, images });
    }

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
    images: images.map((image) => ({
      index: image.index,
      uri: image.uri,
      bytes: image.bytes,
      sourceUrl: image.sourceUrl,
    })),
  };
}

function buildStoryboardArtifact({ context, options, storyboard, groupResults, images }) {
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
    storyboardGroups: groupResults.map(({ group, providerResult, images: groupImages }) => ({
      groupId: group.groupId,
      title: group.title,
      shots: group.shots,
      promptChars: group.prompt.length,
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

module.exports = {
  createImageGenerationService,
};
