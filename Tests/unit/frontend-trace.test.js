const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ts = require("typescript");

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
  const draft = read(root, "Apps/Workbench/src/utils/workbenchDraft.ts");

  assert.match(app, /const uploadTokenRef = useRef\(0\)/);
  assert.match(app, /if \(token !== uploadTokenRef\.current\) return/);
  assert.match(app, /readWorkbenchDraft/);
  assert.match(draft, /localStorage\.setItem\(WORKBENCH_DRAFT_STORAGE_KEY, JSON\.stringify\(value\)\)/);
  assert.match(draft, /localStorage\.getItem\(WORKBENCH_DRAFT_STORAGE_KEY\)/);
  assert.match(state, /type: "restore-draft"/);
  assert.match(state, /sampleArtifact: SampleArtifact/);
  assert.match(state, /activeUploadJob/);
  assert.match(state, /activeAgentJob/);
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

test("timeline playhead playback avoids reducer driven progress updates", () => {
  const root = path.resolve(__dirname, "../..");
  const timeline = read(root, "Apps/Workbench/src/components/TimelinePanel.tsx");
  const playhead = read(root, "Apps/Workbench/src/components/TimelinePlayhead.tsx");
  const playback = read(root, "Apps/Workbench/src/hooks/useTimelinePlayback.ts");
  const state = read(root, "Apps/Workbench/src/state.ts");

  assert.match(timeline, /useTimelinePlayback/);
  assert.match(playback, /requestAnimationFrame\(tick\)/);
  assert.match(playhead, /data-timeline-playhead/);
  assert.match(timeline, /style\.transform = `translate3d/);
  assert.match(playhead, /SCRUB_SEEK_INTERVAL_MS = 66/);
  assert.match(playhead, /timeline\.playback\.toggle/);
  assert.match(playhead, /timeline\.playhead\.seek/);
  assert.match(playhead, /timeline\.playhead\.scrub/);
  assert.doesNotMatch(state, /currentTime/);
  assert.doesNotMatch(state, /set-current-time/);
  assert.doesNotMatch(timeline, /dispatch\(\{ type: "set-visible-seconds"/);
  assert.doesNotMatch(timeline, /setCurrentTime/);
  assert.doesNotMatch(playback, /setCurrentTime/);
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
  assert.match(hook, /durationSeconds/);
  assert.match(hook, /resolveDuration/);
  assert.match(hook, /seekAudio/);
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
  const app = read(root, "Apps/Workbench/src/components/WorkbenchApp.tsx");
  const preview = read(root, "Apps/Workbench/src/components/PreviewPanel.tsx");
  const previewCss = read(root, "Apps/Workbench/styles/preview-panel.css");
  const resize = read(root, "Apps/Workbench/src/hooks/useElementSize.ts");
  const state = read(root, "Apps/Workbench/src/state.ts");
  const property = read(root, "Apps/Workbench/src/components/PropertyPanel.tsx");

  assert.match(resize, /new ResizeObserver/);
  assert.match(resize, /requestAnimationFrame\(update\)/);
  assert.match(preview, /fitMediaViewport/);
  assert.match(preview, /audio-waveform-feature-marker/);
  assert.match(preview, /audio\.currentTime/);
  assert.match(preview, /audioSeekRequest/);
  assert.match(app, /setAudioSeekRequest/);
  assert.match(app, /resolveAudioFeatureSourceId/);
  assert.match(previewCss, /audio-waveform-feature-marker[\s\S]*width: 2px/);
  assert.match(preview, /letterboxInsets/);
  assert.match(state, /width: artifact\.metadata\.width/);
  assert.match(state, /aspectRatio: buildAspectRatio/);
  assert.match(property, /label="分辨率"/);
  assert.match(property, /label="媒体类型"/);
});

test("upload options and optional media tracks are visible in workbench UI", () => {
  const root = path.resolve(__dirname, "../..");
  const resource = read(root, "Apps/Workbench/src/components/ResourcePanel.tsx");
  const app = read(root, "Apps/Workbench/src/components/WorkbenchApp.tsx");
  const timeline = read(root, "Apps/Workbench/src/components/TimelinePanel.tsx");
  const property = read(root, "Apps/Workbench/src/components/PropertyPanel.tsx");
  const api = read(root, "Apps/Workbench/src/api/client.ts");

  assert.match(app, /useState\(3\)/);
  assert.match(app, /const \[enableAudioSeparation, setEnableAudioSeparation\] = useState\(true\)/);
  assert.match(app, /const \[enableSubtitleRecognition, setEnableSubtitleRecognition\] = useState\(true\)/);
  assert.match(app, /const \[enableAudioFeatureAnalysis, setEnableAudioFeatureAnalysis\] = useState\(true\)/);
  assert.match(api, /\/api\/capabilities/);
  assert.match(api, /enableAudioSeparation/);
  assert.match(api, /enableSubtitleRecognition/);
  assert.match(api, /enableAudioFeatureAnalysis/);
  assert.match(resource, /enableAudioSeparationInput/);
  assert.match(resource, /enableAudioFeatureAnalysisInput/);
  assert.match(resource, /XFYUN_APP_ID/);
  assert.match(timeline, /id="subtitleTrack"/);
  assert.match(timeline, /audioSeparation/);
  assert.match(timeline, /audio-feature-marker/);
  assert.match(property, /subtitle-editor/);
  assert.match(property, /draftVersionId/);
  assert.match(property, /AudioFeatureRows/);
});

test("library page exposes local artifact index views", () => {
  const root = path.resolve(__dirname, "../..");
  const vite = read(root, "vite.config.ts");
  const libraryHtml = read(root, "Apps/Workbench/library.html");
  const libraryEntry = read(root, "Apps/Workbench/src/library.tsx");
  const libraryApp = read(root, "Apps/Workbench/src/components/LibraryApp.tsx");
  const app = read(root, "Apps/Workbench/src/components/WorkbenchApp.tsx");
  const api = read(root, "Apps/Workbench/src/api/client.ts");

  assert.match(vite, /library: "Apps\/Workbench\/library\.html"/);
  assert.match(libraryHtml, /src="\/src\/library\.tsx"/);
  assert.match(libraryEntry, /<LibraryApp \/>/);
  assert.match(app, /setWorkbenchView\("library", setActiveView\)/);
  assert.match(app, /<LibraryApp embedded/);
  assert.match(api, /\/api\/library\/items/);
  assert.match(libraryApp, /处理库/);
  assert.match(libraryApp, /loadLibraryItem/);
  assert.match(libraryApp, /libraryArtifactTree/);
});

test("threadpool page and shot boundary agent use proxied API surface", () => {
  const root = path.resolve(__dirname, "../..");
  const vite = read(root, "vite.config.ts");
  const app = read(root, "Apps/Workbench/src/components/WorkbenchApp.tsx");
  const property = read(root, "Apps/Workbench/src/components/PropertyPanel.tsx");
  const threadpoolHtml = read(root, "Apps/Workbench/threadpool.html");
  const threadpoolEntry = read(root, "Apps/Workbench/src/threadpool.tsx");
  const threadpoolApp = read(root, "Apps/Workbench/src/components/ThreadPoolApp.tsx");
  const api = read(root, "Apps/Workbench/src/api/client.ts");

  assert.match(vite, /threadpool: "Apps\/Workbench\/threadpool\.html"/);
  assert.match(threadpoolHtml, /src="\/src\/threadpool\.tsx"/);
  assert.match(threadpoolEntry, /<ThreadPoolApp \/>/);
  assert.match(app, /setWorkbenchView\("threadpool", setActiveView\)/);
  assert.match(app, /<ThreadPoolApp embedded/);
  assert.match(app, /workspace-grid \$\{activeView === "workspace" \? "" : "is-hidden-view"\}/);
  assert.doesNotMatch(app, /href="http:\/\/127\.0\.0\.1:5177\/threadpool"/);
  assert.match(api, /\/api\/threadpool\/roles/);
  assert.match(api, /\/api\/sample-videos\/\$\{encodeURIComponent\(sampleVideoId\)\}\/shot-boundary/);
  assert.match(threadpoolApp, /discardThreadPoolThread/);
  assert.match(threadpoolApp, /window\.confirm/);
  assert.match(property, /AgentRunPanel/);
  assert.match(property, /shot-boundary/);
  assert.match(property, /onRunShotBoundary/);
});

test("workbench workspace layout supports persisted splitters", () => {
  const root = path.resolve(__dirname, "../..");
  const app = read(root, "Apps/Workbench/src/components/WorkbenchApp.tsx");
  const hook = read(root, "Apps/Workbench/src/hooks/useResizableWorkspaceLayout.ts");
  const handle = read(root, "Apps/Workbench/src/components/WorkspaceResizeHandle.tsx");
  const layoutCss = read(root, "Apps/Workbench/styles/layout.css");
  const responsiveCss = read(root, "Apps/Workbench/styles/responsive.css");

  assert.match(app, /useResizableWorkspaceLayout/);
  assert.match(app, /WorkspaceResizeHandle/);
  assert.match(app, /workspaceGridRef/);
  assert.match(hook, /workbench:layout/);
  assert.match(hook, /clampWorkspaceLayout/);
  assert.match(hook, /setProperty\("--workspace-left-width"/);
  assert.match(hook, /setProperty\("--workspace-right-width"/);
  assert.match(hook, /setProperty\("--workspace-timeline-height"/);
  assert.match(handle, /role="separator"/);
  assert.match(handle, /onDoubleClick=\{\(\) => onReset\(kind\)\}/);
  assert.match(handle, /ArrowRight/);
  assert.match(layoutCss, /grid-template-areas:[\s\S]*left-resizer[\s\S]*right-resizer[\s\S]*timeline-resizer/);
  assert.match(layoutCss, /\.workspace-resize-handle/);
  assert.match(layoutCss, /body\.is-resizing-workspace/);
  assert.match(responsiveCss, /max-width: 980px[\s\S]*\.workspace-resize-handle[\s\S]*display: none/);
});

test("workbench workspace layout clamp keeps panel sizes in range", async () => {
  const root = path.resolve(__dirname, "../..");
  const source = read(root, "Apps/Workbench/src/hooks/useResizableWorkspaceLayout.ts");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
  const exports = {};
  vm.runInNewContext(compiled.outputText, {
    exports,
    require: () => ({ useCallback: (value) => value, useEffect: () => undefined, useRef: (current) => ({ current }) }),
  });
  const { clampWorkspaceLayout } = exports;
  const grid = { getBoundingClientRect: () => ({ width: 1000 }) };

  const plain = (value) => JSON.parse(JSON.stringify(value));
  assert.deepEqual(plain(clampWorkspaceLayout({ left: 100, right: 100, timeline: 80 }, grid)), { left: 220, right: 260, timeline: 150 });
  assert.deepEqual(plain(clampWorkspaceLayout({ left: 900, right: 900, timeline: 900 }, grid)), { left: 308, right: 260, timeline: 360 });
  assert.deepEqual(plain(clampWorkspaceLayout({ left: 260, right: 320, timeline: 190 }, grid)), { left: 260, right: 308, timeline: 190 });
});
