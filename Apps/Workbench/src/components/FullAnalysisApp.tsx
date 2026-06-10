import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { checkFullAnalysisUploadCache, checkMaterialRecognitionUploadCache, getFullAnalysisBatchRun, getLatestFullAnalysisBatchRun, getLatestFullAnalysisRun, getLatestFullAnalysisRunForSample, getLatestMaterialRecognitionRun, getLatestMaterialRecognitionRunForSample, getProcessingJob, getSampleArtifact, getWorkflowRun, retryFullAnalysisBatchItem, rerunWorkflowStage, resolveCacheDecision, runtimeUrl, startFullAnalysisBatchRun, startFullAnalysisRun, startMaterialRecognitionRun } from "../api/client";
import type { FullAnalysisBatchItem, FullAnalysisBatchRun, LibraryItemSummary, ProcessingJob, SampleArtifact, WorkflowRun, WorkflowStageState } from "../types";
import { shortId } from "../utils/format";
import { useResizableGridLayout } from "../hooks/useResizableGridLayout";
import { readFullAnalysisDraft, writeFullAnalysisActiveSampleDraft, writeFullAnalysisBatchDraft, writeFullAnalysisDraft } from "../utils/fullAnalysisDraft";
import type { ResultTab } from "./full-analysis/FullAnalysisResults";
import type { FullAnalysisStageTarget } from "./full-analysis/FullAnalysisStageStep";
import { batchStatusLabel, isBatchTerminal } from "./full-analysis/FullAnalysisBatchPanel";
import { FullAnalysisLayout } from "./full-analysis/FullAnalysisLayout";
import { buildWorkbenchSyncSignature, isRunExecuting, NON_EXECUTING_RUN_STATUS, statusLabel } from "./full-analysis/fullAnalysisState";
import { CACHE_PROMPT_ORDER, DEFAULT_STAGES, MATERIAL_DEFAULT_STAGES, MATERIAL_STAGE_ORDER, STAGE_ORDER, shouldPreserveActiveWorkflow, type FullAnalysisWorkbenchActiveSample, type FullAnalysisWorkbenchSync } from "./full-analysis/fullAnalysisWorkflowModel";
import { useFullAnalysisPolling } from "./full-analysis/useFullAnalysisPolling";
export type { FullAnalysisStageTarget } from "./full-analysis/FullAnalysisStageStep";
export type { FullAnalysisWorkbenchActiveSample, FullAnalysisWorkbenchSync } from "./full-analysis/fullAnalysisWorkflowModel";

type WorkflowCachePrompt = { stage: WorkflowStageState; job: ProcessingJob; order: number };
type UploadCachePrompt = { file: File; cachedItem: LibraryItemSummary } | null;

type WorkflowMode = "full-analysis" | "material-recognition";

type FullAnalysisAppProps = {
  embedded?: boolean;
  active?: boolean;
  mode?: WorkflowMode;
  activeSample?: FullAnalysisWorkbenchActiveSample | null;
  onWorkbenchSync?: (payload: FullAnalysisWorkbenchSync) => void;
  onOpenWorkbenchStage?: (stageKey: FullAnalysisStageTarget) => void;
};

