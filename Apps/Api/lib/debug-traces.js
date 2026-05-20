const fs = require("fs/promises");
const path = require("path");

async function readDebugTraces(runtimeRoot) {
  const dir = path.join(runtimeRoot, "DebugSnapshots");
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const logFiles = entries
    .filter((entry) => entry.isFile() && /^trace_.+\.log\.jsonl$/.test(entry.name))
    .map((entry) => entry.name);
  const traces = await Promise.all(logFiles.map((name) => readTraceFile(dir, name)));
  traces.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return { traces };
}

async function readTraceFile(dir, name) {
  const filePath = path.join(dir, name);
  const stat = await fs.stat(filePath);
  const text = await fs.readFile(filePath, "utf8");
  const events = text
    .split(/\r?\n/)
    .filter(Boolean)
    .map(parseLine)
    .filter(Boolean);
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

module.exports = { readDebugTraces };
