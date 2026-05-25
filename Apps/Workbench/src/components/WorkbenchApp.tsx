import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { createInitialState, type WorkbenchAction, workbenchReducer } from "../state";
import type { AudioFeatureMarker, SampleArtifact, WorkbenchState } from "../types";
import { shortId } from "../utils/format";
import { clampVisibleSeconds } from "../utils/timeline";
import { getSampleArtifact, resolveCacheDecision } from "../api/client";
import { findAudioFeatureMarker, resolveAudioFeatureSourceId } from "../utils/workbenchHelpers";
import { readWorkbenchDraft, writeWorkbenchDraft } from "../utils/workbenchDraft";
import { initialViewFromPath, setWorkbenchView, type WorkbenchView } from "../utils/workbenchView";
import { useWorkbenchPlaybackSync } from "../hooks/useWorkbenchPlaybackSync";
import { useAnalysisJobFlow } from "../hooks/useAnalysisJobFlow";
import { useResizableWorkspaceLayout } from "../hooks/useResizableWorkspaceLayout";
import { useWorkbenchStageLogger } from "../hooks/useWorkbenchStageLogger";
import { useWorkbenchUploadFlow } from "../hooks/useWorkbenchUploadFlow";
import { useShotBoundaryFlow } from "../hooks/useShotBoundaryFlow";
import { useSubtitleDraftFlow } from "../hooks/useSubtitleDraftFlow";
import { buildRunStatus, normalizeAnalysisFps } from "./workbenchRunStatus";
import { CacheDecisionDialog } from "./CacheDecisionDialog";
import { DebugApp } from "./DebugApp";
import { LibraryApp } from "./LibraryApp";
import { PreviewPanel } from "./PreviewPanel";
import { PropertyPanel } from "./PropertyPanel";
import { ResourcePanel } from "./ResourcePanel";
import { RunStatusBar } from "./RunStatusBar";
import { ThreadPoolApp } from "./ThreadPoolApp";
import { TimelinePanel } from "./TimelinePanel";
import { WorkspaceResizeHandle } from "./WorkspaceResizeHandle";

type AudioSeekRequest = { requestId: number; time: number };

const MIN_ANALYSIS_FPS = 1;
const MAX_ANALYSIS_FPS = 10;
const DEFAULT_FRAME_SAMPLE_RATE_FPS = 10;
const DEFAULT_ANALYSIS_FPS = 10;

