import { useCallback, useEffect, useRef, useState } from "react";
import { getCapabilities, getLibraryItemDetail, getProcessingJob, getSampleArtifact, uploadSampleVideo } from "../api/client";
import { addVersion, STAGES, type WorkbenchAction } from "../state";
import type { BackendCapabilities, LibraryItemSummary, ProcessingJob, SampleArtifact, WorkbenchState } from "../types";
import { pollProcessingJob } from "./jobPolling";
import { attachProcessingJob, buildIngestError, stageLabel } from "../utils/workbenchHelpers";
import { readWorkbenchDraft, writeActiveUploadJob, writeWorkbenchDraft } from "../utils/workbenchDraft";
import type { UiStage } from "../observability/uiStage";

type CachePrompt = { file: File; cachedItem: LibraryItemSummary; token: number } | null;

type UploadFlowOptions = {
  state: WorkbenchState;
  dispatch: (action: WorkbenchAction) => void;
  frameSampleRate: number;
  enableAudioSeparation: boolean;
  enableSubtitleRecognition: boolean;
  enableAudioFeatureAnalysis: boolean;
  persistWorkbenchArtifact: (artifact: SampleArtifact, traceId: string | null, activeSample?: { revision?: number; source?: WorkbenchState["activeSampleSource"] }) => void;
  setSaveStatus: (value: string) => void;
  beginStage: (stageName: string, parentArtifactId?: string | null, inputSummary?: unknown) => UiStage;
  finishStage: (stage: UiStage, artifactId?: string, outputSummary?: unknown) => void;
  failStage: (stage: UiStage, error: unknown, details?: Record<string, unknown>) => void;
};

