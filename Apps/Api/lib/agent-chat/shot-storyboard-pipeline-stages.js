const path = require("path");
const fs = require("fs/promises");
const { SAMPLE_STATUS } = require("../../../../Core/Workspace/sample-video-contracts");
const { nextStage } = require("../../../../Infrastructure/Observability/trace");
const {
  normalizeText,
  parseJsonStdout,
  pipelineError,
  readJson,
  validateCropResult,
  validateImageArtifact,
  validatePrepareResult,
} = require("./shot-storyboard-pipeline-utils");
const {
  PDF_STAGE_NAME,
  buildPdfAgentInputPackage,
  runShotStoryboardPdfTurn,
  validatePdfAgentOutputs,
} = require("./shot-storyboard-pdf-agent");

function createShotStoryboardStageRunners({
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
}) {
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

  return {
    runCropStage,
    runImageGenerationStage,
    runPdfAgentStage,
    runPrepareStage,
  };
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

module.exports = {
  createShotStoryboardStageRunners,
};
