import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { getCapabilities, getLibraryItemDetail, getProcessingJob, getSampleArtifact, resolveCacheDecision, resolveShotBoundaryCacheDecision, saveSubtitleRevision, uploadSampleVideo } from "../api/client";
import { createStructureCardsFromSegments } from "../domain";
import { addVersion, STAGES, workbenchReducer, createInitialState } from "../state";
import type { AudioFeatureMarker, LibraryItemSummary, LogFields, ProcessingJob, SampleArtifact, SubtitleArtifact, SubtitleDraft, SubtitleSegment } from "../types";
import { beginUiStage, emitUiStage, safeErrorSummary, type UiStage } from "../observability/uiStage";
import { createId, sanitizeText, shortId } from "../utils/format";
import { clampVisibleSeconds } from "../utils/timeline";
import { attachAgentJob, attachProcessingJob, buildIngestError, buildSubtitleSaveError, delay, findAudioFeatureMarker, findCurrentShot, findCurrentStructureCard, resolveAudioFeatureSourceId, runScriptSegmentAnalysis, runShotBoundaryAnalysis, stageLabel } from "../utils/workbenchHelpers";
import { readWorkbenchDraft, writeActiveAgentJob, writeActiveUploadJob, writeWorkbenchDraft } from "../utils/workbenchDraft";
import { initialViewFromPath, setWorkbenchView, type WorkbenchView } from "../utils/workbenchView";
import { useWorkbenchPlaybackSync } from "../hooks/useWorkbenchPlaybackSync";
import { useResizableWorkspaceLayout } from "../hooks/useResizableWorkspaceLayout";
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
type CachePrompt = { file: File; cachedItem: LibraryItemSummary; token: number } | null;
type ShotCachePrompt = { jobId: string; sampleVideoId: string; cachedItem: LibraryItemSummary; token: number } | null;
type ScriptCachePrompt = { jobId: string; sampleVideoId: string; cachedItem: LibraryItemSummary; token: number } | null;
const MIN_ANALYSIS_FPS = 1;
const MAX_ANALYSIS_FPS = 10;
const SUBTITLE_SAVE_STAGE = "sample.subtitle.revised";

