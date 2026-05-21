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

function loadEnvelopeModule() {
  const root = path.resolve(__dirname, "../..");
  const source = fs.readFileSync(path.join(root, "Apps/Workbench/src/utils/audioEnvelope.ts"), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
  const exports = {};
  vm.runInNewContext(compiled.outputText, { exports });
  return exports;
}
