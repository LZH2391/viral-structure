import { FormEvent, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { getCapabilities, getProcessingJob, getSampleArtifact, uploadSampleVideo } from "../api/client";
import { createGeneratedPlan, createStructureCards } from "../domain";
import { addVersion, DraftState, STAGES, workbenchReducer, createInitialState } from "../state";
import type { LogFields, ProcessingJob, StructureCard, WorkbenchState } from "../types";
import { beginUiStage, emitUiStage, safeErrorSummary, type UiStage } from "../observability/uiStage";
import { createId, sanitizeText, shortId } from "../utils/format";
import { clampVisibleSeconds } from "../utils/timeline";
import { PreviewPanel } from "./PreviewPanel";
import { PropertyPanel } from "./PropertyPanel";
import { ResourcePanel } from "./ResourcePanel";
import { RunStatusBar } from "./RunStatusBar";
import { TimelinePanel } from "./TimelinePanel";

const STORAGE_KEY = "workbench:last-sample";

export function WorkbenchApp() {
  const [state, dispatch] = useReducer(workbenchReducer, undefined, createInitialState);
  const [frameSampleRate, setFrameSampleRate] = useState(1);
  const [enableAudioSeparation, setEnableAudioSeparation] = useState(false);
  const [enableSubtitleRecognition, setEnableSubtitleRecognition] = useState(false);
  const [enableAudioFeatureAnalysis, setEnableAudioFeatureAnalysis] = useState(false);
  const [saveStatus, setSaveStatus] = useState("本地草稿");
  const [currentTime, setCurrentTime] = useState(0);
  const uploadTokenRef = useRef(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const miniCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const draft = readDraft();
    if (!draft?.sampleArtifact) return;
    dispatch({ type: "restore-draft", draft });
    setSaveStatus("已恢复最近样例");
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
    async (file: File) => {
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
        const upload = await uploadSampleVideo(file, { frameSampleRateFps: frameSampleRate, enableAudioSeparation, enableSubtitleRecognition, enableAudioFeatureAnalysis });
        if (token !== uploadTokenRef.current) return;
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
            writeDraft({ sampleVideoId: artifact.sampleVideoId, artifactId: artifact.sampleVideo.artifactId, traceId: job.traceId, sampleArtifact: artifact, selectedFrameId: artifact.frames[0]?.frameId ?? null, selectedDerivativeId: artifact.sampleVideo.normalized.artifactId, versions: [version] });
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
      }
    },
    [beginStage, enableAudioFeatureAnalysis, enableAudioSeparation, enableSubtitleRecognition, failStage, finishStage, frameSampleRate, state.processingJob, writeDraft],
  );

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
          <a className="ghost-button action-link" href="http://127.0.0.1:5177/debug">
            运行追踪
          </a>
          <button className="ghost-button" type="button" disabled>
            导出
          </button>
        </div>
      </header>
      <main className="workspace-grid">
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
        <PreviewPanel
          sampleVideo={state.sampleVideo}
          mediaDerivatives={state.mediaDerivatives}
          activeMediaKind={state.activeMediaKind}
          selectedDerivativeId={state.selectedDerivativeId}
          selectedFrameId={state.selectedFrameId}
          processingText={state.processingJob ? `${state.uploadStatusText ?? state.processingJob.stage} / ${state.processingJob.progress}%` : "未加载样例"}
          traceText={state.processingJob?.traceId ? `trace ${shortId(state.processingJob.traceId)}` : "等待后端返回 trace"}
          uiTraceId={state.uiTraceId}
          backendTraceId={state.processingJob?.traceId ?? null}
          errorText={state.errorSummary?.message}
          videoRef={videoRef}
          audioRef={audioRef}
          miniCanvasRef={miniCanvasRef}
        />
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
          onSubtitleDraftChange={(draft) => dispatch({ type: "update-subtitle-draft", ...draft })}
        />
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
            dispatch({ type: "select-media", activeMediaKind: "audioFeature", selectedDerivativeId: state.audioFeatures?.artifactId ?? null, selectedFrameId: null, selectedAudioFeatureMarkerId: markerId });
          }}
          onFrameVisibleChange={(visible) => dispatch({ type: "set-frame-visible", visible })}
          onVisibleSecondsChange={(value) => dispatch({ type: "set-visible-seconds", visibleSeconds: clampVisibleSeconds(value) })}
        />
      </main>
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

function findCurrentStructureCard(cards: StructureCard[], currentTime: number): StructureCard | null {
  return cards.find((item) => currentTime >= item.start && currentTime <= item.end) ?? null;
}

function stageLabel(job: ProcessingJob): string {
  const labels: Record<string, string> = {
    uploaded: "上传中",
    "sample.upload.received": "上传中",
    "sample.upload.validated": "校验上传",
    "sample.source.saved": "保存素材",
    "sample.metadata.probed": "读取元信息",
    "sample.cover.extracted": "生成封面",
    "sample.frames.extracted": "抽帧中",
    "sample.audio.extracted": "提取音频",
    "sample.audio.features.extracted": "分析音频基础特征",
    "sample.audio.separated": "分离人声/伴奏",
    "sample.subtitle.recognized": "识别字幕",
    "sample.artifact.written": "生成产物",
    processed: "生成产物完成",
  };
  return labels[job?.stage] ?? job?.stage ?? "处理中";
}

function buildIngestError(job: ProcessingJob) {
  const summary = job.errorSummary ?? {};
  const error = new Error(summary.message || "样例处理失败") as Error & { code?: string };
  error.code = summary.code || "sample_ingest_failed";
  return error;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readDraft(): DraftState | null {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as DraftState | null;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

function writeDraft(value: DraftState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}
