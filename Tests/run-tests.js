const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const DEFAULT_TEST_TIMEOUT_MS = 5000;
const SLOW_TEST_TIMEOUT_MS = 30000;
const SLOW_TEST_FILES = new Set([
  "Tests/unit/capabilities.test.js",
  "Tests/unit/script-segment-input.test.js",
  "Tests/unit/script-segment-service-flow.test.js",
  "Tests/unit/script-segment-cache-trace.test.js",
]);

const suites = process.argv.slice(2);
const patterns = suites.length ? suites : ["Tests/unit/*.test.js", "Tests/contract/*.test.js"];
const testFiles = patterns.flatMap(expandPattern);

let exitCode = 0;
for (const testFile of testFiles) {
  const timeoutMs = SLOW_TEST_FILES.has(normalizeTestPath(testFile)) ? SLOW_TEST_TIMEOUT_MS : DEFAULT_TEST_TIMEOUT_MS;
  const result = spawnSync(process.execPath, ["--test", `--test-timeout=${timeoutMs}`, testFile], { stdio: "inherit" });
  exitCode = result.status ?? 1;
  if (exitCode !== 0) break;
}
process.exit(exitCode);

function expandPattern(pattern) {
  if (!pattern.includes("*")) return [pattern];

  const normalized = pattern.split(path.sep).join("/");
  const slashIndex = normalized.lastIndexOf("/");
  const dir = slashIndex >= 0 ? normalized.slice(0, slashIndex) : ".";
  const basenamePattern = slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized;
  const regex = new RegExp(`^${basenamePattern.split("*").map(escapeRegex).join(".*")}$`);

  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && regex.test(entry.name))
    .map((entry) => `${dir}/${entry.name}`)
    .sort();
}

function escapeRegex(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function normalizeTestPath(testPath) {
  const relativePath = path.isAbsolute(testPath) ? path.relative(process.cwd(), testPath) : testPath;
  return relativePath.split(path.sep).join("/");
}
