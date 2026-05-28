import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { createInitialState, workbenchReducer } from "../state";
import type { AudioFeatureMarker, SampleArtifact, WorkbenchState } from "../types";
import { shortId } from "../utils/format";
import { getModules, saveFunctionSlotAtomizationManualBoundaryEdit } from "../api/client";
import { resolveAudioFeatureSourceId } from "../utils/workbenchHelpers";
import { setAnalysisRoleModules } from "../utils/analysisRoles";
import { readWorkbenchDraft, writeActiveAgentJob, writeActiveAnalysisJob, writeWorkbenchDraft } from "../utils/workbenchDraft";
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
import { FullAnalysisApp } from "./FullAnalysisApp";
import { LibraryApp } from "./LibraryApp";
import { PropertyPanel, type PropertyPanelTab } from "./PropertyPanel";
import { RunStatusBar } from "./RunStatusBar";
import { ThreadPoolApp } from "./ThreadPoolApp";
import type { FullAnalysisStageTarget, FullAnalysisWorkbenchActiveSample, FullAnalysisWorkbenchSync } from "./FullAnalysisApp";
import { fullAnalysisStageToPropertyTab, refreshAnalysisCache, resolveFailedProcessingJob, reuseAnalysisCache, sampleArtifactSyncSignature, STAGES, toActiveJobDraft } from "./workbench/workbenchAnalysisHelpers";
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
  const [propertyPanelTab, setPropertyPanelTab] = useState<PropertyPanelTab>("shot");
  const [mountedViews, setMountedViews] = useState<Record<WorkbenchView, boolean>>(() => ({
    workspace: true,
    "full-analysis": initialViewFromPath() === "full-analysis",
    library: initialViewFromPath() === "library",
    threadpool: initialViewFromPath() === "threadpool",
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
    setMountedViews((current) => (current[activeView] ? current : { ...current, [activeView]: true }));
  }, [activeView]);

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
    };
    void restoreJobs();
  }, [functionSlotAtomizationFlow, packagingStructureFlow, rhythmStructureFlow, scriptSegmentFlow, setSaveStatus, shotBoundaryFlow]);

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
      scriptSegmentFlow.setJob(resolveFailedProcessingJob(error));
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
      rhythmStructureFlow.setJob(resolveFailedProcessingJob(error));
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

  const handlePackagingStructure = useCallback(async () => {
    if (!state.sampleVideo || !state.sampleArtifact?.shotBoundaryAnalysis?.shots?.length) return null;
    const stage = stageLogger.beginStage(STAGES.packagingStructureAnalyze, state.sampleArtifact.shotBoundaryAnalysis.artifactId, {
      sampleVideoId: state.sampleVideo.id,
      sourceShotBoundaryArtifactId: state.sampleArtifact.shotBoundaryAnalysis.artifactId,
      shotCount: state.sampleArtifact.shotBoundaryAnalysis.shots.length,
    });
    try {
      const result = await packagingStructureFlow.run("ask");
      if (!result?.artifact?.packagingStructureAnalysis) throw new Error("包装结构分析未返回有效产物");
      packagingStructureFlow.applyCompletedArtifact(result.artifact, result.job.traceId ?? state.processingJob?.traceId ?? null, "包装结构完成");
      stageLogger.finishStage(stage, result.artifact.packagingStructureAnalysis.artifactId, {
        packagingBlockCount: result.artifact.packagingStructureAnalysis.packagingBlocks.length,
        shotPackagingNoteCount: result.artifact.packagingStructureAnalysis.shotPackagingNotes.length,
        validatorCode: result.artifact.packagingStructureAnalysis.validation?.validatorCode ?? null,
      });
      return result.artifact;
    } catch (error) {
      packagingStructureFlow.setJob(resolveFailedProcessingJob(error));
      stageLogger.failStage(stage, error, {
        errorCode: (error as { code?: string })?.code,
        errorMessage: error instanceof Error ? error.message : "包装结构分析失败",
        errorStage: STAGES.packagingStructureAnalyze,
        backendTraceId: packagingStructureFlow.job?.traceId ?? state.processingJob?.traceId ?? null,
        debugPayload: { kind: "packaging-structure-failure", sampleVideoId: state.sampleVideo.id },
      });
      throw error;
    }
  }, [packagingStructureFlow, stageLogger, state]);

  const handleFunctionSlotAtomization = useCallback(async () => {
    const scriptArtifactId = state.sampleArtifact?.scriptSegmentAnalysis?.artifactId ?? null;
    const rhythmArtifactId = state.sampleArtifact?.rhythmStructureAnalysis?.artifactId ?? null;
    const packagingArtifactId = state.sampleArtifact?.packagingStructureAnalysis?.artifactId ?? null;
    if (!state.sampleVideo || !scriptArtifactId || !rhythmArtifactId || !packagingArtifactId) return null;
    const stage = stageLogger.beginStage(STAGES.functionSlotAtomizationAnalyze, packagingArtifactId, {
      sampleVideoId: state.sampleVideo.id,
      sourceScriptSegmentArtifactId: scriptArtifactId,
      sourceRhythmStructureArtifactId: rhythmArtifactId,
      sourcePackagingStructureArtifactId: packagingArtifactId,
    });
    try {
      const result = await functionSlotAtomizationFlow.run("refresh");
      if (!result?.artifact?.functionSlotAtomizationAnalysis) throw new Error("功能槽位原子化未返回有效产物");
      functionSlotAtomizationFlow.applyCompletedArtifact(result.artifact, result.job.traceId ?? state.processingJob?.traceId ?? null, "功能槽位原子化完成");
      stageLogger.finishStage(stage, result.artifact.functionSlotAtomizationAnalysis.artifactId, {
        slotCount: result.artifact.functionSlotAtomizationAnalysis.slotMap.slots.length,
        scriptAtomCount: result.artifact.functionSlotAtomizationAnalysis.atomInventory.scriptAtoms.length,
        rhythmAtomCount: result.artifact.functionSlotAtomizationAnalysis.atomInventory.rhythmAtoms.length,
        packagingAtomCount: result.artifact.functionSlotAtomizationAnalysis.atomInventory.packagingAtoms.length,
        validatorCode: result.artifact.functionSlotAtomizationAnalysis.validation?.validatorCode ?? null,
      });
      return result.artifact;
    } catch (error) {
      functionSlotAtomizationFlow.setJob(resolveFailedProcessingJob(error));
      stageLogger.failStage(stage, error, {
        errorCode: (error as { code?: string })?.code,
        errorMessage: error instanceof Error ? error.message : "功能槽位原子化失败",
        errorStage: STAGES.functionSlotAtomizationAnalyze,
        backendTraceId: functionSlotAtomizationFlow.job?.traceId ?? state.processingJob?.traceId ?? null,
        debugPayload: { kind: "function-slot-atomization-failure", sampleVideoId: state.sampleVideo.id },
      });
      throw error;
    }
  }, [functionSlotAtomizationFlow, stageLogger, state]);

  const handleFunctionSlotManualBoundaryEdit = useCallback(async (editedJsonText: string) => {
    const sampleVideoId = state.sampleVideo?.id ?? state.sampleArtifact?.sampleVideoId ?? null;
    const analysis = state.sampleArtifact?.functionSlotAtomizationAnalysis ?? null;
    if (!sampleVideoId || !analysis) throw new Error("没有可手动修正的原子化结果");
    setSaveStatus("提交原子化手动修正");
    const result = await saveFunctionSlotAtomizationManualBoundaryEdit(sampleVideoId, {
      editedJsonText,
      expectedArtifactId: analysis.artifactId,
      sourceBoundaryReviewArtifactId: analysis.boundaryReview?.artifactId ?? null,
    });
    dispatch({ type: "apply-artifact", artifact: result.sampleArtifact });
    persistWorkbenchArtifact(result.sampleArtifact, result.traceId ?? state.processingJob?.traceId ?? null);
    setSaveStatus("原子化手动修正已落地");
  }, [persistWorkbenchArtifact, state.processingJob?.traceId, state.sampleArtifact, state.sampleVideo?.id]);

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

  const handleFullAnalysisWorkbenchSync = useCallback((payload: FullAnalysisWorkbenchSync) => {
    const nextArtifact = payload.artifact;
    if (nextArtifact?.sampleVideo?.artifactId) {
      const artifactSignature = sampleArtifactSyncSignature(nextArtifact);
      if (artifactSignature !== lastFullAnalysisArtifactSyncRef.current) {
        lastFullAnalysisArtifactSyncRef.current = artifactSignature;
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

  const handleOpenWorkbenchStage = useCallback((stageKey: FullAnalysisStageTarget) => {
    const tab = fullAnalysisStageToPropertyTab(stageKey);
    setPropertyPanelTab(tab);
    setWorkbenchView("workspace", setActiveView);
  }, []);

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
          <button className={`tab-button ${activeView === "workspace" ? "active" : ""}`} type="button" onClick={() => setWorkbenchView("workspace", setActiveView)}>
            工作台
          </button>
          <button className={`tab-button ${activeView === "full-analysis" ? "active" : ""}`} type="button" onClick={() => setWorkbenchView("full-analysis", setActiveView)}>
            完整分析
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
        </div>
      </header>
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
        handleFunctionSlotManualBoundaryEdit={handleFunctionSlotManualBoundaryEdit}
      />
      {mountedViews["full-analysis"] ? (
        <section className={`view-shell ${activeView === "full-analysis" ? "" : "is-hidden-view"}`} aria-hidden={activeView !== "full-analysis"}>
          <FullAnalysisApp embedded activeSample={fullAnalysisActiveSample} onWorkbenchSync={handleFullAnalysisWorkbenchSync} onOpenWorkbenchStage={handleOpenWorkbenchStage} />
        </section>
      ) : null}
      {mountedViews.library ? (
        <section className={`view-shell ${activeView === "library" ? "" : "is-hidden-view"}`} aria-hidden={activeView !== "library"}>
          <LibraryApp embedded />
        </section>
      ) : null}
      {mountedViews.threadpool ? (
        <section className={`view-shell ${activeView === "threadpool" ? "" : "is-hidden-view"}`} aria-hidden={activeView !== "threadpool"}>
          <ThreadPoolApp embedded />
        </section>
      ) : null}
      {uploadFlow.cachePrompt ? <CacheDecisionDialog item={uploadFlow.cachePrompt.cachedItem} onReuse={uploadFlow.reuseCache} onRefresh={uploadFlow.refreshCache} onCancel={() => uploadFlow.setCachePrompt(null)} /> : null}
      {shotBoundaryFlow.shotCachePrompt ? <CacheDecisionDialog item={shotBoundaryFlow.shotCachePrompt.cachedItem} onReuse={shotBoundaryFlow.reuseCache} onRefresh={shotBoundaryFlow.refreshCache} onCancel={() => shotBoundaryFlow.setShotCachePrompt(null)} /> : null}
      {scriptSegmentFlow.cachePrompt ? <CacheDecisionDialog item={scriptSegmentFlow.cachePrompt.cachedItem} onReuse={async () => await reuseAnalysisCache("scriptSegment", scriptSegmentFlow, setSaveStatus, state, dispatch)} onRefresh={async () => await refreshAnalysisCache("scriptSegment", scriptSegmentFlow, setSaveStatus, state)} onCancel={() => scriptSegmentFlow.setCachePrompt(null)} /> : null}
      {rhythmStructureFlow.cachePrompt ? <CacheDecisionDialog item={rhythmStructureFlow.cachePrompt.cachedItem} onReuse={async () => await reuseAnalysisCache("rhythmStructure", rhythmStructureFlow, setSaveStatus, state, dispatch)} onRefresh={async () => await refreshAnalysisCache("rhythmStructure", rhythmStructureFlow, setSaveStatus, state)} onCancel={() => rhythmStructureFlow.setCachePrompt(null)} /> : null}
      {packagingStructureFlow.cachePrompt ? <CacheDecisionDialog item={packagingStructureFlow.cachePrompt.cachedItem} onReuse={async () => await reuseAnalysisCache("packagingStructure", packagingStructureFlow, setSaveStatus, state, dispatch)} onRefresh={async () => await refreshAnalysisCache("packagingStructure", packagingStructureFlow, setSaveStatus, state)} onCancel={() => packagingStructureFlow.setCachePrompt(null)} /> : null}
      {functionSlotAtomizationFlow.cachePrompt ? <CacheDecisionDialog item={functionSlotAtomizationFlow.cachePrompt.cachedItem} onReuse={async () => await reuseAnalysisCache("functionSlotAtomization", functionSlotAtomizationFlow, setSaveStatus, state, dispatch)} onRefresh={async () => await refreshAnalysisCache("functionSlotAtomization", functionSlotAtomizationFlow, setSaveStatus, state)} onCancel={() => functionSlotAtomizationFlow.setCachePrompt(null)} /> : null}
      <button id="understandBtn" className="sr-only" type="button" onClick={handleUnderstand}>
        结构理解
      </button>
    </div>
  );
}

