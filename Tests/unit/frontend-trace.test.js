const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

function read(root, file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

test("React workbench entry keeps uiTrace and backend trace boundaries", () => {
  const root = path.resolve(__dirname, "../..");
  const app = read(root, "Apps/Workbench/src/components/WorkbenchApp.tsx");
  const state = read(root, "Apps/Workbench/src/state.ts");
  const api = read(root, "Apps/Workbench/src/api/client.ts");
  const uiStage = read(root, "Apps/Workbench/src/observability/uiStage.ts");

  assert.match(state, /uiTraceId: createId\("uiTrace"\)/);
  assert.match(state, /ingest: "sample\.ingest"/);
  assert.match(state, /understand: "sample\.understand"/);
  assert.match(state, /transfer: "structure\.transfer"/);
  assert.match(app, /uiTraceId: state\.uiTraceId/);
  assert.match(app, /backendTraceId: state\.processingJob\?\.traceId/);
  assert.match(app, /beginUiStage/);
  assert.match(uiStage, /createId\("run"\)/);
  assert.doesNotMatch(app, /traceId: state\.workspace\.id/);
  assert.match(api, /\/api\/workspaces\/\$\{WORKSPACE_ID\}\/sample-videos/);
  assert.match(api, /\/api\/processing-jobs\/\$\{jobId\}/);
  assert.match(api, /\/api\/debug\/ui-events/);
});

test("React pages replace legacy runtime scripts", () => {
  const root = path.resolve(__dirname, "../..");
  const index = read(root, "Apps/Workbench/index.html");
  const debug = read(root, "Apps/Workbench/debug.html");
  const main = read(root, "Apps/Workbench/src/main.tsx");
  const debugEntry = read(root, "Apps/Workbench/src/debug.tsx");

  assert.match(index, /type="module" src="\/src\/main\.tsx"/);
  assert.match(debug, /type="module" src="\/src\/debug\.tsx"/);
  assert.doesNotMatch(index, /scripts\/.*\.js/);
  assert.doesNotMatch(debug, /scripts\/.*\.js/);
  assert.match(main, /<WorkbenchApp \/>/);
  assert.match(debugEntry, /<DebugApp \/>/);
});

test("workbench upload cancels stale polling and restores local draft", () => {
  const root = path.resolve(__dirname, "../..");
  const app = read(root, "Apps/Workbench/src/components/WorkbenchApp.tsx");
  const state = read(root, "Apps/Workbench/src/state.ts");

  assert.match(app, /const uploadTokenRef = useRef\(0\)/);
  assert.match(app, /if \(token !== uploadTokenRef\.current\) return/);
  assert.match(app, /localStorage\.setItem\(STORAGE_KEY, JSON\.stringify\(value\)\)/);
  assert.match(app, /localStorage\.getItem\(STORAGE_KEY\)/);
  assert.match(state, /type: "restore-draft"/);
  assert.match(state, /sampleArtifact: SampleArtifact/);
});

test("timeline selection and zoom avoid high-frequency full rerenders", () => {
  const root = path.resolve(__dirname, "../..");
  const timeline = read(root, "Apps/Workbench/src/components/TimelinePanel.tsx");
  const metrics = read(root, "Apps/Workbench/src/utils/timeline.ts");
  const app = read(root, "Apps/Workbench/src/components/WorkbenchApp.tsx");

  assert.match(timeline, /onBlur=\{\(\) => onVisibleSecondsChange\(clampVisibleSeconds\(draftSeconds\)\)\}/);
  assert.doesNotMatch(timeline, /onChange=\{\(event\) => onVisibleSecondsChange/);
  assert.match(metrics, /export const MAX_RENDERED_FRAMES = 80/);
  assert.match(metrics, /function shouldAppendEndTick/);
  assert.match(app, /lastSegmentId/);
  assert.match(app, /if \(\(card\?\.id \?\? null\) !== lastSegmentId\)/);
});

test("audio waveform uses worker, cache, and layered canvas drawing", () => {
  const root = path.resolve(__dirname, "../..");
  const hook = read(root, "Apps/Workbench/src/hooks/useAudioWaveform.ts");
  const worker = read(root, "Apps/Workbench/src/workers/audioPeaks.worker.ts");
  const draw = read(root, "Apps/Workbench/src/utils/waveformDraw.ts");
  const envelope = read(root, "Apps/Workbench/src/utils/audioEnvelope.ts");

  assert.match(hook, /const peaksCache = new Map<string, number\[\]>\(\)/);
  assert.match(hook, /new Worker\(new URL\("\.\.\/workers\/audioPeaks\.worker\.ts"/);
  assert.match(hook, /decodePeaksInMainThread/);
  assert.match(hook, /workerRef\.current\?\.terminate\(\)/);
  assert.match(hook, /time - lastFrameAtRef\.current >= 66/);
  assert.match(worker, /decodeAudioData/);
  assert.match(worker, /ok: false/);
  assert.match(worker, /audio_context_unavailable/);
  assert.match(worker, /audio_decode_failed/);
  assert.match(worker, /import \{ buildVisualEnvelope \}/);
  assert.match(hook, /audio\.waveform\.decode/);
  assert.match(hook, /fallbackReason/);
  assert.match(hook, /audio_empty_peaks/);
  assert.match(envelope, /buildVisualEnvelope\(audioBuffer/);
  assert.match(envelope, /normalizeEnvelope/);
  assert.match(envelope, /localMean/);
  assert.match(envelope, /stretchVisualRange/);
  assert.match(draw, /createStaticWaveform/);
  assert.match(draw, /buildDisplayPeaks/);
  assert.match(draw, /drawCursor/);
});

test("debug page keeps trace crop, detail cache, refresh, and log link behavior", () => {
  const root = path.resolve(__dirname, "../..");
  const debug = read(root, "Apps/Workbench/src/components/DebugApp.tsx");
  const api = read(root, "Apps/Workbench/src/api/client.ts");

  assert.match(debug, /const TRACE_LIST_LIMIT = 20/);
  assert.match(debug, /detailCacheRef = useRef\(new Map<string, DebugTraceDetail>\(\)\)/);
  assert.match(debug, /已隐藏更早的/);
  assert.match(debug, /id="debugLogLink"/);
  assert.match(debug, /id="refreshDebugBtn"/);
  assert.match(api, /\/api\/debug\/traces/);
  assert.match(api, /\/api\/debug\/traces\/\$\{encodeURIComponent\(traceId\)\}/);
});

test("media preview uses ResizeObserver and preserves full aspect ratio metadata", () => {
  const root = path.resolve(__dirname, "../..");
  const preview = read(root, "Apps/Workbench/src/components/PreviewPanel.tsx");
  const resize = read(root, "Apps/Workbench/src/hooks/useElementSize.ts");
  const state = read(root, "Apps/Workbench/src/state.ts");
  const property = read(root, "Apps/Workbench/src/components/PropertyPanel.tsx");

  assert.match(resize, /new ResizeObserver/);
  assert.match(resize, /requestAnimationFrame\(update\)/);
  assert.match(preview, /fitMediaViewport/);
  assert.match(preview, /letterboxInsets/);
  assert.match(state, /width: artifact\.metadata\.width/);
  assert.match(state, /aspectRatio: buildAspectRatio/);
  assert.match(property, /label="分辨率"/);
  assert.match(property, /label="媒体类型"/);
});

test("upload options and optional media tracks are visible in workbench UI", () => {
  const root = path.resolve(__dirname, "../..");
  const resource = read(root, "Apps/Workbench/src/components/ResourcePanel.tsx");
  const timeline = read(root, "Apps/Workbench/src/components/TimelinePanel.tsx");
  const property = read(root, "Apps/Workbench/src/components/PropertyPanel.tsx");
  const api = read(root, "Apps/Workbench/src/api/client.ts");

  assert.match(api, /\/api\/capabilities/);
  assert.match(api, /enableAudioSeparation/);
  assert.match(api, /enableSubtitleRecognition/);
  assert.match(resource, /enableAudioSeparationInput/);
  assert.match(resource, /XFYUN_APP_ID/);
  assert.match(timeline, /id="subtitleTrack"/);
  assert.match(timeline, /audioSeparation/);
  assert.match(property, /subtitle-editor/);
  assert.match(property, /draftVersionId/);
});
