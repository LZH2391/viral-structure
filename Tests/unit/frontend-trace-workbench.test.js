const { test, assert, fs, path, vm, ts, read, readPropertyPanelCss } = require("./frontend-trace.helpers");

test("React workbench entry keeps uiTrace and backend trace boundaries", () => {
  const root = path.resolve(__dirname, "../..");
  const app = read(root, "Apps/Workbench/src/components/WorkbenchApp.tsx");
  const state = read(root, "Apps/Workbench/src/state.ts");
  const api = read(root, "Apps/Workbench/src/api/client.ts");
  const uiStage = read(root, "Apps/Workbench/src/observability/uiStage.ts");
  const stageLogger = read(root, "Apps/Workbench/src/hooks/useWorkbenchStageLogger.ts");

  assert.match(state, /uiTraceId: createId\("uiTrace"\)/);
  assert.match(state, /ingest: "sample\.ingest"/);
  assert.match(state, /understand: "sample\.understand"/);
  assert.match(state, /scriptSegmentAnalyze: "script\.segment\.analyze"/);
  assert.match(state, /rhythmStructureAnalyze: "rhythm\.structure\.analyze"/);
  assert.doesNotMatch(state, /structure\.transfer/);
  assert.match(app, /uiTraceId: state\.uiTraceId/);
  assert.match(app, /backendTraceId: state\.processingJob\?\.traceId/);
  assert.match(app, /useWorkbenchStageLogger/);
  assert.match(stageLogger, /beginUiStage/);
  assert.match(uiStage, /createId\("run"\)/);
  assert.match(uiStage, /backendTraceId: stage\.backendTraceId \?\? null/);
  assert.doesNotMatch(app, /traceId: state\.workspace\.id/);
  assert.match(api, /\/api\/workspaces\/\$\{WORKSPACE_ID\}\/sample-videos/);
  assert.match(api, /\/api\/processing-jobs\/\$\{jobId\}/);
  assert.match(api, /\/api\/debug\/ui-events/);
});

test("full analysis sync keeps atomization job independent and labels trace layers", () => {
  const root = path.resolve(__dirname, "../..");
  const app = read(root, "Apps/Workbench/src/components/WorkbenchApp.tsx");
  const full = read(root, "Apps/Workbench/src/components/FullAnalysisApp.tsx");
  const fullStageStep = read(root, "Apps/Workbench/src/components/full-analysis/FullAnalysisStageStep.tsx");
  const fullState = read(root, "Apps/Workbench/src/components/full-analysis/fullAnalysisState.ts");
  const workflowTypes = read(root, "Apps/Workbench/src/types/workflow.ts");
  const draft = read(root, "Apps/Workbench/src/utils/fullAnalysisDraft.ts");

  assert.match(workflowTypes, /"cache_waiting"/);
  assert.match(app, /activeSampleRevision/);
  assert.match(app, /activeSampleSource/);
  assert.match(app, /functionSlotAtomizationFlow\.setJob\(atomizationJob\)/);
  assert.match(app, /if \(atomizationJob\) writeActiveAnalysisJob\("functionSlotAtomization", toActiveJobDraft\(atomizationJob\)\)/);
  assert.match(full, /workflow trace/);
  assert.match(fullStageStep, /child trace/);
  assert.match(full, /operationTokenRef/);
  assert.match(fullState, /NON_EXECUTING_RUN_STATUS/);
  assert.match(draft, /activeSampleRevision/);
  assert.match(draft, /activeSampleSource/);
});

