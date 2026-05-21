const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ts = require("typescript");

test("low signal visual envelope stays near baseline", () => {
  const { buildVisualEnvelope } = loadEnvelopeModule();
  const buffer = {
    length: 512,
    numberOfChannels: 1,
    getChannelData: () => Float32Array.from({ length: 512 }, () => 0.0001),
  };
  const peaks = buildVisualEnvelope(buffer, 64);
  assert.equal(peaks.length, 64);
  assert.ok(Math.max(...peaks) < 0.01);
});

test("visual envelope keeps louder source visibly higher than quiet source", () => {
  const { buildVisualEnvelope } = loadEnvelopeModule();
  const loud = createConstantBuffer(0.32);
  const quiet = createConstantBuffer(0.03);

  const loudPeaks = buildVisualEnvelope(loud, 64);
  const quietPeaks = buildVisualEnvelope(quiet, 64);

  assert.ok(average(loudPeaks) > average(quietPeaks) + 0.35);
  assert.ok(Math.max(...quietPeaks) <= 0.08);
});

function createConstantBuffer(value) {
  return {
    length: 512,
    numberOfChannels: 1,
    getChannelData: () => Float32Array.from({ length: 512 }, () => value),
  };
}

function average(values) {
  return values.reduce((total, value) => total + value, 0) / Math.max(values.length, 1);
}

function loadEnvelopeModule() {
  const root = path.resolve(__dirname, "../..");
  const source = fs.readFileSync(path.join(root, "Apps/Workbench/src/utils/audioEnvelope.ts"), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
  const exports = {};
  vm.runInNewContext(compiled.outputText, { exports });
  return exports;
}
