import { FormEvent, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { getCapabilities, getLibraryItemDetail, getProcessingJob, getSampleArtifact, uploadSampleVideo } from "../api/client";
import { createGeneratedPlan, createStructureCards } from "../domain";
import { addVersion, STAGES, workbenchReducer, createInitialState } from "../state";
import type { AudioFeatureMarker, LibraryItemSummary, LogFields, ProcessingJob, WorkbenchState } from "../types";
import { beginUiStage, emitUiStage, safeErrorSummary, type UiStage } from "../observability/uiStage";
import { createId, sanitizeText, shortId } from "../utils/format";
import { clampVisibleSeconds } from "../utils/timeline";
import { attachAgentJob, attachProcessingJob, buildIngestError, delay, findAudioFeatureMarker, findCurrentStructureCard, resolveAudioFeatureSourceId, runShotBoundaryAnalysis, stageLabel } from "../utils/workbenchHelpers";
import { readWorkbenchDraft, writeActiveAgentJob, writeActiveUploadJob, writeWorkbenchDraft } from "../utils/workbenchDraft";
import { initialViewFromPath, setWorkbenchView, type WorkbenchView } from "../utils/workbenchView";
import { useResizableWorkspaceLayout } from "../hooks/useResizableWorkspaceLayout";
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
type CachePrompt = { file: File; cachedItem: LibraryItemSummary; token: number } | null;
type ShotCachePrompt = { cachedItem: LibraryItemSummary; token: number } | null;

export function WorkbenchApp() {
  const [state, dispatch] = useReducer(workbenchReducer, undefined, createInitialState);
  const [frameSampleRate, setFrameSampleRate] = useState(3);
  const [enableAudioSeparation, setEnableAudioSeparation] = useState(true);
  const [enableSubtitleRecognition, setEnableSubtitleRecognition] = useState(true);
  const [enableAudioFeatureAnalysis, setEnableAudioFeatureAnalysis] = useState(true);
  const [saveStatus, setSaveStatus] = useState("本地草稿");
  const [currentTime, setCurrentTime] = useState(0);
  const [audioSeekRequest, setAudioSeekRequest] = useState<AudioSeekRequest | null>(null);
  const [agentJob, setAgentJob] = useState<ProcessingJob | null>(null);
  const [agentAnalysisFps, setAgentAnalysisFps] = useState(1);
  const [cachePrompt, setCachePrompt] = useState<CachePrompt>(null);
  const [shotCachePrompt, setShotCachePrompt] = useState<ShotCachePrompt>(null);
  const [activeView, setActiveView] = useState<WorkbenchView>(() => initialViewFromPath());
  const audioSeekRequestIdRef = useRef(0);
  const uploadTokenRef = useRef(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const miniCanvasRef = useRef<HTMLCanvasElement>(null);
  const workspaceGridRef = useRef<HTMLElement>(null);
  const workspaceLayout = useResizableWorkspaceLayout(workspaceGridRef);

  useEffect(() => {
    const draft = readWorkbenchDraft();
    if (draft?.sampleArtifact) {
      dispatch({ type: "restore-draft", draft });
      setSaveStatus("已恢复最近样例");
    }
    if (draft?.activeUploadJob) attachProcessingJob(draft.activeUploadJob, dispatch, writeActiveUploadJob).catch(() => setSaveStatus("恢复上传任务失败"));
    if (draft?.activeAgentJob) attachAgentJob(draft.activeAgentJob, setAgentJob, dispatch, writeActiveAgentJob).catch(() => setSaveStatus("恢复切镜任务失败"));
    if (draft?.activeAgentJob) setAgentAnalysisFps(draft.activeAgentJob.analysisFps);
  }, []);

  useEffect(() => {
    getCapabilities()
      .then((capabilities) => dispatch({ type: "set-capabilities", capabilities }))
      .catch(() => setSaveStatus("能力检测失败"));
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    let lastSegmentId: string | null = null;
    const onTimeUpdate = () => {
      const time = video.currentTime || 0;
      const card = findCurrentStructureCard(state.structureCards, time);
      if ((card?.id ?? null) !== lastSegmentId) {
        lastSegmentId = card?.id ?? null;
        setCurrentTime(time);
      }
    };
    video.addEventListener("timeupdate", onTimeUpdate);
    return () => video.removeEventListener("timeupdate", onTimeUpdate);
  }, [state.structureCards]);

  const currentCard = useMemo(() => findCurrentStructureCard(state.structureCards, currentTime), [currentTime, state.structureCards]);
  const runStatus = buildRunStatus(state);

  const writeLog = useCallback(
    (event: string, level: "info" | "done" | "fail", fields: LogFields) => {
      dispatch({
        type: "add-log",
        fields,
        log: {
          id: createId("log"),
          event,
          level,
          time: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
          fields,
        },
      });
    },
    [],
  );

  const beginStage = useCallback(
    (stageName: string, parentArtifactId: string | null = null, inputSummary: unknown = null) => {
      const stage = beginUiStage({
        uiTraceId: state.uiTraceId,
        backendTraceId: state.processingJob?.traceId ?? null,
        stageName,
        parentArtifactId,
        inputSummary,
      });
      dispatch({ type: "set-active-stage", stageId: stage.stageId });
      writeLog("stage.start", "info", {
        runId: stage.runId,
        uiTraceId: stage.uiTraceId,
        backendTraceId: state.processingJob?.traceId ?? null,
        stageId: stage.stageId,
        artifactId: stage.artifactId,
        parentArtifactId: stage.parentArtifactId,
        stageName,
        inputSummary,
      });
      emitUiStage(stage, "stage.start");
      return stage;
    },
    [state.processingJob?.traceId, state.uiTraceId, writeLog],
  );

  const finishStage = useCallback(
    (stage: UiStage, artifactId = stage.artifactId, outputSummary: unknown = null) => {
      const durationMs = Math.max(0, Math.round(performance.now() - stage.startedAt));
      writeLog("stage.end", "done", {
        runId: stage.runId,
        uiTraceId: stage.uiTraceId,
        backendTraceId: state.processingJob?.traceId ?? null,
        stageId: stage.stageId,
        artifactId,
        parentArtifactId: stage.parentArtifactId,
        stageName: stage.stageName,
        outputSummary,
        durationMs,
      });
      dispatch({ type: "set-active-stage", stageId: stage.stageId });
      emitUiStage(stage, "stage.end", { artifactId, outputSummary, durationMs });
    },
    [state.processingJob?.traceId, writeLog],
  );

  const failStage = useCallback(
    (stage: UiStage, error: unknown, details: Partial<LogFields> & { processingJob?: ProcessingJob | null; debugPayload?: unknown } = {}) => {
      const summary = safeErrorSummary(error, details.errorCode ?? "unknown_error", details.errorMessage ?? "未知错误", details.canRetry ?? true);
      const errorInfo = {
        errorName: error instanceof Error ? error.name : "Error",
        errorCode: summary.code,
        errorStage: details.errorStage ?? details.processingJob?.stage ?? null,
        errorMessage: summary.message,
        canRetry: summary.retryable,
      };
      const snapshot = {
        id: createId("snapshot"),
        runId: stage.runId,
        uiTraceId: stage.uiTraceId,
        backendTraceId: details.backendTraceId ?? details.processingJob?.traceId ?? state.processingJob?.traceId ?? null,
        stageId: stage.stageId,
        stageName: stage.stageName,
        artifactId: stage.artifactId,
        parentArtifactId: stage.parentArtifactId,
        createdAt: new Date().toISOString(),
        payload: { kind: "stage-failure", ...errorInfo, processingJob: details.processingJob ?? null },
      };
      dispatch({ type: "add-snapshot", snapshot });
      writeLog("stage.fail", "fail", {
        runId: stage.runId,
        uiTraceId: stage.uiTraceId,
        backendTraceId: snapshot.backendTraceId,
        stageId: stage.stageId,
        artifactId: stage.artifactId,
        parentArtifactId: stage.parentArtifactId,
        stageName: stage.stageName,
        ...errorInfo,
        debugSnapshotId: snapshot.id,
        debugSnapshotUri: details.debugSnapshotUri ?? null,
      });
      emitUiStage(stage, "stage.fail", {
        errorSummary: {
          code: errorInfo.errorCode,
          message: errorInfo.errorMessage,
          stageName: errorInfo.errorStage ?? stage.stageName,
          retryable: errorInfo.canRetry,
          debugSnapshotUri: details.debugSnapshotUri ?? null,
        },
        debugPayload: details.debugPayload ?? snapshot.payload,
      });
    },
    [state.processingJob?.traceId, writeLog],
  );

  const handleSampleUpload = useCallback(
    async (file: File, cacheDecision: "ask" | "refresh" = "ask") => {
      const token = uploadTokenRef.current + 1;
      uploadTokenRef.current = token;
      const stage = beginStage(STAGES.ingest, null, {
        filename: file.name,
        mimeType: file.type || null,
        sizeBytes: file.size,
        frameSampleRateFps: frameSampleRate,
        enableAudioFeatureAnalysis,
      });
      dispatch({ type: "set-upload-state", isUploadingSample: true, uploadStatusText: "上传中", processingJob: null, errorSummary: null });
      let latestJob: ProcessingJob | null = null;
      try {
        const upload = await uploadSampleVideo(file, { frameSampleRateFps: frameSampleRate, enableAudioSeparation, enableSubtitleRecognition, enableAudioFeatureAnalysis, cacheDecision });
        if (token !== uploadTokenRef.current) return;
        if ("cacheHit" in upload && upload.cacheHit) {
          setCachePrompt({ file, cachedItem: upload.cachedItem, token });
          dispatch({ type: "set-upload-state", isUploadingSample: false, uploadStatusText: "命中缓存", processingJob: null });
          setSaveStatus("命中同视频缓存，等待选择");
          return;
        }
        const pendingJob: ProcessingJob = {
          jobId: upload.processingJobId,
          sampleVideoId: upload.sampleVideoId,
          status: "pending",
          stage: "uploaded",
          progress: 0,
          traceId: upload.traceId,
        };
        latestJob = pendingJob;
        dispatch({ type: "set-processing-job", processingJob: pendingJob, uploadStatusText: "上传中" });
        writeActiveUploadJob({ processingJobId: upload.processingJobId, sampleVideoId: upload.sampleVideoId, traceId: upload.traceId });
        for (let attempt = 0; attempt < 120; attempt += 1) {
          await delay(1000);
          if (token !== uploadTokenRef.current) return;
          const job = await getProcessingJob(upload.processingJobId);
          if (token !== uploadTokenRef.current) return;
          latestJob = job;
          dispatch({ type: "set-processing-job", processingJob: job, uploadStatusText: stageLabel(job) });
          if (job.status === "processed") {
            const artifact = await getSampleArtifact(upload.sampleVideoId);
            if (token !== uploadTokenRef.current) return;
            dispatch({ type: "apply-artifact", artifact });
            dispatch({ type: "set-upload-state", isUploadingSample: false, uploadStatusText: "生成产物完成" });
            const version = addVersion("样例处理完成", stage.stageName, artifact.sampleVideo.artifactId, null);
            dispatch({ type: "add-version", version });
            writeWorkbenchDraft({ sampleVideoId: artifact.sampleVideoId, artifactId: artifact.sampleVideo.artifactId, traceId: job.traceId, sampleArtifact: artifact, selectedFrameId: artifact.frames[0]?.frameId ?? null, selectedDerivativeId: artifact.sampleVideo.normalized.artifactId, versions: [version] });
            writeActiveUploadJob(null);
            setSaveStatus("已保存样例处理完成");
            finishStage(stage, artifact.sampleVideo.artifactId, {
              sampleVideoId: artifact.sampleVideoId,
              frameCount: artifact.frames.length,
              hasAudio: Boolean(artifact.audio?.uri),
            });
            return;
          }
          if (job.status === "failed") {
            dispatch({ type: "set-error", errorSummary: job.errorSummary ?? null, uploadStatusText: "处理失败" });
            writeActiveUploadJob(null);
            throw buildIngestError(job);
          }
        }
        throw new Error("处理超时，请稍后查询任务状态");
      } catch (error) {
        failStage(stage, error, {
          errorCode: (error as { code?: string })?.code,
          errorMessage: error instanceof Error ? error.message : "样例处理失败",
          backendTraceId: latestJob?.traceId ?? state.processingJob?.traceId ?? null,
          processingJob: latestJob ?? state.processingJob,
          debugPayload: { kind: "sample-ingest-failure", processingJob: latestJob ?? state.processingJob },
        });
        dispatch({ type: "set-upload-state", isUploadingSample: false, uploadStatusText: "处理失败" });
        writeActiveUploadJob(null);
      }
    },
    [beginStage, enableAudioFeatureAnalysis, enableAudioSeparation, enableSubtitleRecognition, failStage, finishStage, frameSampleRate, state.processingJob],
  );

  const reuseCache = useCallback(async () => {
    if (!cachePrompt) return;
    const prompt = cachePrompt;
    setCachePrompt(null);
    const stage = beginStage(STAGES.ingest, null, { cacheDecision: "reuse", sampleVideoId: prompt.cachedItem.sampleVideoId });
    try {
      const detail = await getLibraryItemDetail(prompt.cachedItem.sampleVideoId);
      if (prompt.token !== uploadTokenRef.current) return;
      dispatch({ type: "apply-artifact", artifact: detail.artifact });
      dispatch({ type: "set-upload-state", isUploadingSample: false, uploadStatusText: "已复用缓存", processingJob: null });
      const version = addVersion("复用缓存样例", stage.stageName, detail.artifact.sampleVideo.artifactId, null);
      dispatch({ type: "add-version", version });
      writeWorkbenchDraft({ sampleVideoId: detail.artifact.sampleVideoId, artifactId: detail.artifact.sampleVideo.artifactId, traceId: detail.artifact.trace?.traceId ?? null, sampleArtifact: detail.artifact, selectedFrameId: detail.artifact.frames[0]?.frameId ?? null, selectedDerivativeId: detail.artifact.sampleVideo.normalized.artifactId, versions: [version] });
      setSaveStatus("已复用缓存");
      finishStage(stage, detail.artifact.sampleVideo.artifactId, { cacheHit: true, sampleVideoId: detail.artifact.sampleVideoId });
    } catch (error) {
      failStage(stage, error, { errorMessage: error instanceof Error ? error.message : "复用缓存失败" });
    }
  }, [beginStage, cachePrompt, failStage, finishStage]);

  const refreshCache = useCallback(() => {
    if (!cachePrompt) return;
    const file = cachePrompt.file;
    setCachePrompt(null);
    handleSampleUpload(file, "refresh");
  }, [cachePrompt, handleSampleUpload]);

  const reuseShotCache = useCallback(async () => {
    if (!shotCachePrompt || !state.sampleVideo) return;
    const prompt = shotCachePrompt;
    setShotCachePrompt(null);
    try {
      await runShotBoundaryAnalysis(state, agentAnalysisFps, setAgentJob, dispatch, writeActiveAgentJob, undefined, "reuse");
      setSaveStatus("已复用切镜缓存");
    } catch (error) {
      setSaveStatus(error instanceof Error ? error.message : "复用切镜缓存失败");
    }
  }, [agentAnalysisFps, shotCachePrompt, state]);

  const refreshShotCache = useCallback(() => {
    if (!state.sampleVideo) return;
    setShotCachePrompt(null);
    runShotBoundaryAnalysis(state, agentAnalysisFps, setAgentJob, dispatch, writeActiveAgentJob, undefined, "refresh").catch((error) => setSaveStatus(error instanceof Error ? error.message : "切镜分析失败"));
  }, [agentAnalysisFps, state]);

  const handleUnderstand = () => {
    if (!state.sampleVideo) return;
    const stage = beginStage(STAGES.understand, state.sampleVideo.artifactId);
    const cards = createStructureCards(state.sampleVideo);
    dispatch({ type: "set-structure-cards", cards });
    const structureArtifactId = createId("artifact");
    dispatch({ type: "add-version", version: addVersion("结构理解完成", stage.stageName, structureArtifactId, state.sampleVideo.artifactId) });
    finishStage(stage, structureArtifactId, { cardCount: cards.length });
  };

  const handleGeneratePlan = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!state.sampleVideo || state.structureCards.length === 0) return;
    const parentArtifactId = state.structureCards[state.structureCards.length - 1].artifactId;
    const stage = beginStage(STAGES.transfer, parentArtifactId);
    const form = event.currentTarget;
    const profile = {
      topic: sanitizeText(new FormData(form).get("topic"), 60) || "新主题",
      sellingPoints: sanitizeText(new FormData(form).get("sellingPoints"), 120) || "核心卖点待补充",
      audience: sanitizeText(new FormData(form).get("audience"), 60) || "目标人群待补充",
      platform: sanitizeText(new FormData(form).get("platform"), 60) || "短视频平台",
      duration: sanitizeText(new FormData(form).get("duration"), 32) || "与样例接近",
      tone: sanitizeText(new FormData(form).get("tone"), 60) || "清晰、有节奏",
    };
    const result = createGeneratedPlan(profile, state.structureCards, parentArtifactId);
    dispatch({ type: "set-generated-plan", generatedPlan: result.generatedPlan, mappings: result.mappings });
    dispatch({ type: "add-version", version: addVersion("迁移方案生成", stage.stageName, result.generatedArtifactId, parentArtifactId) });
    finishStage(stage, result.generatedArtifactId, { shotCount: result.generatedPlan.shots.length, mappingCount: result.mappings.length });
  };

  const handleSelectAudioFeature = useCallback(
    (marker: AudioFeatureMarker) => {
      dispatch({ type: "select-media", activeMediaKind: "audioFeature", selectedDerivativeId: resolveAudioFeatureSourceId(state), selectedFrameId: null, selectedAudioFeatureMarkerId: marker.id });
      audioSeekRequestIdRef.current += 1;
      setAudioSeekRequest({ requestId: audioSeekRequestIdRef.current, time: marker.time });
    },
    [state],
  );

  const fileLabel = state.isUploadingSample ? `${state.uploadStatusText ?? "处理中"} ${state.processingJob ? `${state.processingJob.progress}%` : ""}`.trim() : state.sampleVideo?.fileName ?? "未选择文件";

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
          capabilities={state.capabilities}
          enableAudioSeparation={enableAudioSeparation}
          enableSubtitleRecognition={enableSubtitleRecognition}
          enableAudioFeatureAnalysis={enableAudioFeatureAnalysis}
          onFrameSampleRateChange={setFrameSampleRate}
          onEnableAudioSeparationChange={setEnableAudioSeparation}
          onEnableSubtitleRecognitionChange={setEnableSubtitleRecognition}
          onEnableAudioFeatureAnalysisChange={setEnableAudioFeatureAnalysis}
          onUpload={handleSampleUpload}
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
          processingText={state.processingJob ? `${state.uploadStatusText ?? state.processingJob.stage} / ${state.processingJob.progress}%` : "未加载样例"}
          traceText={state.processingJob?.traceId ? `trace ${shortId(state.processingJob.traceId)}` : "等待后端返回 trace"}
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
          shotBoundaryAnalysis={state.sampleArtifact?.shotBoundaryAnalysis ?? null}
          agentJob={agentJob}
          agentAnalysisFps={agentAnalysisFps}
          onAgentAnalysisFpsChange={setAgentAnalysisFps}
          onRunShotBoundary={() => runShotBoundaryAnalysis(
            state,
            agentAnalysisFps,
            setAgentJob,
            dispatch,
            writeActiveAgentJob,
            async (cachedItem) => {
              setShotCachePrompt({ cachedItem, token: uploadTokenRef.current });
              setSaveStatus("命中切镜缓存，等待选择");
            },
            "ask",
          ).catch((error) => setSaveStatus(error instanceof Error ? error.message : "切镜分析失败"))}
          onSelectShot={(time) => {
            if (videoRef.current) videoRef.current.currentTime = time;
            setCurrentTime(time);
            dispatch({ type: "select-media", activeMediaKind: "video", selectedDerivativeId: state.sampleVideo?.artifactId ?? state.selectedDerivativeId, selectedFrameId: null });
          }}
          onSubtitleDraftChange={(draft) => dispatch({ type: "update-subtitle-draft", ...draft })}
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
      {cachePrompt ? <CacheDecisionDialog item={cachePrompt.cachedItem} onReuse={reuseCache} onRefresh={refreshCache} onCancel={() => setCachePrompt(null)} /> : null}
      {shotCachePrompt ? <CacheDecisionDialog item={shotCachePrompt.cachedItem} onReuse={reuseShotCache} onRefresh={refreshShotCache} onCancel={() => setShotCachePrompt(null)} /> : null}
      <form id="profileForm" className="sr-only" onSubmit={handleGeneratePlan}>
        <input name="topic" />
        <input name="sellingPoints" />
        <input name="audience" />
        <input name="platform" />
        <input name="duration" />
        <input name="tone" />
        <button type="submit">生成方案</button>
      </form>
      <button id="understandBtn" className="sr-only" type="button" onClick={handleUnderstand}>
        结构理解
      </button>
    </div>
  );
}

function buildRunStatus(state: WorkbenchState) {
  const latest = state.logs[0];
  if (!latest) return { label: "等待输入", stageId: null, backendTraceId: state.processingJob?.traceId ?? null };
  const labelMap = { info: "运行中", done: "阶段完成", fail: "阶段失败" };
  return { label: labelMap[latest.level] ?? "等待输入", stageId: latest.fields.stageId, backendTraceId: latest.fields.backendTraceId ?? state.processingJob?.traceId ?? null };
}
