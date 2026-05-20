function createStageLogger(store) {
  async function writeStageLog({ traceContext, stage, event, artifactId = null, parentArtifactId = null, summary = null }) {
    const line = {
      time: new Date().toISOString(),
      event,
      stage,
      runId: traceContext.runId,
      traceId: traceContext.traceId,
      stageId: traceContext.stageId,
      artifactId,
      parentArtifactId,
      summary,
    };
    const logPath = `${store.runtimeRoot}/DebugSnapshots/${traceContext.traceId}.log.jsonl`;
    await appendJsonLine(logPath, line);
    return line;
  }

  async function writeDebugSnapshot({ traceContext, stage, artifactId, parentArtifactId, payload }) {
    const snapshot = {
      snapshotId: `snapshot_${traceContext.stageId}`,
      createdAt: new Date().toISOString(),
      stage,
      runId: traceContext.runId,
      traceId: traceContext.traceId,
      stageId: traceContext.stageId,
      artifactId,
      parentArtifactId,
      payload,
    };
    const filePath = `${store.runtimeRoot}/DebugSnapshots/${snapshot.snapshotId}.json`;
    await store.writeJson(filePath, snapshot);
    return { ...snapshot, uri: store.runtimeUri(filePath) };
  }

  return { writeStageLog, writeDebugSnapshot };
}

async function appendJsonLine(filePath, value) {
  const fs = require("fs/promises");
  const path = require("path");
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

module.exports = { createStageLogger };
