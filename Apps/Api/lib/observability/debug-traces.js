const fs = require("fs/promises");
const path = require("path");
const { expandStageLogLines } = require("../../../../Infrastructure/Observability/stage-logger");

async function readDebugTraces(runtimeRoot) {
  const dir = path.join(runtimeRoot, "DebugSnapshots");
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const logFiles = entries
    .filter((entry) => entry.isFile() && /^(trace_|uiTrace_).+\.log\.jsonl$/.test(entry.name))
    .map((entry) => entry.name);
  const traces = await Promise.all(logFiles.map((name) => readTraceSummary(dir, name)));
  traces.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return { traces };
}

async function readDebugTraceDetail(runtimeRoot, traceId) {
  if (!/^(trace_|uiTrace_)[A-Za-z0-9_-]+$/.test(traceId)) return null;
  const dir = path.join(runtimeRoot, "DebugSnapshots");
  const name = `${traceId}.log.jsonl`;
  const filePath = path.join(dir, name);
  try {
    await fs.access(filePath);
  } catch {
    return null;
  }
  return readTraceDetail(dir, name);
}

async function readTraceSummary(dir, name) {
  const trace = await readTraceDetail(dir, name);
  const { events, ...summary } = trace;
  return summary;
}

async function readTraceDetail(dir, name) {
  const filePath = path.join(dir, name);
  const stat = await fs.stat(filePath);
  const text = await fs.readFile(filePath, "utf8");
  const rawEvents = text.split(/\r?\n/).filter(Boolean).map(parseLine).filter(Boolean);
  const events = expandStageLogLines(rawEvents);
  const latest = events.at(-1) ?? null;
  const traceId = name.replace(/\.log\.jsonl$/, "");
  return {
    traceId,
    logUri: `/runtime/DebugSnapshots/${name}`,
    updatedAt: stat.mtime.toISOString(),
    latestEvent: latest?.event ?? null,
    latestStageName: latest?.stageName ?? latest?.stage ?? null,
    errorSummary: latest?.errorSummary ?? latest?.summary ?? null,
    events,
  };
}

function parseLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

module.exports = { readDebugTraces, readDebugTraceDetail };
