const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

function loadAudioFeatureMarkerUtils(root) {
  const file = path.join(root, "Apps/Workbench/src/utils/audioFeatureMarkers.ts");
  const source = fs.readFileSync(file, "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const module = { exports: {} };
  new Function("exports", "module", "require", output)(module.exports, module, () => ({}));
  return module.exports;
}

test("audio feature duration prefers analysis source duration over video fallback", () => {
  const root = path.resolve(__dirname, "../..");
  const { resolveAudioFeatureDuration } = loadAudioFeatureMarkerUtils(root);

  assert.equal(resolveAudioFeatureDuration({ durationSeconds: 17.5 }, 18), 17.5);
  assert.equal(resolveAudioFeatureDuration({ durationSeconds: null }, 18), 18);
  assert.equal(resolveAudioFeatureDuration(null, 18), 18);
  assert.equal(resolveAudioFeatureDuration({ durationSeconds: 0 }, null), null);
});

test("audio feature marker left percent clamps against resolved duration", () => {
  const root = path.resolve(__dirname, "../..");
  const { markerLeftPercent } = loadAudioFeatureMarkerUtils(root);

  assert.equal(markerLeftPercent(8.75, 17.5), 50);
  assert.equal(markerLeftPercent(-2, 17.5), 0);
  assert.equal(markerLeftPercent(20, 17.5), 100);
  assert.equal(markerLeftPercent(3, null), 100);
});
