const path = require("path");
const { spawn } = require("child_process");
const { SAMPLE_STATUS } = require("../../../../Core/Workspace/sample-video-contracts");
const { pipelineError, safeError, safePreview, sleep } = require("./shot-storyboard-pipeline-utils");

function createShotStoryboardPipelineRuntime({ rootDir, logger, jobStore, autoStageName }) {
  async function runLoggedStage({ stageName, traceContext, artifactId, parentArtifactId, inputSummary, action, outputSummary }) {
    const startedAt = Date.now();
    await logger.writeStageLog({ traceContext, stageName, event: "stage.start", artifactId, parentArtifactId, inputSummary });
    try {
      const result = await action();
      await logger.writeStageLog({
        traceContext,
        stageName,
        event: "stage.end",
        artifactId,
        parentArtifactId,
        outputSummary: typeof outputSummary === "function" ? outputSummary(result) : outputSummary,
        durationMs: Date.now() - startedAt,
      });
      return result;
    } catch (error) {
      const safe = safeError(error, stageName);
      const snapshot = await logger.writeDebugSnapshot({
        traceContext,
        stageName,
        artifactId,
        parentArtifactId,
        reason: safe.code,
        inputSummary,
        outputSummary: null,
        debugPayload: error.debugPayload ?? { code: safe.code, message: safe.message },
      }).catch(() => null);
      await logger.writeStageLog({
        traceContext,
        stageName,
        event: "stage.fail",
        artifactId,
        parentArtifactId,
        errorSummary: { ...safe, debugSnapshotUri: snapshot?.uri ?? null },
        durationMs: Date.now() - startedAt,
      }).catch(() => undefined);
      throw error;
    }
  }

  async function markFailed({ job, traceContext, artifactId, parentArtifactId, error, inputSummary }) {
    const safe = safeError(error, autoStageName);
    const snapshot = await logger.writeDebugSnapshot({
      traceContext,
      stageName: autoStageName,
      artifactId,
      parentArtifactId,
      reason: safe.code,
      inputSummary,
      outputSummary: null,
      debugPayload: error.debugPayload ?? { code: safe.code, message: safe.message },
    }).catch(() => null);
    const finalError = { ...safe, debugSnapshotUri: snapshot?.uri ?? null };
    await logger.writeStageLog({
      traceContext,
      stageName: autoStageName,
      event: "stage.fail",
      artifactId,
      parentArtifactId,
      errorSummary: finalError,
    }).catch(() => undefined);
    jobStore.updateJob(job.jobId, {
      stage: autoStageName,
      status: SAMPLE_STATUS.failed,
      progress: 100,
      artifactId,
      parentArtifactId,
      errorSummary: finalError,
    });
  }

  async function runPythonScript(scriptName, args) {
    const scriptPath = path.join(rootDir, ".agents", "skills", "shot-storyboard-prep", "scripts", scriptName);
    return new Promise((resolve, reject) => {
      const child = spawn(process.env.PYTHON || "python", [scriptPath, ...args], {
        cwd: rootDir,
        windowsHide: true,
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
      child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
      child.on("error", (error) => reject(error));
      child.on("close", (code) => {
        if (code === 0) {
          resolve({ stdout, stderr });
          return;
        }
        reject(pipelineError(`storyboard_prep_${scriptName.replace(/\.py$/, "")}_failed`, `${scriptName} failed`, {
          retryable: scriptName === "prepare_storyboard.py",
          debugPayload: { code, stdout: safePreview(stdout, 800), stderr: safePreview(stderr, 800) },
        }));
      });
    });
  }

  async function waitForJob(jobId, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      const job = jobStore.getJob(jobId);
      if (job && [SAMPLE_STATUS.processed, SAMPLE_STATUS.failed].includes(job.status)) return job;
      await sleep(250);
    }
    throw pipelineError("storyboard_prep_image_generation_timeout", "等待生图完成超时", {
      retryable: true,
      debugPayload: { jobId, timeoutMs },
    });
  }

  return { markFailed, runLoggedStage, runPythonScript, waitForJob };
}

module.exports = {
  createShotStoryboardPipelineRuntime,
};