test("embedded full analysis preserves running workflow during workbench artifact sync", () => {
  const root = path.resolve(__dirname, "../..");
  const full = read(root, "Apps/Workbench/src/components/FullAnalysisApp.tsx");

  assert.match(full, /function shouldPreserveActiveWorkflow/);
  assert.match(full, /activeSample\.activeSampleSource === "fullAnalysis"/);
  assert.match(full, /return isRunExecuting\(run\)/);
  assert.match(full, /const shouldPreserveWorkflow = shouldPreserveActiveWorkflow\(run, activeSample\)/);
  assert.match(full, /if \(!shouldPreserveWorkflow\) \{\s*operationTokenRef\.current \+= 1;/);
  assert.match(full, /setRun\(\(current\) => shouldPreserveActiveWorkflow\(current, activeSample\) \? current : null\)/);
  assert.match(full, /if \(!shouldPreserveWorkflow\) setChildJobs\(\{\}\)/);
  assert.match(full, /shouldPreserveWorkflow[\s\S]*startPolling\(run\.workflowRunId, operationTokenRef\.current\)/);
});

test("full analysis includes optional atomization stage and cache surface", () => {
  const root = path.resolve(__dirname, "../..");
  const full = read(root, "Apps/Workbench/src/components/FullAnalysisApp.tsx");
  const api = read(root, "Apps/Workbench/src/api/client.ts");
  const descriptor = read(root, "Apps/Api/lib/workflows/full-analysis/descriptor.js");
  const atomizationDefinition = read(root, "Apps/Api/lib/function-slot-atomization/analysis-definition.js");
  const atomizationCache = read(root, "Apps/Api/lib/function-slot-atomization/cache.js");

  assert.match(full, /enableFunctionSlotAtomization/);
  assert.match(full, /functionSlotAtomization/);
  assert.match(full, /label="原子化"/);
  assert.match(api, /enableFunctionSlotAtomization/);
  assert.match(descriptor, /moduleId: "function-slot-atomization"/);
  assert.match(descriptor, /optionalFlag: "enableFunctionSlotAtomization"/);
  assert.match(atomizationDefinition, /cacheKind: "function_slot_atomization"/);
  assert.match(atomizationDefinition, /supportsCacheReuse: true/);
  assert.match(atomizationCache, /function_slot_atomization/);
  assert.match(atomizationCache, /sourceScriptSegmentArtifactId/);
});

test("analysis cache decision keeps runId separate from traceId", () => {
  const root = path.resolve(__dirname, "../..");
  const roleService = read(root, "Apps/Api/lib/analysis-runtime-v2/role-service.js");

  assert.doesNotMatch(roleService, /runId: job\.traceId/);
  assert.match(roleService, /runId: job\.runId \?\? `run_cache_decision_/);
  assert.match(roleService, /traceId: job\.traceId/);
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
  const uploadFlow = read(root, "Apps/Workbench/src/hooks/useWorkbenchUploadFlow.ts");
  const jobPolling = read(root, "Apps/Workbench/src/hooks/jobPolling.ts");
  const state = read(root, "Apps/Workbench/src/state.ts");
  const draft = read(root, "Apps/Workbench/src/utils/workbenchDraft.ts");

  assert.match(app, /useWorkbenchUploadFlow/);
  assert.match(uploadFlow, /const uploadTokenRef = useRef\(0\)/);
  assert.match(uploadFlow, /if \(token !== uploadTokenRef\.current\) return/);
  assert.match(uploadFlow, /readWorkbenchDraft/);
  assert.match(uploadFlow, /getSampleArtifact\(sampleVideoId\)/);
  assert.match(uploadFlow, /setSaveStatus\("已同步最新样例"\)/);
  assert.match(uploadFlow, /resolveDraftDerivativeId/);
  assert.match(uploadFlow, /pollProcessingJob/);
  assert.match(jobPolling, /stopOnNull\?: boolean/);
  assert.match(draft, /localStorage\.setItem\(WORKBENCH_DRAFT_STORAGE_KEY, JSON\.stringify\(value\)\)/);
  assert.match(draft, /localStorage\.getItem\(WORKBENCH_DRAFT_STORAGE_KEY\)/);
  assert.match(state, /type: "restore-draft"/);
  assert.match(state, /case "set-shot-boundary-analysis":[\s\S]*return applySampleArtifact\(state, action\.artifact\)/);
  assert.match(state, /sampleArtifact: SampleArtifact/);
  assert.match(state, /activeUploadJob/);
  assert.match(state, /activeAgentJob/);
});

test("timeline selection and zoom avoid high-frequency full rerenders", () => {
  const root = path.resolve(__dirname, "../..");
  const timeline = read(root, "Apps/Workbench/src/components/TimelinePanel.tsx");
  const metrics = read(root, "Apps/Workbench/src/utils/timeline.ts");
  const app = read(root, "Apps/Workbench/src/components/WorkbenchApp.tsx");
  const playbackSync = read(root, "Apps/Workbench/src/hooks/useWorkbenchPlaybackSync.ts");
  const helpers = read(root, "Apps/Workbench/src/utils/workbenchHelpers.ts");

  assert.match(timeline, /onBlur=\{\(\) => onVisibleSecondsChange\(clampVisibleSeconds\(draftSeconds\)\)\}/);
  assert.doesNotMatch(timeline, /onChange=\{\(event\) => onVisibleSecondsChange/);
  assert.match(metrics, /export const MAX_RENDERED_FRAMES = 80/);
  assert.match(metrics, /function shouldAppendEndTick/);
  assert.match(app, /lastSegmentIdRef/);
  assert.match(app, /lastShotIdRef/);
  assert.match(app, /useWorkbenchPlaybackSync/);
  assert.match(playbackSync, /video\.addEventListener\("seeked", onSeeked\)/);
  assert.match(playbackSync, /video\.addEventListener\("loadedmetadata", onLoadedMetadata\)/);
  assert.match(playbackSync, /findCurrentShot/);
  assert.match(helpers, /currentTime >= shot\.start && \(isLastShot \? currentTime <= shot\.end : currentTime < shot\.end\)/);
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
  assert.match(hook, /MAX_MAIN_THREAD_DECODE_SECONDS = 90/);
  assert.match(hook, /mainThreadDecodeSkipped: true/);
  assert.match(hook, /new AbortController\(\)/);
  assert.match(hook, /fetch\(url, \{ signal \}\)/);
  assert.match(hook, /result\.cancelled/);
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
  const sharedRows = read(root, "Apps/Workbench/src/components/property-panel/SharedRows.tsx");
  const format = read(root, "Apps/Workbench/src/utils/format.ts");

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
  assert.match(sharedRows, /label="分辨率"/);
  assert.match(sharedRows, /label="媒体类型"/);
  assert.match(format, /export function formatSecondsCompact/);
  assert.match(format, /return `\$\{text\}s`/);
});

test("audio feature display keeps only sfx candidate markers", () => {
  const root = path.resolve(__dirname, "../..");
  const timeline = read(root, "Apps/Workbench/src/components/TimelinePanel.tsx");
  const preview = read(root, "Apps/Workbench/src/components/PreviewPanel.tsx");
  const formatters = read(root, "Apps/Workbench/src/components/property-panel/formatters.ts");
  const helpers = read(root, "Apps/Workbench/src/utils/workbenchHelpers.ts");

  for (const source of [timeline, preview, formatters, helpers]) {
    assert.match(source, /candidate\.kind === "sfx_candidate"/);
    assert.doesNotMatch(source, /candidate\.kind === "strong_cut_candidate"/);
    assert.doesNotMatch(source, /`beat_\$\{index\}_\$\{time\}`/);
    assert.doesNotMatch(source, /`onset_\$\{index\}_\$\{time\}`/);
  }
});

test("upload options and optional media tracks are visible in workbench UI", () => {
  const root = path.resolve(__dirname, "../..");
  const resource = read(root, "Apps/Workbench/src/components/ResourcePanel.tsx");
  const app = read(root, "Apps/Workbench/src/components/WorkbenchApp.tsx");
  const timeline = read(root, "Apps/Workbench/src/components/TimelinePanel.tsx");
  const property = read(root, "Apps/Workbench/src/components/PropertyPanel.tsx");
  const agentRunPanel = read(root, "Apps/Workbench/src/components/property-panel/AgentRunPanel.tsx");
  const formatters = read(root, "Apps/Workbench/src/components/property-panel/formatters.ts");
  const propertyCss = readPropertyPanelCss(root);
  const api = read(root, "Apps/Workbench/src/api/client.ts");

  assert.match(app, /DEFAULT_FRAME_SAMPLE_RATE_FPS = 10/);
  assert.match(app, /useState\(DEFAULT_FRAME_SAMPLE_RATE_FPS\)/);
  assert.match(app, /DEFAULT_ANALYSIS_FPS = 10/);
  assert.match(app, /useState\(DEFAULT_ANALYSIS_FPS\)/);
  assert.match(app, /const \[enableAudioSeparation, setEnableAudioSeparation\] = useState\(true\)/);
  assert.match(app, /const \[enableSubtitleRecognition, setEnableSubtitleRecognition\] = useState\(true\)/);
  assert.match(app, /const \[enableAudioFeatureAnalysis, setEnableAudioFeatureAnalysis\] = useState\(true\)/);
  assert.match(api, /\/api\/capabilities/);
  assert.match(api, /enableAudioSeparation/);
  assert.match(api, /enableSubtitleRecognition/);
  assert.match(api, /enableAudioFeatureAnalysis/);
  assert.match(resource, /enableAudioSeparationInput/);
  assert.match(resource, /enableAudioFeatureAnalysisInput/);
  assert.match(resource, /DOUBAO_Api_App_Key/);
  assert.match(timeline, /id="subtitleTrack"/);
  assert.match(timeline, /audioSeparation/);
  assert.match(timeline, /audio-feature-marker/);
  assert.match(timeline, /buildEnergyFrameIndex/);
  assert.match(timeline, /findNearestEnergyFrame/);
  assert.match(property, /MetaInfoPanel/);
  assert.match(property, /selectedSubtitleId=\{props\.selectedSubtitleId\}/);
  assert.match(read(root, "Apps/Workbench/src/components/property-panel/MetaInfoPanel.tsx"), /当前字幕/);
  assert.match(read(root, "Apps/Workbench/src/components/property-panel/MetaInfoPanel.tsx"), /字幕时间/);
  assert.match(read(root, "Apps/Workbench/src/components/property-panel/MetaInfoPanel.tsx"), /字幕句级/);
  assert.match(agentRunPanel, /1 fps 推荐：普通口播、生活记录、稳定剪辑/);
  assert.match(agentRunPanel, /2-3 fps 推荐：动作快、转场多、镜头变化密的视频/);
  assert.match(agentRunPanel, /4-10 fps 推荐：高频动作、快速闪切、需要更细切分的视频/);
  assert.match(agentRunPanel, /step="1"/);
  assert.match(agentRunPanel, /分析采样率必须是 1 到 10 之间的整数/);
  assert.match(agentRunPanel, /采样率越高，图片越多，分析更细但耗时更久/);
  assert.match(app, /const \[enableShotBoundaryReview, setEnableShotBoundaryReview\] = useState\(true\)/);
  assert.match(api, /enableReview: options\.enableReview \?\? true/);
  assert.match(agentRunPanel, /Transform/);
  assert.match(agentRunPanel, /checked=\{enableReview\}/);
  assert.match(agentRunPanel, /disabled=\{running\}/);
  assert.match(agentRunPanel, /enableReview \? "开启" : "关闭"/);
  assert.match(agentRunPanel, /预计分析：目标 \{formatFpsValue\(samplingPreview\.requestedFps\)\} fps \/ 约 \{samplingPreview\.selectedFrameCount\} 帧 \/ 最近不重复取帧/);
  assert.doesNotMatch(agentRunPanel, /requestedAnalysisFps：/);
  assert.doesNotMatch(agentRunPanel, /effectiveAnalysisFps：/);
  assert.doesNotMatch(agentRunPanel, /selectionPolicy：/);
  assert.doesNotMatch(agentRunPanel, /roundingPolicy：/);
  assert.match(agentRunPanel, /CommerceBriefPanel/);
  assert.match(agentRunPanel, /带货总结/);
  assert.doesNotMatch(agentRunPanel, /结果摘要/);
  assert.match(agentRunPanel, /卖什么/);
  assert.match(formatters, /target_grid_nearest_unique/);
  assert.match(formatters, /isLegacyStride: false/);
  assert.match(app, /normalizeAnalysisFps/);
  assert.match(agentRunPanel, /shot\.shotNo \?\?/);
  assert.match(propertyCss, /\.agent-sampling-preview/);
  assert.match(propertyCss, /\.shot-commerce-brief/);
  assert.match(propertyCss, /grid-template-columns: 44px minmax\(0, 1fr\)/);
});