export function WorkbenchApp() {
  const [state, dispatch] = useReducer(workbenchReducer, undefined, createInitialState);
  const [frameSampleRate, setFrameSampleRate] = useState(DEFAULT_FRAME_SAMPLE_RATE_FPS);
  const [enableAudioSeparation, setEnableAudioSeparation] = useState(true);
  const [enableSubtitleRecognition, setEnableSubtitleRecognition] = useState(true);
  const [enableAudioFeatureAnalysis, setEnableAudioFeatureAnalysis] = useState(true);
  const [saveStatus, setSaveStatus] = useState("本地草稿");
  const [audioSeekRequest, setAudioSeekRequest] = useState<AudioSeekRequest | null>(null);
  const [agentAnalysisFps, setAgentAnalysisFps] = useState(DEFAULT_ANALYSIS_FPS);
  const [enableShotBoundaryReview, setEnableShotBoundaryReview] = useState(true);
  const [activeView, setActiveView] = useState<WorkbenchView>(() => initialViewFromPath());
  const audioSeekRequestIdRef = useRef(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const miniCanvasRef = useRef<HTMLCanvasElement>(null);
  const workspaceGridRef = useRef<HTMLElement>(null);
  const lastSegmentIdRef = useRef<string | null>(null);
  const lastShotIdRef = useRef<string | null>(null);
  const workspaceLayout = useResizableWorkspaceLayout(workspaceGridRef);
  const shotBoundaryAnalysis = state.sampleArtifact?.shotBoundaryAnalysis ?? null;

  const persistWorkbenchArtifact = useCallback((artifact: SampleArtifact, traceId: string | null) => {
    writeWorkbenchDraft({
      sampleVideoId: artifact.sampleVideoId,
      artifactId: artifact.sampleVideo.artifactId,
      traceId,
      sampleArtifact: artifact,
      selectedFrameId: artifact.frames[0]?.frameId ?? null,
      selectedDerivativeId: artifact.sampleVideo.normalized.artifactId,
      versions: state.versions,
    });
  }, [state.versions]);

  const stageLogger = useWorkbenchStageLogger({
    uiTraceId: state.uiTraceId,
    backendTraceId: state.processingJob?.traceId ?? null,
    dispatch,
  });

  const uploadFlow = useWorkbenchUploadFlow({
    state,
    dispatch,
    frameSampleRate,
    enableAudioSeparation,
    enableSubtitleRecognition,
    enableAudioFeatureAnalysis,
    persistWorkbenchArtifact,
    setSaveStatus,
    beginStage: stageLogger.beginStage,
    finishStage: stageLogger.finishStage,
    failStage: stageLogger.failStage,
  });

  const shotBoundaryFlow = useShotBoundaryFlow({
    state,
    dispatch,
    agentAnalysisFps,
    enableReview: enableShotBoundaryReview,
    setSaveStatus,
    uploadTokenRef: uploadFlow.uploadTokenRef,
  });

  const subtitleDraftFlow = useSubtitleDraftFlow({
    state,
    dispatch,
    persistWorkbenchArtifact,
    setSaveStatus,
    beginStage: stageLogger.beginStage,
    finishStage: stageLogger.finishStage,
    failStage: stageLogger.failStage,
  });

  const scriptSegmentFlow = useAnalysisJobFlow({
    kind: "scriptSegment",
    state,
    dispatch,
    persistWorkbenchArtifact,
    setSaveStatus,
    uploadTokenRef: uploadFlow.uploadTokenRef,
  });

  const rhythmStructureFlow = useAnalysisJobFlow({
    kind: "rhythmStructure",
    state,
    dispatch,
    persistWorkbenchArtifact,
    setSaveStatus,
    uploadTokenRef: uploadFlow.uploadTokenRef,
  });

  const { currentTime, setCurrentTime, currentCard, currentShot } = useWorkbenchPlaybackSync({
    videoRef,
    structureCards: state.structureCards,
    shotBoundaryAnalysis,
    lastSegmentIdRef,
    lastShotIdRef,
  });

  const currentShotId = currentShot?.id ?? null;
  const runStatus = buildRunStatus(state);

  useEffect(() => {
    const restoreJobs = async () => {
      const shotDraft = await shotBoundaryFlow.restoreDraft();
      if (shotDraft) setAgentAnalysisFps(normalizeAnalysisFps(shotDraft.analysisFps ?? DEFAULT_ANALYSIS_FPS, MIN_ANALYSIS_FPS, MAX_ANALYSIS_FPS));
      if (shotDraft) setEnableShotBoundaryReview(shotDraft.enableReview ?? true);
      const draft = readWorkbenchDraft();
      await scriptSegmentFlow.attachDraftJob(draft?.activeScriptSegmentJob).catch(() => setSaveStatus("恢复脚本段落任务失败"));
      await rhythmStructureFlow.attachDraftJob(draft?.activeRhythmStructureJob).catch(() => setSaveStatus("恢复节奏结构任务失败"));
    };
    void restoreJobs();
  }, [rhythmStructureFlow, scriptSegmentFlow, setSaveStatus, shotBoundaryFlow]);

  const handleUnderstand = useCallback(async () => {
    if (!state.sampleVideo || !state.sampleArtifact?.shotBoundaryAnalysis?.shots?.length) return null;
    const stage = stageLogger.beginStage(STAGES.scriptSegmentAnalyze, state.sampleArtifact.shotBoundaryAnalysis.artifactId, {
      sampleVideoId: state.sampleVideo.id,
      sourceShotBoundaryArtifactId: state.sampleArtifact.shotBoundaryAnalysis.artifactId,
      shotCount: state.sampleArtifact.shotBoundaryAnalysis.shots.length,
    });
    try {
      const result = await scriptSegmentFlow.run("ask");
      if (!result?.artifact?.scriptSegmentAnalysis) throw new Error("脚本段落分析未返回有效产物");
      scriptSegmentFlow.applyCompletedArtifact(result.artifact, result.job.traceId ?? state.processingJob?.traceId ?? null, "结构理解完成");
      stageLogger.finishStage(stage, result.artifact.scriptSegmentAnalysis.artifactId, {
        segmentCount: result.artifact.scriptSegmentAnalysis.segments.length,
        validatorCode: result.artifact.scriptSegmentAnalysis.validation?.validatorCode ?? null,
      });
      return result.artifact;
    } catch (error) {
      scriptSegmentFlow.setJob(null);
      stageLogger.failStage(stage, error, {
        errorCode: (error as { code?: string })?.code,
        errorMessage: error instanceof Error ? error.message : "脚本段落分析失败",
        errorStage: STAGES.scriptSegmentAnalyze,
        backendTraceId: scriptSegmentFlow.job?.traceId ?? state.processingJob?.traceId ?? null,
        debugPayload: { kind: "script-segment-failure", sampleVideoId: state.sampleVideo.id },
      });
      throw error;
    }
  }, [scriptSegmentFlow, stageLogger, state]);

  const handleRhythmStructure = useCallback(async () => {
    if (!state.sampleVideo || !state.sampleArtifact?.shotBoundaryAnalysis?.shots?.length) return null;
    const stage = stageLogger.beginStage(STAGES.rhythmStructureAnalyze, state.sampleArtifact.shotBoundaryAnalysis.artifactId, {
      sampleVideoId: state.sampleVideo.id,
      sourceShotBoundaryArtifactId: state.sampleArtifact.shotBoundaryAnalysis.artifactId,
      shotCount: state.sampleArtifact.shotBoundaryAnalysis.shots.length,
    });
    try {
      const result = await rhythmStructureFlow.run("ask");
      if (!result?.artifact?.rhythmStructureAnalysis) throw new Error("节奏结构分析未返回有效产物");
      rhythmStructureFlow.applyCompletedArtifact(result.artifact, result.job.traceId ?? state.processingJob?.traceId ?? null, "节奏结构完成");
      stageLogger.finishStage(stage, result.artifact.rhythmStructureAnalysis.artifactId, {
        sectionCount: result.artifact.rhythmStructureAnalysis.sections.length,
        validatorCode: result.artifact.rhythmStructureAnalysis.validation?.validatorCode ?? null,
      });
      return result.artifact;
    } catch (error) {
      rhythmStructureFlow.setJob(null);
      stageLogger.failStage(stage, error, {
        errorCode: (error as { code?: string })?.code,
        errorMessage: error instanceof Error ? error.message : "节奏结构分析失败",
        errorStage: STAGES.rhythmStructureAnalyze,
        backendTraceId: rhythmStructureFlow.job?.traceId ?? state.processingJob?.traceId ?? null,
        debugPayload: { kind: "rhythm-structure-failure", sampleVideoId: state.sampleVideo.id },
      });
      throw error;
    }
  }, [rhythmStructureFlow, stageLogger, state]);

  const handleSelectAudioFeature = useCallback((marker: AudioFeatureMarker) => {
    dispatch({ type: "select-media", activeMediaKind: "audioFeature", selectedDerivativeId: resolveAudioFeatureSourceId(state), selectedFrameId: null, selectedAudioFeatureMarkerId: marker.id });
    audioSeekRequestIdRef.current += 1;
    setAudioSeekRequest({ requestId: audioSeekRequestIdRef.current, time: marker.time });
  }, [state]);

  const handleSelectTimelineTime = useCallback((time: number) => {
    if (videoRef.current) videoRef.current.currentTime = time;
    setCurrentTime(time);
    dispatch({ type: "select-media", activeMediaKind: "video", selectedDerivativeId: state.sampleVideo?.artifactId ?? state.selectedDerivativeId, selectedFrameId: null });
  }, [setCurrentTime, state]);

  const fileLabel = state.isUploadingSample
    ? `${state.uploadStatusText ?? "处理中"} ${state.processingJob ? `${state.processingJob.progress}%` : ""}`.trim()
    : state.sampleVideo?.fileName ?? "未选择文件";

  const processingText = state.processingJob
    ? `${state.uploadStatusText ?? state.processingJob.stage} / ${state.processingJob.progress}%`
    : "未加载样例";

  const traceText = state.processingJob?.traceId ? `trace ${shortId(state.processingJob.traceId)}` : "等待后端返回 trace";

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="project-block">
          <div className="project-name">结构迁移工作台</div>
          <div id="saveStatus" className="save-status">
            {saveStatus}
          </div>
        </div>
        <RunStatusBar label={runStatus.label} backendTraceId={state.processingJob?.traceId ?? runStatus.backendTraceId} uiTraceId={state.uiTraceId} stageId={runStatus.stageId} />
        <div className="top-actions">
          <button className={`tab-button ${activeView === "library" ? "active" : ""}`} type="button" onClick={() => setWorkbenchView("library", setActiveView)}>
            处理库
          </button>
          <button className={`tab-button ${activeView === "debug" ? "active" : ""}`} type="button" onClick={() => setWorkbenchView("debug", setActiveView)}>
            运行追踪
          </button>
          <button className={`tab-button ${activeView === "threadpool" ? "active" : ""}`} type="button" onClick={() => setWorkbenchView("threadpool", setActiveView)}>
            ThreadPool
          </button>
          <button className="ghost-button" type="button" disabled>
            导出
          </button>
        </div>
      </header>
      <main ref={workspaceGridRef} className={`workspace-grid ${activeView === "workspace" ? "" : "is-hidden-view"}`} aria-hidden={activeView !== "workspace"}>
        <ResourcePanel
          fileLabel={fileLabel}
          isUploading={state.isUploadingSample}
          frameSampleRate={frameSampleRate}
          capabilities={uploadFlow.capabilities}
          enableAudioSeparation={enableAudioSeparation}
          enableSubtitleRecognition={enableSubtitleRecognition}
          enableAudioFeatureAnalysis={enableAudioFeatureAnalysis}
          onFrameSampleRateChange={setFrameSampleRate}
          onEnableAudioSeparationChange={setEnableAudioSeparation}
          onEnableSubtitleRecognitionChange={setEnableSubtitleRecognition}
          onEnableAudioFeatureAnalysisChange={setEnableAudioFeatureAnalysis}
          onUpload={uploadFlow.handleSampleUpload}
        />
        <WorkspaceResizeHandle kind="left-panel" onResizeStart={workspaceLayout.startResize} onReset={workspaceLayout.resetSize} onNudge={workspaceLayout.nudgeSize} />
        <PreviewPanel
          sampleVideo={state.sampleVideo}
          mediaDerivatives={state.mediaDerivatives}
          activeMediaKind={state.activeMediaKind}
          selectedDerivativeId={state.selectedDerivativeId}
          selectedFrameId={state.selectedFrameId}
          selectedAudioFeatureMarkerId={state.selectedAudioFeatureMarkerId}
          audioFeatures={state.audioFeatures}
          audioSeekRequest={audioSeekRequest}
          processingText={processingText}
          traceText={traceText}
          uiTraceId={state.uiTraceId}
          backendTraceId={state.processingJob?.traceId ?? null}
          errorText={state.errorSummary?.message}
          videoRef={videoRef}
          audioRef={audioRef}
          miniCanvasRef={miniCanvasRef}
          onSelectAudioFeature={handleSelectAudioFeature}
        />
        <WorkspaceResizeHandle kind="right-panel" onResizeStart={workspaceLayout.startResize} onReset={workspaceLayout.resetSize} onNudge={workspaceLayout.nudgeSize} />
        <PropertyPanel
          sampleVideo={state.sampleVideo}
          activeMediaKind={state.activeMediaKind}
          selectedFrameId={state.selectedFrameId}
          selectedDerivativeId={state.selectedDerivativeId}
          selectedSubtitleId={state.selectedSubtitleId}
          selectedAudioFeatureMarkerId={state.selectedAudioFeatureMarkerId}
          mediaDerivatives={state.mediaDerivatives}
          audioFeatures={state.audioFeatures}
          subtitles={state.subtitles}
          subtitleDrafts={state.subtitleDrafts}
          currentCard={currentCard}
          processingTraceId={state.processingJob?.traceId}
          processingStatus={state.processingJob?.status}
          processingStage={state.processingJob?.stage}
          processingProgress={state.processingJob?.progress}
          errorMessage={state.errorSummary?.message}
          shotBoundaryAnalysis={shotBoundaryAnalysis}
          shotBoundaryAnalysisHistory={state.sampleArtifact?.shotBoundaryAnalysisHistory ?? null}
          currentShot={currentShot}
          currentShotId={currentShotId}
          agentJob={shotBoundaryFlow.agentJob}
          scriptSegmentAnalysis={state.sampleArtifact?.scriptSegmentAnalysis ?? null}
          scriptSegmentAnalysisHistory={state.sampleArtifact?.scriptSegmentAnalysisHistory ?? null}
          scriptSegmentJob={scriptSegmentFlow.job}
          rhythmStructureAnalysis={state.sampleArtifact?.rhythmStructureAnalysis ?? null}
          rhythmStructureAnalysisHistory={state.sampleArtifact?.rhythmStructureAnalysisHistory ?? null}
          rhythmStructureJob={rhythmStructureFlow.job}
          agentAnalysisFps={agentAnalysisFps}
          enableShotBoundaryReview={enableShotBoundaryReview}
          onAgentAnalysisFpsChange={(value) => setAgentAnalysisFps(normalizeAnalysisFps(value, MIN_ANALYSIS_FPS, MAX_ANALYSIS_FPS))}
          onEnableShotBoundaryReviewChange={setEnableShotBoundaryReview}
          onRunShotBoundary={() => {
            subtitleDraftFlow.flushSubtitleDraftsBeforeShotBoundary()
              .then((ready) => {
                if (!ready) {
                  setSaveStatus("字幕保存失败，已阻止切镜分析；请修复后重试");
                  throw new Error("字幕保存失败，已阻止切镜分析");
                }
                return shotBoundaryFlow.run();
              })
              .catch((error) => setSaveStatus(error instanceof Error ? error.message : "切镜分析失败"));
          }}
          onRunScriptSegment={() => {
            void handleUnderstand().catch((error) => setSaveStatus(error instanceof Error ? error.message : "脚本段落分析失败"));
          }}
          onRunRhythmStructure={() => {
            void handleRhythmStructure().catch((error) => setSaveStatus(error instanceof Error ? error.message : "节奏结构分析失败"));
          }}
          onSelectScriptSegment={handleSelectTimelineTime}
          onSelectRhythmCard={handleSelectTimelineTime}
          onSelectShot={handleSelectTimelineTime}
          onSubtitleDraftChange={subtitleDraftFlow.handleSubtitleDraftChange}
        />
        <WorkspaceResizeHandle kind="timeline" onResizeStart={workspaceLayout.startResize} onReset={workspaceLayout.resetSize} onNudge={workspaceLayout.nudgeSize} />
        <TimelinePanel
          sampleVideo={state.sampleVideo}
          mediaDerivatives={state.mediaDerivatives}
          activeMediaKind={state.activeMediaKind}
          selectedDerivativeId={state.selectedDerivativeId}
          selectedFrameId={state.selectedFrameId}
          selectedSubtitleId={state.selectedSubtitleId}
          selectedAudioFeatureMarkerId={state.selectedAudioFeatureMarkerId}
          audioSeparation={state.audioSeparation}
          audioFeatures={state.audioFeatures}
          subtitles={state.subtitles}
          subtitleDrafts={state.subtitleDrafts}
          timelineFrameVisible={state.timelineFrameVisible}
          timelineVisibleSeconds={state.timelineVisibleSeconds}
          videoRef={videoRef}
          audioRef={audioRef}
          miniCanvasRef={miniCanvasRef}
          uiTraceId={state.uiTraceId}
          backendTraceId={state.processingJob?.traceId ?? null}
          onSelectVideo={() => {
            const video = state.mediaDerivatives.find((entry) => entry.type === "normalized-video" || entry.type === "original-video");
            dispatch({ type: "select-media", activeMediaKind: "video", selectedDerivativeId: video?.artifactId ?? state.sampleVideo?.artifactId ?? null, selectedFrameId: null });
          }}
          onSelectAudio={(artifactId) => {
            const audio = state.mediaDerivatives.find((entry) => entry.artifactId === artifactId) ?? state.mediaDerivatives.find((entry) => entry.type === "audio-track");
            dispatch({ type: "select-media", activeMediaKind: "audio", selectedDerivativeId: audio?.artifactId ?? state.sampleArtifact?.audio?.artifactId ?? null, selectedFrameId: null });
          }}
          onSelectFrame={(frameId) => {
            const frame = state.sampleVideo?.frameArtifacts.find((item) => item.id === frameId);
            if (!frame) return;
            dispatch({ type: "select-media", activeMediaKind: "frame", selectedDerivativeId: frame.artifactId, selectedFrameId: frame.id });
          }}
          onSelectSubtitle={(segmentId) => {
            dispatch({ type: "select-media", activeMediaKind: "subtitle", selectedDerivativeId: state.subtitles?.artifactId ?? null, selectedFrameId: null, selectedSubtitleId: segmentId });
          }}
          onSelectAudioFeature={(markerId) => {
            const marker = findAudioFeatureMarker(state.audioFeatures, markerId);
            if (marker) handleSelectAudioFeature(marker);
          }}
          onFrameVisibleChange={(visible) => dispatch({ type: "set-frame-visible", visible })}
          onVisibleSecondsChange={(value) => dispatch({ type: "set-visible-seconds", visibleSeconds: clampVisibleSeconds(value) })}
        />
      </main>
      {activeView === "library" ? <LibraryApp embedded onBack={() => setWorkbenchView("workspace", setActiveView)} /> : null}
      {activeView === "debug" ? <DebugApp embedded onBack={() => setWorkbenchView("workspace", setActiveView)} /> : null}
      {activeView === "threadpool" ? <ThreadPoolApp embedded onBack={() => setWorkbenchView("workspace", setActiveView)} /> : null}
      {uploadFlow.cachePrompt ? <CacheDecisionDialog item={uploadFlow.cachePrompt.cachedItem} onReuse={uploadFlow.reuseCache} onRefresh={uploadFlow.refreshCache} onCancel={() => uploadFlow.setCachePrompt(null)} /> : null}
      {shotBoundaryFlow.shotCachePrompt ? <CacheDecisionDialog item={shotBoundaryFlow.shotCachePrompt.cachedItem} onReuse={shotBoundaryFlow.reuseCache} onRefresh={shotBoundaryFlow.refreshCache} onCancel={() => shotBoundaryFlow.setShotCachePrompt(null)} /> : null}
      {scriptSegmentFlow.cachePrompt ? <CacheDecisionDialog item={scriptSegmentFlow.cachePrompt.cachedItem} onReuse={async () => await reuseAnalysisCache("scriptSegment", scriptSegmentFlow, setSaveStatus, state, dispatch)} onRefresh={async () => await refreshAnalysisCache("scriptSegment", scriptSegmentFlow, setSaveStatus, state)} onCancel={() => scriptSegmentFlow.setCachePrompt(null)} /> : null}
      {rhythmStructureFlow.cachePrompt ? <CacheDecisionDialog item={rhythmStructureFlow.cachePrompt.cachedItem} onReuse={async () => await reuseAnalysisCache("rhythmStructure", rhythmStructureFlow, setSaveStatus, state, dispatch)} onRefresh={async () => await refreshAnalysisCache("rhythmStructure", rhythmStructureFlow, setSaveStatus, state)} onCancel={() => rhythmStructureFlow.setCachePrompt(null)} /> : null}
      <button id="understandBtn" className="sr-only" type="button" onClick={handleUnderstand}>
        结构理解
      </button>
    </div>
  );
}

