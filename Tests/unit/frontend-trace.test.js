const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

test("frontend UI logs use uiTraceId and display backend trace after upload", () => {
  const root = path.resolve(__dirname, "../..");
  const observability = fs.readFileSync(path.join(root, "Apps/Workbench/scripts/observability.js"), "utf8");
  const render = fs.readFileSync(path.join(root, "Apps/Workbench/scripts/render.js"), "utf8");

  assert.match(observability, /uiTraceId: state\.uiTraceId/);
  assert.doesNotMatch(observability, /traceId: state\.workspace\.id/);
  assert.match(render, /state\.processingJob\?\.traceId/);
  assert.match(render, /uiTrace/);
});
