import { useCallback, useEffect, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from "react";
import { cancelFullAnalysisBatchItem, cancelMaterialRecognitionBatchItem, getLatestFullAnalysisBatchRun, getLatestMaterialRecognitionBatchRun, getSampleArtifact, retryFullAnalysisBatchItem, retryMaterialRecognitionBatchItem, runtimeUrl, startFullAnalysisBatchRun, startMaterialRecognitionBatchRun } from "../../api/client";
import type { FullAnalysisBatchItem, FullAnalysisBatchRun, SampleArtifact } from "../../types";
import { AnalysisHistory } from "./AnalysisHistory";
import { AnalysisTimelineTracks } from "./AnalysisTimelineTracks";
import { loadAnalysisDetailItem, refreshAnalysisDetailItem } from "./analysisDetailData";
import {
  cancelAnalysisWorkflow,
  isAnalysisItemRunning,
  loadRerunnableWorkflowStageKeys,
  rerunAnalysisWorkflowStage,
  resumeAnalysisWorkflow,
} from "./analysisBackend";
import type { AnalysisWorkflowMode } from "./analysisBackend";
import { listAnalysisHistorySamples, resolveAnalysisHistoryMedia, type AnalysisHistoryItem, type AnalysisHistoryMedia } from "./analysisHistoryData";
import type { AnalysisTimelineSegmentDetail } from "./analysisTimelineSelection";
import type { AnalysisDetailSidebarState } from "./AnalysisWorkflowSidebar";

type AnalysisHomeProps = {
  mode?: AnalysisWorkflowMode;
  onDetailStateChange?: (state: AnalysisDetailSidebarState) => void;
  onQueueStateChange?: (state: AnalysisHomeQueueState) => void;
  openRequest?: { requestId: number; sampleVideoId: string; artifactId?: string | null; title?: string | null } | null;
  onOpenRequestResolved?: (result: { requestId: number; ok: boolean; message?: string | null }) => void;
  timelineSelectionClearRequest?: number;
};

type TimelineSeekRequest = {
  requestId: number;
  time: number;
};

export type AnalysisHomeQueueItem = {
  key: string;
  status: "done" | "running" | "waiting" | "failed" | "canceled";
  thumbnailUrl: string | null;
  ratio: "wide" | "cinema";
  badgeLabel: "分析中" | "识别中" | "排队中" | "已完成" | "失败" | "已停止";
  title: string;
  historyItem: AnalysisHistoryItem | null;
  batchRunId?: string | null;
  queueItemId?: string | null;
  workflowRunId?: string | null;
  workflowKey?: string | null;
  retryable?: boolean;
};

export type AnalysisHomeQueueState = {
  items: AnalysisHomeQueueItem[];
  loading: boolean;
  onOpenItem: (item: AnalysisHistoryItem) => void;
  onCancelItem?: (item: AnalysisHomeQueueItem) => void;
  onRetryItem?: (item: AnalysisHomeQueueItem) => void;
  actionBusyKey?: string | null;
};

const ANALYSIS_DETAIL_HEAVY_MOUNT_DELAY_MS = 240;
const ANALYSIS_PLAYER_QUEUE_REFRESH_MS = 3200;

export function AnalysisHome({ mode = "structureAnalysis", onDetailStateChange, onQueueStateChange, openRequest = null, onOpenRequestResolved, timelineSelectionClearRequest = 0 }: AnalysisHomeProps = {}) {
  const lastTimelineSelectionClearRequestRef = useRef(timelineSelectionClearRequest);
  const uploadInputRef = useRef<HTMLInputElement>(null);
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
  const [queueActionBusyKey, setQueueActionBusyKey] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [homeQueueItems, setHomeQueueItems] = useState<AnalysisHomeQueueItem[]>([]);
  const [homeQueueLoading, setHomeQueueLoading] = useState(false);
  const [detailHeavyReady, setDetailHeavyReady] = useState(false);
  const [detailTimelineReady, setDetailTimelineReady] = useState(false);
  const [detailSeekRequest, setDetailSeekRequest] = useState<TimelineSeekRequest | null>(null);
  const isMaterialMode = mode === "materialRecognition";
  const uploadTitle = isMaterialMode ? "拖拽视频做素材识别" : "拖拽样例做结构分析";
  const uploadSubtitle = isMaterialMode ? "生成素材能力包" : "拆出脚本 / 节奏 / 包装";
  const uploadAriaLabel = isMaterialMode ? "上传视频开始素材识别" : "上传视频开始结构分析";
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

  const openUploadDetail = () => {
    uploadInputRef.current?.click();
  };

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
        if (!target.hasFunctionSlotAtomization) {
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
    } catch {
      setHomeQueueItems([]);
    } finally {
      setHomeQueueLoading(false);
    }
  }, [mode]);

  useEffect(() => {
    if (view !== "home") return undefined;
    let mounted = true;
    const refresh = () => {
      setHomeQueueLoading(true);
      loadLatestVideoProcessingQueue(mode)
        .then((items) => {
          if (mounted) setHomeQueueItems(items);
        })
        .catch(() => {
          if (mounted) setHomeQueueItems([]);
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
    } finally {
      if (token === operationTokenRef.current) setIsUploading(false);
    }
  }, [isMaterialMode, openHistoryDetail, refreshHomeQueue, stopPolling]);

  const handleUploadFiles = useCallback(async (files: FileList | File[]) => {
    const videoFiles = Array.from(files).filter((item) => item.type.startsWith("video/") || /\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(item.name));
    if (!videoFiles.length) return;
    await startAnalysisBatch(videoFiles, { openFirstWhenReady: videoFiles.length === 1 });
  }, [startAnalysisBatch]);

  const handleUploadDrop = useCallback((event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (isUploading) return;
    if (event.dataTransfer.files.length) void handleUploadFiles(event.dataTransfer.files);
  }, [handleUploadFiles, isUploading]);

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

  useEffect(() => {
    onQueueStateChange?.({
      items: homeQueueItems,
      loading: homeQueueLoading,
      onOpenItem: openHistoryDetail,
      onCancelItem: handleQueueItemCancel,
      onRetryItem: handleQueueItemRetry,
      actionBusyKey: queueActionBusyKey,
    });
  }, [handleQueueItemCancel, handleQueueItemRetry, homeQueueItems, homeQueueLoading, onQueueStateChange, openHistoryDetail, queueActionBusyKey]);

  useEffect(() => () => {
    onQueueStateChange?.({
      items: [],
      loading: false,
      onOpenItem: openHistoryDetail,
      actionBusyKey: null,
    });
  }, [onQueueStateChange, openHistoryDetail]);

  useEffect(() => () => {
    stopPolling();
  }, [stopPolling]);

  useEffect(() => {
    if (lastTimelineSelectionClearRequestRef.current === timelineSelectionClearRequest) return;
    lastTimelineSelectionClearRequestRef.current = timelineSelectionClearRequest;
    setSelectedTimelineSegment(null);
  }, [timelineSelectionClearRequest]);

  const selectTimelineSegment = useCallback((segment: AnalysisTimelineSegmentDetail) => {
    if (!detailHeavyReady) return;
    setSelectedTimelineSegment(segment);
    onDetailStateChange?.({
      visible: view === "detail",
      title: detailTitle,
      item: detailItem,
      selectedTimelineSegment: segment,
      rerunnableStageKeys,
      rerunningStageKey,
      onWorkflowStageRerun: handleWorkflowStageRerun,
      workflowActionBusy,
      onWorkflowCancel: handleWorkflowCancel,
      onWorkflowResume: handleWorkflowResume,
    });
  }, [detailHeavyReady, detailItem, detailTitle, handleWorkflowCancel, handleWorkflowResume, handleWorkflowStageRerun, onDetailStateChange, rerunnableStageKeys, rerunningStageKey, view, workflowActionBusy]);

  const handleWorkflowDetailCardSelect = useCallback((target: AnalysisTimelineSegmentDetail) => {
    selectTimelineSegment(target);
    const time = Number(target.start);
    if (!Number.isFinite(time) || time < 0) return;
    detailSeekRequestIdRef.current += 1;
    setDetailSeekRequest({ requestId: detailSeekRequestIdRef.current, time });
  }, [selectTimelineSegment]);

  useEffect(() => {
    const sidebarItem = detailTimelineReady ? detailItem : null;
    onDetailStateChange?.({
      visible: view === "detail",
      title: detailTitle,
      item: sidebarItem,
      selectedTimelineSegment: detailTimelineReady ? selectedTimelineSegment : null,
      rerunnableStageKeys: detailTimelineReady ? rerunnableStageKeys : [],
      rerunningStageKey: detailTimelineReady ? rerunningStageKey : null,
      onWorkflowStageRerun: handleWorkflowStageRerun,
      workflowActionBusy,
      onWorkflowCancel: handleWorkflowCancel,
      onWorkflowResume: handleWorkflowResume,
      onWorkflowDetailCardSelect: handleWorkflowDetailCardSelect,
    });
  }, [detailItem, detailTimelineReady, detailTitle, handleWorkflowCancel, handleWorkflowDetailCardSelect, handleWorkflowResume, handleWorkflowStageRerun, onDetailStateChange, rerunnableStageKeys, rerunningStageKey, selectedTimelineSegment, view, workflowActionBusy]);

  const handleTimelineReady = useCallback(() => {
    setDetailTimelineReady(true);
  }, []);

  return (
    <>
      <input
        ref={uploadInputRef}
        type="file"
        accept="video/*"
        multiple
        hidden
        onChange={(event) => {
          const files = event.currentTarget.files;
          if (files?.length) void handleUploadFiles(files);
          event.currentTarget.value = "";
        }}
      />
      <section className={`new-ui-analysis-home ${view === "home" ? "" : "is-hidden"}`.trim()} aria-hidden={view !== "home"} aria-label="分析首页">
        <button
          className="new-ui-analysis-upload-frame"
          type="button"
          aria-label={uploadAriaLabel}
          disabled={isUploading}
          onClick={openUploadDetail}
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleUploadDrop}
        >
          <span className="new-ui-analysis-upload-icon-tile">
            <svg className="new-ui-analysis-upload-icon" viewBox="0 0 128 96" focusable="false" aria-hidden="true">
              <path className="new-ui-analysis-upload-cloud-fill" d="M38 70c-10.6 0-19-8.2-19-18.5 0-9.8 7.3-17.6 17.1-19.1 3.6-10.9 13.1-17.9 24.4-17.9 12.6 0 23 9 25.1 20.9 10.1 1.3 17.9 9 17.9 18.8 0 8.9-6.7 15.8-16.1 15.8H38Z" />
              <path className="new-ui-analysis-upload-cloud-line" d="M38 70c-10.6 0-19-8.2-19-18.5 0-9.8 7.3-17.6 17.1-19.1 3.6-10.9 13.1-17.9 24.4-17.9 12.6 0 23 9 25.1 20.9 10.1 1.3 17.9 9 17.9 18.8 0 8.9-6.7 15.8-16.1 15.8H38Z" />
              <path className="new-ui-analysis-upload-arrow" d="M61 71V42" />
              <path className="new-ui-analysis-upload-arrow" d="M46 56 61 41l15 15" />
              <path className="new-ui-analysis-upload-base" d="M49 82h24" />
            </svg>
          </span>
          <span className="new-ui-analysis-upload-copy">
            <span className="new-ui-analysis-upload-primary">{isUploading ? (isMaterialMode ? "正在启动识别" : "正在启动分析") : uploadTitle}</span>
            <span className="new-ui-analysis-upload-secondary">{isUploading ? "正在创建任务" : uploadSubtitle}</span>
          </span>
          <span className="new-ui-analysis-upload-limit-group" aria-hidden="true">
            <span className="new-ui-analysis-upload-limit">支持并行</span>
            <span className="new-ui-analysis-upload-limit">单文件最大 2G</span>
          </span>
        </button>
        <AnalysisHistory mode={mode} refreshKey={historyRefreshKey} onOpenItem={openHistoryDetail} />
      </section>
      <AnalysisDetailPage
        hidden={view !== "detail"}
        mode={mode}
        title={detailTitle}
        media={detailMedia}
        item={detailItem}
        heavyReady={detailHeavyReady}
        selectedTimelineSegment={selectedTimelineSegment}
        seekRequest={detailSeekRequest}
        onTimelineReady={handleTimelineReady}
        onSelectTimelineSegment={selectTimelineSegment}
        onOpenItem={openHistoryDetail}
        onBack={() => {
          stopPolling();
          detailPollingKeyRef.current = null;
          setDetailHeavyReady(false);
          setDetailTimelineReady(false);
          setView("home");
        }}
      />
    </>
  );
}

