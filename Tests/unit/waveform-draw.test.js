const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ts = require("typescript");

test("display waveform preserves relative loudness across sources", () => {
  const { buildDisplayPeaks } = loadWaveformDrawModule();
  const loud = Array.from({ length: 64 }, () => 0.78);
  const quiet = Array.from({ length: 64 }, () => 0.1);

  const loudDisplay = buildDisplayPeaks(loud);
  const quietDisplay = buildDisplayPeaks(quiet);

  assert.ok(average(loudDisplay) > average(quietDisplay) + 0.45);
  assert.ok(Math.max(...quietDisplay) < 0.13);
});

function average(values) {
  return values.reduce((total, value) => total + value, 0) / Math.max(values.length, 1);
}

function loadWaveformDrawModule() {
  const root = path.resolve(__dirname, "../..");
  const source = fs.readFileSync(path.join(root, "Apps/Workbench/src/utils/waveformDraw.ts"), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
  const exports = {};
  vm.runInNewContext(compiled.outputText, { exports, document: { createElement: () => ({ getContext: () => null }) }, window: { devicePixelRatio: 1 } });
  return exports;
}
