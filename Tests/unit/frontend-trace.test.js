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

test("upload options and optional media tracks are visible in workbench UI", () => {
  const root = path.resolve(__dirname, "../..");
  const resource = read(root, "Apps/Workbench/src/components/ResourcePanel.tsx");
  const app = read(root, "Apps/Workbench/src/components/WorkbenchApp.tsx");
  const timeline = read(root, "Apps/Workbench/src/components/TimelinePanel.tsx");
  const property = read(root, "Apps/Workbench/src/components/PropertyPanel.tsx");
  const agentRunPanel = read(root, "Apps/Workbench/src/components/property-panel/AgentRunPanel.tsx");
  const formatters = read(root, "Apps/Workbench/src/components/property-panel/formatters.ts");
  const propertyCss = read(root, "Apps/Workbench/styles/property-panel.css");
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
  const shotBoundaryFlow = read(root, "Apps/Workbench/src/hooks/useShotBoundaryFlow.ts");
  const property = read(root, "Apps/Workbench/src/components/PropertyPanel.tsx");
  const agentRunPanel = read(root, "Apps/Workbench/src/components/property-panel/AgentRunPanel.tsx");
  const cacheDialog = read(root, "Apps/Workbench/src/components/CacheDecisionDialog.tsx");
  const threadpoolHtml = read(root, "Apps/Workbench/threadpool.html");
  const threadpoolEntry = read(root, "Apps/Workbench/src/threadpool.tsx");
  const threadpoolApp = read(root, "Apps/Workbench/src/components/ThreadPoolApp.tsx");
  const threadpoolCss = read(root, "Apps/Workbench/styles/threadpool.css");
  const api = read(root, "Apps/Workbench/src/api/client.ts");

  assert.match(vite, /threadpool: "Apps\/Workbench\/threadpool\.html"/);
  assert.match(vite, /isWorkbenchRoute\(pathname\)/);
  assert.match(vite, /"\/full-analysis"/);
  assert.match(vite, /"\/library"/);
  assert.match(vite, /"\/threadpool"/);
  assert.match(vite, /request\.url = "\/index\.html"/);
  assert.match(threadpoolHtml, /src="\/src\/threadpool\.tsx"/);
  assert.match(threadpoolEntry, /<ThreadPoolApp \/>/);
  assert.match(app, /setWorkbenchView\("threadpool", setActiveView\)/);
  assert.match(app, /<ThreadPoolApp embedded/);
  assert.match(app, /workspace-grid \$\{activeView === "workspace" \? "" : "is-hidden-view"\}/);
  assert.doesNotMatch(app, /href="http:\/\/127\.0\.0\.1:5177\/threadpool"/);
  assert.match(api, /\/api\/threadpool\/roles/);
  assert.match(api, /\/api\/threadpool\/threads\/\$\{encodeURIComponent\(threadId\)\}\/conversation/);
  assert.match(api, /\/api\/sample-videos\/\$\{encodeURIComponent\(sampleVideoId\)\}\/shot-boundary/);
  assert.match(api, /\/api\/processing-jobs\/\$\{encodeURIComponent\(jobId\)\}\/cache-decision/);
  assert.match(api, /cacheDecision: options\.cacheDecision \?\? "ask"/);
  assert.match(shotBoundaryFlow, /resolveShotBoundaryCacheDecision\(prompt\.jobId, "reuse"\)/);
  assert.match(shotBoundaryFlow, /resolveShotBoundaryCacheDecision\(prompt\.jobId, "refresh"\)/);
  assert.match(shotBoundaryFlow, /jobId: job\.jobId/);
  assert.match(shotBoundaryFlow, /cache_waiting|setShotCachePrompt/);
  assert.match(api, /resolveShotBoundaryCacheDecision/);
  assert.match(api, /resolveCacheDecision/);
  assert.match(threadpoolApp, /discardThreadPoolThread/);
  assert.match(threadpoolApp, /THREADPOOL_REFRESH_INTERVAL_MS = 2000/);
  assert.match(threadpoolApp, /window\.setInterval/);
  assert.match(threadpoolApp, /getThreadConversation/);
  assert.match(threadpoolApp, /\(detail\?\.threads \?\? \[\]\)\.filter\(\(thread\) => !thread\.seed\)/);
  assert.doesNotMatch(threadpoolApp, /thread\.seed \? "seed \/ " : ""/);
  assert.match(threadpoolApp, /replenishing/);
  assert.match(threadpoolApp, /查看对话/);
  assert.match(threadpoolApp, /ThreadConversationPanel/);
  assert.match(threadpoolApp, /window\.confirm/);
  assert.match(threadpoolCss, /\.threadpool-conversation-panel/);
  assert.match(threadpoolCss, /\.threadpool-conversation-block summary/);
  assert.match(property, /AgentRunPanel/);
  assert.match(agentRunPanel, /shot-boundary/);
  assert.match(property, /onRunShotBoundary/);
  assert.match(agentRunPanel, /renderResultOrigin/);
  assert.doesNotMatch(agentRunPanel, /repairAttemptCount/);
  assert.match(agentRunPanel, /ThreadPool 获取 lease 超时，Agent turn 未提交，可重试/);
  assert.match(cacheDialog, /发现切镜缓存/);
  assert.match(cacheDialog, /发现脚本段落缓存/);
  assert.match(cacheDialog, /fps \/ \{item\.shotCount \?\? "\?"\} 镜 \/ turn/);
  assert.match(agentRunPanel, /SHOT_BOUNDARY_GUARD_POLL_MS = 2000/);
  assert.match(agentRunPanel, /setTimeout\(\(\) => syncGuard\(false\), SHOT_BOUNDARY_GUARD_POLL_MS\)/);
  assert.match(agentRunPanel, /job\.stage === "shot\.boundary_transform\.thread_acquire"/);
  assert.match(agentRunPanel, /!jobTurnId/);
  assert.match(api, /\/api\/sample-videos\/\$\{encodeURIComponent\(sampleVideoId\)\}\/shot-boundary/);
});

