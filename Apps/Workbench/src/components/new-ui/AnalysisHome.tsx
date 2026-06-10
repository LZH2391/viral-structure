import { useCallback, useEffect, useRef, useState } from "react";
import { cancelFullAnalysisBatchItem, cancelMaterialRecognitionBatchItem, getFunctionSlotGovernanceSchedulerState, resolveCacheDecision, retryFullAnalysisBatchItem, retryMaterialRecognitionBatchItem, startFullAnalysisBatchRun, startMaterialRecognitionBatchRun, type FunctionSlotGovernanceSchedulerState } from "../../api/client";
import type { TimelineSeekRequest } from "./AnalysisDetailPage";
import { AnalysisHomeView } from "./AnalysisHomeView";
import { loadAnalysisDetailItem, refreshAnalysisDetailItem } from "./analysisDetailData";
import { cancelAnalysisWorkflow, isAnalysisItemRunning, loadRerunnableWorkflowStageKeys, rerunAnalysisWorkflowStage, resumeAnalysisWorkflow } from "./analysisBackend";
import type { AnalysisWorkflowMode } from "./analysisBackend";
import { listAnalysisHistorySamples, resolveAnalysisHistoryMedia, type AnalysisHistoryItem, type AnalysisHistoryMedia } from "./analysisHistoryData";
import type { AnalysisTimelineSegmentDetail } from "./analysisTimelineSelection";
import { ANALYSIS_PLAYER_QUEUE_REFRESH_MS, analysisDetailPollingKey, createUploadingQueueItems, loadLatestVideoProcessingQueue, mergeLocalQueueItems, normalizePlayerQueueStatus, resolveBatchQueueHistoryItem, toVisibleGovernanceSchedulerState, type AnalysisHomeQueueItem, type AnalysisHomeQueueState } from "./analysisHomeQueueModel";
import type { AnalysisDetailSidebarState } from "./AnalysisWorkflowSidebar";
import { useAnalysisHomeSidebarSync } from "./useAnalysisHomeSidebarSync";

export type { AnalysisHomeQueueItem, AnalysisHomeQueueState } from "./analysisHomeQueueModel";

type AnalysisHomeProps = {
  mode?: AnalysisWorkflowMode;
  onDetailStateChange?: (state: AnalysisDetailSidebarState) => void;
  onQueueStateChange?: (state: AnalysisHomeQueueState) => void;
  openRequest?: { requestId: number; mode?: AnalysisWorkflowMode; sampleVideoId: string; artifactId?: string | null; title?: string | null } | null;
  onOpenRequestResolved?: (result: { requestId: number; ok: boolean; message?: string | null }) => void;
  timelineSelectionClearRequest?: number;
};

const ANALYSIS_DETAIL_HEAVY_MOUNT_DELAY_MS = 240;

