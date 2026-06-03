const { randomUUID } = require("crypto");

function createWorkflowLogger({ logger }) {
  async function logWorkflowEvent(traceContext, event, stageName, artifactId, parentArtifactId, inputSummary, outputSummary, durationMs, errorSummary) {
    await logger.writeStageLog({
      traceContext,
      event,
      stageName,
      artifactId: artifactId ?? null,
      parentArtifactId: parentArtifactId ?? null,
      inputSummary: inputSummary ?? null,
      outputSummary: outputSummary ?? null,
      durationMs: durationMs ?? null,
      errorSummary: errorSummary ?? null,
    });
  }

  async function logWorkflowRunClosed(run, event) {
    if (!run) return;
    const traceContext = { runId: run.runId, traceId: run.traceId, stageId: `stage_${randomUUID()}` };
    const outputSummary = {
      workflowRunId: run.workflowRunId,
      status: run.status,
      sampleVideoId: run.sampleVideoId ?? null,
      processedStageCount: run.stages.filter((stage) => stage.status === "processed").length,
      failedStageCount: run.stages.filter((stage) => stage.status === "failed").length,
    };
    await logWorkflowEvent(traceContext, event, "workflow.run", null, null, null, outputSummary, null, event === "stage.fail" ? run.errorSummary ?? null : null);
  }

  return { logWorkflowEvent, logWorkflowRunClosed };
}

module.exports = { createWorkflowLogger };
