const { randomUUID } = require("crypto");

function createTraceIds() {
  const traceId = `trace_${randomUUID()}`;
  return {
    runId: `run_${randomUUID()}`,
    traceId,
    stageId: `stage_${randomUUID()}`,
  };
}

function nextStage(traceContext) {
  return {
    ...traceContext,
    stageId: `stage_${randomUUID()}`,
  };
}

module.exports = { createTraceIds, nextStage };
