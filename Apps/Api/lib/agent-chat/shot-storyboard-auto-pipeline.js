const path = require("path");
const fs = require("fs/promises");
const { randomUUID } = require("crypto");
const { SAMPLE_STATUS } = require("../../../../Core/Workspace/sample-video-contracts");
const { createTraceIds, nextStage } = require("../../../../Infrastructure/Observability/trace");
const {
  assertFile,
  buildInputSummary,
  createPathHelpers,
  isRepairable,
  normalizeText,
  parseJsonStdout,
  pipelineError,
  readJson,
  safePreview,
  validateCropResult,
  validateImageArtifact,
  validatePrepareResult,
} = require("./shot-storyboard-pipeline-utils");
const {
  MAX_REPAIR_ATTEMPTS,
  REPAIR_ROLE,
  createShotStoryboardRepairRunner,
} = require("./shot-storyboard-repair");
const {
  PDF_STAGE_NAME,
  buildPdfAgentInputPackage,
  runShotStoryboardPdfTurn,
  validatePdfAgentOutputs,
} = require("./shot-storyboard-pdf-agent");
const { createShotStoryboardPipelineRuntime } = require("./shot-storyboard-pipeline-runtime");

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
  const repairRunner = createShotStoryboardRepairRunner({
    rootDir,
    threadPool,
    appServer,
    resolveInputs,
    safeRelative,
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
      await markConversationStoryboardFailed({ options: job.options, job, traceContext, artifactId, error });
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

  async function runPrepareStage({ resolved, traceContext, artifactId, parentArtifactId, repairAttemptCount, job }) {
    const stageTrace = nextStage(traceContext);
    await fs.mkdir(resolved.baseDir, { recursive: true });
    const promptPath = path.join(resolved.baseDir, "shot-storyboard-prompts.md");
    const manifestPath = path.join(resolved.baseDir, "shot-storyboard-manifest.json");
    jobStore.updateJob(job.jobId, { stage: "function.slot.shot_storyboard_prep.prepare", progress: 25 });
    const result = await runLoggedStage({
      stageName: "function.slot.shot_storyboard_prep.prepare",
      traceContext: stageTrace,
      artifactId,
      parentArtifactId,
      inputSummary: {
        shotDesignFinalPath: safeRelative(resolved.shotDesignFinalPath),
        promptPath: safeRelative(promptPath),
        manifestPath: safeRelative(manifestPath),
        repairAttemptCount,
      },
      action: async () => {
        const output = await runPythonScript("prepare_storyboard.py", [
          "--input", resolved.shotDesignFinalPath,
          "--output", promptPath,
          "--manifest-output", manifestPath,
        ]);
        const parsed = parseJsonStdout(output.stdout, "storyboard_prep_prepare_output_invalid", true);
        const manifest = await readJson(manifestPath);
        validatePrepareResult(parsed, manifest);
        return { parsed, manifest };
      },
      outputSummary: ({ parsed, manifest }) => ({
        shotCount: parsed.shotCount,
        generatedShotCount: parsed.generatedShotCount,
        materialShotCount: parsed.materialShotCount,
        groupCount: parsed.groupCount,
        warnings: manifest.warnings ?? [],
      }),
    });
    return {
      promptPath,
      manifestPath,
      manifest: result.manifest,
      outputSummary: {
        shotCount: result.parsed.shotCount,
        generatedShotCount: result.parsed.generatedShotCount,
        materialShotCount: result.parsed.materialShotCount,
        groupCount: result.parsed.groupCount,
      },
    };
  }

  async function runImageGenerationStage({ options, prepare, traceContext, artifactId, parentArtifactId, job }) {
    const stageTrace = nextStage(traceContext);
    jobStore.updateJob(job.jobId, { stage: "function.slot.shot_storyboard_prep.image_generation", progress: 45 });
    return runLoggedStage({
      stageName: "function.slot.shot_storyboard_prep.image_generation",
      traceContext: stageTrace,
      artifactId,
      parentArtifactId,
      inputSummary: {
        storyboardPromptFile: safeRelative(prepare.promptPath),
        groupCount: prepare.manifest.storyboardGroups?.length ?? null,
      },
      action: async () => {
        const started = await moduleRegistry.startModule({
          moduleId: "image-generation",
          sampleVideoId: options.sampleVideoId,
          body: {
            storyboardPromptFile: prepare.promptPath,
            parentArtifactId: artifactId,
            timeoutSeconds: options.timeoutSeconds ?? 450,
            storyboardConcurrency: options.storyboardConcurrency ?? 10,
            storyboardRetryAttempts: options.storyboardRetryAttempts ?? 2,
          },
        });
        const imageJob = await waitForJob(started.processingJobId, options.imageGenerationWaitMs ?? 30 * 60 * 1000);
        if (imageJob.status !== SAMPLE_STATUS.processed || !imageJob.imageGenerationArtifact) {
          throw pipelineError("storyboard_prep_image_generation_failed", "生图未产出有效 artifact", { retryable: true, debugPayload: { imageJobStatus: imageJob.status, errorSummary: imageJob.errorSummary ?? null } });
        }
        validateImageArtifact(imageJob.imageGenerationArtifact, prepare.manifest);
        const artifactPath = resolveRuntimeUri(imageJob.imageGenerationArtifact.uri);
        return {
          started,
          job: imageJob,
          artifact: imageJob.imageGenerationArtifact,
          artifactPath,
        };
      },
      outputSummary: ({ artifact }) => ({
        imageGenerationArtifactId: artifact.artifactId,
        groupCount: artifact.storyboardGroups?.length ?? null,
        imageCount: artifact.images?.length ?? null,
        uri: artifact.uri ?? null,
      }),
    });
  }

  async function runCropStage({ prepare, image, resolved, traceContext, artifactId, parentArtifactId, job }) {
    const stageTrace = nextStage(traceContext);
    const outputDir = path.join(resolved.baseDir, "shot-storyboard-frames");
    await fs.mkdir(outputDir, { recursive: true });
    jobStore.updateJob(job.jobId, { stage: "function.slot.shot_storyboard_prep.crop", progress: 70 });
    return runLoggedStage({
      stageName: "function.slot.shot_storyboard_prep.crop",
      traceContext: stageTrace,
      artifactId,
      parentArtifactId,
      inputSummary: {
        artifactPath: safeRelative(image.artifactPath),
        manifestPath: safeRelative(prepare.manifestPath),
        outputDir: safeRelative(outputDir),
      },
      action: async () => {
        const output = await runPythonScript("crop_storyboard_groups.py", [
          "--artifact", image.artifactPath,
          "--manifest", prepare.manifestPath,
          "--output-dir", outputDir,
          "--root", rootDir,
        ]);
        const parsed = parseJsonStdout(output.stdout, "storyboard_prep_crop_output_invalid", true);
        validateCropResult(parsed, prepare.manifest);
        return {
          parsed,
          cropsManifestPath: path.join(outputDir, "shot-storyboard-crops.json"),
        };
      },
      outputSummary: ({ parsed }) => ({
        croppedCount: parsed.croppedCount,
        warningCount: parsed.warnings?.length ?? 0,
      }),
    });
  }

  async function runPdfAgentStage({ resolved, prepare, crop, options, traceContext, artifactId, parentArtifactId, job }) {
    const stageTrace = nextStage(traceContext);
    const materialFrameMaps = collectMaterialFrameMaps(options, resolved.baseDir, resolved.sourceBaseDir);
    jobStore.updateJob(job.jobId, { stage: PDF_STAGE_NAME, progress: 88 });
    return runLoggedStage({
      stageName: PDF_STAGE_NAME,
      traceContext: stageTrace,
      artifactId,
      parentArtifactId,
      inputSummary: {
        restructureFinalPath: safeRelative(resolved.restructureFinalPath),
        shotDesignFinalPath: safeRelative(resolved.shotDesignFinalPath),
        cropsManifestPath: safeRelative(crop.cropsManifestPath),
        materialFrameMapCount: materialFrameMaps.length,
      },
      action: async () => {
        let retryContext = null;
        const maxRetries = 1;
        for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
          try {
            const inputPackage = await buildPdfAgentInputPackage({
              rootDir,
              resolved,
              prepare,
              crop,
              options,
              traceContext: stageTrace,
              artifactId,
              parentArtifactId,
              materialFrameMaps,
              resolveInsideRoot,
              safeRelative,
              now,
              retryContext,
            });
            const turn = await runShotStoryboardPdfTurn({
              rootDir,
              threadPool,
              appServer,
              activeTurnRuntime,
              jobStore,
              jobId: job.jobId,
              traceContext: stageTrace,
              artifactId,
              parentArtifactId,
              inputPackagePath: inputPackage.inputPackagePath,
              pdfPath: inputPackage.pdfPath,
              summaryPath: inputPackage.summaryPath,
              layoutPath: inputPackage.layoutPath,
              safeRelative,
              retryContext,
            });
            const validated = await validatePdfAgentOutputs({
              manifest: prepare.manifest,
              pdfPath: inputPackage.pdfPath,
              summaryPath: inputPackage.summaryPath,
              layoutPath: inputPackage.layoutPath,
              expectedWarnings: inputPackage.inputPackage.expectedWarnings,
            });
            return {
              ...validated,
              agent: turn.agent,
            };
          } catch (error) {
            if (attempt >= maxRetries) throw error;
            retryContext = {
              attempt: attempt + 1,
              safeErrorSummary: {
                code: error?.code ?? "storyboard_prep_pdf_agent_failed",
                message: normalizeText(error?.message) ?? "PDF agent 失败",
              },
              validationFailures: Array.isArray(error?.validationErrors) ? error.validationErrors : [],
            };
            jobStore.updateJob(job.jobId, {
              stage: PDF_STAGE_NAME,
              status: SAMPLE_STATUS.processing,
              progress: 88,
              errorSummary: null,
            });
          }
        }
      },
      outputSummary: ({ pdfPath, summaryPath, layoutPath, summary, agent }) => ({
        pdfPath: safeRelative(pdfPath),
        summaryPath: safeRelative(summaryPath),
        layoutPath: safeRelative(layoutPath),
        slotCount: summary.slotCount ?? null,
        shotCount: summary.shotCount ?? null,
        warningCount: summary.warnings?.length ?? 0,
        turnId: agent?.turnId ?? null,
      }),
    });
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
    await markConversationStoryboardProcessed({ options: job.options ?? {}, job, traceContext, artifactId });
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
    runVersionBatch({ options: job.options, job, traceContext, artifactId, parentArtifactId }).catch(async (error) => {
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

  async function markConversationStoryboardProcessed({ options, job, traceContext, artifactId }) {
    const conversationId = normalizeText(options.conversationId);
    if (!conversationId || !agentConversationStore?.confirmPlan) return;
    const current = await agentConversationStore.get?.(conversationId).catch(() => null);
    const optionConfirmationId = normalizeText(options.confirmationId);
    const optionTurnId = normalizeText(options.restructureArtifactId);
    if (!isCurrentStoryboardConfirmation(current, { confirmationId: optionConfirmationId, turnId: optionTurnId })) {
      await updateStoryboardResultMessage({
        conversationId,
        confirmationId: optionConfirmationId,
        storyboardArtifact: {
          artifactId,
          processingJobId: job.jobId,
          traceId: traceContext.traceId,
          runId: traceContext.runId,
          stageId: traceContext.stageId,
          status: "processed",
        },
        status: "completed",
        traceContext,
      });
      return;
    }
    await agentConversationStore.confirmPlan({
      conversationId,
      turnId: current?.confirmedPlan?.turnId ?? normalizeText(options.restructureArtifactId),
      confirmationId: optionConfirmationId ?? current?.confirmedPlan?.confirmationId ?? null,
      sourceRestructurePath: normalizeText(options.restructureFinalPath) ?? current?.confirmedPlan?.sourceRestructurePath ?? null,
      sourceShotDesignPath: normalizeText(options.shotDesignFinalPath) ?? current?.confirmedPlan?.sourceShotDesignPath ?? null,
      note: "Shot Storyboard Prep 流水线已完成。",
      storyboardArtifact: {
        artifactId,
        processingJobId: job.jobId,
        traceId: traceContext.traceId,
        runId: traceContext.runId,
        stageId: traceContext.stageId,
        status: "processed",
      },
      status: "completed",
      traceId: traceContext.traceId,
      runId: traceContext.runId,
      stageId: traceContext.stageId,
    }).catch(() => null);
    await updateStoryboardResultMessage({
      conversationId,
      confirmationId: optionConfirmationId,
      storyboardArtifact: {
        artifactId,
        processingJobId: job.jobId,
        traceId: traceContext.traceId,
        runId: traceContext.runId,
        stageId: traceContext.stageId,
        status: "processed",
      },
      status: "completed",
      traceContext,
    });
  }

  async function markConversationStoryboardFailed({ options, job, traceContext, artifactId, error }) {
    const conversationId = normalizeText(options.conversationId);
    if (!conversationId || !agentConversationStore?.confirmPlan) return;
    const current = await agentConversationStore.get?.(conversationId).catch(() => null);
    if (!current?.confirmedPlan) return;
    const optionConfirmationId = normalizeText(options.confirmationId);
    const optionTurnId = normalizeText(options.restructureArtifactId);
    if (!isCurrentStoryboardConfirmation(current, { confirmationId: optionConfirmationId, turnId: optionTurnId })) {
      await updateStoryboardResultMessage({
        conversationId,
        confirmationId: optionConfirmationId,
        storyboardArtifact: {
          artifactId,
          processingJobId: job?.jobId ?? null,
          traceId: traceContext.traceId,
          runId: traceContext.runId,
          stageId: traceContext.stageId,
          status: "failed",
        },
        status: "storyboard_failed",
        traceContext,
      });
      return;
    }
    await agentConversationStore.confirmPlan({
      conversationId,
      turnId: current.confirmedPlan.turnId ?? normalizeText(options.restructureArtifactId),
      confirmationId: optionConfirmationId ?? current.confirmedPlan.confirmationId ?? null,
      sourceRestructurePath: normalizeText(options.restructureFinalPath) ?? current.confirmedPlan.sourceRestructurePath ?? null,
      sourceShotDesignPath: normalizeText(options.shotDesignFinalPath) ?? current.confirmedPlan.sourceShotDesignPath ?? null,
      note: `Shot Storyboard Prep 流水线失败：${safePreview(error?.message ?? "未知错误", 160)}`,
      storyboardArtifact: {
        artifactId,
        processingJobId: job?.jobId ?? null,
        traceId: traceContext.traceId,
        runId: traceContext.runId,
        stageId: traceContext.stageId,
        status: "failed",
      },
      status: "storyboard_failed",
      traceId: traceContext.traceId,
      runId: traceContext.runId,
      stageId: traceContext.stageId,
    }).catch(() => null);
    await updateStoryboardResultMessage({
      conversationId,
      confirmationId: optionConfirmationId,
      storyboardArtifact: {
        artifactId,
        processingJobId: job?.jobId ?? null,
        traceId: traceContext.traceId,
        runId: traceContext.runId,
        stageId: traceContext.stageId,
        status: "failed",
      },
      status: "storyboard_failed",
      traceContext,
    });
  }

  async function updateStoryboardResultMessage({ conversationId, confirmationId, storyboardArtifact, status, traceContext }) {
    if (!agentConversationStore?.updateStoryboardResultMessage) return;
    await agentConversationStore.updateStoryboardResultMessage({
      conversationId,
      confirmationId,
      storyboardArtifact,
      status,
      traceId: traceContext.traceId,
      runId: traceContext.runId,
      stageId: traceContext.stageId,
    }).catch(() => null);
  }

  async function runVersionBatch({ options, job, traceContext, artifactId, parentArtifactId }) {
    const startedAt = Date.now();
    const versions = Array.isArray(options.versions) ? options.versions : [];
    const concurrency = Math.max(1, Math.min(2, Number(options.versionConcurrency) || 2));
    const results = [];
    let cursor = 0;
    async function worker() {
      while (cursor < versions.length) {
        const index = cursor;
        cursor += 1;
        const version = versions[index];
        const childRun = startPipelineJob({
          ...options,
          mode: "single",
          versionId: version.versionId,
          versionName: version.versionName,
          restructureFinalPath: version.restructureFinalPath,
          shotDesignFinalPath: version.shotDesignFinalPath,
          parentArtifactId: artifactId,
          restructureArtifactId: artifactId,
          confirmationId: `${normalizeText(options.confirmationId) || "confirm"}:${version.versionId}`,
        });
        const child = childRun.startResult;
        results[index] = {
          versionId: version.versionId,
          versionName: version.versionName || version.versionId,
          sourceRestructurePath: version.restructureFinalPath,
          sourceShotDesignPath: version.shotDesignFinalPath,
          status: child.status ?? (child.ok === false ? "failed" : "processing"),
          storyboardArtifact: child.ok === false ? null : {
            artifactId: child.artifactId ?? null,
            processingJobId: child.processingJobId ?? null,
            traceId: child.traceId ?? null,
            runId: child.runId ?? null,
            stageId: child.stageId ?? null,
            status: child.status ?? null,
          },
          error: child.ok === false ? child.error ?? null : null,
          message: child.ok === false ? child.message ?? null : null,
        };
        updateVersionBatchJob({ job, versions, results, artifactId, parentArtifactId });
        const completed = await childRun.completion;
        if (!completed.ok) {
          results[index] = {
            ...results[index],
            status: "failed",
            storyboardArtifact: {
              ...results[index].storyboardArtifact,
              status: "failed",
            },
            error: completed.error?.code ?? "storyboard_prep_version_failed",
            message: safePreview(completed.error?.message ?? "版本故事板任务失败", 200),
          };
        } else {
          results[index] = {
            ...results[index],
            status: "completed",
            storyboardArtifact: {
              ...results[index].storyboardArtifact,
              status: "processed",
            },
          };
        }
        updateVersionBatchJob({ job, versions, results, artifactId, parentArtifactId });
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, versions.length) }, () => worker()));
    const failedCount = results.filter((item) => item?.status === "failed").length;
    const status = failedCount === versions.length ? SAMPLE_STATUS.failed : SAMPLE_STATUS.processed;
    const outputSummary = {
      mode: "multi_version",
      status: failedCount ? "partial_failed" : "processing",
      versionCount: versions.length,
      failedCount,
      defaultVersionId: options.defaultVersionId ?? versions[0]?.versionId ?? null,
      versions: results,
    };
    await logger.writeStageLog({
      traceContext,
      stageName: `${AUTO_STAGE_NAME}.multi_version`,
      event: failedCount === versions.length ? "stage.fail" : "stage.end",
      artifactId,
      parentArtifactId,
      outputSummary,
      durationMs: Date.now() - startedAt,
    });
    jobStore.updateJob(job.jobId, {
      stage: `${AUTO_STAGE_NAME}.multi_version`,
      status,
      progress: 100,
      artifactId,
      parentArtifactId,
      outputSummary,
    });
    await markConversationStoryboardBatchStarted({ options, job, traceContext, artifactId, versionResults: results });
  }

  function updateVersionBatchJob({ job, versions, results, artifactId, parentArtifactId }) {
    const completed = results.filter(Boolean).length;
    jobStore.updateJob(job.jobId, {
      stage: `${AUTO_STAGE_NAME}.multi_version`,
      status: SAMPLE_STATUS.processing,
      progress: Math.max(5, Math.min(95, Math.round((completed / Math.max(versions.length, 1)) * 90))),
      artifactId,
      parentArtifactId,
      outputSummary: {
        mode: "multi_version",
        versionCount: versions.length,
        completedEnqueueCount: completed,
        versions: results.filter(Boolean),
      },
    });
  }

  async function markConversationStoryboardBatchStarted({ options, job, traceContext, artifactId, versionResults }) {
    const conversationId = normalizeText(options.conversationId);
    if (!conversationId || !agentConversationStore?.confirmPlan) return;
    const defaultVersion = versionResults.find((item) => item.versionId === options.defaultVersionId) ?? versionResults[0] ?? null;
    const storyboardArtifact = {
      artifactId,
      processingJobId: job.jobId,
      traceId: traceContext.traceId,
      runId: traceContext.runId,
      stageId: traceContext.stageId,
      status: "processing",
    };
    await agentConversationStore.confirmPlan({
      conversationId,
      turnId: normalizeText(options.restructureArtifactId) ?? null,
      confirmationId: normalizeText(options.confirmationId),
      sourceRestructurePath: defaultVersion?.sourceRestructurePath ?? normalizeText(options.restructureFinalPath) ?? null,
      sourceShotDesignPath: defaultVersion?.sourceShotDesignPath ?? normalizeText(options.shotDesignFinalPath) ?? null,
      note: "多版本 Shot Storyboard Prep 流水线已启动。",
      storyboardArtifact,
      storyboardMode: "multi_version",
      defaultVersionId: options.defaultVersionId ?? defaultVersion?.versionId ?? null,
      storyboardVersions: versionResults,
      status: "storyboard_processing",
      traceId: traceContext.traceId,
      runId: traceContext.runId,
      stageId: traceContext.stageId,
    }).catch(() => null);
    await agentConversationStore.updateStoryboardResultMessage?.({
      conversationId,
      confirmationId: normalizeText(options.confirmationId),
      storyboardArtifact,
      versions: versionResults,
      status: versionResults.some((item) => item.status === "failed") ? "storyboard_failed" : "completed",
      traceId: traceContext.traceId,
      runId: traceContext.runId,
      stageId: traceContext.stageId,
    }).catch(() => null);
  }

  return { enqueue, enqueueVersionBatch };
}

function collectMaterialFrameMaps(options, baseDir, sourceBaseDir = baseDir) {
  const explicit = Array.isArray(options.materialFrameMaps) ? options.materialFrameMaps : [];
  const requiredCandidates = [
    ...explicit,
    options.materialFrameMap,
    options.visualManifest,
    options.frameMap,
    options.userMaterialPackPath,
  ].map(normalizeText).filter(Boolean).map((path) => ({ path, required: true }));
  const optionalCandidates = [
    path.join(baseDir, "material-frame-map.json"),
    path.join(baseDir, "visual-manifest.json"),
    path.join(baseDir, "user-material-pack.stable.json"),
    path.join(baseDir, "user-material-pack.stable"),
    path.join(sourceBaseDir, "material-frame-map.json"),
    path.join(sourceBaseDir, "visual-manifest.json"),
    path.join(sourceBaseDir, "user-material-pack.stable.json"),
    path.join(sourceBaseDir, "user-material-pack.stable"),
  ].map((path) => ({ path, required: false }));
  return [...requiredCandidates, ...optionalCandidates];
}

function normalizeStoryboardArtifactId(value) {
  const text = normalizeText(value);
  return /^artifact_[A-Za-z0-9_.-]+$/.test(text) ? text : null;
}

function isCurrentStoryboardConfirmation(conversation, { confirmationId, turnId }) {
  const confirmed = conversation?.confirmedPlan;
  if (!confirmed) return false;
  const expectedConfirmationId = normalizeText(confirmationId);
  const expectedTurnId = normalizeText(turnId);
  return Boolean(
    expectedConfirmationId
    && expectedTurnId
    && normalizeText(confirmed.confirmationId) === expectedConfirmationId
    && normalizeText(confirmed.turnId) === expectedTurnId
  );
}

module.exports = {
  AUTO_STAGE_NAME,
  MAX_REPAIR_ATTEMPTS,
  createShotStoryboardAutoPipelineService,
};
