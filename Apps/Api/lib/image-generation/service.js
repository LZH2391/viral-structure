const { randomUUID } = require("crypto");
const { SAMPLE_STATUS } = require("../../../../Core/Workspace/sample-video-contracts");
const { createExecutorRegistry } = require("../executors/registry");
const { buildImagePrompt } = require("./prompt-builder");
const { createPPAPIProvider } = require("./ppapi-provider");
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

module.exports = {
  createImageGenerationService,
};
