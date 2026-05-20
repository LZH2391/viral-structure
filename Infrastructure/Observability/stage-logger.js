function createStageLogger(store) {
  const tracedLogs = new Set();

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
    const lines = [];
    if (!tracedLogs.has(traceContext.traceId)) {
      lines.push(compactTraceMeta(line));
      tracedLogs.add(traceContext.traceId);
    }
    lines.push(compactStageLog(line));
    await appendJsonLines(logPath, lines);
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

const EVENT_CODES = { "stage.start": "s", "stage.end": "e", "stage.fail": "f" };
const EVENT_NAMES = Object.fromEntries(Object.entries(EVENT_CODES).map(([name, code]) => [code, name]));

const STAGE_CODES = {
  "sample.upload.received": "ur", "sample.upload.validated": "uv", "sample.source.saved": "ss", "sample.metadata.probed": "mp",
  "sample.cover.extracted": "ce", "sample.frames.extracted": "fe", "sample.audio.extracted": "ae", "sample.artifact.written": "aw",
};

const STAGE_NAMES = Object.fromEntries(Object.entries(STAGE_CODES).map(([name, code]) => [code, name]));

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

function compactTraceMeta(line) {
  return {
    v: 2,
    e: "m",
    run: line.runId,
    trace: line.traceId,
    t: line.createdAt,
  };
}

function compactStageLog(line) {
  return dropNulls({
    v: 2,
    e: EVENT_CODES[line.event] ?? line.event,
    sid: line.stageId,
    sn: STAGE_CODES[line.stageName] ?? line.stageName,
    a: line.artifactId,
    p: line.parentArtifactId,
    i: line.inputSummary,
    o: line.outputSummary,
    d: line.durationMs,
    err: compactErrorSummary(line.errorSummary),
    t: line.createdAt,
  });
}

function expandStageLogLines(entries) {
  const context = { runId: null, traceId: null };
  return entries.map((entry) => expandStageLogLine(entry, context)).filter(Boolean);
}

function expandStageLogLine(entry, context = {}) {
  if (entry?.v === 2 && entry.e === "m") {
    context.runId = entry.run ?? null;
    context.traceId = entry.trace ?? null;
    return null;
  }
  if (entry?.v === 2) {
    return {
      event: EVENT_NAMES[entry.e] ?? entry.e ?? null,
      runId: context.runId ?? null,
      traceId: context.traceId ?? null,
      stageId: entry.sid ?? null,
      stageName: STAGE_NAMES[entry.sn] ?? entry.sn ?? null,
      artifactId: entry.a ?? null,
      parentArtifactId: entry.p ?? null,
      inputSummary: entry.i ?? null,
      outputSummary: entry.o ?? null,
      durationMs: entry.d ?? null,
      errorSummary: expandErrorSummary(entry.err),
      createdAt: entry.t ?? null,
    };
  }
  const legacySummary = entry?.summary ?? null;
  return {
    event: entry?.event ?? null,
    runId: entry?.runId ?? context.runId ?? null,
    traceId: entry?.traceId ?? context.traceId ?? null,
    stageId: entry?.stageId ?? null,
    stageName: entry?.stageName ?? entry?.stage ?? null,
    artifactId: entry?.artifactId ?? null,
    parentArtifactId: entry?.parentArtifactId ?? null,
    inputSummary: entry?.inputSummary ?? null,
    outputSummary: entry?.outputSummary ?? (entry?.event === "stage.end" ? legacySummary : null),
    durationMs: entry?.durationMs ?? null,
    errorSummary: entry?.errorSummary ?? (entry?.event === "stage.fail" ? legacySummary : null),
    createdAt: entry?.createdAt ?? entry?.time ?? null,
  };
}

function dropNulls(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null && item !== undefined));
}

function compactErrorSummary(errorSummary) {
  if (!errorSummary) return null;
  return dropNulls({
    c: errorSummary.code,
    m: errorSummary.message,
    st: errorSummary.stageName,
    u: errorSummary.debugSnapshotUri,
  });
}

function expandErrorSummary(errorSummary) {
  if (!errorSummary) return null;
  if (!("c" in errorSummary || "m" in errorSummary || "st" in errorSummary || "u" in errorSummary)) return errorSummary;
  return {
    code: errorSummary.c ?? null,
    message: errorSummary.m ?? null,
    stageName: errorSummary.st ?? null,
    debugSnapshotUri: errorSummary.u ?? null,
  };
}

async function appendJsonLines(filePath, values) {
  const fs = require("fs/promises");
  const path = require("path");
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `${values.map((value) => JSON.stringify(value)).join("\n")}\n`, "utf8");
}

module.exports = { createStageLogger, normalizeStageLog, compactStageLog, compactTraceMeta, expandStageLogLine, expandStageLogLines };