type AnalysisJobFlow = ReturnType<typeof useAnalysisJobFlow>;

async function reuseAnalysisCache(
  kind: "scriptSegment" | "rhythmStructure",
  flow: AnalysisJobFlow,
  setSaveStatus: (value: string) => void,
  state: WorkbenchState,
  dispatch: (action: WorkbenchAction) => void,
) {
  if (!flow.cachePrompt) return;
  const prompt = flow.cachePrompt;
  flow.setCachePrompt(null);
  try {
    const job = await resolveCacheDecision(prompt.jobId, "reuse");
    flow.setJob(job);
    const artifact = await getSampleArtifact(prompt.sampleVideoId);
    dispatch({ type: "apply-artifact", artifact });
    flow.applyCompletedArtifact(
      artifact,
      job.traceId ?? state.processingJob?.traceId ?? null,
      kind === "scriptSegment" ? "复用脚本段落缓存" : "复用节奏结构缓存",
    );
    flow.setJob(null);
    setSaveStatus(kind === "scriptSegment" ? "已复用脚本段落缓存" : "已复用节奏结构缓存");
  } catch (error) {
    setSaveStatus(error instanceof Error ? error.message : kind === "scriptSegment" ? "复用脚本段落缓存失败" : "复用节奏结构缓存失败");
  }
}