function AnalysisDetailPage({
  hidden,
  mode,
  title,
  media,
  item,
  heavyReady,
  selectedTimelineSegment,
  seekRequest,
  onTimelineReady,
  onSelectTimelineSegment,
  onOpenItem,
  onBack,
}: {
  hidden: boolean;
  mode: AnalysisWorkflowMode;
  title: string;
  media: AnalysisHistoryMedia | null;
  item: AnalysisHistoryItem | null;
  heavyReady: boolean;
  selectedTimelineSegment: AnalysisTimelineSegmentDetail | null;
  seekRequest: TimelineSeekRequest | null;
  onTimelineReady: () => void;
  onSelectTimelineSegment: (segment: AnalysisTimelineSegmentDetail) => void;
  onOpenItem: (item: AnalysisHistoryItem) => void;
  onBack: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const orientation = media?.orientation ?? "landscape";
  const [queueExpanded, setQueueExpanded] = useState(false);
  const [batchQueueItems, setBatchQueueItems] = useState<AnalysisHomeQueueItem[] | null>(null);
  const queueItems = resolveVideoProcessingQueueItems(item, media, batchQueueItems);

  useEffect(() => {
    if (hidden) {
      videoRef.current?.pause();
      setQueueExpanded(false);
    }
  }, [hidden]);

  useEffect(() => {
    if (!queueExpanded) {
      setBatchQueueItems(null);
      return undefined;
    }
    let mounted = true;
    const refreshQueue = () => {
      loadLatestVideoProcessingQueue(mode)
        .then((items) => {
          if (mounted) setBatchQueueItems(items);
        })
        .catch(() => {
          if (mounted) setBatchQueueItems([]);
        });
    };
    refreshQueue();
    const refreshTimer = window.setInterval(refreshQueue, ANALYSIS_PLAYER_QUEUE_REFRESH_MS);
    return () => {
      mounted = false;
      window.clearInterval(refreshTimer);
    };
  }, [mode, queueExpanded]);

  const seekTimeline = (time: number) => {
    const nextTime = Math.max(0, time);
    const video = videoRef.current;
    if (video) {
      video.currentTime = Math.min(nextTime, Number.isFinite(video.duration) ? video.duration : nextTime);
      return;
    }
  };

  useEffect(() => {
    if (!seekRequest) return;
    seekTimeline(seekRequest.time);
  }, [seekRequest?.requestId]);

  return (
    <section className={`new-ui-analysis-detail ${hidden ? "is-hidden" : ""}`.trim()} aria-hidden={hidden} aria-label="分析详情">
      <header className="new-ui-analysis-detail-header">
        <button className="new-ui-analysis-title-button" type="button" aria-label={`返回分析首页：${title}`} data-tooltip={title} onClick={onBack}>
          <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
            <path d="M15 6 9 12l6 6" />
          </svg>
          <span className="new-ui-analysis-detail-title">{title}</span>
        </button>
      </header>
      <div className="new-ui-analysis-detail-body">
        <div className="new-ui-analysis-detail-media">
          <div className={`new-ui-analysis-player-shell ${queueExpanded ? "is-queue-expanded" : ""}`.trim()}>
            <div className={`new-ui-analysis-player is-${orientation}`}>
              {media?.videoUrl ? (
                heavyReady ? (
                  <video
                    ref={videoRef}
                    key={media.videoUrl}
                    src={media.videoUrl}
                    poster={media.coverUrl ?? undefined}
                    controls
                    playsInline
                    preload="metadata"
                  />
                ) : (
                  <div className="new-ui-analysis-player-empty" aria-hidden="true" />
                )
              ) : (
                <div className="new-ui-analysis-player-empty" aria-hidden="true" />
              )}
            </div>
            <PlayerQueueRail
              currentSampleVideoId={item?.sampleVideoId ?? null}
              expanded={queueExpanded}
              items={queueItems}
              onOpenItem={onOpenItem}
              onToggle={() => setQueueExpanded((value) => !value)}
            />
          </div>
          <div className="new-ui-analysis-detail-status-spacer" aria-hidden="true" />
        </div>
        <AnalysisTimelineTracks
          item={heavyReady && item?.artifact ? item : null}
          modeHint={resolveTimelineModeHint(media)}
          mediaKey={heavyReady ? media?.videoUrl ?? item?.sampleVideoId ?? "empty" : "deferred"}
          active={!hidden && heavyReady && Boolean(item?.artifact)}
          videoRef={videoRef}
          selectedSegmentId={selectedTimelineSegment?.id ?? null}
          onReady={onTimelineReady}
          onSeek={seekTimeline}
          onSelectSegment={onSelectTimelineSegment}
        />
      </div>
    </section>
  );
}

function resolveTimelineModeHint(media: AnalysisHistoryMedia | null): "material" | "structure" | null {
  return media?.analysisKind ?? null;
}

function PlayerQueueRail({
  currentSampleVideoId,
  expanded,
  items,
  onOpenItem,
  onToggle,
}: {
  currentSampleVideoId: string | null;
  expanded: boolean;
  items: AnalysisHomeQueueItem[];
  onOpenItem: (item: AnalysisHistoryItem) => void;
  onToggle: () => void;
}) {
  const queueLabel = expanded ? "收起视频处理队列" : "展开视频处理队列";
  const handleQueueKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onToggle();
  };
  const openQueueItem = (event: MouseEvent<HTMLButtonElement>, queueItem: AnalysisHomeQueueItem) => {
    event.stopPropagation();
    if (!queueItem.historyItem) return;
    if (queueItem.historyItem.sampleVideoId === currentSampleVideoId) return;
    onOpenItem(queueItem.historyItem);
  };

  return (
    <aside
      className={`new-ui-analysis-player-queue ${expanded ? "is-expanded" : ""}`.trim()}
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      aria-label={queueLabel}
      data-tooltip={queueLabel}
      onClick={onToggle}
      onKeyDown={handleQueueKeyDown}
    >
      <div className="new-ui-analysis-player-queue-preview">
        {items.map((item) => {
          const currentItem = Boolean(item.historyItem?.sampleVideoId && item.historyItem.sampleVideoId === currentSampleVideoId);
          return (
            <button
              key={item.key}
              className={`new-ui-analysis-player-queue-thumb is-${item.status} is-${item.ratio} ${currentItem ? "is-current" : ""}`.trim()}
              type="button"
              tabIndex={expanded && item.historyItem && !currentItem ? 0 : -1}
              disabled={!item.historyItem}
              aria-current={currentItem ? "true" : undefined}
              aria-label={currentItem ? `当前视频：${item.title}` : `打开分析详情：${item.title}`}
              onClick={(event) => openQueueItem(event, item)}
            >
              {item.thumbnailUrl ? <img src={item.thumbnailUrl} alt="" loading="lazy" decoding="async" /> : <span className="new-ui-analysis-player-queue-thumb-empty" />}
              <span className="new-ui-analysis-player-queue-badge">{item.badgeLabel}</span>
            </button>
          );
        })}
      </div>
      <span
        className="new-ui-analysis-player-queue-toggle"
        aria-hidden="true"
      >
        <QueueIcon expanded={expanded} />
      </span>
    </aside>
  );
}

function QueueIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path d={expanded ? "M14 7l-5 5 5 5" : "M10 7l5 5-5 5"} />
    </svg>
  );
}

function resolveVideoProcessingQueueItems(item: AnalysisHistoryItem | null, media: AnalysisHistoryMedia | null, batchItems: AnalysisHomeQueueItem[] | null): AnalysisHomeQueueItem[] {
  if (batchItems?.length) return batchItems;
  if (!item && !media) return [];
  const currentStatus = resolveCurrentQueueStatus(item);
  return [
    {
      key: "video-slot-1",
      status: currentStatus,
      thumbnailUrl: media?.coverUrl ?? null,
      ratio: resolveQueueThumbnailRatio(media),
      badgeLabel: resolveQueueBadgeLabel(item, media, currentStatus),
      title: media?.title ?? item?.title ?? "当前视频",
      historyItem: item,
    },
  ];
}

function resolveCurrentQueueStatus(item: AnalysisHistoryItem | null): AnalysisHomeQueueItem["status"] {
  const status = normalizePlayerQueueStatus(item?.artifact?.status ?? item?.workflowRun?.status ?? item?.runtimeState?.status ?? item?.status);
  if (status === "done") return status;
  if ((item?.hasFunctionSlotAtomization || item?.hasUserMaterialPack || item?.artifact?.functionSlotAtomizationAnalysis || item?.artifact?.userMaterialPack) && status !== "failed" && status !== "canceled") return "done";
  return status;
}

