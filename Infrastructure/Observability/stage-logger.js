function createStageLogger(store) {
  async function writeStageLog({
    traceContext,
    stageName,
    stage,
    event,
    artifactId = null,
    parentArtifactId = null,
    inputSummary = null,
    outputSummary = null,
    durationMs = null,
    errorSummary = null,
  }) {
    const line = normalizeStageLog({
      event,
      traceContext,
      stageName: stageName ?? stage,
      artifactId,
      parentArtifactId,
      inputSummary,
      outputSummary,
      durationMs,
      errorSummary,
    });
    const logPath = `${store.runtimeRoot}/DebugSnapshots/${traceContext.traceId}.log.jsonl`;
    await appendJsonLine(logPath, line);
    return line;
  }

  async function writeDebugSnapshot({
    traceContext,
    stageName,
    stage,
    artifactId = null,
    parentArtifactId = null,
    reason,
    inputSummary = null,
    outputSummary = null,
    debugPayload = null,
    payload = null,
  }) {
    const snapshot = {
      snapshotId: `snapshot_${traceContext.stageId}`,
      runId: traceContext.runId,
      traceId: traceContext.traceId,
      stageId: traceContext.stageId,
      stageName: stageName ?? stage ?? null,
      artifactId,
      parentArtifactId,
      createdAt: new Date().toISOString(),
      reason: reason ?? null,
      inputSummary,
      outputSummary,
      debugPayload: debugPayload ?? payload ?? null,
    };
    const filePath = `${store.runtimeRoot}/DebugSnapshots/${snapshot.snapshotId}.json`;
    await store.writeJson(filePath, snapshot);
    return { ...snapshot, uri: store.runtimeUri(filePath) };
  }

  return { writeStageLog, writeDebugSnapshot };
}

function normalizeStageLog({
  event,
  traceContext,
  stageName,
  artifactId,
  parentArtifactId,
  inputSummary,
  outputSummary,
  durationMs,
  errorSummary,
}) {
  return {
    event: event ?? null,
    runId: traceContext?.runId ?? null,
    traceId: traceContext?.traceId ?? null,
    stageId: traceContext?.stageId ?? null,
    stageName: stageName ?? null,
    artifactId: artifactId ?? null,
    parentArtifactId: parentArtifactId ?? null,
    inputSummary: inputSummary ?? null,
    outputSummary: outputSummary ?? null,
    durationMs: durationMs ?? null,
    errorSummary: errorSummary ?? null,
    createdAt: new Date().toISOString(),
  };
}

async function appendJsonLine(filePath, value) {
  const fs = require("fs/promises");
  const path = require("path");
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

module.exports = { createStageLogger, normalizeStageLog };