export function AnalysisHome({ mode = "structureAnalysis", onDetailStateChange, onQueueStateChange, openRequest = null, onOpenRequestResolved, timelineSelectionClearRequest = 0 }: AnalysisHomeProps = {}) {
  const lastTimelineSelectionClearRequestRef = useRef(timelineSelectionClearRequest);
  const pollTimerRef = useRef<number | null>(null);
  const operationTokenRef = useRef(0);
  const detailLoadKeyRef = useRef<string | null>(null);
  const detailPollingKeyRef = useRef<string | null>(null);
  const detailSeekRequestIdRef = useRef(0);
  const [view, setView] = useState<"home" | "detail">("home");
  const [detailTransitionKey, setDetailTransitionKey] = useState(0);
  const [detailTitle, setDetailTitle] = useState("新建分析");
  const [detailMedia, setDetailMedia] = useState<AnalysisHistoryMedia | null>(null);
  const [detailItem, setDetailItem] = useState<AnalysisHistoryItem | null>(null);
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  const [selectedTimelineSegment, setSelectedTimelineSegment] = useState<AnalysisTimelineSegmentDetail | null>(null);
  const [rerunnableStageKeys, setRerunnableStageKeys] = useState<string[]>([]);
  const [rerunningStageKey, setRerunningStageKey] = useState<string | null>(null);
  const [workflowActionBusy, setWorkflowActionBusy] = useState<"cancel" | "resume" | null>(null);
  const [cacheDecisionBusyKey, setCacheDecisionBusyKey] = useState<string | null>(null);
  const [queueActionBusyKey, setQueueActionBusyKey] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [homeQueueItems, setHomeQueueItems] = useState<AnalysisHomeQueueItem[]>([]);
  const [homeQueueLoading, setHomeQueueLoading] = useState(false);
  const [governanceSchedulerState, setGovernanceSchedulerState] = useState<FunctionSlotGovernanceSchedulerState | null>(null);
  const [detailHeavyReady, setDetailHeavyReady] = useState(false);
  const [detailTimelineReady, setDetailTimelineReady] = useState(false);
  const [detailSeekRequest, setDetailSeekRequest] = useState<TimelineSeekRequest | null>(null);
  const isMaterialMode = mode === "materialRecognition";
  const workflowStageKeySignature = detailItem?.workflowRun?.stages?.map((stage) => stage.key).join("|") ?? "";
  const detailArtifactSignature = [
    detailItem?.artifact?.sampleVideo?.artifactId,
    detailItem?.artifact?.shotBoundaryAnalysis?.artifactId,
    detailItem?.artifact?.scriptSegmentAnalysis?.artifactId,
    detailItem?.artifact?.rhythmStructureAnalysis?.artifactId,
    detailItem?.artifact?.packagingStructureAnalysis?.artifactId,
    detailItem?.artifact?.functionSlotAtomizationAnalysis?.artifactId,
    detailItem?.artifact?.userMaterialPack?.artifactId,
  ].join("|");

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current == null) return;
    window.clearInterval(pollTimerRef.current);
    pollTimerRef.current = null;
  }, []);

  const startDetailPolling = useCallback((initialItem: AnalysisHistoryItem, token = operationTokenRef.current) => {
    stopPolling();
    detailPollingKeyRef.current = analysisDetailPollingKey(initialItem);
    let currentItem = initialItem;
    let terminalPollsRemaining = 4;
    const poll = async () => {
      if (token !== operationTokenRef.current) return;
      try {
        const { item: nextItem, media: nextMedia } = await refreshAnalysisDetailItem(currentItem);
        if (token !== operationTokenRef.current) return;
        currentItem = nextItem;
        setDetailItem(nextItem);
        setDetailMedia(nextMedia);
        setDetailTitle(nextMedia.title);
        setHistoryRefreshKey((value) => value + 1);
        if (isAnalysisItemRunning(nextItem)) {
          terminalPollsRemaining = 4;
          return;
        }
        terminalPollsRemaining -= 1;
        if (terminalPollsRemaining <= 0) stopPolling();
      } catch {
        if (token !== operationTokenRef.current) return;
      }
    };
    void poll();
    pollTimerRef.current = window.setInterval(() => {
      void poll();
    }, 2000);
  }, [stopPolling]);

  const openHistoryDetail = useCallback((item: AnalysisHistoryItem) => {
    const token = operationTokenRef.current + 1;
    operationTokenRef.current = token;
    stopPolling();
    detailLoadKeyRef.current = null;
    detailPollingKeyRef.current = null;
    const media = resolveAnalysisHistoryMedia(item);
    setDetailHeavyReady(false);
    setDetailTimelineReady(false);
    setDetailTransitionKey((value) => value + 1);
    setDetailTitle(media.title);
    setDetailMedia(media);
    setDetailItem(item);
    setSelectedTimelineSegment(null);
    setRerunnableStageKeys([]);
    setRerunningStageKey(null);
    setView("detail");
  }, [stopPolling]);

  useEffect(() => {
    if (!openRequest) return undefined;
    let cancelled = false;
    const run = async () => {
      try {
        const items = await listAnalysisHistorySamples();
        if (cancelled) return;
        const target = items.find((item) => item.sampleVideoId === openRequest.sampleVideoId) ?? null;
        if (!target) {
          onOpenRequestResolved?.({ requestId: openRequest.requestId, ok: false, message: "未找到对应历史分析" });
          return;
        }
        const requestMode = openRequest.mode ?? mode;
        const canOpenTarget = requestMode === "materialRecognition"
          ? Boolean(target.hasUserMaterialPack || target.isRunning || target.workflowKey === "material-recognition")
          : Boolean(target.hasFunctionSlotAtomization);
        if (!canOpenTarget) {
          onOpenRequestResolved?.({ requestId: openRequest.requestId, ok: false, message: "对应样例还没有结构分析结果" });
          return;
        }
        openHistoryDetail(target);
        onOpenRequestResolved?.({ requestId: openRequest.requestId, ok: true });
      } catch {
        if (!cancelled) onOpenRequestResolved?.({ requestId: openRequest.requestId, ok: false, message: "打开结构分析失败" });
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [openRequest?.requestId]);

  const refreshHomeQueue = useCallback(async () => {
    setHomeQueueLoading(true);
    try {
      setHomeQueueItems(await loadLatestVideoProcessingQueue(mode));
      if (mode === "structureAnalysis") {
        setGovernanceSchedulerState(toVisibleGovernanceSchedulerState(await getFunctionSlotGovernanceSchedulerState().catch(() => null)));
      } else {
        setGovernanceSchedulerState(null);
      }
    } catch {
      setHomeQueueItems([]);
      setGovernanceSchedulerState(null);
    } finally {
      setHomeQueueLoading(false);
    }
  }, [mode]);

  useEffect(() => {
    if (view !== "home") return undefined;
    let mounted = true;
    const refresh = () => {
      setHomeQueueLoading(true);
      Promise.all([
        loadLatestVideoProcessingQueue(mode),
        mode === "structureAnalysis" ? getFunctionSlotGovernanceSchedulerState().catch(() => null) : Promise.resolve(null),
      ])
        .then(([items, schedulerState]) => {
          if (mounted) setHomeQueueItems(items);
          if (mounted) setGovernanceSchedulerState(toVisibleGovernanceSchedulerState(schedulerState));
        })
        .catch(() => {
          if (mounted) setHomeQueueItems([]);
          if (mounted) setGovernanceSchedulerState(null);
        })
        .finally(() => {
          if (mounted) setHomeQueueLoading(false);
        });
    };
    refresh();
    const timer = window.setInterval(refresh, ANALYSIS_PLAYER_QUEUE_REFRESH_MS);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, [mode, view]);

  const startAnalysisBatch = useCallback(async (files: File[], options: { openFirstWhenReady?: boolean } = {}) => {
    const token = operationTokenRef.current + 1;
    operationTokenRef.current = token;
    stopPolling();
    setIsUploading(true);
    const localItems = createUploadingQueueItems(files, mode, token);
    setHomeQueueItems((current) => mergeLocalQueueItems(localItems, current));
    try {
      const batch = isMaterialMode
        ? await startMaterialRecognitionBatchRun(files, {
          frameSampleRateFps: 10,
          enableAudioSeparation: true,
          enableSubtitleRecognition: true,
          enableAudioFeatureAnalysis: true,
          cacheDecision: "ask",
          maxConcurrentRuns: 2,
        })
        : await startFullAnalysisBatchRun(files, {
          frameSampleRateFps: 10,
          enableAudioSeparation: true,
          enableSubtitleRecognition: true,
          enableAudioFeatureAnalysis: true,
          enableFunctionSlotAtomization: true,
          cacheDecision: "ask",
          maxConcurrentRuns: 2,
        });
      if (token !== operationTokenRef.current) return;
      setHistoryRefreshKey((value) => value + 1);
      const firstItem = batch.items.find((item) => item.sampleVideoId) ?? null;
      if (options.openFirstWhenReady && firstItem?.sampleVideoId) {
        const historyItem = resolveBatchQueueHistoryItem(firstItem, batch, null, normalizePlayerQueueStatus(firstItem.status));
        if (historyItem) {
          openHistoryDetail(historyItem);
        } else {
          setView("home");
        }
      } else {
        setView("home");
      }
      await refreshHomeQueue().catch(() => undefined);
    } catch (error) {
      setHomeQueueItems((current) => current.filter((item) => !localItems.some((local) => local.key === item.key)));
      throw error;
    } finally {
      if (token === operationTokenRef.current) setIsUploading(false);
    }
  }, [isMaterialMode, openHistoryDetail, refreshHomeQueue, stopPolling]);

  const handleUploadFiles = useCallback(async (files: FileList | File[]) => {
    const videoFiles = Array.from(files).filter((item) => item.type.startsWith("video/") || /\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(item.name));
    if (!videoFiles.length) return;
    await startAnalysisBatch(videoFiles, { openFirstWhenReady: videoFiles.length === 1 });
  }, [startAnalysisBatch]);

  const handleWorkflowStageRerun = useCallback(async (stageKey: string | string[]) => {
    if (!detailItem || rerunningStageKey) return;
    const stageKeys = Array.isArray(stageKey) ? stageKey : [stageKey];
    const statusKey = stageKeys.length > 1 ? "structureAnalysis" : stageKeys[0];
    const token = operationTokenRef.current + 1;
    operationTokenRef.current = token;
    stopPolling();
    detailPollingKeyRef.current = null;
    setRerunningStageKey(statusKey);
    setSelectedTimelineSegment(null);
    try {
      const { item: nextItem, media: nextMedia } = await rerunAnalysisWorkflowStage(detailItem, stageKeys);
      if (token !== operationTokenRef.current) return;
      setDetailItem(nextItem);
      setDetailMedia(nextMedia);
      setDetailTitle(nextMedia.title);
      setHistoryRefreshKey((value) => value + 1);
      startDetailPolling(nextItem, token);
    } catch {
      if (token !== operationTokenRef.current) return;
    } finally {
      if (token === operationTokenRef.current) setRerunningStageKey(null);
    }
  }, [detailItem, rerunningStageKey, startDetailPolling, stopPolling]);

  const handleWorkflowCancel = useCallback(async () => {
    if (!detailItem || workflowActionBusy) return;
    const token = operationTokenRef.current + 1;
    operationTokenRef.current = token;
    stopPolling();
    detailPollingKeyRef.current = null;
    setWorkflowActionBusy("cancel");
    setSelectedTimelineSegment(null);
    try {
      const { item: nextItem, media: nextMedia } = await cancelAnalysisWorkflow(detailItem);
      if (token !== operationTokenRef.current) return;
      setDetailItem(nextItem);
      setDetailMedia(nextMedia);
      setDetailTitle(nextMedia.title);
      setHistoryRefreshKey((value) => value + 1);
      await refreshHomeQueue().catch(() => undefined);
    } finally {
      if (token === operationTokenRef.current) setWorkflowActionBusy(null);
    }
  }, [detailItem, refreshHomeQueue, stopPolling, workflowActionBusy]);

  const handleWorkflowResume = useCallback(async () => {
    if (!detailItem || workflowActionBusy) return;
    const token = operationTokenRef.current + 1;
    operationTokenRef.current = token;
    stopPolling();
    detailPollingKeyRef.current = null;
    setWorkflowActionBusy("resume");
    setSelectedTimelineSegment(null);
    try {
      const { item: nextItem, media: nextMedia } = await resumeAnalysisWorkflow(detailItem);
      if (token !== operationTokenRef.current) return;
      setDetailItem(nextItem);
      setDetailMedia(nextMedia);
      setDetailTitle(nextMedia.title);
      setHistoryRefreshKey((value) => value + 1);
      startDetailPolling(nextItem, token);
      await refreshHomeQueue().catch(() => undefined);
    } finally {
      if (token === operationTokenRef.current) setWorkflowActionBusy(null);
    }
  }, [detailItem, refreshHomeQueue, startDetailPolling, stopPolling, workflowActionBusy]);

  const handleWorkflowCacheDecision = useCallback(async ({ jobId, decision }: { stageKey: string; jobId: string; decision: "reuse" | "refresh" }) => {
    if (!detailItem || cacheDecisionBusyKey) return;
    const token = operationTokenRef.current + 1;
    operationTokenRef.current = token;
    stopPolling();
    detailPollingKeyRef.current = null;
    setCacheDecisionBusyKey(jobId);
    setSelectedTimelineSegment(null);
    try {
      await resolveCacheDecision(jobId, decision);
      const { item: nextItem, media: nextMedia } = await refreshAnalysisDetailItem(detailItem);
      if (token !== operationTokenRef.current) return;
      setDetailItem(nextItem);
      setDetailMedia(nextMedia);
      setDetailTitle(nextMedia.title);
      setHistoryRefreshKey((value) => value + 1);
      startDetailPolling(nextItem, token);
      await refreshHomeQueue().catch(() => undefined);
    } finally {
      if (token === operationTokenRef.current) setCacheDecisionBusyKey(null);
    }
  }, [cacheDecisionBusyKey, detailItem, refreshHomeQueue, startDetailPolling, stopPolling]);

  const handleQueueItemCancel = useCallback(async (item: AnalysisHomeQueueItem) => {
    if (!item.batchRunId || !item.queueItemId || queueActionBusyKey) return;
    const busyKey = `cancel:${item.key}`;
    setQueueActionBusyKey(busyKey);
    try {
      if (item.workflowKey === "material-recognition") {
        await cancelMaterialRecognitionBatchItem(item.batchRunId, item.queueItemId);
      } else {
        await cancelFullAnalysisBatchItem(item.batchRunId, item.queueItemId);
      }
      await refreshHomeQueue();
      setHistoryRefreshKey((value) => value + 1);
    } finally {
      setQueueActionBusyKey(null);
    }
  }, [queueActionBusyKey, refreshHomeQueue]);

  const handleQueueItemRetry = useCallback(async (item: AnalysisHomeQueueItem) => {
    if (!item.batchRunId || !item.queueItemId || queueActionBusyKey) return;
    const busyKey = `retry:${item.key}`;
    setQueueActionBusyKey(busyKey);
    try {
      if (item.workflowKey === "material-recognition") {
        await retryMaterialRecognitionBatchItem(item.batchRunId, item.queueItemId);
      } else {
        await retryFullAnalysisBatchItem(item.batchRunId, item.queueItemId);
      }
      await refreshHomeQueue();
      setHistoryRefreshKey((value) => value + 1);
    } finally {
      setQueueActionBusyKey(null);
    }
  }, [queueActionBusyKey, refreshHomeQueue]);

  useEffect(() => {
    if (view !== "detail") {
      setDetailHeavyReady(false);
      setDetailTimelineReady(false);
      return undefined;
    }
    setDetailHeavyReady(false);
    setDetailTimelineReady(false);
    const timeoutId = window.setTimeout(() => {
      setDetailHeavyReady(true);
    }, ANALYSIS_DETAIL_HEAVY_MOUNT_DELAY_MS);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [detailTransitionKey, view]);

  useEffect(() => {
    if (view !== "detail" || !detailHeavyReady) return;
    setDetailTimelineReady(false);
  }, [detailArtifactSignature, detailHeavyReady, detailItem?.sampleVideoId, detailItem?.workflowRunId, view]);

  useEffect(() => {
    if (!detailItem?.artifact) setDetailTimelineReady(false);
  }, [detailItem?.artifact]);

  useEffect(() => {
    if (!detailHeavyReady || view !== "detail" || !detailItem || !isAnalysisItemRunning(detailItem)) return undefined;
    const pollingKey = analysisDetailPollingKey(detailItem);
    if (detailPollingKeyRef.current === pollingKey) return undefined;
    startDetailPolling(detailItem);
    return undefined;
  }, [detailHeavyReady, detailItem, startDetailPolling, view]);

  useEffect(() => {
    if (!detailHeavyReady || view !== "detail" || !detailItem?.sampleVideoId) {
      setRerunnableStageKeys([]);
      return undefined;
    }
    let mounted = true;
    loadRerunnableWorkflowStageKeys(detailItem)
      .then((stageKeys) => {
        if (mounted) setRerunnableStageKeys(stageKeys);
      })
      .catch(() => {
        if (mounted) setRerunnableStageKeys([]);
      });
    return () => {
      mounted = false;
    };
  }, [detailHeavyReady, detailItem?.sampleVideoId, detailItem?.workflowRunId, detailArtifactSignature, view, workflowStageKeySignature]);

  useEffect(() => {
    if (!detailHeavyReady || view !== "detail" || !detailItem?.sampleVideoId || detailItem.artifact) return undefined;
    const loadKey = `${detailItem.sampleVideoId}:${detailItem.workflowRunId ?? ""}:${detailItem.artifactId ?? ""}`;
    if (detailLoadKeyRef.current === loadKey) return undefined;
    detailLoadKeyRef.current = loadKey;
    let mounted = true;
    loadAnalysisDetailItem(detailItem)
      .then(({ item: nextItem, media: nextMedia }) => {
        if (!mounted) return;
        setDetailItem(nextItem);
        setDetailMedia(nextMedia);
        setDetailTitle(nextMedia.title);
      })
      .catch(() => {
        if (!mounted) return;
      });
    return () => {
      mounted = false;
    };
  }, [detailHeavyReady, detailItem, view]);

  useEffect(() => () => {
    stopPolling();
  }, [stopPolling]);

  const { selectTimelineSegment } = useAnalysisHomeSidebarSync({
    actionBusyKey: workflowActionBusy,
    detailHeavyReady,
    detailItem,
    detailSeekRequestIdRef,
    detailTimelineReady,
    detailTitle,
    governanceSchedulerState,
    handleQueueItemCancel,
    handleQueueItemRetry,
    handleWorkflowCancel,
    handleWorkflowCacheDecision,
    handleWorkflowResume,
    handleWorkflowStageRerun,
    homeQueueItems,
    homeQueueLoading,
    lastTimelineSelectionClearRequestRef,
    onDetailStateChange,
    onQueueStateChange,
    openHistoryDetail,
    queueActionBusyKey,
    cacheDecisionBusyKey,
    rerunnableStageKeys,
    rerunningStageKey,
    selectedTimelineSegment,
    setDetailSeekRequest,
    setSelectedTimelineSegment,
    timelineSelectionClearRequest,
    view,
  });

  const handleTimelineReady = useCallback(() => {
    setDetailTimelineReady(true);
  }, []);

  const handleDetailBack = useCallback(() => {
    stopPolling();
    detailPollingKeyRef.current = null;
    setDetailHeavyReady(false);
    setDetailTimelineReady(false);
    setView("home");
  }, [stopPolling]);

  return (
    <AnalysisHomeView
      view={view}
      mode={mode}
      isUploading={isUploading}
      historyRefreshKey={historyRefreshKey}
      detailTitle={detailTitle}
      detailMedia={detailMedia}
      detailItem={detailItem}
      detailHeavyReady={detailHeavyReady}
      selectedTimelineSegment={selectedTimelineSegment}
      detailSeekRequest={detailSeekRequest}
      onUploadFiles={handleUploadFiles}
      onOpenItem={openHistoryDetail}
      onTimelineReady={handleTimelineReady}
      onSelectTimelineSegment={selectTimelineSegment}
      onBack={handleDetailBack}
    />
  );
}

