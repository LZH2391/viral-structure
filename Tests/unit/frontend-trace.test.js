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

test("frontend only creates debug snapshots for failures and manual capture", () => {
  const root = path.resolve(__dirname, "../..");
  const observability = fs.readFileSync(path.join(root, "Apps/Workbench/scripts/observability.js"), "utf8");
  const workflow = fs.readFileSync(path.join(root, "Apps/Workbench/scripts/workflow.js"), "utf8");

  assert.match(observability, /function failStage[\s\S]+captureStageSnapshot/);
  assert.match(workflow, /captureManualSnapshot\(\)[\s\S]+observability\.captureDebugSnapshot/);
  assert.equal([...workflow.matchAll(/observability\.captureDebugSnapshot/g)].length, 1);
});

test("media preview can switch between video, frames, and audio track", () => {
  const root = path.resolve(__dirname, "../..");
  const app = fs.readFileSync(path.join(root, "Apps/Workbench/app.js"), "utf8");
  const workflow = fs.readFileSync(path.join(root, "Apps/Workbench/scripts/workflow.js"), "utf8");
  const render = fs.readFileSync(path.join(root, "Apps/Workbench/scripts/render.js"), "utf8");
  const templates = fs.readFileSync(path.join(root, "Apps/Workbench/scripts/render-templates.js"), "utf8");

  assert.match(app, /selectDerivative: \(artifactId\) => actionsRef\.current\.selectDerivative\(artifactId\)/);
  assert.match(app, /selectAudioTrack: \(\) => actionsRef\.current\.selectAudioTrack\(\)/);
  assert.match(workflow, /if \(type === "frame-set"\) return "frame"/);
  assert.match(workflow, /state\.selectedFrameId = null/);
  assert.match(workflow, /state\.mediaDerivatives\.find\(\(entry\) => entry\.type === "audio-track"\)/);
  assert.match(render, /templates\.audioTrackButton\(findAudioDerivative\(\)\)/);
  assert.match(render, /isVideoDerivative\(derivative\) \? derivative\.uri : state\.sampleVideo\.videoUri/);
  assert.match(render, /return renderAudio\(derivative \?\? findAudioDerivative\(\)\)/);
  assert.match(templates, /function audioTrackButton\(audio\)/);
});