async function refreshAnalysisCache(
  kind: "scriptSegment" | "rhythmStructure",
  flow: AnalysisJobFlow,
  setSaveStatus: (value: string) => void,
  state: WorkbenchState,
) {
  if (!state.sampleVideo || !flow.cachePrompt) return;
  flow.setCachePrompt(null);
  try {
    const result = await flow.run("refresh");
    if (kind === "scriptSegment" && result?.artifact?.scriptSegmentAnalysis) {
      flow.applyCompletedArtifact(result.artifact, result.job.traceId ?? state.processingJob?.traceId ?? null, "脚本段落重新生成");
      setSaveStatus("脚本段落已重新生成");
    }
    if (kind === "rhythmStructure" && result?.artifact?.rhythmStructureAnalysis) {
      flow.applyCompletedArtifact(result.artifact, result.job.traceId ?? state.processingJob?.traceId ?? null, "节奏结构重新生成");
      setSaveStatus("节奏结构已重新生成");
    }
  } catch (error) {
    setSaveStatus(error instanceof Error ? error.message : kind === "scriptSegment" ? "脚本段落分析失败" : "节奏结构分析失败");
  }
}

const STAGES = {
  scriptSegmentAnalyze: "script.segment.analyze",
  rhythmStructureAnalyze: "rhythm.structure.analyze",
} as const;