function resolveQueueThumbnailRatio(media: AnalysisHistoryMedia | null): AnalysisHomeQueueItem["ratio"] {
  return media?.ratioLabel === "16:9" ? "wide" : "cinema";
}

function resolveQueueBadgeLabel(item: AnalysisHistoryItem | null, media: AnalysisHistoryMedia | null, status: AnalysisHomeQueueItem["status"]): AnalysisHomeQueueItem["badgeLabel"] {
  if (status === "done") return "已完成";
  if (status === "failed") return "失败";
  if (status === "canceled") return "已停止";
  if (status === "waiting") return "排队中";
  if (media?.analysisKind === "material" || item?.workflowRun?.workflowKey === "material-recognition") return "识别中";
  return "分析中";
}

async function loadLatestVideoProcessingQueue(mode: AnalysisWorkflowMode = "structureAnalysis"): Promise<AnalysisHomeQueueItem[]> {
  const loadBatch = mode === "materialRecognition" ? getLatestMaterialRecognitionBatchRun : getLatestFullAnalysisBatchRun;
  const batch = await loadBatch({ active: true }).catch(() => null);
  if (!batch?.items?.length) return [];
  const artifactEntries = await Promise.all(
    batch.items.map(async (queueItem) => {
      if (!queueItem.sampleVideoId) return [queueItem.queueItemId, null] as const;
      const artifact = await getSampleArtifact(queueItem.sampleVideoId).catch(() => null);
      return [queueItem.queueItemId, artifact] as const;
    }),
  );
  const artifactByQueueItemId = new Map<string, SampleArtifact | null>(artifactEntries);
  return batch.items.map((queueItem) => resolveBatchQueueItem(queueItem, batch, artifactByQueueItemId.get(queueItem.queueItemId) ?? null));
}