test("workbench helper labels transform thread acquire as waiting lease", () => {
  const root = path.resolve(__dirname, "../..");
  const helpers = read(root, "Apps/Workbench/src/utils/workbenchHelpers.ts");

  assert.match(helpers, /"shot\.boundary_transform\.thread_acquire": "等待 Transform lease"/);
});

test("property panel treats processed passed single-shot data as valid unless it matches legacy fallback", () => {
  const root = path.resolve(__dirname, "../..");
  const formatters = read(root, "Apps/Workbench/src/components/property-panel/formatters.ts");
  const agentRunPanel = read(root, "Apps/Workbench/src/components/property-panel/AgentRunPanel.tsx");

  assert.match(formatters, /return shots\.length > 0;/);
  assert.match(agentRunPanel, /hasValidShotResult \? `\$\{analysis\.shots\.length\} 镜 \/ \$\{analysis\.boundaries\?\.length \?\? 0\} 边界` : "无有效切镜结果"/);
  assert.match(agentRunPanel, /analysis && !hasValidShotResult \? <div className="detail-hint">无有效切镜结果 \/ 需重新分析<\/div> : null/);
});

test("subtitle autosave uses queued save tokens and forwards revision preconditions", () => {
  const root = path.resolve(__dirname, "../..");
  const subtitleFlow = read(root, "Apps/Workbench/src/hooks/useSubtitleDraftFlow.ts");
  const api = read(root, "Apps/Workbench/src/api/client.ts");
  const types = read(root, "Apps/Workbench/src/types.ts");

  assert.match(subtitleFlow, /subtitleSaveQueueRef = useRef\(Promise\.resolve\(true\)\)/);
  assert.match(subtitleFlow, /subtitleSaveTokenRef = useRef\(0\)/);
  assert.match(subtitleFlow, /expectedSubtitleArtifactId: subtitles\.artifactId \?\? null/);
  assert.match(subtitleFlow, /expectedRevisionIndex: subtitles\.revisionIndex \?\? null/);
  assert.match(subtitleFlow, /code === "subtitle_revision_conflict"/);
  assert.match(subtitleFlow, /saveToken: draft\.saveToken \?\? null/);
  assert.match(api, /expectedSubtitleArtifactId: options\.expectedSubtitleArtifactId \?\? null/);
  assert.match(api, /expectedRevisionIndex: options\.expectedRevisionIndex \?\? null/);
  assert.match(types, /saveToken\?: number \| null;/);
  assert.match(types, /queuedAt\?: number \| null;/);
});

