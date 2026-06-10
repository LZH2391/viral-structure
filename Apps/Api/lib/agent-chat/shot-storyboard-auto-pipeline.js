const path = require("path");
const { randomUUID } = require("crypto");
const { SAMPLE_STATUS } = require("../../../../Core/Workspace/sample-video-contracts");
const { createTraceIds, nextStage } = require("../../../../Infrastructure/Observability/trace");
const {
  assertFile,
  buildInputSummary,
  createPathHelpers,
  isRepairable,
  normalizeText,
  pipelineError,
} = require("./shot-storyboard-pipeline-utils");
const {
  MAX_REPAIR_ATTEMPTS,
  REPAIR_ROLE,
  createShotStoryboardRepairRunner,
} = require("./shot-storyboard-repair");
const { createShotStoryboardPipelineRuntime } = require("./shot-storyboard-pipeline-runtime");
const { createStoryboardConversationUpdater } = require("./shot-storyboard-pipeline-conversation");
const { createShotStoryboardStageRunners } = require("./shot-storyboard-pipeline-stages");
const { createStoryboardVersionBatchRunner } = require("./shot-storyboard-version-batch");

const AUTO_STAGE_NAME = "function.slot.shot_storyboard_prep.pipeline";

function createShotStoryboardAutoPipelineService({
  rootDir,
  store,
  logger,
  jobStore,
  moduleRegistry,
  threadPool = null,
  appServer = null,
  activeTurnRuntime = null,
  agentConversationStore = null,
  now = () => new Date().toISOString(),
} = {}) {
  if (!rootDir) throw new Error("rootDir is required for shot storyboard pipeline");
  if (!store) throw new Error("store is required for shot storyboard pipeline");
  if (!logger) throw new Error("logger is required for shot storyboard pipeline");
  if (!jobStore) throw new Error("jobStore is required for shot storyboard pipeline");
  if (!moduleRegistry) throw new Error("moduleRegistry is required for shot storyboard pipeline");
  const { resolveInsideRoot, resolveRuntimeUri, safeRelative } = createPathHelpers({ rootDir, store });
  const { markFailed, runLoggedStage, runPythonScript, waitForJob } = createShotStoryboardPipelineRuntime({
    rootDir,
    logger,
    jobStore,
    autoStageName: AUTO_STAGE_NAME,
  });
  const {
    runCropStage,
    runImageGenerationStage,
    runPdfAgentStage,
    runPrepareStage,
  } = createShotStoryboardStageRunners({
    rootDir,
    moduleRegistry,
    jobStore,
    runLoggedStage,
    runPythonScript,
    waitForJob,
    resolveRuntimeUri,
    resolveInsideRoot,
    safeRelative,
    threadPool,
    appServer,
    activeTurnRuntime,
    now,
  });
  const repairRunner = createShotStoryboardRepairRunner({
    rootDir,
    threadPool,
    appServer,
    resolveInputs,
    safeRelative,
  });
  const conversationUpdater = createStoryboardConversationUpdater({ agentConversationStore });
  const versionBatchRunner = createStoryboardVersionBatchRunner({
    autoStageName: AUTO_STAGE_NAME,
    jobStore,
    logger,
    startPipelineJob,
    conversationUpdater,
  });

  async function enqueue(options = {}) {
    await store.ensureRuntimeDirs?.();
    const run = startPipelineJob(options);
    return run.startResult;
  }

  function startPipelineJob(options = {}) {
    const sampleVideoId = normalizeText(options.sampleVideoId) || "function-slot-workflow";
    const traceContext = nextStage(createTraceIds());
    const artifactId = normalizeStoryboardArtifactId(options.artifactId) || `artifact_${randomUUID()}`;
    const parentArtifactId = normalizeText(options.parentArtifactId || options.restructureArtifactId) || null;
    const job = jobStore.createJob({ sampleVideoId, traceId: traceContext.traceId });
    job.options = { ...options, sampleVideoId, parentArtifactId };
    const completion = runPipelineWithRepair({
      options: job.options,
      job,
      traceContext,
      artifactId,
      parentArtifactId,
    }).then((artifact) => ({ ok: true, artifact })).catch(async (error) => {
      await markFailed({
        job,
        traceContext,
        artifactId,
        parentArtifactId,
        error,
        inputSummary: buildInputSummary(options),
      });
      await conversationUpdater.markFailed({ options: job.options, job, traceContext, artifactId, error });
      return { ok: false, error };
    });
    return {
      completion,
      job,
      traceContext,
      artifactId,
      parentArtifactId,
      startResult: {
      ok: true,
      processingJobId: job.jobId,
      sampleVideoId,
      traceId: traceContext.traceId,
      runId: traceContext.runId,
      stageId: traceContext.stageId,
      artifactId,
      parentArtifactId,
      confirmationId: normalizeText(options.confirmationId),
      status: "processing",
      role: REPAIR_ROLE,
      message: "Shot Storyboard Prep pipeline 已启动。",
      },
    };
  }

  async function runPipelineWithRepair(context) {
    let lastError = null;
    let shotDesignPath = null;
    for (let attempt = 0; attempt <= MAX_REPAIR_ATTEMPTS; attempt += 1) {
      try {
        return await runPipeline({ ...context, repairAttemptCount: attempt, shotDesignPathOverride: shotDesignPath });
      } catch (error) {
        lastError = error;
        if (!isRepairable(error) || attempt >= MAX_REPAIR_ATTEMPTS) break;
        const repairAttemptCount = attempt + 1;
        const repair = await repairRunner.runRepairTurn({ ...context, error, repairAttemptCount, shotDesignPathOverride: shotDesignPath });
        shotDesignPath = repair.repairedPath;
      }
    }
    if (lastError) {
      lastError.repairAttemptCount = Math.min(MAX_REPAIR_ATTEMPTS, Math.max(0, lastError.repairAttemptCount ?? MAX_REPAIR_ATTEMPTS));
      throw lastError;
    }
  }

  async function runPipeline({ options, job, traceContext, artifactId, parentArtifactId, repairAttemptCount = 0, shotDesignPathOverride = null }) {
    const stageStartedAt = Date.now();
    const inputSummary = buildInputSummary(options);
    jobStore.updateJob(job.jobId, {
      stage: AUTO_STAGE_NAME,
      status: SAMPLE_STATUS.processing,
      progress: 10,
      runId: traceContext.runId,
      stageId: traceContext.stageId,
      artifactId,
      parentArtifactId,
      moduleId: "shot-storyboard-prep",
    });
    await logger.writeStageLog({
      traceContext,
      stageName: AUTO_STAGE_NAME,
      event: "stage.start",
      artifactId,
      parentArtifactId,
      inputSummary,
    });

    const resolved = await resolveInputs(options, shotDesignPathOverride, artifactId);
    const prepare = await runPrepareStage({ resolved, traceContext, artifactId, parentArtifactId, repairAttemptCount, job });
    if (options.runImageGeneration === false) {
      return await finishProcessed({
        job,
        traceContext,
        artifactId,
        parentArtifactId,
        outputSummary: {
          status: "prompt_ready",
          ...prepare.outputSummary,
          repairAttemptCount,
        },
        stageStartedAt,
      });
    }

    const image = await runImageGenerationStage({ options, prepare, traceContext, artifactId, parentArtifactId, job });
    const crop = await runCropStage({ prepare, image, resolved, traceContext, artifactId, parentArtifactId, job });
    if (options.runPdfAgent === false) {
      return await finishProcessed({
        job,
        traceContext,
        artifactId,
        parentArtifactId,
        outputSummary: {
          status: "frames_ready",
          restructureFinalPath: safeRelative(resolved.restructureFinalPath),
          shotDesignFinalPath: safeRelative(resolved.shotDesignFinalPath),
          promptPath: safeRelative(prepare.promptPath),
          manifestPath: safeRelative(prepare.manifestPath),
          imageGenerationArtifactId: image.artifact?.artifactId ?? null,
          cropsManifestPath: safeRelative(crop.cropsManifestPath),
          repairAttemptCount,
        },
        stageStartedAt,
        pipelineArtifact: {
          artifactId,
          parentArtifactId,
          artifactType: "shot-storyboard-prep",
          type: "shot-storyboard-prep",
          stageName: AUTO_STAGE_NAME,
          sampleVideoId: options.sampleVideoId,
          runId: traceContext.runId,
          traceId: traceContext.traceId,
          stageId: traceContext.stageId,
          status: "processed",
          createdAt: now(),
          files: {
            restructureFinalPath: safeRelative(resolved.restructureFinalPath),
            shotDesignFinalPath: safeRelative(resolved.shotDesignFinalPath),
            promptPath: safeRelative(prepare.promptPath),
            manifestPath: safeRelative(prepare.manifestPath),
            cropsManifestPath: safeRelative(crop.cropsManifestPath),
          },
          imageGenerationArtifact: image.artifact ? {
            artifactId: image.artifact.artifactId,
            uri: image.artifact.uri,
            groupCount: image.artifact.storyboardGroups?.length ?? null,
          } : null,
          validation: {
            repairAttemptCount,
            warnings: crop.parsed?.warnings ?? [],
          },
          pdfTurn: null,
        },
      });
    }
    const pdf = await runPdfAgentStage({ resolved, prepare, crop, options, traceContext, artifactId, parentArtifactId, job });
    return await finishProcessed({
      job,
      traceContext,
      artifactId,
      parentArtifactId,
      outputSummary: {
        status: "processed",
        restructureFinalPath: safeRelative(resolved.restructureFinalPath),
        shotDesignFinalPath: safeRelative(resolved.shotDesignFinalPath),
        promptPath: safeRelative(prepare.promptPath),
        manifestPath: safeRelative(prepare.manifestPath),
        imageGenerationArtifactId: image.artifact?.artifactId ?? null,
        cropsManifestPath: safeRelative(crop.cropsManifestPath),
        pdfPath: safeRelative(pdf.pdfPath),
        summaryPath: safeRelative(pdf.summaryPath),
        layoutPath: safeRelative(pdf.layoutPath),
        warningCount: pdf.summary?.warnings?.length ?? 0,
        repairAttemptCount,
      },
      stageStartedAt,
      pipelineArtifact: {
        artifactId,
        parentArtifactId,
        artifactType: "shot-storyboard-prep",
        type: "shot-storyboard-prep",
        stageName: AUTO_STAGE_NAME,
        sampleVideoId: options.sampleVideoId,
        runId: traceContext.runId,
        traceId: traceContext.traceId,
        stageId: traceContext.stageId,
        status: "processed",
        createdAt: now(),
        files: {
          restructureFinalPath: safeRelative(resolved.restructureFinalPath),
          shotDesignFinalPath: safeRelative(resolved.shotDesignFinalPath),
          promptPath: safeRelative(prepare.promptPath),
          manifestPath: safeRelative(prepare.manifestPath),
          cropsManifestPath: safeRelative(crop.cropsManifestPath),
          pdfPath: safeRelative(pdf.pdfPath),
          summaryPath: safeRelative(pdf.summaryPath),
          layoutPath: safeRelative(pdf.layoutPath),
        },
        imageGenerationArtifact: image.artifact ? {
          artifactId: image.artifact.artifactId,
          uri: image.artifact.uri,
          groupCount: image.artifact.storyboardGroups?.length ?? null,
        } : null,
        validation: {
          repairAttemptCount,
          warnings: pdf.summary?.warnings ?? [],
        },
        pdfTurn: {
          agent: pdf.agent,
        },
      },
    });
  }

  async function resolveInputs(options, shotDesignPathOverride, artifactId) {
    const restructureFinalPath = resolveInsideRoot(options.restructureFinalPath);
    if (!restructureFinalPath) throw pipelineError("storyboard_prep_restructure_required", "需要 restructureFinalPath", { retryable: false });
    await assertFile(restructureFinalPath, "storyboard_prep_restructure_missing", false);
    const shotDesignFinalPath = shotDesignPathOverride
      ? resolveInsideRoot(shotDesignPathOverride)
      : resolveInsideRoot(options.shotDesignFinalPath) || path.join(path.dirname(restructureFinalPath), "shot-design.final.md");
    await assertFile(shotDesignFinalPath, "storyboard_prep_shot_design_missing", true);
    const safeArtifactId = normalizeStoryboardArtifactId(artifactId);
    if (!safeArtifactId) throw pipelineError("storyboard_prep_artifact_id_invalid", "artifactId 不合法", { retryable: false });
    const sourceBaseDir = path.dirname(shotDesignFinalPath);
    const outputBaseDir = path.join(sourceBaseDir, "storyboard-runs", safeArtifactId);
    return {
      restructureFinalPath,
      shotDesignFinalPath,
      sourceBaseDir,
      baseDir: outputBaseDir,
    };
  }

  async function finishProcessed({ job, traceContext, artifactId, parentArtifactId, outputSummary, stageStartedAt, pipelineArtifact = null }) {
    let artifactWithUri = null;
    if (pipelineArtifact) {
      const artifactDir = path.join(store.sampleDir(pipelineArtifact.sampleVideoId || "function-slot-workflow"), "shot-storyboard-prep", artifactId);
      const artifactPath = path.join(artifactDir, "artifact.json");
      await store.writeJson(artifactPath, pipelineArtifact);
      artifactWithUri = { ...pipelineArtifact, uri: store.runtimeUri(artifactPath) };
    }
    await logger.writeStageLog({
      traceContext,
      stageName: AUTO_STAGE_NAME,
      event: "stage.end",
      artifactId,
      parentArtifactId,
      outputSummary,
      durationMs: Date.now() - stageStartedAt,
    });
    jobStore.updateJob(job.jobId, {
      stage: AUTO_STAGE_NAME,
      status: SAMPLE_STATUS.processed,
      progress: 100,
      artifactId,
      parentArtifactId,
      storyboardPrepArtifact: artifactWithUri,
      outputSummary,
    });
    await conversationUpdater.markProcessed({ options: job.options ?? {}, job, traceContext, artifactId });
    return artifactWithUri;
  }

  async function enqueueVersionBatch(options = {}) {
    await store.ensureRuntimeDirs?.();
    const sampleVideoId = normalizeText(options.sampleVideoId) || "function-slot-workflow";
    const traceContext = nextStage(createTraceIds());
    const artifactId = normalizeStoryboardArtifactId(options.artifactId) || `artifact_${randomUUID()}`;
    const parentArtifactId = normalizeText(options.parentArtifactId || options.restructureArtifactId) || null;
    const versions = Array.isArray(options.versions) ? options.versions.filter((item) => normalizeText(item?.versionId)) : [];
    const defaultVersionId = normalizeText(options.defaultVersionId) || versions[0]?.versionId || null;
    const job = jobStore.createJob({ sampleVideoId, traceId: traceContext.traceId });
    job.options = { ...options, sampleVideoId, parentArtifactId, artifactId, defaultVersionId, versions };
    jobStore.updateJob(job.jobId, {
      stage: `${AUTO_STAGE_NAME}.multi_version`,
      status: SAMPLE_STATUS.processing,
      progress: 5,
      runId: traceContext.runId,
      stageId: traceContext.stageId,
      artifactId,
      parentArtifactId,
      moduleId: "shot-storyboard-prep",
      outputSummary: {
        mode: "multi_version",
        versionCount: versions.length,
        defaultVersionId,
      },
    });
    await logger.writeStageLog({
      traceContext,
      stageName: `${AUTO_STAGE_NAME}.multi_version`,
      event: "stage.start",
      artifactId,
      parentArtifactId,
      inputSummary: {
        mode: "multi_version",
        versionCount: versions.length,
        defaultVersionId,
      },
    });
    versionBatchRunner.runVersionBatch({ options: job.options, job, traceContext, artifactId, parentArtifactId }).catch(async (error) => {
      await markFailed({
        job,
        traceContext,
        artifactId,
        parentArtifactId,
        error,
        inputSummary: { mode: "multi_version", versionCount: versions.length, defaultVersionId },
      });
    });
    const versionResults = versions.map((version) => ({
      versionId: version.versionId,
      versionName: version.versionName || version.versionId,
      sourceRestructurePath: version.restructureFinalPath,
      sourceShotDesignPath: version.shotDesignFinalPath,
      status: "queued",
      storyboardArtifact: null,
    }));
    return {
      ok: true,
      mode: "multi_version",
      processingJobId: job.jobId,
      sampleVideoId,
      traceId: traceContext.traceId,
      runId: traceContext.runId,
      stageId: traceContext.stageId,
      artifactId,
      parentArtifactId,
      confirmationId: normalizeText(options.confirmationId),
      status: "processing",
      role: REPAIR_ROLE,
      message: "多版本 Shot Storyboard Prep pipeline 已启动。",
      defaultVersionId,
      versions: versionResults,
    };
  }

  return { enqueue, enqueueVersionBatch };
}

function normalizeStoryboardArtifactId(value) {
  const text = normalizeText(value);
  return /^artifact_[A-Za-z0-9_.-]+$/.test(text) ? text : null;
}

module.exports = {
  AUTO_STAGE_NAME,
  MAX_REPAIR_ATTEMPTS,
  createShotStoryboardAutoPipelineService,
};