export function WorkbenchApp() {
  const [state, dispatch] = useReducer(workbenchReducer, undefined, createInitialState);
  const [frameSampleRate, setFrameSampleRate] = useState(3);
  const [enableAudioSeparation, setEnableAudioSeparation] = useState(true);
  const [enableSubtitleRecognition, setEnableSubtitleRecognition] = useState(true);
  const [enableAudioFeatureAnalysis, setEnableAudioFeatureAnalysis] = useState(true);
  const [saveStatus, setSaveStatus] = useState("本地草稿");
  const [audioSeekRequest, setAudioSeekRequest] = useState<AudioSeekRequest | null>(null);
  const [agentJob, setAgentJob] = useState<ProcessingJob | null>(null);
  const [agentAnalysisFps, setAgentAnalysisFps] = useState(1);
  const [cachePrompt, setCachePrompt] = useState<CachePrompt>(null);
  const [shotCachePrompt, setShotCachePrompt] = useState<ShotCachePrompt>(null);
  const [scriptCachePrompt, setScriptCachePrompt] = useState<ScriptCachePrompt>(null);
  const [activeView, setActiveView] = useState<WorkbenchView>(() => initialViewFromPath());
  const [scriptSegmentJob, setScriptSegmentJob] = useState<ProcessingJob | null>(null);
  const audioSeekRequestIdRef = useRef(0);
  const uploadTokenRef = useRef(0);
  const subtitleSaveTokenRef = useRef(0);
  const subtitleSaveQueueRef = useRef(Promise.resolve(true));
  const subtitleSaveStateRef = useRef({
    sampleVideo: state.sampleVideo,
    subtitles: state.subtitles,
    subtitleDrafts: state.subtitleDrafts,
    processingTraceId: state.processingJob?.traceId ?? null,
  });
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const miniCanvasRef = useRef<HTMLCanvasElement>(null);
  const workspaceGridRef = useRef<HTMLElement>(null);
  const lastSegmentIdRef = useRef<string | null>(null);
  const lastShotIdRef = useRef<string | null>(null);
  const workspaceLayout = useResizableWorkspaceLayout(workspaceGridRef);
  const shotBoundaryAnalysis = state.sampleArtifact?.shotBoundaryAnalysis ?? null;
  const { currentTime, setCurrentTime, currentCard, currentShot } = useWorkbenchPlaybackSync({
    videoRef,
    structureCards: state.structureCards,
    shotBoundaryAnalysis,
    lastSegmentIdRef,
    lastShotIdRef,
  });

  useEffect(() => {
    const draft = readWorkbenchDraft();
    if (draft?.sampleArtifact) {
      dispatch({ type: "restore-draft", draft });
      setSaveStatus("已恢复最近样例");
    }
    if (draft?.activeUploadJob) attachProcessingJob(draft.activeUploadJob, dispatch, writeActiveUploadJob).catch(() => setSaveStatus("恢复上传任务失败"));
    if (draft?.activeAgentJob) attachAgentJob(draft.activeAgentJob, setAgentJob, dispatch, writeActiveAgentJob, ({ job, cachedItem }) => {
      setShotCachePrompt({ jobId: job.jobId ?? draft.activeAgentJob!.processingJobId, sampleVideoId: job.sampleVideoId ?? draft.activeAgentJob!.sampleVideoId, cachedItem, token: uploadTokenRef.current });
      setSaveStatus("命中切镜缓存，等待选择");
    }).catch(() => setSaveStatus("恢复切镜任务失败"));
    if (draft?.activeAgentJob) setAgentAnalysisFps(normalizeAnalysisFps(draft.activeAgentJob.analysisFps, MIN_ANALYSIS_FPS, MAX_ANALYSIS_FPS));
  }, []);

  useEffect(() => {
    getCapabilities()
      .then((capabilities) => dispatch({ type: "set-capabilities", capabilities }))
      .catch(() => setSaveStatus("能力检测失败"));
  }, []);

  const currentShotId = currentShot?.id ?? null;
  const runStatus = buildRunStatus(state);
  const subtitleDraftEntries = Object.values(state.subtitleDrafts);
  useEffect(() => {
    subtitleSaveStateRef.current = {
      sampleVideo: state.sampleVideo,
      subtitles: state.subtitles,
      subtitleDrafts: state.subtitleDrafts,
      processingTraceId: state.processingJob?.traceId ?? null,
    };
  }, [state.processingJob?.traceId, state.sampleVideo, state.subtitleDrafts, state.subtitles]);

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
      const previousArtifact = state.sampleArtifact;
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
            dispatch({
              type: "set-error",
              errorSummary: previousArtifact
                ? {
                  ...(job.errorSummary ?? null),
                  message: `新处理失败，当前仍保留旧样例结果。${job.errorSummary?.message ? ` ${job.errorSummary.message}` : ""}`.trim(),
                }
                : (job.errorSummary ?? null),
              uploadStatusText: previousArtifact ? "新处理失败，仍使用旧样例结果" : "处理失败",
            });
            writeActiveUploadJob(null);
            throw buildIngestError(job);
          }
        }
        throw new Error("处理超时，请稍后查询任务状态");
      } catch (error) {
        const preserveOldArtifact = Boolean(previousArtifact);
        failStage(stage, error, {
          errorCode: (error as { code?: string })?.code,
          errorMessage: error instanceof Error ? error.message : "样例处理失败",
          backendTraceId: latestJob?.traceId ?? state.processingJob?.traceId ?? null,
          processingJob: latestJob ?? state.processingJob,
          debugPayload: { kind: "sample-ingest-failure", processingJob: latestJob ?? state.processingJob },
        });
        dispatch({
          type: "set-upload-state",
          isUploadingSample: false,
          uploadStatusText: preserveOldArtifact ? "新处理失败，仍使用旧样例结果" : "处理失败",
        });
        writeActiveUploadJob(null);
      }
    },
    [beginStage, enableAudioFeatureAnalysis, enableAudioSeparation, enableSubtitleRecognition, failStage, finishStage, frameSampleRate, state.processingJob, state.sampleArtifact],
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
      const job = await resolveShotBoundaryCacheDecision(prompt.jobId, "reuse");
      setAgentJob(job);
      const artifact = await getSampleArtifact(prompt.sampleVideoId);
      dispatch({ type: "set-shot-boundary-analysis", artifact });
      writeActiveAgentJob(null);
      setSaveStatus("已复用切镜缓存");
    } catch (error) {
      setSaveStatus(error instanceof Error ? error.message : "复用切镜缓存失败");
    }
  }, [shotCachePrompt, state.sampleVideo]);

  const refreshShotCache = useCallback(async () => {
    if (!state.sampleVideo || !shotCachePrompt) return;
    const prompt = shotCachePrompt;
    setShotCachePrompt(null);
    try {
      const job = await resolveShotBoundaryCacheDecision(prompt.jobId, "refresh");
      setAgentJob(job);
      await attachAgentJob({ processingJobId: prompt.jobId, sampleVideoId: prompt.sampleVideoId, traceId: job.traceId, analysisFps: agentAnalysisFps }, setAgentJob, dispatch, writeActiveAgentJob, ({ job: waitingJob, cachedItem }) => {
        setShotCachePrompt({ jobId: waitingJob.jobId ?? prompt.jobId, sampleVideoId: waitingJob.sampleVideoId ?? prompt.sampleVideoId, cachedItem, token: uploadTokenRef.current });
        setSaveStatus("命中切镜缓存，等待选择");
      });
    } catch (error) {
      setSaveStatus(error instanceof Error ? error.message : "切镜分析失败");
    }
  }, [agentAnalysisFps, shotCachePrompt, state.sampleVideo]);

  const persistWorkbenchArtifact = useCallback((artifact: Parameters<typeof writeWorkbenchDraft>[0]["sampleArtifact"], traceId: string | null) => {
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

  const reuseScriptCache = useCallback(async () => {
    if (!scriptCachePrompt) return;
    const prompt = scriptCachePrompt;
    setScriptCachePrompt(null);
    try {
      const job = await resolveCacheDecision(prompt.jobId, "reuse");
      setScriptSegmentJob(job);
      const artifact = await getSampleArtifact(prompt.sampleVideoId);
      dispatch({ type: "apply-artifact", artifact });
      persistWorkbenchArtifact(artifact, job.traceId ?? state.processingJob?.traceId ?? null);
      dispatch({
        type: "add-version",
        version: addVersion(
          "复用脚本段落缓存",
          STAGES.understand,
          artifact.scriptSegmentAnalysis?.artifactId ?? artifact.sampleVideo.artifactId,
          artifact.scriptSegmentAnalysis?.parentArtifactId ?? artifact.shotBoundaryAnalysis?.artifactId ?? null,
        ),
      });
      setScriptSegmentJob(null);
      setSaveStatus("已复用脚本段落缓存");
    } catch (error) {
      setSaveStatus(error instanceof Error ? error.message : "复用脚本段落缓存失败");
    }
  }, [persistWorkbenchArtifact, scriptCachePrompt, state.processingJob?.traceId]);

  const refreshScriptCache = useCallback(async () => {
    if (!state.sampleVideo || !scriptCachePrompt) return;
    const prompt = scriptCachePrompt;
    setScriptCachePrompt(null);
    try {
      const result = await runScriptSegmentAnalysis(
        state,
        dispatch,
        setScriptSegmentJob,
        async ({ job, cachedItem }) => {
          setScriptCachePrompt({ jobId: job.jobId ?? prompt.jobId, sampleVideoId: job.sampleVideoId ?? prompt.sampleVideoId, cachedItem, token: uploadTokenRef.current });
          setSaveStatus("命中脚本段落缓存，等待选择");
        },
        "refresh",
      );
      if (result?.artifact?.scriptSegmentAnalysis) {
        persistWorkbenchArtifact(result.artifact, result.job.traceId ?? state.processingJob?.traceId ?? null);
        dispatch({
          type: "add-version",
          version: addVersion(
            "脚本段落重新生成",
            STAGES.understand,
            result.artifact.scriptSegmentAnalysis.artifactId,
            result.artifact.scriptSegmentAnalysis.parentArtifactId ?? state.sampleArtifact?.shotBoundaryAnalysis?.artifactId ?? null,
          ),
        });
        setSaveStatus("脚本段落已重新生成");
      }
    } catch (error) {
      setSaveStatus(error instanceof Error ? error.message : "脚本段落分析失败");
    }
  }, [dispatch, persistWorkbenchArtifact, scriptCachePrompt, state, state.processingJob?.traceId, state.sampleArtifact?.shotBoundaryAnalysis?.artifactId]);

  const buildSubtitleSegmentsForSave = useCallback((subtitles: SubtitleArtifact, drafts: Record<string, SubtitleDraft>) => {
    return subtitles.segments.map((segment) => {
      const draft = drafts[segment.id];
      return draft
        ? {
          id: segment.id,
          start: draft.start,
          end: draft.end,
          text: draft.text,
          confidence: segment.confidence ?? null,
        }
        : {
          id: segment.id,
          start: segment.start,
          end: segment.end,
          text: segment.text,
          confidence: segment.confidence ?? null,
      };
    });
  }, []);

  const isSubtitleDraftChanged = useCallback((artifact: SubtitleArtifact | null | undefined, draft: SubtitleDraft) => {
    const sourceArtifactId = artifact?.artifactId ?? null;
    if (!artifact || draft.sourceArtifactId !== sourceArtifactId) return true;
    const sourceSegment = artifact.segments.find((item) => item.id === draft.segmentId);
    if (!sourceSegment) return true;
    return sourceSegment.text !== draft.text || sourceSegment.start !== draft.start || sourceSegment.end !== draft.end;
  }, []);

  const saveSubtitleDraft = useCallback(async (draft: SubtitleDraft, options: { silent?: boolean; allowConflictRetry?: boolean } = {}) => {
    const currentState = subtitleSaveStateRef.current;
    const subtitles = currentState.subtitles;
    const sampleVideo = currentState.sampleVideo;
    if (!subtitles || !sampleVideo) return { ok: false as const, reason: "missing_subtitles" };
    if (!isSubtitleDraftChanged(subtitles, draft)) {
      dispatch({ type: "clear-subtitle-draft", segmentId: draft.segmentId, saveToken: draft.saveToken ?? null });
      if (!options.silent) setSaveStatus("字幕未变化，无需保存");
      return { ok: true as const, changed: false };
    }
    const stage = beginStage(SUBTITLE_SAVE_STAGE, subtitles.artifactId ?? sampleVideo.artifactId, {
      sampleVideoId: sampleVideo.id,
      sourceSubtitleArtifactId: subtitles.artifactId ?? null,
      segmentId: draft.segmentId,
      queuedDraftCount: Object.keys(currentState.subtitleDrafts).length,
    });
    dispatch({ type: "set-subtitle-draft-status", segmentId: draft.segmentId, saveState: "saving", saveToken: draft.saveToken ?? null });
    try {
      const segments = buildSubtitleSegmentsForSave(subtitles, subtitleSaveStateRef.current.subtitleDrafts);
      const result = await saveSubtitleRevision(sampleVideo.id, segments, {
        expectedSubtitleArtifactId: subtitles.artifactId ?? null,
        expectedRevisionIndex: subtitles.revisionIndex ?? null,
      });
      dispatch({ type: "sync-subtitle-artifact", artifact: result.sampleArtifact });
      dispatch({
        type: "set-subtitle-draft-status",
        segmentId: draft.segmentId,
        saveState: "saved",
        saveToken: draft.saveToken ?? null,
        lastSavedArtifactId: result.sampleArtifact.subtitles?.artifactId ?? null,
      });
      dispatch({ type: "clear-subtitle-draft", segmentId: draft.segmentId, saveToken: draft.saveToken ?? null });
      persistWorkbenchArtifact(result.sampleArtifact, result.traceId ?? subtitleSaveStateRef.current.processingTraceId ?? null);
      setSaveStatus("字幕已自动保存");
      finishStage(stage, result.sampleArtifact.subtitles?.artifactId ?? stage.artifactId, {
        sampleVideoId: result.sampleArtifact.sampleVideoId,
        subtitleArtifactId: result.sampleArtifact.subtitles?.artifactId ?? null,
        revisionIndex: result.sampleArtifact.subtitles?.revisionIndex ?? null,
        changed: result.changed,
      });
      return { ok: true as const, changed: result.changed, artifact: result.sampleArtifact };
    } catch (error) {
      const rawError = error as { code?: string; traceId?: string | null; debugSnapshotUri?: string | null; stageName?: string | null; retryable?: boolean | null };
      if (rawError?.code === "subtitle_revision_conflict" && options.allowConflictRetry !== false) {
        const latestArtifact = await getSampleArtifact(sampleVideo.id);
        dispatch({ type: "sync-subtitle-artifact", artifact: latestArtifact });
        persistWorkbenchArtifact(latestArtifact, rawError.traceId ?? subtitleSaveStateRef.current.processingTraceId ?? null);
        const refreshedDraft = subtitleSaveStateRef.current.subtitleDrafts[draft.segmentId];
        if (refreshedDraft) {
          return saveSubtitleDraft(refreshedDraft, { ...options, allowConflictRetry: false });
        }
      }
      const normalizedError = buildSubtitleSaveError(error);
      const message = normalizedError.message;
      dispatch({ type: "set-subtitle-draft-status", segmentId: draft.segmentId, saveState: "failed", saveToken: draft.saveToken ?? null, errorMessage: message });
      failStage(stage, normalizedError, {
        errorCode: (normalizedError as { code?: string })?.code,
        errorMessage: message,
        errorStage: SUBTITLE_SAVE_STAGE,
        backendTraceId: (error as { traceId?: string })?.traceId ?? subtitleSaveStateRef.current.processingTraceId ?? null,
        debugSnapshotUri: (error as { debugSnapshotUri?: string })?.debugSnapshotUri ?? null,
        debugPayload: { kind: "subtitle-save-failure", segmentId: draft.segmentId, sourceArtifactId: draft.sourceArtifactId ?? null },
      });
      setSaveStatus(`字幕保存失败：${message}`);
      return { ok: false as const, error: normalizedError };
    }
  }, [beginStage, buildSubtitleSegmentsForSave, failStage, finishStage, isSubtitleDraftChanged, persistWorkbenchArtifact]);

  const enqueueSubtitleDraftSave = useCallback((draft: SubtitleDraft, options: { silent?: boolean } = {}) => {
    subtitleSaveQueueRef.current = subtitleSaveQueueRef.current
      .catch(() => true)
      .then(async () => {
        const currentDraft = subtitleSaveStateRef.current.subtitleDrafts[draft.segmentId];
        if (!currentDraft || currentDraft.saveToken !== draft.saveToken) return true;
        const result = await saveSubtitleDraft(currentDraft, options);
        return result.ok;
      });
    return subtitleSaveQueueRef.current;
  }, [saveSubtitleDraft]);

  const flushSubtitleDraftsBeforeShotBoundary = useCallback(async () => {
    await subtitleSaveQueueRef.current.catch(() => true);
    const currentState = subtitleSaveStateRef.current;
    const drafts = Object.values(currentState.subtitleDrafts);
    if (!drafts.length) return true;
    for (const draft of drafts) {
      if (!currentState.subtitles || !isSubtitleDraftChanged(currentState.subtitles, draft)) {
        dispatch({ type: "clear-subtitle-draft", segmentId: draft.segmentId, saveToken: draft.saveToken ?? null });
        continue;
      }
      const ok = await enqueueSubtitleDraftSave(draft, { silent: true });
      if (!ok) return false;
    }
    await subtitleSaveQueueRef.current.catch(() => false);
    return !Object.values(subtitleSaveStateRef.current.subtitleDrafts).some((entry) => entry.saveState === "failed");
  }, [enqueueSubtitleDraftSave, isSubtitleDraftChanged]);

  const handleUnderstand = useCallback(async () => {
    if (!state.sampleVideo || !state.sampleArtifact?.shotBoundaryAnalysis?.shots?.length) return null;
    const stage = beginStage(STAGES.understand, state.sampleArtifact.shotBoundaryAnalysis.artifactId, {
      sampleVideoId: state.sampleVideo.id,
      sourceShotBoundaryArtifactId: state.sampleArtifact.shotBoundaryAnalysis.artifactId,
      shotCount: state.sampleArtifact.shotBoundaryAnalysis.shots.length,
    });
    try {
      const result = await runScriptSegmentAnalysis(
        state,
        dispatch,
        setScriptSegmentJob,
        async ({ job, cachedItem }) => {
          if (!job.jobId || !job.sampleVideoId) return;
          setScriptCachePrompt({ jobId: job.jobId, sampleVideoId: job.sampleVideoId, cachedItem, token: uploadTokenRef.current });
          setSaveStatus("命中脚本段落缓存，等待选择");
        },
        "ask",
      );
      if (!result) return null;
      if (!result?.artifact?.scriptSegmentAnalysis) {
        throw new Error("脚本段落分析未返回有效产物");
      }
      persistWorkbenchArtifact(result.artifact, result.job.traceId ?? state.processingJob?.traceId ?? null);
      dispatch({
        type: "add-version",
        version: addVersion(
          "结构理解完成",
          stage.stageName,
          result.artifact.scriptSegmentAnalysis.artifactId,
          result.artifact.scriptSegmentAnalysis.parentArtifactId ?? state.sampleArtifact.shotBoundaryAnalysis.artifactId,
        ),
      });
      finishStage(stage, result.artifact.scriptSegmentAnalysis.artifactId, {
        segmentCount: result.artifact.scriptSegmentAnalysis.segments.length,
        validatorCode: result.artifact.scriptSegmentAnalysis.validation?.validatorCode ?? null,
      });
      return result.artifact;
    } catch (error) {
      setScriptSegmentJob(null);
      failStage(stage, error, {
        errorCode: (error as { code?: string })?.code,
        errorMessage: error instanceof Error ? error.message : "脚本段落分析失败",
        errorStage: STAGES.understand,
        backendTraceId: scriptSegmentJob?.traceId ?? state.processingJob?.traceId ?? null,
        debugPayload: { kind: "script-segment-failure", sampleVideoId: state.sampleVideo.id },
      });
      throw error;
    }
  }, [beginStage, dispatch, failStage, finishStage, persistWorkbenchArtifact, scriptSegmentJob?.traceId, state, state.processingJob?.traceId]);

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
          shotBoundaryAnalysis={shotBoundaryAnalysis}
          shotBoundaryAnalysisHistory={state.sampleArtifact?.shotBoundaryAnalysisHistory ?? null}
          currentShot={currentShot}
          currentShotId={currentShotId}
          agentJob={agentJob}
          scriptSegmentAnalysis={state.sampleArtifact?.scriptSegmentAnalysis ?? null}
          scriptSegmentAnalysisHistory={state.sampleArtifact?.scriptSegmentAnalysisHistory ?? null}
          scriptSegmentJob={scriptSegmentJob}
          agentAnalysisFps={agentAnalysisFps}
          onAgentAnalysisFpsChange={(value) => setAgentAnalysisFps(normalizeAnalysisFps(value, MIN_ANALYSIS_FPS, MAX_ANALYSIS_FPS))}
          onRunShotBoundary={() => {
            flushSubtitleDraftsBeforeShotBoundary()
              .then((ready) => {
                if (!ready) {
                  setSaveStatus("字幕保存失败，已阻止切镜分析；请修复后重试");
                  throw new Error("字幕保存失败，已阻止切镜分析");
                }
                return runShotBoundaryAnalysis(
                  state,
                  agentAnalysisFps,
                  setAgentJob,
                  dispatch,
                  writeActiveAgentJob,
                  async ({ job, cachedItem }) => {
                    if (!job.jobId || !job.sampleVideoId) return;
                    setShotCachePrompt({ jobId: job.jobId, sampleVideoId: job.sampleVideoId, cachedItem, token: uploadTokenRef.current });
                    setSaveStatus("命中切镜缓存，等待选择");
                  },
                  "ask",
                );
              })
              .catch((error) => setSaveStatus(error instanceof Error ? error.message : "切镜分析失败"));
          }}
          onRunScriptSegment={() => {
            void handleUnderstand().catch((error) => setSaveStatus(error instanceof Error ? error.message : "脚本段落分析失败"));
          }}
          onSelectScriptSegment={(time) => {
            if (videoRef.current) videoRef.current.currentTime = time;
            const card = findCurrentStructureCard(state.structureCards, time);
            const shot = findCurrentShot(shotBoundaryAnalysis?.shots, time);
            lastSegmentIdRef.current = card?.id ?? null;
            lastShotIdRef.current = shot?.id ?? null;
            setCurrentTime(time);
            dispatch({ type: "select-media", activeMediaKind: "video", selectedDerivativeId: state.sampleVideo?.artifactId ?? state.selectedDerivativeId, selectedFrameId: null });
          }}
          onSelectShot={(time) => {
            if (videoRef.current) videoRef.current.currentTime = time;
            const card = findCurrentStructureCard(state.structureCards, time);
            const shot = findCurrentShot(shotBoundaryAnalysis?.shots, time);
            lastSegmentIdRef.current = card?.id ?? null;
            lastShotIdRef.current = shot?.id ?? null;
            setCurrentTime(time);
            dispatch({ type: "select-media", activeMediaKind: "video", selectedDerivativeId: state.sampleVideo?.artifactId ?? state.selectedDerivativeId, selectedFrameId: null });
          }}
          onSubtitleDraftChange={(draft) => {
            const currentSubtitleArtifact = state.subtitles;
            const sourceSegment = currentSubtitleArtifact?.segments.find((item) => item.id === draft.segmentId);
            const changed = !sourceSegment
              || sourceSegment.text !== draft.text
              || sourceSegment.start !== draft.start
              || sourceSegment.end !== draft.end
              || currentSubtitleArtifact?.artifactId !== draft.sourceArtifactId;
            if (!changed) {
              dispatch({ type: "clear-subtitle-draft", segmentId: draft.segmentId });
              setSaveStatus("字幕未变化，无需保存");
              return;
            }
            const saveToken = subtitleSaveTokenRef.current + 1;
            subtitleSaveTokenRef.current = saveToken;
            const nextDraft = {
              ...draft,
              draftVersionId: state.subtitleDrafts[draft.segmentId]?.draftVersionId ?? createId("version"),
              saveToken,
              queuedAt: Date.now(),
              saveState: "idle" as const,
              errorMessage: null,
              lastSavedArtifactId: state.subtitleDrafts[draft.segmentId]?.lastSavedArtifactId ?? null,
            };
            dispatch({ type: "update-subtitle-draft", ...nextDraft });
            void enqueueSubtitleDraftSave(nextDraft);
          }}
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
      {scriptCachePrompt ? <CacheDecisionDialog item={scriptCachePrompt.cachedItem} onReuse={reuseScriptCache} onRefresh={refreshScriptCache} onCancel={() => setScriptCachePrompt(null)} /> : null}
      <button id="understandBtn" className="sr-only" type="button" onClick={handleUnderstand}>
        结构理解
      </button>
    </div>
  );
}
