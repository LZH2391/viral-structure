import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { createInitialState, workbenchReducer } from "../state";
import type { SampleArtifact, WorkbenchState } from "../types";
import { shortId } from "../utils/format";
import { getModules } from "../api/client";
import { setAnalysisRoleModules } from "../utils/analysisRoles";
import { readWorkbenchDraft, writeActiveAgentJob, writeActiveAnalysisJob, writeWorkbenchDraft } from "../utils/workbenchDraft";
import { readNewUiThemePreference, writeNewUiThemePreference, type NewUiTheme } from "../utils/workbenchPreferences";
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
import { ActiveTurnsApp } from "./ActiveTurnsApp";
import { AgentChatApp } from "./AgentChatApp";
import { FullAnalysisApp } from "./FullAnalysisApp";
import { LibraryApp } from "./LibraryApp";
import { NewUiApp } from "./NewUiApp";
import { PageCurlViewToggle } from "./PageCurlViewToggle";
import { PropertyPanel, type PropertyPanelTab } from "./PropertyPanel";
import { RunStatusBar } from "./RunStatusBar";
import { ThreadPoolApp } from "./ThreadPoolApp";
import type { FullAnalysisStageTarget, FullAnalysisWorkbenchActiveSample, FullAnalysisWorkbenchSync } from "./FullAnalysisApp";
import { fullAnalysisStageToPropertyTab, refreshAnalysisCache, reuseAnalysisCache, sampleArtifactSyncSignature, toActiveJobDraft } from "./workbench/workbenchAnalysisHelpers";
import { useWorkbenchAnalysisHandlers } from "./workbench/useWorkbenchAnalysisHandlers";
import { WorkbenchWorkspaceView } from "./workbench/WorkbenchWorkspaceView";

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
  const [newUiTheme, setNewUiTheme] = useState<NewUiTheme>(() => readNewUiThemePreference());
  const [newUiLeftCollapsed, setNewUiLeftCollapsed] = useState(false);
  const [propertyPanelTab, setPropertyPanelTab] = useState<PropertyPanelTab>("shot");
  const [mountedViews, setMountedViews] = useState<Record<WorkbenchView, boolean>>(() => ({
    workspace: true,
    "new-ui": initialViewFromPath() === "new-ui",
    "full-analysis": initialViewFromPath() === "full-analysis",
    "material-recognition": initialViewFromPath() === "material-recognition",
    library: initialViewFromPath() === "library",
    threadpool: initialViewFromPath() === "threadpool",
    "agent-chat": initialViewFromPath() === "agent-chat",
    "active-turns": initialViewFromPath() === "active-turns",
  }));
  const audioSeekRequestIdRef = useRef(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const miniCanvasRef = useRef<HTMLCanvasElement>(null);
  const workspaceGridRef = useRef<HTMLElement>(null);
  const lastSegmentIdRef = useRef<string | null>(null);
  const lastShotIdRef = useRef<string | null>(null);
  const restoredAnalysisJobsRef = useRef(false);
  const lastFullAnalysisArtifactSyncRef = useRef<string | null>(null);
  const lastMaterialRecognitionArtifactSyncRef = useRef<string | null>(null);
  const workspaceLayout = useResizableWorkspaceLayout(workspaceGridRef);
  const shotBoundaryAnalysis = state.sampleArtifact?.shotBoundaryAnalysis ?? null;

  const persistWorkbenchArtifact = useCallback((artifact: SampleArtifact, traceId: string | null, activeSample?: { revision?: number; source?: WorkbenchState["activeSampleSource"] }) => {
    writeWorkbenchDraft({
      sampleVideoId: artifact.sampleVideoId,
      artifactId: artifact.sampleVideo.artifactId,
      traceId,
      activeSampleRevision: activeSample?.revision ?? state.activeSampleRevision,
      activeSampleSource: activeSample?.source ?? state.activeSampleSource,
      sampleArtifact: artifact,
      selectedFrameId: artifact.frames[0]?.frameId ?? null,
      selectedDerivativeId: artifact.sampleVideo.normalized.artifactId,
      versions: state.versions,
    });
  }, [state.activeSampleRevision, state.activeSampleSource, state.versions]);

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

  const packagingStructureFlow = useAnalysisJobFlow({
    kind: "packagingStructure",
    state,
    dispatch,
    persistWorkbenchArtifact,
    setSaveStatus,
    uploadTokenRef: uploadFlow.uploadTokenRef,
  });

  const functionSlotAtomizationFlow = useAnalysisJobFlow({
    kind: "functionSlotAtomization",
    state,
    dispatch,
    persistWorkbenchArtifact,
    setSaveStatus,
    uploadTokenRef: uploadFlow.uploadTokenRef,
  });

  const userMaterialTaggerFlow = useAnalysisJobFlow({
    kind: "userMaterialTagger",
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
  const {
    handleUnderstand,
    handleRhythmStructure,
    handlePackagingStructure,
    handleFunctionSlotAtomization,
    handleUserMaterialTagger,
    handleFunctionSlotManualBoundaryEdit,
    handleSelectAudioFeature,
    handleSelectTimelineTime,
  } = useWorkbenchAnalysisHandlers({
    state,
    dispatch,
    stageLogger,
    scriptSegmentFlow,
    rhythmStructureFlow,
    packagingStructureFlow,
    functionSlotAtomizationFlow,
    userMaterialTaggerFlow,
    persistWorkbenchArtifact,
    setSaveStatus,
    audioSeekRequestIdRef,
    setAudioSeekRequest,
    videoRef,
    setCurrentTime,
  });

  const currentShotId = currentShot?.id ?? null;
  const runStatus = buildRunStatus(state);

  useEffect(() => {
    setMountedViews((current) => (current[activeView] ? current : { ...current, [activeView]: true }));
  }, [activeView]);

  useEffect(() => {
    writeNewUiThemePreference(newUiTheme);
  }, [newUiTheme]);

  useEffect(() => {
    void getModules()
      .then(({ modules }) => setAnalysisRoleModules(modules))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const handlePopState = () => setActiveView(initialViewFromPath());
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    if (restoredAnalysisJobsRef.current) return;
    restoredAnalysisJobsRef.current = true;
    const restoreJobs = async () => {
      const shotDraft = await shotBoundaryFlow.restoreDraft();
      if (shotDraft) setAgentAnalysisFps(normalizeAnalysisFps(shotDraft.analysisFps ?? DEFAULT_ANALYSIS_FPS, MIN_ANALYSIS_FPS, MAX_ANALYSIS_FPS));
      if (shotDraft) setEnableShotBoundaryReview(shotDraft.enableReview ?? true);
      const draft = readWorkbenchDraft();
      await scriptSegmentFlow.attachDraftJob(draft?.activeScriptSegmentJob).catch(() => setSaveStatus("恢复脚本段落任务失败"));
      await rhythmStructureFlow.attachDraftJob(draft?.activeRhythmStructureJob).catch(() => setSaveStatus("恢复节奏结构任务失败"));
      await packagingStructureFlow.attachDraftJob(draft?.activePackagingStructureJob).catch(() => setSaveStatus("恢复包装结构任务失败"));
      await functionSlotAtomizationFlow.attachDraftJob(draft?.activeFunctionSlotAtomizationJob).catch(() => setSaveStatus("恢复原子化任务失败"));
      await userMaterialTaggerFlow.attachDraftJob(draft?.activeUserMaterialTaggerJob).catch(() => setSaveStatus("恢复素材识别任务失败"));
    };
    void restoreJobs();
  }, [functionSlotAtomizationFlow, packagingStructureFlow, rhythmStructureFlow, scriptSegmentFlow, setSaveStatus, shotBoundaryFlow, userMaterialTaggerFlow]);

  const handleFullAnalysisWorkbenchSync = useCallback((payload: FullAnalysisWorkbenchSync) => {
    const nextArtifact = payload.artifact;
    if (nextArtifact?.sampleVideo?.artifactId) {
      const artifactSignature = sampleArtifactSyncSignature(nextArtifact);
      if (artifactSignature !== lastMaterialRecognitionArtifactSyncRef.current) {
        lastMaterialRecognitionArtifactSyncRef.current = artifactSignature;
        dispatch({ type: "apply-artifact", artifact: nextArtifact, activeSampleSource: "fullAnalysis", bumpActiveSampleRevision: true });
        persistWorkbenchArtifact(nextArtifact, payload.run.traceId ?? nextArtifact.trace?.traceId ?? null, { revision: state.activeSampleRevision + 1, source: "fullAnalysis" });
      }
    }
    const stageJob = (stageKey: string) => {
      const stage = payload.run.stages.find((item) => item.key === stageKey);
      return stage?.childJobId ? payload.childJobs[stage.childJobId] ?? null : null;
    };
    const uploadStage = payload.run.stages.find((stage) => stage.key === "upload");
    const uploadProcessed = uploadStage?.status === "processed";
    const shouldSyncUploadState = payload.run.status !== "running" || !uploadProcessed || Boolean(payload.run.errorSummary);
    if (shouldSyncUploadState) {
      dispatch({
        type: "set-upload-state",
        isUploadingSample: payload.run.status === "running" && !uploadProcessed,
        uploadStatusText: payload.run.status === "running" ? "完整分析同步中" : null,
        processingJob: null,
        errorSummary: payload.run.errorSummary ?? null,
      });
    }
    const shotJob = stageJob("shotBoundary");
    const scriptJob = stageJob("scriptSegment");
    const rhythmJob = stageJob("rhythmStructure");
    const packagingJob = stageJob("packagingStructure");
    const atomizationJob = stageJob("functionSlotAtomization");
    shotBoundaryFlow.setAgentJob(shotJob);
    scriptSegmentFlow.setJob(scriptJob);
    rhythmStructureFlow.setJob(rhythmJob);
    packagingStructureFlow.setJob(packagingJob);
    functionSlotAtomizationFlow.setJob(atomizationJob);
    writeActiveAgentJob(toActiveJobDraft(shotJob));
    writeActiveAnalysisJob("scriptSegment", toActiveJobDraft(scriptJob));
    writeActiveAnalysisJob("rhythmStructure", toActiveJobDraft(rhythmJob));
    writeActiveAnalysisJob("packagingStructure", toActiveJobDraft(packagingJob));
    if (atomizationJob) writeActiveAnalysisJob("functionSlotAtomization", toActiveJobDraft(atomizationJob));
  }, [functionSlotAtomizationFlow, packagingStructureFlow, persistWorkbenchArtifact, rhythmStructureFlow, scriptSegmentFlow, shotBoundaryFlow, state.activeSampleRevision]);

  const handleMaterialRecognitionWorkbenchSync = useCallback((payload: FullAnalysisWorkbenchSync) => {
    const nextArtifact = payload.artifact;
    if (nextArtifact?.sampleVideo?.artifactId) {
      const artifactSignature = sampleArtifactSyncSignature(nextArtifact);
      if (artifactSignature !== lastFullAnalysisArtifactSyncRef.current) {
        lastFullAnalysisArtifactSyncRef.current = artifactSignature;
        dispatch({ type: "apply-artifact", artifact: nextArtifact, activeSampleSource: "materialRecognition", bumpActiveSampleRevision: true });
        persistWorkbenchArtifact(nextArtifact, payload.run.traceId ?? nextArtifact.trace?.traceId ?? null, { revision: state.activeSampleRevision + 1, source: "materialRecognition" });
      }
    }
    const shotStage = payload.run.stages.find((stage) => stage.key === "shotBoundary");
    const shotJob = shotStage?.childJobId ? payload.childJobs[shotStage.childJobId] ?? null : null;
    const materialStage = payload.run.stages.find((stage) => stage.key === "userMaterialTagger");
    const materialJob = materialStage?.childJobId ? payload.childJobs[materialStage.childJobId] ?? null : null;
    shotBoundaryFlow.setAgentJob(shotJob);
    userMaterialTaggerFlow.setJob(materialJob);
    writeActiveAgentJob(toActiveJobDraft(shotJob));
    writeActiveAnalysisJob("userMaterialTagger", toActiveJobDraft(materialJob));
  }, [persistWorkbenchArtifact, shotBoundaryFlow, state.activeSampleRevision, userMaterialTaggerFlow]);

  const handleOpenWorkbenchStage = useCallback((stageKey: FullAnalysisStageTarget) => {
    const tab = fullAnalysisStageToPropertyTab(stageKey);
    setPropertyPanelTab(tab);
    setWorkbenchView("workspace", setActiveView);
  }, []);

  const switchWorkbenchView = useCallback((view: WorkbenchView) => {
    if (view === activeView) return;
    setWorkbenchView(view, setActiveView);
  }, [activeView]);

  const fileLabel = state.isUploadingSample
    ? `${state.uploadStatusText ?? "处理中"} ${state.processingJob ? `${state.processingJob.progress}%` : ""}`.trim()
    : state.sampleVideo?.fileName ?? "未选择文件";

  const processingText = state.processingJob
    ? `${state.uploadStatusText ?? state.processingJob.stage} / ${state.processingJob.progress}%`
    : "未加载样例";

  const traceText = state.processingJob?.traceId ? `trace ${shortId(state.processingJob.traceId)}` : "等待后端返回 trace";
  const fullAnalysisActiveSample: FullAnalysisWorkbenchActiveSample | null = state.sampleArtifact ? {
    artifact: state.sampleArtifact,
    activeSampleRevision: state.activeSampleRevision,
    activeSampleSource: state.activeSampleSource,
  } : null;
  const newUiThemeClass = newUiTheme === "light" ? "target-new-ui-light" : "target-new-ui-dark";

  return (
    <div className={`app-shell ${activeView === "new-ui" ? "new-ui-active" : ""}`}>
      {activeView !== "new-ui" ? (
        <div className="legacy-view-toggle-layer">
          <PageCurlViewToggle label="新 UI" ariaLabel="切换到新 UI" className={`from-legacy ${newUiThemeClass}`} redrawKey={newUiTheme} onClick={() => switchWorkbenchView("new-ui")} />
        </div>
      ) : null}
      {activeView !== "new-ui" ? (
      <header className="topbar">
        <div className="project-block">
          <div className="project-name">结构迁移工作台</div>
          <div id="saveStatus" className="save-status">
            {saveStatus}
          </div>
        </div>
        <RunStatusBar label={runStatus.label} backendTraceId={state.processingJob?.traceId ?? runStatus.backendTraceId} uiTraceId={state.uiTraceId} stageId={runStatus.stageId} />
        <div className="top-actions">
            <button className={`tab-button ${activeView === "workspace" ? "active" : ""}`} type="button" onClick={() => setWorkbenchView("workspace", setActiveView)}>
              工作台
            </button>
            <button className={`tab-button ${activeView === "full-analysis" ? "active" : ""}`} type="button" onClick={() => setWorkbenchView("full-analysis", setActiveView)}>
              完整分析
            </button>
            <button className={`tab-button ${activeView === "material-recognition" ? "active" : ""}`} type="button" onClick={() => setWorkbenchView("material-recognition", setActiveView)}>
              素材识别
            </button>
            <button className={`tab-button ${activeView === "library" ? "active" : ""}`} type="button" onClick={() => setWorkbenchView("library", setActiveView)}>
              处理库
            </button>
            <button className="tab-button" type="button" onClick={() => window.location.assign("/function-slot-graph")}>
              结构图谱
            </button>
            <button className={`tab-button ${activeView === "threadpool" ? "active" : ""}`} type="button" onClick={() => setWorkbenchView("threadpool", setActiveView)}>
              ThreadPool
            </button>
            <button className={`tab-button ${activeView === "active-turns" ? "active" : ""}`} type="button" onClick={() => setWorkbenchView("active-turns", setActiveView)}>
              运行面板
            </button>
            <button className={`tab-button ${activeView === "agent-chat" ? "active" : ""}`} type="button" onClick={() => setWorkbenchView("agent-chat", setActiveView)}>
              Agent 对话
            </button>
            <button className="tab-button" type="button" onClick={() => switchWorkbenchView("new-ui")}>
              新 UI
            </button>
        </div>
      </header>
      ) : null}
      <WorkbenchWorkspaceView
        state={state}
        dispatch={dispatch}
        active={activeView === "workspace"}
        workspaceGridRef={workspaceGridRef}
        workspaceLayout={workspaceLayout}
        uploadFlow={uploadFlow}
        shotBoundaryFlow={shotBoundaryFlow}
        subtitleDraftFlow={subtitleDraftFlow}
        scriptSegmentFlow={scriptSegmentFlow}
        rhythmStructureFlow={rhythmStructureFlow}
        packagingStructureFlow={packagingStructureFlow}
        functionSlotAtomizationFlow={functionSlotAtomizationFlow}
        userMaterialTaggerFlow={userMaterialTaggerFlow}
        fileLabel={fileLabel}
        processingText={processingText}
        traceText={traceText}
        frameSampleRate={frameSampleRate}
        enableAudioSeparation={enableAudioSeparation}
        enableSubtitleRecognition={enableSubtitleRecognition}
        enableAudioFeatureAnalysis={enableAudioFeatureAnalysis}
        setFrameSampleRate={setFrameSampleRate}
        setEnableAudioSeparation={setEnableAudioSeparation}
        setEnableSubtitleRecognition={setEnableSubtitleRecognition}
        setEnableAudioFeatureAnalysis={setEnableAudioFeatureAnalysis}
        agentAnalysisFps={agentAnalysisFps}
        setAgentAnalysisFps={setAgentAnalysisFps}
        enableShotBoundaryReview={enableShotBoundaryReview}
        setEnableShotBoundaryReview={setEnableShotBoundaryReview}
        propertyPanelTab={propertyPanelTab}
        setPropertyPanelTab={setPropertyPanelTab}
        shotBoundaryAnalysis={shotBoundaryAnalysis}
        currentCard={currentCard}
        currentShot={currentShot}
        currentShotId={currentShotId}
        audioSeekRequest={audioSeekRequest}
        videoRef={videoRef}
        audioRef={audioRef}
        miniCanvasRef={miniCanvasRef}
        minAnalysisFps={MIN_ANALYSIS_FPS}
        maxAnalysisFps={MAX_ANALYSIS_FPS}
        setSaveStatus={setSaveStatus}
        handleSelectAudioFeature={handleSelectAudioFeature}
        handleSelectTimelineTime={handleSelectTimelineTime}
        handleUnderstand={handleUnderstand}
        handleRhythmStructure={handleRhythmStructure}
        handlePackagingStructure={handlePackagingStructure}
        handleFunctionSlotAtomization={handleFunctionSlotAtomization}
        handleUserMaterialTagger={handleUserMaterialTagger}
        handleFunctionSlotManualBoundaryEdit={handleFunctionSlotManualBoundaryEdit}
      />
      {mountedViews["new-ui"] ? (
        <section className={`view-shell new-ui-view-shell is-theme-${newUiTheme} ${activeView === "new-ui" ? "" : "is-hidden-view"} ${newUiLeftCollapsed ? "is-left-pane-collapsed" : ""}`} aria-hidden={activeView !== "new-ui"}>
          {newUiLeftCollapsed ? null : (
            <PageCurlViewToggle label="旧 UI" ariaLabel="切换回旧 UI" className={`from-new-ui-${newUiTheme}`} redrawKey={newUiTheme} onClick={() => switchWorkbenchView("workspace")} />
          )}
          <NewUiApp active={activeView === "new-ui"} theme={newUiTheme} onThemeChange={setNewUiTheme} onLeftCollapsedChange={setNewUiLeftCollapsed} />
        </section>
      ) : null}
      {mountedViews["full-analysis"] ? (
        <section className={`view-shell ${activeView === "full-analysis" ? "" : "is-hidden-view"}`} aria-hidden={activeView !== "full-analysis"}>
          <FullAnalysisApp embedded active={activeView === "full-analysis"} activeSample={fullAnalysisActiveSample} onWorkbenchSync={handleFullAnalysisWorkbenchSync} onOpenWorkbenchStage={handleOpenWorkbenchStage} />
        </section>
      ) : null}
      {mountedViews["material-recognition"] ? (
        <section className={`view-shell ${activeView === "material-recognition" ? "" : "is-hidden-view"}`} aria-hidden={activeView !== "material-recognition"}>
          <FullAnalysisApp embedded active={activeView === "material-recognition"} mode="material-recognition" activeSample={fullAnalysisActiveSample} onWorkbenchSync={handleMaterialRecognitionWorkbenchSync} onOpenWorkbenchStage={handleOpenWorkbenchStage} />
        </section>
      ) : null}
      {mountedViews.library ? (
        <section className={`view-shell ${activeView === "library" ? "" : "is-hidden-view"}`} aria-hidden={activeView !== "library"}>
          <LibraryApp embedded />
        </section>
      ) : null}
      {mountedViews.threadpool ? (
        <section className={`view-shell ${activeView === "threadpool" ? "" : "is-hidden-view"}`} aria-hidden={activeView !== "threadpool"}>
          <ThreadPoolApp embedded active={activeView === "threadpool"} />
        </section>
      ) : null}
      {mountedViews["active-turns"] ? (
        <section className={`view-shell ${activeView === "active-turns" ? "" : "is-hidden-view"}`} aria-hidden={activeView !== "active-turns"}>
          <ActiveTurnsApp embedded active={activeView === "active-turns"} />
        </section>
      ) : null}
      {mountedViews["agent-chat"] ? (
        <section className={`view-shell ${activeView === "agent-chat" ? "" : "is-hidden-view"}`} aria-hidden={activeView !== "agent-chat"}>
          <AgentChatApp embedded active={activeView === "agent-chat"} />
        </section>
      ) : null}
      {uploadFlow.cachePrompt ? <CacheDecisionDialog item={uploadFlow.cachePrompt.cachedItem} onReuse={uploadFlow.reuseCache} onRefresh={uploadFlow.refreshCache} onCancel={() => uploadFlow.setCachePrompt(null)} /> : null}
      {shotBoundaryFlow.shotCachePrompt ? <CacheDecisionDialog item={shotBoundaryFlow.shotCachePrompt.cachedItem} onReuse={shotBoundaryFlow.reuseCache} onRefresh={shotBoundaryFlow.refreshCache} onCancel={() => shotBoundaryFlow.setShotCachePrompt(null)} /> : null}
      {scriptSegmentFlow.cachePrompt ? <CacheDecisionDialog item={scriptSegmentFlow.cachePrompt.cachedItem} onReuse={async () => await reuseAnalysisCache("scriptSegment", scriptSegmentFlow, setSaveStatus, state, dispatch)} onRefresh={async () => await refreshAnalysisCache("scriptSegment", scriptSegmentFlow, setSaveStatus, state)} onCancel={() => scriptSegmentFlow.setCachePrompt(null)} /> : null}
      {rhythmStructureFlow.cachePrompt ? <CacheDecisionDialog item={rhythmStructureFlow.cachePrompt.cachedItem} onReuse={async () => await reuseAnalysisCache("rhythmStructure", rhythmStructureFlow, setSaveStatus, state, dispatch)} onRefresh={async () => await refreshAnalysisCache("rhythmStructure", rhythmStructureFlow, setSaveStatus, state)} onCancel={() => rhythmStructureFlow.setCachePrompt(null)} /> : null}
      {packagingStructureFlow.cachePrompt ? <CacheDecisionDialog item={packagingStructureFlow.cachePrompt.cachedItem} onReuse={async () => await reuseAnalysisCache("packagingStructure", packagingStructureFlow, setSaveStatus, state, dispatch)} onRefresh={async () => await refreshAnalysisCache("packagingStructure", packagingStructureFlow, setSaveStatus, state)} onCancel={() => packagingStructureFlow.setCachePrompt(null)} /> : null}
      {functionSlotAtomizationFlow.cachePrompt ? <CacheDecisionDialog item={functionSlotAtomizationFlow.cachePrompt.cachedItem} onReuse={async () => await reuseAnalysisCache("functionSlotAtomization", functionSlotAtomizationFlow, setSaveStatus, state, dispatch)} onRefresh={async () => await refreshAnalysisCache("functionSlotAtomization", functionSlotAtomizationFlow, setSaveStatus, state)} onCancel={() => functionSlotAtomizationFlow.setCachePrompt(null)} /> : null}
      {userMaterialTaggerFlow.cachePrompt ? <CacheDecisionDialog item={userMaterialTaggerFlow.cachePrompt.cachedItem} onReuse={async () => await reuseAnalysisCache("userMaterialTagger", userMaterialTaggerFlow, setSaveStatus, state, dispatch)} onRefresh={async () => await refreshAnalysisCache("userMaterialTagger", userMaterialTaggerFlow, setSaveStatus, state)} onCancel={() => userMaterialTaggerFlow.setCachePrompt(null)} /> : null}
      <button id="understandBtn" className="sr-only" type="button" onClick={handleUnderstand}>
        结构理解
      </button>
    </div>
  );
}