export function useWorkbenchUploadFlow(options: UploadFlowOptions) {
  const {
    state,
    dispatch,
    frameSampleRate,
    enableAudioSeparation,
    enableSubtitleRecognition,
    enableAudioFeatureAnalysis,
    persistWorkbenchArtifact,
    setSaveStatus,
    beginStage,
    finishStage,
    failStage,
  } = options;
  const [cachePrompt, setCachePrompt] = useState<CachePrompt>(null);
  const [capabilities, setCapabilities] = useState<BackendCapabilities | null>(null);
  const uploadTokenRef = useRef(0);

  const restoreDraft = useCallback(async () => {
    const draft = readWorkbenchDraft();
    if (draft?.sampleArtifact) {
      dispatch({ type: "restore-draft", draft });
      setSaveStatus("已恢复最近样例");
      const sampleVideoId = draft.sampleVideoId ?? draft.sampleArtifact.sampleVideoId;
      getSampleArtifact(sampleVideoId)
        .then((artifact) => {
          dispatch({ type: "apply-artifact", artifact, activeSampleSource: "workbench", bumpActiveSampleRevision: true });
          writeWorkbenchDraft({
            ...draft,
            sampleVideoId: artifact.sampleVideoId,
            artifactId: artifact.sampleVideo.artifactId,
            traceId: artifact.trace?.traceId ?? draft.traceId ?? null,
            activeSampleRevision: draft.activeSampleRevision ?? 0,
            activeSampleSource: draft.activeSampleSource ?? "workbench",
            sampleArtifact: artifact,
            selectedFrameId: artifact.frames.some((frame) => frame.frameId === draft.selectedFrameId) ? draft.selectedFrameId : artifact.frames[0]?.frameId ?? null,
            selectedDerivativeId: resolveDraftDerivativeId(artifact, draft.selectedDerivativeId),
          });
          setSaveStatus("已同步最新样例");
        })
        .catch(() => setSaveStatus("已恢复最近样例，最新样例同步失败"));
    }
    if (draft?.activeUploadJob) {
      await attachProcessingJob(draft.activeUploadJob, dispatch, writeActiveUploadJob).catch(() => setSaveStatus("恢复上传任务失败"));
    }
    return draft;
  }, [dispatch, setSaveStatus]);

  const loadCapabilities = useCallback(async () => {
    try {
      const next = await getCapabilities();
      setCapabilities(next);
      dispatch({ type: "set-capabilities", capabilities: next });
    } catch {
      setSaveStatus("能力检测失败");
    }
  }, [dispatch, setSaveStatus]);

  useEffect(() => {
    void restoreDraft();
  }, [restoreDraft]);

  useEffect(() => {
    void loadCapabilities();
  }, [loadCapabilities]);

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

        const job = await waitForUploadJob(upload.processingJobId, token);
        if (!job) return;
        latestJob = job;
        if (job.status === "processed") {
          const artifact = await getSampleArtifact(upload.sampleVideoId);
          if (token !== uploadTokenRef.current) return;
          dispatch({ type: "apply-artifact", artifact });
          dispatch({ type: "set-upload-state", isUploadingSample: false, uploadStatusText: "生成产物完成" });
          const version = addVersion("样例处理完成", stage.stageName, artifact.sampleVideo.artifactId, null);
          dispatch({ type: "add-version", version });
          persistWorkbenchArtifact(artifact, job.traceId, { revision: state.activeSampleRevision + 1, source: "workbench" });
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
    [
      beginStage,
      dispatch,
      enableAudioFeatureAnalysis,
      enableAudioSeparation,
      enableSubtitleRecognition,
      failStage,
      finishStage,
      frameSampleRate,
      persistWorkbenchArtifact,
      setSaveStatus,
      state.processingJob,
      state.sampleArtifact,
    ],
  );

  const reuseCache = useCallback(async () => {
    if (!cachePrompt) return;
    const prompt = cachePrompt;
    setCachePrompt(null);
    const stage = beginStage(STAGES.ingest, null, { cacheDecision: "reuse", sampleVideoId: prompt.cachedItem.sampleVideoId });
    try {
      const detail = await getLibraryItemDetail(prompt.cachedItem.sampleVideoId);
      if (prompt.token !== uploadTokenRef.current) return;
      dispatch({ type: "apply-artifact", artifact: detail.artifact, activeSampleSource: "workbench", bumpActiveSampleRevision: true });
      dispatch({ type: "set-upload-state", isUploadingSample: false, uploadStatusText: "已复用缓存", processingJob: null });
      const version = addVersion("复用缓存样例", stage.stageName, detail.artifact.sampleVideo.artifactId, null);
      dispatch({ type: "add-version", version });
      persistWorkbenchArtifact(detail.artifact, detail.artifact.trace?.traceId ?? null, { revision: state.activeSampleRevision + 1, source: "workbench" });
      setSaveStatus("已复用缓存");
      finishStage(stage, detail.artifact.sampleVideo.artifactId, { cacheHit: true, sampleVideoId: detail.artifact.sampleVideoId });
    } catch (error) {
      failStage(stage, error, { errorMessage: error instanceof Error ? error.message : "复用缓存失败" });
    }
  }, [beginStage, cachePrompt, dispatch, failStage, finishStage, persistWorkbenchArtifact, setSaveStatus, state.activeSampleRevision]);

  const refreshCache = useCallback(() => {
    if (!cachePrompt) return;
    const file = cachePrompt.file;
    setCachePrompt(null);
    void handleSampleUpload(file, "refresh");
  }, [cachePrompt, handleSampleUpload]);

  const waitForUploadJob = useCallback(
    async (jobId: string, token: number) => {
      const job = await pollProcessingJob(
        async () => {
          if (token !== uploadTokenRef.current) return null;
          return getProcessingJob(jobId);
        },
        {
          maxAttempts: 120,
          stopOnNull: true,
          onUpdate: (nextJob) => {
            if (!nextJob || token !== uploadTokenRef.current) return;
            dispatch({ type: "set-processing-job", processingJob: nextJob, uploadStatusText: stageLabel(nextJob) });
          },
        },
      );
      if (token !== uploadTokenRef.current || !job) return null;
      return job;
    },
    [dispatch],
  );

  return {
    capabilities,
    cachePrompt,
    setCachePrompt,
    handleSampleUpload,
    reuseCache,
    refreshCache,
    uploadTokenRef,
    restoreDraft,
  };
}

function resolveDraftDerivativeId(artifact: SampleArtifact, selectedDerivativeId?: string | null) {
  if (!selectedDerivativeId) return artifact.sampleVideo.normalized.artifactId;
  const derivativeIds = [
    artifact.sampleVideo.original.artifactId,
    artifact.sampleVideo.normalized.artifactId,
    artifact.cover?.artifactId,
    artifact.audio?.artifactId,
    artifact.audioSeparation?.vocal?.artifactId,
    artifact.audioSeparation?.music?.artifactId,
  ].filter(Boolean);
  return derivativeIds.includes(selectedDerivativeId) ? selectedDerivativeId : artifact.sampleVideo.normalized.artifactId;
}
