const { SAMPLE_STATUS } = require("../../../../Core/Workspace/sample-video-contracts");
const {
  normalizeText,
  safePreview,
} = require("./shot-storyboard-pipeline-utils");

function createStoryboardVersionBatchRunner({
  autoStageName,
  jobStore,
  logger,
  startPipelineJob,
  conversationUpdater,
}) {
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
        results[index] = buildQueuedVersionResult(version, child);
        updateVersionBatchJob({ job, versions, results, artifactId, parentArtifactId });
        const completed = await childRun.completion;
        results[index] = completed.ok
          ? {
            ...results[index],
            status: "completed",
            storyboardArtifact: {
              ...results[index].storyboardArtifact,
              status: "processed",
            },
          }
          : {
            ...results[index],
            status: "failed",
            storyboardArtifact: {
              ...results[index].storyboardArtifact,
              status: "failed",
            },
            error: completed.error?.code ?? "storyboard_prep_version_failed",
            message: safePreview(completed.error?.message ?? "版本故事板任务失败", 200),
          };
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
      stageName: `${autoStageName}.multi_version`,
      event: failedCount === versions.length ? "stage.fail" : "stage.end",
      artifactId,
      parentArtifactId,
      outputSummary,
      durationMs: Date.now() - startedAt,
    });
    jobStore.updateJob(job.jobId, {
      stage: `${autoStageName}.multi_version`,
      status,
      progress: 100,
      artifactId,
      parentArtifactId,
      outputSummary,
    });
    await conversationUpdater.markBatchStarted({ options, job, traceContext, artifactId, versionResults: results });
  }

  function updateVersionBatchJob({ job, versions, results, artifactId, parentArtifactId }) {
    const completed = results.filter(Boolean).length;
    jobStore.updateJob(job.jobId, {
      stage: `${autoStageName}.multi_version`,
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

  return { runVersionBatch };
}

function buildQueuedVersionResult(version, child) {
  return {
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
}

module.exports = {
  createStoryboardVersionBatchRunner,
};
