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
  const index = fs.readFileSync(path.join(root, "Apps/Workbench/index.html"), "utf8");
  const workflow = fs.readFileSync(path.join(root, "Apps/Workbench/scripts/workflow.js"), "utf8");
  const render = fs.readFileSync(path.join(root, "Apps/Workbench/scripts/render.js"), "utf8");
  const templates = fs.readFileSync(path.join(root, "Apps/Workbench/scripts/render-templates.js"), "utf8");

  assert.match(index, /scripts\/audio-waveform\.js/);
  assert.match(app, /selectDerivative: \(artifactId\) => actionsRef\.current\.selectDerivative\(artifactId\)/);
  assert.match(app, /selectAudioTrack: \(\) => actionsRef\.current\.selectAudioTrack\(\)/);
  assert.match(workflow, /if \(type === "frame-set"\) return "frame"/);
  assert.match(workflow, /state\.selectedFrameId = null/);
  assert.match(workflow, /state\.mediaDerivatives\.find\(\(entry\) => entry\.type === "audio-track"\)/);
  assert.match(render, /templates\.audioTrackButton\(audio\)/);
  assert.match(render, /isVideoDerivative\(derivative\) \? derivative\.uri : state\.sampleVideo\.videoUri/);
  assert.match(render, /return renderAudio\(derivative \?\? findAudioDerivative\(\)\)/);
  assert.match(templates, /function audioTrackButton\(audio\)/);
});

test("audio waveform player is isolated and keeps empty audio safe", () => {
  const root = path.resolve(__dirname, "../..");
  const index = fs.readFileSync(path.join(root, "Apps/Workbench/index.html"), "utf8");
  const dom = fs.readFileSync(path.join(root, "Apps/Workbench/scripts/dom.js"), "utf8");
  const waveform = fs.readFileSync(path.join(root, "Apps/Workbench/scripts/audio-waveform.js"), "utf8");
  const render = fs.readFileSync(path.join(root, "Apps/Workbench/scripts/render.js"), "utf8");
  const templates = fs.readFileSync(path.join(root, "Apps/Workbench/scripts/render-templates.js"), "utf8");

  assert.match(index, /id="audioWaveformCanvas"/);
  assert.match(index, /id="audioWaveformPlayBtn"/);
  assert.match(dom, /audioWaveformCanvas: document\.querySelector/);
  assert.match(waveform, /decodeAudioData/);
  assert.match(waveform, /requestAnimationFrame/);
  assert.match(waveform, /seekFromPointer/);
  assert.match(render, /if \(!url\) return renderEmpty/);
  assert.match(templates, /data-audio-wave-mini/);
  assert.match(templates, /audio\?\.uri \? `<canvas/);
});

test("media preview preserves full aspect ratios and exposes resolution", () => {
  const root = path.resolve(__dirname, "../..");
  const index = fs.readFileSync(path.join(root, "Apps/Workbench/index.html"), "utf8");
  const layoutCss = fs.readFileSync(path.join(root, "Apps/Workbench/styles/layout.css"), "utf8");
  const previewCss = fs.readFileSync(path.join(root, "Apps/Workbench/styles/preview-panel.css"), "utf8");
  const responsiveCss = fs.readFileSync(path.join(root, "Apps/Workbench/styles/responsive.css"), "utf8");
  const timelineCss = fs.readFileSync(path.join(root, "Apps/Workbench/styles/timeline.css"), "utf8");
  const ingest = fs.readFileSync(path.join(root, "Apps/Workbench/scripts/sample-ingest.js"), "utf8");
  const render = fs.readFileSync(path.join(root, "Apps/Workbench/scripts/render.js"), "utf8");
  const templates = fs.readFileSync(path.join(root, "Apps/Workbench/scripts/render-templates.js"), "utf8");

  assert.match(index, /scripts\/media-viewport-fitter\.js/);
  assert.match(layoutCss, /grid-template-columns: clamp\(220px/);
  assert.match(layoutCss, /grid-template-rows: minmax\(0, 1fr\) clamp\(132px/);
  assert.match(previewCss, /\.sample-video,[\s\S]+\.media-image-preview[\s\S]+object-fit: contain/);
  assert.match(previewCss, /\.preview-stage[\s\S]+background: #000/);
  assert.doesNotMatch(previewCss, /960px|540px/);
  assert.match(responsiveCss, /@media \(max-width: 1320px\)/);
  assert.match(responsiveCss, /@media \(max-width: 980px\)/);
  assert.match(timelineCss, /\.frame-cell img[\s\S]+object-fit: contain/);
  assert.match(render, /fitMediaViewport/);
  assert.match(render, /letterboxInsets/);
  assert.match(render, /overlapsVertically/);
  assert.match(ingest, /width: artifact\.metadata\.width/);
  assert.match(ingest, /aspectRatio: buildAspectRatio/);
  assert.match(templates, /<b>分辨率<\/b>/);
  assert.match(templates, /<b>媒体类型<\/b>/);
});