function resolveBatchQueueItem(queueItem: FullAnalysisBatchItem, batch: FullAnalysisBatchRun, artifact: SampleArtifact | null): AnalysisHomeQueueItem {
  const status = resolveBatchQueueStatus(queueItem, batch, artifact);
  return {
    key: queueItem.queueItemId,
    status,
    thumbnailUrl: resolveArtifactThumbnailUrl(artifact),
    ratio: resolveBatchQueueThumbnailRatio(artifact),
    badgeLabel: resolveBatchQueueBadgeLabel(queueItem, batch, status),
    title: resolveBatchQueueTitle(queueItem, artifact),
    historyItem: resolveBatchQueueHistoryItem(queueItem, batch, artifact, status),
    batchRunId: batch.batchRunId,
    queueItemId: queueItem.queueItemId,
    workflowRunId: queueItem.workflowRunId ?? null,
    workflowKey: batch.workflowKey,
    retryable: Boolean(queueItem.retryable),
  };
}

function resolveBatchQueueStatus(queueItem: FullAnalysisBatchItem, batch: FullAnalysisBatchRun, artifact: SampleArtifact | null): AnalysisHomeQueueItem["status"] {
  if (batch.workflowKey === "material-recognition" && artifact?.userMaterialPack) return "done";
  if (batch.workflowKey !== "material-recognition" && artifact?.functionSlotAtomizationAnalysis) return "done";
  return normalizePlayerQueueStatus(queueItem.status ?? artifact?.status);
}

