const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

function loadTimelineUtils(root) {
  const file = path.join(root, "Apps/Workbench/src/utils/timeline.ts");
  const source = fs.readFileSync(file, "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const module = { exports: {} };
  new Function("exports", "module", output)(module.exports, module);
  return module.exports;
}

test("timeline time and left conversions clamp invalid and out-of-range values", () => {
  const root = path.resolve(__dirname, "../..");
  const { timeToTimelineLeft, timelineLeftToTime } = loadTimelineUtils(root);
  const metrics = { duration: 10, contentWidth: 1000 };

  assert.equal(timeToTimelineLeft(5, metrics), 500);
  assert.equal(timeToTimelineLeft(-4, metrics), 0);
  assert.equal(timeToTimelineLeft(14, metrics), 1000);
  assert.equal(timeToTimelineLeft(Number.NaN, metrics), 0);
  assert.equal(timelineLeftToTime(500, metrics), 5);
  assert.equal(timelineLeftToTime(-20, metrics), 0);
  assert.equal(timelineLeftToTime(1400, metrics), 10);
  assert.equal(timelineLeftToTime(Number.POSITIVE_INFINITY, metrics), 0);
});

test("timeline conversions never return NaN for invalid duration or width", () => {
  const root = path.resolve(__dirname, "../..");
  const { timeToTimelineLeft, timelineLeftToTime } = loadTimelineUtils(root);
  const invalidMetrics = [
    { duration: 0, contentWidth: 100 },
    { duration: Number.NaN, contentWidth: 100 },
    { duration: 10, contentWidth: 0 },
    { duration: 10, contentWidth: Number.POSITIVE_INFINITY },
  ];

  for (const metrics of invalidMetrics) {
    assert.equal(Number.isNaN(timeToTimelineLeft(3, metrics)), false);
    assert.equal(Number.isNaN(timelineLeftToTime(30, metrics)), false);
    assert.equal(timeToTimelineLeft(3, metrics), 0);
    assert.equal(timelineLeftToTime(30, metrics), 0);
  }
});