export function FullAnalysisApp({ embedded = false, active = true, mode = "full-analysis", activeSample = null, onWorkbenchSync, onOpenWorkbenchStage }: FullAnalysisAppProps = {}) {
  const isMaterialMode = mode === "material-recognition";
  const pageTitle = isMaterialMode ? "素材识别" : "完整分析";
  const draftStorageKey = isMaterialMode ? "material-recognition:last-run" : undefined;
  const stageOrder = isMaterialMode ? MATERIAL_STAGE_ORDER : STAGE_ORDER;
  const defaultStages = isMaterialMode ? MATERIAL_DEFAULT_STAGES : DEFAULT_STAGES;
  const [run, setRun] = useState<WorkflowRun | null>(null);
  const [artifact, setArtifact] = useState<SampleArtifact | null>(null);
  const [childJobs, setChildJobs] = useState<Record<string, ProcessingJob | null>>({});
  const [activeTab, setActiveTab] = useState<ResultTab>("shot");
  const [statusText, setStatusText] = useState("等待上传");
  const [errorText, setErrorText] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [frameSampleRate, setFrameSampleRate] = useState(10);
  const [maxConcurrentRuns, setMaxConcurrentRuns] = useState(2);
  const [enableFunctionSlotAtomization, setEnableFunctionSlotAtomization] = useState(true);
  const [refreshMode, setRefreshMode] = useState(false);
  const [dismissedCachePromptJobIds, setDismissedCachePromptJobIds] = useState<string[]>([]);
  const [uploadCachePrompt, setUploadCachePrompt] = useState<UploadCachePrompt>(null);
  const [batchRun, setBatchRun] = useState<FullAnalysisBatchRun | null>(null);
  const [selectedBatchItemId, setSelectedBatchItemId] = useState<string | null>(null);
  const operationTokenRef = useRef(0);
  const batchSelectionSequenceRef = useRef(0);
  const restoredRunRef = useRef(false);
  const lastActiveSampleRevisionRef = useRef<number | null>(null);
  const lastWorkbenchSyncSignatureRef = useRef<string | null>(null);
  const lastSyncedSampleVideoIdRef = useRef<string | null>(null);
  const selectedBatchItemIdRef = useRef<string | null>(null);
  const layoutRef = useRef<HTMLElement>(null);
  const layout = useResizableGridLayout({
    containerRef: layoutRef,
    storageKey: "full-analysis:layout",
    leftCssVar: "--full-analysis-left-width",
    topCssVar: "--full-analysis-top-height",
    bottomLeftCssVar: "--full-analysis-bottom-left-width",
    defaultLeft: 340,
    minLeft: 280,
    maxLeft: 520,
    minRight: 420,
    defaultTop: 320,
    minTop: 260,
    maxTop: 560,
    minBottomTop: 260,
    defaultBottomLeft: 340,
    minBottomLeft: 260,
    maxBottomLeft: 520,
    minBottomRight: 420,
  });
  const { startPolling, startBatchPolling, clearRunPolling } = useFullAnalysisPolling({
    active,
    pageTitle,
    draftStorageKey,
    run,
    batchRun,
    operationTokenRef,
    selectedBatchItemIdRef,
    setRun,
    setArtifact,
    setStatusText,
    setErrorText,
    setBatchRun,
    setSelectedBatchItemId,
  });

  const orderedStages = useMemo(() => {
    const stages = run?.stages?.length ? run.stages : defaultStages;
    return [...stages]
      .filter((stage) => enableFunctionSlotAtomization || stage.key !== "functionSlotAtomization")
      .sort((a, b) => stageOrder.indexOf(a.key) - stageOrder.indexOf(b.key));
  }, [defaultStages, enableFunctionSlotAtomization, run, stageOrder]);

  useEffect(() => {
    if (!enableFunctionSlotAtomization && activeTab === "atomization") setActiveTab("shot");
  }, [activeTab, enableFunctionSlotAtomization]);

  useEffect(() => {
    if (isMaterialMode && activeTab !== "shot" && activeTab !== "material") setActiveTab("shot");
  }, [activeTab, isMaterialMode]);

  const childJobIds = useMemo(
    () => orderedStages
      .filter((stage) => Boolean(stage.childJobId))
      .map((stage) => stage.childJobId as string),
    [orderedStages],
  );

  const activeCachePrompt = useMemo(() => {
    return orderedStages
      .map((stage) => ({
        stage,
        order: CACHE_PROMPT_ORDER.indexOf(stage.key),
        job: stage.childJobId ? childJobs[stage.childJobId] ?? null : null,
      }))
      .filter((item): item is WorkflowCachePrompt => item.order >= 0 && Boolean(item.job?.jobId && item.job.cachePrompt?.cachedItem && item.job.status === "cache_waiting"))
      .filter((item) => !dismissedCachePromptJobIds.includes(item.job.jobId as string))
      .sort((a, b) => a.order - b.order)[0] ?? null;
  }, [childJobs, dismissedCachePromptJobIds, orderedStages]);

  useEffect(() => {
    if (restoredRunRef.current) return;
    restoredRunRef.current = true;
    const token = operationTokenRef.current + 1;
    operationTokenRef.current = token;
    const restoreRun = async () => {
      if (embedded && activeSample?.artifact) {
        lastActiveSampleRevisionRef.current = activeSample.activeSampleRevision;
        lastSyncedSampleVideoIdRef.current = activeSample.artifact.sampleVideoId;
        setArtifact(activeSample.artifact);
        const restoredRun = await (isMaterialMode ? getLatestMaterialRecognitionRunForSample : getLatestFullAnalysisRunForSample)(activeSample.artifact.sampleVideoId).catch(() => null);
        if (token !== operationTokenRef.current) return;
        if (restoredRun) {
          setRun(restoredRun);
          setStatusText(statusLabel(restoredRun));
          setEnableFunctionSlotAtomization(restoredRun.options?.enableFunctionSlotAtomization !== false);
          writeFullAnalysisDraft(restoredRun, activeSample.artifact, draftStorageKey);
          if (!NON_EXECUTING_RUN_STATUS.has(restoredRun.status)) startPolling(restoredRun.workflowRunId, token);
        } else {
          setRun(null);
          setStatusText("已同步工作台当前视频");
        }
        writeFullAnalysisActiveSampleDraft(activeSample.artifact, {
          activeSampleRevision: activeSample.activeSampleRevision,
          activeSampleSource: activeSample.activeSampleSource,
        }, draftStorageKey);
        return;
      }
      const draft = readFullAnalysisDraft(draftStorageKey);
      if (!isMaterialMode) {
        let restoredBatch = draft?.batchRunId
          ? await getFullAnalysisBatchRun(draft.batchRunId).catch(() => null)
          : await getLatestFullAnalysisBatchRun({ active: true }).catch(() => null);
        restoredBatch = restoredBatch ?? await getLatestFullAnalysisBatchRun().catch(() => null);
        if (token !== operationTokenRef.current) return;
        if (restoredBatch) {
          setBatchRun(restoredBatch);
          writeFullAnalysisBatchDraft(restoredBatch.batchRunId, draftStorageKey);
          selectedBatchItemIdRef.current = restoredBatch.items.find((item) => item.workflowRunId)?.queueItemId ?? restoredBatch.items[0]?.queueItemId ?? null;
          setSelectedBatchItemId(selectedBatchItemIdRef.current);
          setStatusText(`批量完整分析：${batchStatusLabel(restoredBatch.status)}`);
          if (!isBatchTerminal(restoredBatch)) startBatchPolling(restoredBatch.batchRunId, token);
        }
      }
      if (draft?.sampleArtifact) {
        setArtifact(draft.sampleArtifact);
        setStatusText(`已恢复最近${pageTitle}结果`);
        lastActiveSampleRevisionRef.current = draft.activeSampleRevision ?? null;
        lastSyncedSampleVideoIdRef.current = draft.sampleArtifact.sampleVideoId;
      }
      let restoredRun: WorkflowRun | null = null;
      if (draft?.workflowRunId) {
        restoredRun = await getWorkflowRun(draft.workflowRunId).catch(() => null);
      }
      if (token !== operationTokenRef.current) return;
      if (!restoredRun) {
        restoredRun = await (isMaterialMode ? getLatestMaterialRecognitionRun : getLatestFullAnalysisRun)().catch(() => null);
      }
      if (token !== operationTokenRef.current) return;
      if (!restoredRun) return;
      setRun(restoredRun);
      setStatusText(statusLabel(restoredRun));
      setEnableFunctionSlotAtomization(restoredRun.options?.enableFunctionSlotAtomization !== false);
      let restoredArtifact: SampleArtifact | null = null;
      if (restoredRun.sampleVideoId) {
        restoredArtifact = await getSampleArtifact(restoredRun.sampleVideoId).catch(() => null);
        if (token !== operationTokenRef.current) return;
        if (restoredArtifact && "sampleVideo" in restoredArtifact) setArtifact(restoredArtifact);
      }
      writeFullAnalysisDraft(restoredRun, restoredArtifact ?? draft?.sampleArtifact ?? null, draftStorageKey);
      if (!NON_EXECUTING_RUN_STATUS.has(restoredRun.status)) startPolling(restoredRun.workflowRunId, token);
    };
    void restoreRun().catch((error) => {
      if (token === operationTokenRef.current) setErrorText(error instanceof Error ? error.message : `恢复${pageTitle}失败`);
    });
  }, [activeSample, draftStorageKey, embedded, isMaterialMode, pageTitle, startBatchPolling, startPolling]);

  useEffect(() => {
    if (!embedded || !activeSample?.artifact) return;
    if (lastActiveSampleRevisionRef.current != null && activeSample.activeSampleRevision <= lastActiveSampleRevisionRef.current) return;
    lastActiveSampleRevisionRef.current = activeSample.activeSampleRevision;
    lastSyncedSampleVideoIdRef.current = activeSample.artifact.sampleVideoId;
    const shouldPreserveWorkflow = shouldPreserveActiveWorkflow(run, activeSample);
    if (!shouldPreserveWorkflow) {
      operationTokenRef.current += 1;
      clearRunPolling();
    }
    setArtifact(activeSample.artifact);
    setRun((current) => shouldPreserveActiveWorkflow(current, activeSample) ? current : null);
    if (!shouldPreserveWorkflow) setChildJobs({});
    setStatusText(shouldPreserveWorkflow && run ? statusLabel(run) : "已同步工作台当前视频");
    setErrorText(null);
    writeFullAnalysisActiveSampleDraft(activeSample.artifact, {
      activeSampleRevision: activeSample.activeSampleRevision,
      activeSampleSource: activeSample.activeSampleSource,
    }, draftStorageKey);
    if (shouldPreserveWorkflow && run && !NON_EXECUTING_RUN_STATUS.has(run.status)) {
      startPolling(run.workflowRunId, operationTokenRef.current);
      return;
    }
    if (shouldPreserveWorkflow) return;
    const token = operationTokenRef.current;
    const sampleVideoId = activeSample.artifact.sampleVideoId;
    const syncRunForSample = async () => {
      const restoredRun = await (isMaterialMode ? getLatestMaterialRecognitionRunForSample : getLatestFullAnalysisRunForSample)(sampleVideoId).catch(() => null);
      if (token !== operationTokenRef.current) return;
      if (!restoredRun) {
        setStatusText("已同步工作台当前视频");
        return;
      }
      setRun(restoredRun);
      setStatusText(statusLabel(restoredRun));
      setEnableFunctionSlotAtomization(restoredRun.options?.enableFunctionSlotAtomization !== false);
      writeFullAnalysisDraft(restoredRun, activeSample.artifact, draftStorageKey);
      if (!NON_EXECUTING_RUN_STATUS.has(restoredRun.status)) startPolling(restoredRun.workflowRunId, token);
    };
    void syncRunForSample().catch((error) => {
      if (token === operationTokenRef.current) setErrorText(error instanceof Error ? error.message : `恢复当前视频${pageTitle}失败`);
    });
  }, [activeSample, clearRunPolling, draftStorageKey, embedded, isMaterialMode, pageTitle, run, startPolling]);

  useEffect(() => {
    if (!active) return;
    if (!childJobIds.length) return;
    let cancelled = false;

    const syncChildJobs = async () => {
      const updates = await Promise.all(childJobIds.map(async (jobId) => {
        try {
          return [jobId, await getProcessingJob(jobId)] as const;
        } catch {
          return [jobId, null] as const;
        }
      }));
      if (cancelled) return;
      setChildJobs((current) => {
        const next = { ...current };
        for (const [jobId, job] of updates) next[jobId] = job;
        return next;
      });
    };

    void syncChildJobs();
    const timer = window.setInterval(() => {
      void syncChildJobs();
    }, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [active, childJobIds]);

  useEffect(() => {
    if (!active) return;
    if (!run || !onWorkbenchSync) return;
    const signature = buildWorkbenchSyncSignature(run, artifact, childJobs);
    if (signature === lastWorkbenchSyncSignatureRef.current) return;
    lastWorkbenchSyncSignatureRef.current = signature;
    const activeSampleChanged = Boolean(artifact?.sampleVideoId && artifact.sampleVideoId !== lastSyncedSampleVideoIdRef.current);
    if (activeSampleChanged) lastSyncedSampleVideoIdRef.current = artifact?.sampleVideoId ?? null;
    onWorkbenchSync({ run, artifact, childJobs, activeSampleChanged });
  }, [active, artifact, childJobs, onWorkbenchSync, run]);

  const startFullAnalysis = useCallback(async (file: File, cacheDecision: "ask" | "reuse" | "refresh") => {
    const token = operationTokenRef.current + 1;
    operationTokenRef.current = token;
    setIsStarting(true);
    setErrorText(null);
    setArtifact(null);
    setBatchRun(null);
    setSelectedBatchItemId(null);
    setDismissedCachePromptJobIds([]);
    setStatusText(`创建${pageTitle}任务`);
    try {
      const nextRun = await (isMaterialMode ? startMaterialRecognitionRun : startFullAnalysisRun)(file, {
        frameSampleRateFps: frameSampleRate,
        enableAudioSeparation: true,
        enableSubtitleRecognition: true,
        enableAudioFeatureAnalysis: true,
        ...(!isMaterialMode ? { enableFunctionSlotAtomization } : {}),
        cacheDecision,
      });
      if (token !== operationTokenRef.current) return;
      setRun(nextRun);
      setStatusText(statusLabel(nextRun));
      setEnableFunctionSlotAtomization(nextRun.options?.enableFunctionSlotAtomization !== false);
      writeFullAnalysisDraft(nextRun, null, draftStorageKey);
      startPolling(nextRun.workflowRunId, token);
    } catch (error) {
      if (token !== operationTokenRef.current) return;
      setErrorText(error instanceof Error ? error.message : `启动${pageTitle}失败`);
      setStatusText("启动失败");
    } finally {
      if (token === operationTokenRef.current) setIsStarting(false);
    }
  }, [draftStorageKey, enableFunctionSlotAtomization, frameSampleRate, isMaterialMode, pageTitle, startPolling]);

  const startFullAnalysisBatch = useCallback(async (files: File[]) => {
    if (isMaterialMode) {
      await startFullAnalysis(files[0], refreshMode ? "refresh" : "ask");
      return;
    }
    const token = operationTokenRef.current + 1;
    operationTokenRef.current = token;
    setIsStarting(true);
    setErrorText(null);
    setArtifact(null);
    setRun(null);
    setUploadCachePrompt(null);
    setDismissedCachePromptJobIds([]);
    setStatusText("创建批量完整分析任务");
    try {
      const nextBatch = await startFullAnalysisBatchRun(files, {
        frameSampleRateFps: frameSampleRate,
        enableAudioSeparation: true,
        enableSubtitleRecognition: true,
        enableAudioFeatureAnalysis: true,
        enableFunctionSlotAtomization,
        cacheDecision: refreshMode ? "refresh" : "ask",
        maxConcurrentRuns,
      });
      if (token !== operationTokenRef.current) return;
      setBatchRun(nextBatch);
      writeFullAnalysisBatchDraft(nextBatch.batchRunId, draftStorageKey);
      selectedBatchItemIdRef.current = nextBatch.items[0]?.queueItemId ?? null;
      setSelectedBatchItemId(nextBatch.items[0]?.queueItemId ?? null);
      setStatusText(`批量完整分析：${batchStatusLabel(nextBatch.status)}`);
      startBatchPolling(nextBatch.batchRunId, token);
    } catch (error) {
      if (token !== operationTokenRef.current) return;
      setErrorText(error instanceof Error ? error.message : "启动批量完整分析失败");
      setStatusText("批量启动失败");
    } finally {
      if (token === operationTokenRef.current) setIsStarting(false);
    }
  }, [draftStorageKey, enableFunctionSlotAtomization, frameSampleRate, isMaterialMode, maxConcurrentRuns, refreshMode, startBatchPolling, startFullAnalysis]);

  const handleUpload = useCallback(async (files: FileList | File[]) => {
    const fileList = Array.from(files);
    if (!isMaterialMode && fileList.length > 1) {
      await startFullAnalysisBatch(fileList);
      return;
    }
    const file = fileList[0];
    if (!file) return;
    const token = operationTokenRef.current + 1;
    operationTokenRef.current = token;
    setIsStarting(true);
    setErrorText(null);
    setArtifact(null);
    setRun(null);
    setUploadCachePrompt(null);
    setDismissedCachePromptJobIds([]);
    setStatusText(refreshMode ? `创建${pageTitle}任务` : "检查上传缓存");
    try {
      if (!refreshMode) {
        const cache = await (isMaterialMode ? checkMaterialRecognitionUploadCache : checkFullAnalysisUploadCache)(file, { frameSampleRateFps: frameSampleRate });
        if (token !== operationTokenRef.current) return;
        if (cache.cacheHit) {
          setUploadCachePrompt({ file, cachedItem: cache.cachedItem });
          setStatusText("命中同视频缓存，等待选择");
          return;
        }
      }
    } catch (error) {
      if (token !== operationTokenRef.current) return;
      setErrorText(error instanceof Error ? error.message : "检查上传缓存失败");
      setStatusText("缓存检查失败");
      return;
    } finally {
      if (token === operationTokenRef.current) setIsStarting(false);
    }
    if (token !== operationTokenRef.current) return;
    await startFullAnalysis(file, refreshMode ? "refresh" : "ask");
  }, [frameSampleRate, isMaterialMode, pageTitle, refreshMode, startFullAnalysis, startFullAnalysisBatch]);

  const handleSelectBatchItem = useCallback(async (item: FullAnalysisBatchItem) => {
    const selectionSequence = batchSelectionSequenceRef.current + 1;
    batchSelectionSequenceRef.current = selectionSequence;
    const isCurrentSelection = () => selectionSequence === batchSelectionSequenceRef.current && selectedBatchItemIdRef.current === item.queueItemId;
    selectedBatchItemIdRef.current = item.queueItemId;
    setSelectedBatchItemId(item.queueItemId);
    if (!item.workflowRunId) {
      setRun(null);
      setArtifact(null);
      setStatusText(`${item.filename} ${batchStatusLabel(item.status)}`);
      return;
    }
    const nextRun = await getWorkflowRun(item.workflowRunId);
    if (!isCurrentSelection()) return;
    setRun(nextRun);
    setStatusText(statusLabel(nextRun));
    if (nextRun.sampleVideoId) {
      const nextArtifact = await getSampleArtifact(nextRun.sampleVideoId).catch(() => null);
      if (!isCurrentSelection()) return;
      if (nextArtifact && "sampleVideo" in nextArtifact) setArtifact(nextArtifact as SampleArtifact);
    }
  }, []);

  const handleRetryBatchItem = useCallback(async (item: FullAnalysisBatchItem) => {
    if (!batchRun || !item.retryable) return;
    const token = operationTokenRef.current + 1;
    operationTokenRef.current = token;
    setErrorText(null);
    setStatusText(`重试 ${item.filename}`);
    try {
      const nextBatch = await retryFullAnalysisBatchItem(batchRun.batchRunId, item.queueItemId);
      if (token !== operationTokenRef.current) return;
      setBatchRun(nextBatch);
      writeFullAnalysisBatchDraft(nextBatch.batchRunId, draftStorageKey);
      selectedBatchItemIdRef.current = item.queueItemId;
      setSelectedBatchItemId(item.queueItemId);
      startBatchPolling(nextBatch.batchRunId, token);
    } catch (error) {
      if (token !== operationTokenRef.current) return;
      setErrorText(error instanceof Error ? error.message : "重试批量项失败");
    }
  }, [batchRun, draftStorageKey, startBatchPolling]);

  const handleRerun = useCallback(async (stageKey: string) => {
    if (!run) return;
    const token = operationTokenRef.current + 1;
    operationTokenRef.current = token;
    setErrorText(null);
    try {
      const nextRun = await rerunWorkflowStage(run.workflowRunId, stageKey);
      if (token !== operationTokenRef.current) return;
      setRun(nextRun);
      setStatusText(statusLabel(nextRun));
      setEnableFunctionSlotAtomization(nextRun.options?.enableFunctionSlotAtomization !== false);
      writeFullAnalysisDraft(nextRun, artifact, draftStorageKey);
      startPolling(nextRun.workflowRunId, token);
    } catch (error) {
      if (token !== operationTokenRef.current) return;
      setErrorText(error instanceof Error ? error.message : "重跑步骤失败");
    }
  }, [artifact, draftStorageKey, run, startPolling]);

  const resolveWorkflowCache = useCallback(async (prompt: WorkflowCachePrompt, decision: "reuse" | "refresh") => {
    if (!prompt.job.jobId) return;
    const token = operationTokenRef.current + 1;
    operationTokenRef.current = token;
    setErrorText(null);
    setDismissedCachePromptJobIds((current) => current.filter((jobId) => jobId !== prompt.job.jobId));
    setStatusText(`${prompt.stage.label}${decision === "reuse" ? "复用缓存" : "重新生成"}`);
    try {
      const nextJob = await resolveCacheDecision(prompt.job.jobId, decision);
      if (token !== operationTokenRef.current) return;
      setChildJobs((current) => ({ ...current, [prompt.job.jobId as string]: nextJob }));
      if (run) {
        const nextRun = await getWorkflowRun(run.workflowRunId);
        if (token !== operationTokenRef.current) return;
        setRun(nextRun);
        setStatusText(statusLabel(nextRun));
        setEnableFunctionSlotAtomization(nextRun.options?.enableFunctionSlotAtomization !== false);
        writeFullAnalysisDraft(nextRun, artifact, draftStorageKey);
        startPolling(nextRun.workflowRunId, token);
      }
    } catch (error) {
      if (token !== operationTokenRef.current) return;
      const message = error instanceof Error ? error.message : `${prompt.stage.label}缓存选择失败`;
      setErrorText(message);
      setStatusText(message);
    }
  }, [artifact, draftStorageKey, run, startPolling]);
  const resolveStageCache = useCallback((stage: WorkflowStageState, job: ProcessingJob, decision: "reuse" | "refresh") => {
    return resolveWorkflowCache({ stage, job, order: CACHE_PROMPT_ORDER.indexOf(stage.key) }, decision);
  }, [resolveWorkflowCache]);

  const videoUrl = runtimeUrl(artifact?.sampleVideo.normalized.uri);
  const countLabel = `workflow ${run ? shortId(run.workflowRunId) : "未创建"}`;
  const workflowTraceLabel = `workflow trace ${run ? shortId(run.traceId) : "等待后端返回"}`;

  return (
    <FullAnalysisLayout
      {...{
        embedded, pageTitle, mode, isMaterialMode, statusText, countLabel, workflowTraceLabel, layoutRef, layout, run, artifact, videoUrl, isStarting,
        frameSampleRate, maxConcurrentRuns, refreshMode, enableFunctionSlotAtomization, batchRun, selectedBatchItemId, orderedStages, childJobs,
        activeTab, errorText, activeCachePrompt, uploadCachePrompt, onOpenWorkbenchStage,
        onUpload: handleUpload, onFrameSampleRateChange: setFrameSampleRate, onMaxConcurrentRunsChange: setMaxConcurrentRuns,
        onRefreshModeChange: setRefreshMode, onFunctionSlotAtomizationChange: setEnableFunctionSlotAtomization,
        onSelectBatchItem: handleSelectBatchItem, onRetryBatchItem: handleRetryBatchItem, onRerun: handleRerun,
        onResolveStageCache: resolveStageCache, onResolveWorkflowCache: resolveWorkflowCache, onActiveTabChange: setActiveTab,
        onDismissCachePromptJobIdsChange: setDismissedCachePromptJobIds, onUploadCachePromptChange: setUploadCachePrompt,
        onStatusTextChange: setStatusText, onStartFullAnalysis: startFullAnalysis,
      }}
    />
  );
}