function resolveBatchQueueTitle(queueItem: FullAnalysisBatchItem, artifact: SampleArtifact | null) {
  return artifact?.sampleVideo.original.summary ?? queueItem.filename ?? queueItem.sampleVideoId ?? "队列视频";
}

function resolveBatchQueueHistoryItem(queueItem: FullAnalysisBatchItem, batch: FullAnalysisBatchRun, artifact: SampleArtifact | null, status: AnalysisHomeQueueItem["status"]): AnalysisHistoryItem | null {
  if (!queueItem.sampleVideoId) return null;
  return {
    sampleVideoId: queueItem.sampleVideoId,
    workflowRunId: queueItem.workflowRunId ?? null,
    workflowKey: batch.workflowKey,
    title: resolveBatchQueueTitle(queueItem, artifact),
    status: artifact?.status ?? queueItem.status,
    updatedAt: queueItem.updatedAt,
    createdAt: queueItem.createdAt,
    artifactId: latestSampleAnalysisArtifactId(artifact),
    traceId: artifact?.trace?.traceId ?? null,
    runId: artifact?.trace?.runId ?? null,
    stageId: artifact?.trace?.stageId ?? null,
    durationSeconds: artifact?.metadata.durationSeconds ?? null,
    width: artifact?.metadata.width ?? null,
    height: artifact?.metadata.height ?? null,
    coverUri: artifact?.cover?.uri ?? artifact?.frames?.[0]?.imageUri ?? null,
    videoUri: artifact?.sampleVideo.normalized.uri ?? artifact?.sampleVideo.original.uri ?? null,
    hasFunctionSlotAtomization: Boolean(artifact?.functionSlotAtomizationAnalysis),
    hasUserMaterialPack: Boolean(artifact?.userMaterialPack),
    isIncomplete: status !== "done" && status !== "running" && status !== "waiting",
    isRunning: status === "running" || status === "waiting",
    artifact,
    workflowRun: null,
    runtimeState: null,
  };
}