test("workbench exposes commerce brief summary and visible content profile inputs", () => {
  const root = path.resolve(__dirname, "../..");
  const property = read(root, "Apps/Workbench/src/components/PropertyPanel.tsx");
  const types = read(root, "Apps/Workbench/src/types.ts");
  const css = read(root, "Apps/Workbench/styles/property-panel.css");
  const roles = read(root, "Infrastructure/ThreadPool/thread_roles.json");

  assert.match(types, /commerceBrief\?: \{/);
  assert.match(types, /sellingObject: string;/);
  assert.match(css, /\.commerce-brief-panel/);
  assert.match(roles, /"script-segment-analyzer"/);
  assert.match(roles, /"script-segment-analyzer"[\s\S]*"min_idle": 3/);
  assert.doesNotMatch(property, /CommerceBriefPanel/);
});

test("workbench understand flow triggers script segment analysis", () => {
  const root = path.resolve(__dirname, "../..");
  const app = read(root, "Apps/Workbench/src/components/WorkbenchApp.tsx");
  const helpers = read(root, "Apps/Workbench/src/utils/workbenchHelpers.ts");
  const analysisFlow = read(root, "Apps/Workbench/src/hooks/useAnalysisJobFlow.ts");
  const api = read(root, "Apps/Workbench/src/api/client.ts");
  const server = read(root, "Apps/Api/server.js");
  const registry = read(root, "Apps/Api/lib/compatibility/analysis-role-registry.js");
  const index = read(root, "Infrastructure/ArtifactIndex/artifact-index.js");

  assert.match(app, /const handleUnderstand = useCallback\(async \(\) =>/);
  assert.match(app, /scriptSegmentFlow\.run\("ask"\)/);
  assert.match(analysisFlow, /runAnalysisRole/);
  assert.match(analysisFlow, /getAnalysisRole/);
  assert.match(app, /const handleUnderstand = useCallback\(async \(\) =>/);
  assert.match(helpers, /startAnalysisRole/);
  assert.match(helpers, /runAnalysisRole/);
  assert.match(helpers, /expectedShotBoundaryArtifactId: state\.sampleArtifact\?\.shotBoundaryAnalysis\?\.artifactId \?\? null/);
  assert.match(read(root, "Apps/Workbench/src/utils/analysisRoles.ts"), /"script_segment\.cache_lookup": "检查脚本段落缓存"/);
  assert.match(read(root, "Apps/Workbench/src/utils/analysisRoles.ts"), /"script_segment\.cache_reuse": "复用脚本段落缓存"/);
  assert.match(read(root, "Apps/Workbench/src/utils/analysisRoles.ts"), /"script_segment\.input_prepare": "准备脚本段落输入"/);
  assert.match(read(root, "Apps/Workbench/src/utils/analysisRoles.ts"), /"script_segment\.input_package": "生成脚本段落输入包"/);
  assert.match(read(root, "Apps/Workbench/src/utils/analysisRoles.ts"), /"script_segment\.repair": "修复脚本段落结果"/);
  assert.match(api, /getAnalysisRoles/);
  assert.match(api, /\/api\/sample-videos\/\$\{encodeURIComponent\(sampleVideoId\)\}\/analyses\/\$\{encodeURIComponent\(analysisId\)\}/);
  assert.match(api, /cacheDecision: options\.cacheDecision \?\? "ask"/);
  assert.match(api, /expectedShotBoundaryArtifactId: options\.expectedShotBoundaryArtifactId \?\? null/);
  assert.match(read(root, "Apps/Api/lib/modules/catalog.js"), /createScriptSegmentAnalysisDefinition/);
  assert.match(registry, /MODULE_DEFINITIONS\.filter\(\(definition\) => definition\.moduleKind === "structure-analysis"\)/);
  assert.match(read(root, "Apps/Api/lib/compatibility/analysis-role-definition.js"), /expectedShotBoundaryArtifactId: dependencies\.shotBoundaryArtifactId \?\? body\?\.expectedShotBoundaryArtifactId \?\? null/);
  assert.match(server, /\/api\/analysis-roles/);
  assert.match(server, /startLegacyAnalysis/);
  assert.match(server, /script-segments/);
  assert.match(index, /script_segment\.materialize/);
  assert.match(index, /"script-segment-analysis": "脚本段落"/);
});

test("workbench removes create input view entry", () => {
  const root = path.resolve(__dirname, "../..");
  const app = read(root, "Apps/Workbench/src/components/WorkbenchApp.tsx");
  const property = read(root, "Apps/Workbench/src/components/PropertyPanel.tsx");
  const view = read(root, "Apps/Workbench/src/utils/workbenchView.ts");

  assert.match(view, /"workspace" \| "full-analysis" \| "library" \| "threadpool"/);
  assert.doesNotMatch(view, /\/create/);
  assert.doesNotMatch(app, /创作输入/);
  assert.doesNotMatch(app, /CreateInputApp/);
  assert.doesNotMatch(property, /profile-form/);
});

test("property panel shows all shots and recent shot analysis history", () => {
  const root = path.resolve(__dirname, "../..");
  const propertyPanel = read(root, "Apps/Workbench/src/components/PropertyPanel.tsx");
  const property = read(root, "Apps/Workbench/src/components/property-panel/AgentRunPanel.tsx");
  const scriptPanel = read(root, "Apps/Workbench/src/components/property-panel/ScriptSegmentPanel.tsx");
  const rhythmPanel = read(root, "Apps/Workbench/src/components/property-panel/RhythmStructurePanel.tsx");
  const packagingPanel = read(root, "Apps/Workbench/src/components/property-panel/PackagingStructurePanel.tsx");
  const formatters = read(root, "Apps/Workbench/src/components/property-panel/formatters.ts");
  const app = read(root, "Apps/Workbench/src/components/WorkbenchApp.tsx");
  const css = read(root, "Apps/Workbench/styles/property-panel.css");
  const types = read(root, "Apps/Workbench/src/types.ts");

  assert.match(propertyPanel, /const \[activeTab, setActiveTab\] = useState<"shot" \| "script" \| "rhythm" \| "packaging" \| "atomization" \| "meta">\("shot"\)/);
  assert.match(propertyPanel, /role="tablist"/);
  assert.match(propertyPanel, /shot/);
  assert.match(propertyPanel, /script/);
  assert.match(propertyPanel, /节奏结构/);
  assert.match(propertyPanel, /包装结构/);
  assert.match(propertyPanel, /原子化/);
  assert.match(propertyPanel, /<PackagingStructurePanel/);
  assert.match(propertyPanel, /<FunctionSlotAtomizationPanel/);
  assert.match(packagingPanel, /agentName="packaging-structure"/);
  assert.match(packagingPanel, /整体包装/);
  assert.match(packagingPanel, /shotPackagingNotes/);
  assert.match(packagingPanel, /packagingBlocks/);
  assert.match(propertyPanel, /<ScriptSegmentPanel/);
  assert.match(propertyPanel, /<RhythmStructurePanel/);
  assert.doesNotMatch(property, /\.shots\.slice\(0, 12\)/);
  assert.match(property, /`\$\{analysis\.shots\.length\} 镜 \/ \$\{analysis\.boundaries\?\.length \?\? 0\} 边界`/);
  assert.match(property, /analysis\.shots\.map\(\(shot\) => \(/);
  assert.match(scriptPanel, /agentName="script-segment"/);
  assert.doesNotMatch(scriptPanel, /segmentCount：/);
  assert.doesNotMatch(scriptPanel, /resultOrigin：/);
  assert.doesNotMatch(scriptPanel, /cacheKey：/);
  assert.doesNotMatch(scriptPanel, /sourceTurn：/);
  assert.doesNotMatch(scriptPanel, /repairAttemptCount：/);
  assert.match(scriptPanel, /onSelectSegment/);
  assert.match(scriptPanel, /agent-script-meta/);
  assert.match(scriptPanel, /运行脚本段落分析|运行/);
  assert.match(rhythmPanel, /agentName="rhythm-structure"/);
  assert.doesNotMatch(rhythmPanel, /cardCount：/);
  assert.match(rhythmPanel, /sectionCount：/);
  assert.match(rhythmPanel, /rhythm-overview-panel/);
  assert.match(rhythmPanel, /整体节奏/);
  assert.doesNotMatch(rhythmPanel, /观感作用/);
  assert.doesNotMatch(rhythmPanel, /迁移规则/);
  assert.match(rhythmPanel, /analysis\.overview\.summary/);
  assert.match(rhythmPanel, /analysis\?\.sections/);
  assert.match(rhythmPanel, /rhythm-card-badge/);
  assert.doesNotMatch(rhythmPanel, /resultOrigin：/);
  assert.doesNotMatch(rhythmPanel, /cacheKey：/);
  assert.doesNotMatch(rhythmPanel, /sourceTurn：/);
  assert.doesNotMatch(rhythmPanel, /repairAttemptCount：/);
  assert.match(rhythmPanel, /onSelectCard/);
  assert.match(app, /currentShot=\{currentShot\}/);
  assert.match(app, /currentShotId=\{currentShotId\}/);
  assert.match(app, /scriptSegmentAnalysis=\{state\.sampleArtifact\?\.scriptSegmentAnalysis \?\? null\}/);
  assert.match(app, /scriptSegmentAnalysisHistory=\{state\.sampleArtifact\?\.scriptSegmentAnalysisHistory \?\? null\}/);
  assert.match(app, /scriptSegmentJob=\{scriptSegmentFlow\.job\}/);
  assert.match(app, /rhythmStructureJob=\{rhythmStructureFlow\.job\}/);
  assert.match(app, /packagingStructureAnalysis=\{state\.sampleArtifact\?\.packagingStructureAnalysis \?\? null\}/);
  assert.match(app, /packagingStructureAnalysisHistory=\{state\.sampleArtifact\?\.packagingStructureAnalysisHistory \?\? null\}/);
  assert.match(app, /packagingStructureJob=\{packagingStructureFlow\.job\}/);
  assert.match(app, /scriptSegmentFlow\.cachePrompt/);
  assert.match(app, /rhythmStructureFlow\.cachePrompt/);
  assert.match(app, /packagingStructureFlow\.cachePrompt/);
  assert.match(app, /onRunScriptSegment=\{/);
  assert.match(app, /onRunRhythmStructure=\{/);
  assert.match(app, /onRunPackagingStructure=\{/);
  assert.match(app, /onSelectScriptSegment=\{/);
  assert.match(app, /onSelectRhythmCard=\{/);
  assert.match(app, /onSelectPackagingBlock=\{/);
  assert.match(property, /aria-current=\{currentShotId === shot\.id \? "true" : undefined\}/);
  assert.match(property, /className=\{`agent-shot-item \$\{currentShotId === shot\.id \? "active" : ""\}`\}/);
  assert.match(property, /resolveShotSummary\(currentShot\)/);
  assert.match(property, /formatSecondsCompact\(currentShot\.start\)\} - \{formatSecondsCompact\(currentShot\.end\)/);
  assert.doesNotMatch(property, /resolveShotEndBoundaryReason/);
  assert.match(formatters, /shot\.summary \?\? shot\.reason/);
  assert.match(app, /shotBoundaryAnalysisHistory=\{state\.sampleArtifact\?\.shotBoundaryAnalysisHistory \?\? null\}/);
  assert.match(property, /historyEntries\.slice\(-5\)\.reverse\(\)\.map/);
  assert.match(property, /className=\{`agent-history-item \$\{analysis\?\.artifactId === entry\.artifactId \? "is-current" : ""\}`\}/);
  assert.match(css, /\.agent-shot-list[\s\S]*max-height: 220px;[\s\S]*overflow: auto;/);
  assert.match(css, /\.agent-shot-current/);
  assert.match(css, /\.agent-shot-item\.active,\s*[\s\S]*\.agent-shot-item\[aria-current="true"\]/);
  assert.match(css, /\.property-tabs/);
  assert.match(css, /flex: 0 0 clamp\(84px, 31%, 128px\)/);
  assert.match(css, /\.property-tab\.active,\s*[\s\S]*\.property-tab\[aria-selected="true"\]/);
  assert.match(css, /\.agent-shot-summary/);
  assert.match(css, /\.agent-history-list[\s\S]*max-height: 160px;[\s\S]*overflow: auto;/);
  assert.match(css, /\.agent-script-item/);
  assert.match(types, /shotBoundaryAnalysisHistory\?: ShotBoundaryAnalysisHistoryEntry\[] \| null;/);
  assert.match(types, /scriptSegmentAnalysisHistory\?: ScriptSegmentHistoryEntry\[] \| null;/);
  assert.match(types, /cacheKind\?: "sample" \| "shot_boundary" \| "script_segment" \| "rhythm_structure" \| "packaging_structure" \| "function_slot_atomization" \| string;/);
  assert.match(types, /segmentCount\?: number \| null;/);
  assert.match(types, /sectionCount\?: number \| null;/);
  assert.match(types, /cardCount\?: number \| null;/);
  assert.match(types, /sourceSegmentId: string;/);
  assert.match(types, /summary\?: string \| null;/);
  assert.match(types, /endBoundaryReason\?: string \| null;/);
  assert.match(types, /scriptSegmentAnalysis\?: ScriptSegmentArtifact \| null;/);
  assert.match(types, /rhythmStructureAnalysis\?: RhythmStructureArtifact \| null;/);
  assert.match(types, /packagingStructureAnalysis\?: PackagingStructureArtifact \| null;/);
});

test("agent cards show readable activity and timeline traces across agent turns", () => {
  const root = path.resolve(__dirname, "../..");
  const types = read(root, "Apps/Workbench/src/types.ts");
  const jobTypes = read(root, "Apps/Workbench/src/types/job.ts");
  const shotPanel = read(root, "Apps/Workbench/src/components/property-panel/AgentRunPanel.tsx");
  const scriptPanel = read(root, "Apps/Workbench/src/components/property-panel/ScriptSegmentPanel.tsx");
  const rhythmPanel = read(root, "Apps/Workbench/src/components/property-panel/RhythmStructurePanel.tsx");
  const packagingPanel = read(root, "Apps/Workbench/src/components/property-panel/PackagingStructurePanel.tsx");
  const atomizationPanel = read(root, "Apps/Workbench/src/components/property-panel/FunctionSlotAtomizationPanel.tsx");
  const timelinePanel = read(root, "Apps/Workbench/src/components/property-panel/AgentTurnTimeline.tsx");
  const css = read(root, "Apps/Workbench/styles/property-panel.css");

  assert.match(types, /activeThreadMessage\?: \{/);
  assert.match(types, /agentActivity\?: AgentActivitySummary \| null;/);
  assert.match(jobTypes, /export type AgentTimelineItem = \{/);
  assert.match(jobTypes, /latestMessagePreview: string \| null;/);
  assert.match(types, /agentRun\?: \{/);
  assert.match(shotPanel, /resolveActiveThreadMessage\(job\)/);
  assert.match(scriptPanel, /AgentTurnTimelinePanel/);
  assert.match(rhythmPanel, /AgentTurnTimelinePanel/);
  assert.match(packagingPanel, /AgentTurnTimelinePanel/);
  assert.match(atomizationPanel, /AgentTurnTimelinePanel/);
  assert.match(timelinePanel, /getAgentTurnTimeline\(threadId, turnId\)/);
  assert.match(timelinePanel, /setInterval\([\s\S]*2000/);
  assert.match(timelinePanel, /latestMessagePreview \?\? job\?\.activeThreadMessage\?\.text/);
  assert.match(shotPanel, /job\.status !== "processing"/);
  assert.doesNotMatch(scriptPanel, /!job\.agentRun\?\.threadId \|\| !job\.agentRun\?\.turnId/);
  assert.doesNotMatch(rhythmPanel, /!job\.agentRun\?\.threadId \|\| !job\.agentRun\?\.turnId/);
  assert.doesNotMatch(packagingPanel, /!job\.agentRun\?\.threadId \|\| !job\.agentRun\?\.turnId/);
  assert.doesNotMatch(shotPanel, /message\.turnId && message\.turnId !== job\.agentRun\.turnId/);
  assert.doesNotMatch(scriptPanel, /message\.turnId && message\.turnId !== job\.agentRun\.turnId/);
  assert.doesNotMatch(rhythmPanel, /message\.turnId && message\.turnId !== job\.agentRun\.turnId/);
  assert.doesNotMatch(packagingPanel, /message\.turnId && message\.turnId !== job\.agentRun\.turnId/);
  assert.match(shotPanel, /className="agent-thread-message"/);
  assert.match(timelinePanel, /className="agent-latest-activity"/);
  assert.match(timelinePanel, /className="agent-turn-timeline"/);
  assert.match(css, /\.agent-thread-message/);
  assert.match(css, /\.agent-summary-card/);
  assert.match(css, /\.agent-timeline-list/);
});

test("rhythm and packaging structure skills are registered as independent analyzers", () => {
  const root = path.resolve(__dirname, "../..");
  const rhythmSkill = read(root, ".agents/skills/rhythm-structure-analyzer/SKILL.md");
  const packagingSkill = read(root, ".agents/skills/packaging-structure-analyzer/SKILL.md");
  const rhythmRole = read(root, "Assets/RoleProfiles/rhythm-structure-analyzer/role.json");
  const packagingRole = read(root, "Assets/RoleProfiles/packaging-structure-analyzer/role.json");
  const roles = read(root, "Infrastructure/ThreadPool/thread_roles.json");
  const server = read(root, "Apps/Api/server.js");

  assert.match(rhythmSkill, /name: rhythm-structure-analyzer/);
  assert.match(rhythmSkill, /不重切 shot/);
  assert.match(packagingSkill, /name: packaging-structure-analyzer/);
  assert.doesNotMatch(packagingSkill, /占位版本/);
  assert.match(packagingSkill, /不依赖 `scriptSegmentAnalysis` 或 `rhythmStructureAnalysis`/);
  assert.match(packagingSkill, /subtitleText/);
  assert.match(packagingSkill, /subtitleContextText/);
  assert.match(packagingSkill, /visualRefs/);
  assert.match(rhythmRole, /"turnTemplates": \{/);
  assert.match(rhythmRole, /"analyze"/);
  assert.match(rhythmRole, /"repair"/);
  assert.doesNotMatch(packagingRole, /"status": "placeholder"/);
  assert.match(packagingRole, /"turnTemplates": \{/);
  assert.match(packagingRole, /"analyze"/);
  assert.match(packagingRole, /"repair"/);
  assert.match(roles, /rhythm-structure-analyzer/);
  assert.match(roles, /packaging-structure-analyzer/);
  assert.match(server, /rhythm-structure/);
  assert.match(server, /packaging-structure/);
});

test("findCurrentShot uses half-open ranges and keeps final boundary inclusive", async () => {
  const root = path.resolve(__dirname, "../..");
  const source = read(root, "Apps/Workbench/src/utils/workbenchHelpers.ts");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
  const exports = {};
  vm.runInNewContext(compiled.outputText, {
    exports,
    require: () => ({
      getLibraryItemDetail: async () => null,
      getProcessingJob: async () => null,
      getSampleArtifact: async () => null,
      getThreadPoolRoleStatus: async () => null,
      listAnalysisRoles: () => [],
      startAnalysisRole: async () => null,
      startRhythmStructureAnalysis: async () => null,
      startShotBoundaryAnalysis: async () => null,
      startScriptSegmentAnalysis: async () => null,
    }),
  });
  const { findCurrentShot } = exports;
  const shots = [
    { id: "shot_1", index: 0, start: 0, end: 1, representativeFrameId: "frame_1", confidence: 0.9, reason: "start" },
    { id: "shot_2", index: 1, start: 1, end: 2, representativeFrameId: "frame_2", confidence: 0.9, reason: "middle" },
    { id: "shot_3", index: 2, start: 2, end: 3, representativeFrameId: "frame_3", confidence: 0.9, reason: "end" },
  ];

  assert.equal(findCurrentShot(shots, 0.5)?.id, "shot_1");
  assert.equal(findCurrentShot(shots, 1)?.id, "shot_2");
  assert.equal(findCurrentShot(shots, 2)?.id, "shot_3");
  assert.equal(findCurrentShot(shots, 3)?.id, "shot_3");
  assert.equal(findCurrentShot(shots, 3.01), null);
});

test("appserver bridge and startup script use local agent runtime", () => {
  const root = path.resolve(__dirname, "../..");
  const bridge = read(root, "Apps/Api/lib/gateways/appserver/bridge.js");
  const bridgePy = read(root, "Apps/Api/lib/gateways/appserver/bridge.py");
  const legacyBridgePy = read(root, "Apps/Api/lib/appserver_bridge.py");
  const startup = read(root, "start-api-server.ps1");

  assert.match(bridge, /DEFAULT_PYTHON_RUNTIME_ROOT/);
  assert.match(bridge, /pythonRuntimeRoot = process\.env\.PYTHON_RUNTIME_ROOT \|\| DEFAULT_PYTHON_RUNTIME_ROOT/);
  assert.match(bridge, /async function readThread/);
  assert.match(bridgePy, /from agent_runtime\.appserver\.client import AppServerSessionClient/);
  assert.match(bridgePy, /if operation == "readThread"/);
  assert.match(bridgePy, /client\.read_thread\(str\(payload\["threadId"\]\), include_turns=True\)/);
  assert.match(bridgePy, /local_runtime_root/);
  assert.match(bridgePy, /structured_error\("appserver_bridge_failed"/);
  assert.match(bridgePy, /except Exception as exc:/);
  assert.match(legacyBridgePy, /gateways.*appserver.*bridge\.py/);
  assert.match(startup, /\$env:PYTHON_RUNTIME_ROOT/);
  assert.match(startup, /Join-Path \$env:PYTHON_RUNTIME_ROOT "scripts\\thread_pool_service\.py"/);
  assert.match(startup, /function Test-ThreadPoolReady/);
  assert.match(startup, /\[bool\]\$payload\.ok/);
  assert.match(startup, /thread_pool_service/);
  assert.doesNotMatch(startup, /return \[bool\]\$payload\.ready_for_leases/);
  assert.match(startup, /Resolve-CommandPathOrNull @\("codex\.cmd", "codex\.exe"\)/);
  assert.match(startup, /function Test-DirectStartCommandPath/);
  assert.match(startup, /"\.exe", "\.cmd", "\.bat", "\.com"/);
  assert.doesNotMatch(startup, /Resolve-CommandPathOrNull @\("codex\.exe", "codex", "codex\.cmd"\)/);
  assert.match(startup, /\$\(.*Spec\.Name.*\) ready in/);
  assert.doesNotMatch(startup, /THREADPOOL_ALLOWED_ROLES/);
  assert.equal(bridge.includes("cepRoot"), false);
  assert.equal(bridgePy.includes("cepRoot"), false);
});

test("appserver collect exposes active thread message without final residue", () => {
  const root = path.resolve(__dirname, "../..");
  const client = read(root, "Infrastructure/AgentRuntime/agent_runtime/appserver/client.py");
  const bridgePy = read(root, "Apps/Api/lib/gateways/appserver/bridge.py");
  const shotService = read(root, "Apps/Api/lib/shot-boundary/service.js");
  const scriptService = read(root, "Apps/Api/lib/script-segment/service.js");
  const shared = read(root, "Apps/Api/lib/compatibility/analysis-service-shared.js");

  assert.match(client, /active_thread_message: str \| None = None/);
  assert.match(client, /_turn_active_thread_messages/);
  assert.match(client, /_extract_turn_active_thread_message\(turn, status=status\)/);
  assert.match(client, /if not _is_non_terminal_turn_status\(status\):[\s\S]*_turn_active_thread_messages\.pop\(turn_id, None\)/);
  assert.match(bridgePy, /"activeThreadMessage": result\.active_thread_message/);
  assert.match(bridgePy, /"turnActivity": turn_activity/);
  assert.match(bridgePy, /def inspect_turn_activity\(client, payload\):/);
  assert.match(bridgePy, /"latestMessagePreview": snapshot\.latest_message_preview/);
  assert.match(bridgePy, /"activeThreadMessage": message\[:1200\]/);
  assert.match(shotService, /buildActiveThreadMessage\(threadId, turnId, message, status, options = \{\}\)/);
  assert.match(shotService, /String\(message \?\? ""\)\.trim\(\) \|\| String\(options\.fallbackMessage \?\? ""\)\.trim\(\)/);
  assert.match(shotService, /fallbackMessage: "正在分析镜头边界"/);
  assert.match(shared, /createAnalysisRuntimeV2/);
  const runtimeThread = read(root, "Apps/Api/lib/analysis-runtime-v2/thread-runtime.js");
  assert.match(runtimeThread, /buildActiveThreadMessage\(\s*turn\?\.threadId,\s*turn\?\.turnId,\s*turn\?\.activeThreadMessage,\s*turn\?\.status,\s*\)/);
  assert.match(shotService, /if \(normalized \|\| !isPendingTurnStatus\(status\)\)/);
  assert.match(runtimeThread, /buildAgentActivityFromTurnResult\(turn\)/);
  assert.match(runtimeThread, /if \(activeThreadMessage \|\| agentActivity \|\| !isPendingTurnStatus\(turn\?\.status\)\)/);
  const turnResult = read(root, "Infrastructure/AgentRuntime/agent_runtime/appserver/turn_result.py");
  const events = read(root, "Infrastructure/AgentRuntime/agent_runtime/appserver/events.py");
  assert.match(events, /latest_message_preview: str \| None = None/);
  assert.match(turnResult, /_summarize_latest_turn_activity_item\(items\)/);
  assert.match(turnResult, /"kind": "tool_result"/);
  assert.match(scriptService, /runtime\.updateActiveThreadMessage\(context, turn\)/);
  assert.match(shotService, /activeThreadMessage: null/);
  assert.match(scriptService, /activeThreadMessage: null/);
});

test("workbench api client safely parses empty and invalid JSON responses", () => {
  const root = path.resolve(__dirname, "../..");
  const client = read(root, "Apps/Workbench/src/api/client.ts");

  assert.match(client, /export async function readJsonResponse/);
  assert.match(client, /parseJsonResponse/);
  assert.match(client, /summarizeResponseText/);
  assert.match(client, /responseBodySnippet/);
  assert.match(client, /responseContentType/);
  assert.match(client, /API 返回了非 JSON 响应/);
});

test("workbench api client safely parses empty and invalid JSON responses", async () => {
  const root = path.resolve(__dirname, "../..");
  const source = read(root, "Apps/Workbench/src/api/client.ts");
  assert.match(source, /readJsonResponse/);
  assert.match(source, /parseJsonResponse/);
  assert.match(source, /summarizeResponseText/);
  assert.match(source, /responseBodySnippet/);
  assert.match(source, /responseContentType/);
  assert.match(source, /API 返回了非 JSON 响应/);
});

test("workbench workspace layout supports persisted splitters", () => {
  const root = path.resolve(__dirname, "../..");
  const app = read(root, "Apps/Workbench/src/components/WorkbenchApp.tsx");
  const hook = read(root, "Apps/Workbench/src/hooks/useResizableWorkspaceLayout.ts");
  const handle = read(root, "Apps/Workbench/src/components/WorkspaceResizeHandle.tsx");
  const splitHandle = read(root, "Apps/Workbench/src/components/SplitResizeHandle.tsx");
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
  assert.match(splitHandle, /role="separator"/);
  assert.match(splitHandle, /onDoubleClick=\{onReset\}/);
  assert.match(splitHandle, /ArrowRight/);
  assert.match(handle, /onReset=\{\(\) => onReset\(kind\)\}/);
  assert.match(layoutCss, /grid-template-areas:[\s\S]*left-resizer[\s\S]*right-resizer[\s\S]*timeline-resizer/);
  assert.match(layoutCss, /\.workspace-resize-handle/);
  assert.match(layoutCss, /body\.is-resizing-workspace/);
  assert.match(responsiveCss, /max-width: 980px[\s\S]*\.workspace-resize-handle[\s\S]*display: none/);
});

test("full analysis splitters control top row, row height, and bottom row independently", () => {
  const root = path.resolve(__dirname, "../..");
  const app = read(root, "Apps/Workbench/src/components/FullAnalysisApp.tsx");
  const api = read(root, "Apps/Workbench/src/api/client.ts");
  const draft = read(root, "Apps/Workbench/src/utils/fullAnalysisDraft.ts");
  const hook = read(root, "Apps/Workbench/src/hooks/useResizableGridLayout.ts");
  const css = read(root, "Apps/Workbench/styles/full-analysis.css");

  assert.match(app, /leftCssVar: "--full-analysis-left-width"/);
  assert.match(app, /topCssVar: "--full-analysis-top-height"/);
  assert.match(app, /bottomLeftCssVar: "--full-analysis-bottom-left-width"/);
  assert.match(app, /className="full-analysis-top-row"[\s\S]*layout\.startResize\("column", event\)/);
  assert.match(app, /className="workspace-resize-handle full-analysis-row-resizer"[\s\S]*layout\.startResize\("top-row", event\)/);
  assert.match(app, /className="full-analysis-bottom-row"[\s\S]*layout\.startResize\("bottom-row", event\)/);
  assert.match(app, /checkFullAnalysisUploadCache/);
  assert.match(app, /setUploadCachePrompt/);
  assert.match(app, /readFullAnalysisDraft/);
  assert.match(app, /writeFullAnalysisDraft/);
  assert.match(app, /getLatestFullAnalysisRun/);
  assert.match(app, /restoredRunRef/);
  assert.match(api, /\/api\/workflows\/full-analysis\/cache-check/);
  assert.match(api, /\/api\/workflows\/full-analysis\/latest/);
  assert.match(api, /cache: "no-store"/);
  assert.match(draft, /FULL_ANALYSIS_DRAFT_STORAGE_KEY = "full-analysis:last-run"/);
  assert.match(draft, /localStorage\.setItem\(FULL_ANALYSIS_DRAFT_STORAGE_KEY, JSON\.stringify/);
  assert.match(draft, /localStorage\.getItem\(FULL_ANALYSIS_DRAFT_STORAGE_KEY\)/);
  assert.match(css, /\.full-analysis-main \{[\s\S]*grid-template-rows: var\(--full-analysis-top-height/);
  assert.match(css, /\.full-analysis-shell \{[\s\S]*overflow: auto/);
  assert.match(css, /\.full-analysis-top-row \{[\s\S]*grid-template-columns: var\(--full-analysis-left-width/);
  assert.match(css, /\.full-analysis-bottom-row \{[\s\S]*grid-template-columns: var\(--full-analysis-bottom-left-width/);
  assert.match(hook, /if \(drag\.kind === "column"\) next\.left = drag\.startLayout\.left \+ event\.clientX - drag\.startX/);
  assert.match(hook, /if \(drag\.kind === "top-row"\) next\.top = drag\.startLayout\.top \+ event\.clientY - drag\.startY/);
  assert.match(hook, /if \(drag\.kind === "bottom-row"\) next\.bottomLeft = drag\.startLayout\.bottomLeft \+ event\.clientX - drag\.startX/);
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