function latestSampleAnalysisArtifactId(artifact: SampleArtifact | null) {
  return artifact?.functionSlotAtomizationAnalysis?.artifactId
    ?? artifact?.userMaterialPack?.artifactId
    ?? artifact?.packagingStructureAnalysis?.artifactId
    ?? artifact?.rhythmStructureAnalysis?.artifactId
    ?? artifact?.scriptSegmentAnalysis?.artifactId
    ?? artifact?.shotBoundaryAnalysis?.artifactId
    ?? null;
}

function resolveArtifactThumbnailUrl(artifact: SampleArtifact | null) {
  return runtimeUrl(artifact?.cover?.uri ?? artifact?.frames?.[0]?.imageUri ?? null);
}

function resolveBatchQueueThumbnailRatio(artifact: SampleArtifact | null): AnalysisHomeQueueItem["ratio"] {
  const width = Number(artifact?.metadata?.width);
  const height = Number(artifact?.metadata?.height);
  if (Number.isFinite(width) && Number.isFinite(height) && height > width) return "cinema";
  return "wide";
}

function resolveBatchQueueBadgeLabel(queueItem: FullAnalysisBatchItem, batch: FullAnalysisBatchRun, status: AnalysisHomeQueueItem["status"]): AnalysisHomeQueueItem["badgeLabel"] {
  if (status === "done") return "已完成";
  if (status === "failed") return "失败";
  if (status === "canceled") return "已停止";
  if (status === "waiting" || queueItem.status === "queued" || queueItem.position > batch.maxConcurrentRuns) return "排队中";
  if (batch.workflowKey === "material-recognition" || queueItem.currentStageLabel?.includes("素材")) return "识别中";
  return "分析中";
}

function normalizePlayerQueueStatus(status: string | null | undefined): AnalysisHomeQueueItem["status"] {
  const text = String(status ?? "").toLowerCase();
  if (["processed", "done", "completed", "complete", "success", "succeeded"].includes(text)) return "done";
  if (text === "running" || text === "processing" || text === "cache_waiting") return "running";
  if (text === "failed" || text === "partial_failed") return "failed";
  if (text === "canceled") return "canceled";
  return "waiting";
}

function analysisDetailPollingKey(item: AnalysisHistoryItem) {
  return `${item.sampleVideoId ?? ""}:${item.workflowRunId ?? ""}:${item.artifactId ?? ""}`;
}
