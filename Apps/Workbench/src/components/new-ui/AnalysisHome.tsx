import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { AnalysisHistory } from "./AnalysisHistory";
import { AnalysisTimelineTracks } from "./AnalysisTimelineTracks";
import { loadAnalysisDetailItem, refreshAnalysisDetailItem } from "./analysisDetailData";
import {
  isAnalysisItemRunning,
  loadRerunnableWorkflowStageKeys,
  rerunAnalysisWorkflowStage,
  startAnalysisUpload,
} from "./analysisBackend";
import { resolveAnalysisHistoryMedia, type AnalysisHistoryItem, type AnalysisHistoryMedia } from "./analysisHistoryData";
import type { AnalysisTimelineSegmentDetail } from "./analysisTimelineSelection";
import type { AnalysisDetailSidebarState } from "./AnalysisWorkflowSidebar";

type AnalysisHomeProps = {
  onDetailStateChange?: (state: AnalysisDetailSidebarState) => void;
  timelineSelectionClearRequest?: number;
};

const ANALYSIS_DETAIL_HEAVY_MOUNT_DELAY_MS = 240;

export function AnalysisHome({ onDetailStateChange, timelineSelectionClearRequest = 0 }: AnalysisHomeProps = {}) {
  const lastTimelineSelectionClearRequestRef = useRef(timelineSelectionClearRequest);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const pollTimerRef = useRef<number | null>(null);
  const operationTokenRef = useRef(0);
  const detailLoadKeyRef = useRef<string | null>(null);
  const detailPollingKeyRef = useRef<string | null>(null);
  const [view, setView] = useState<"home" | "detail">("home");
  const [detailTransitionKey, setDetailTransitionKey] = useState(0);
  const [detailTitle, setDetailTitle] = useState("新建分析");
  const [detailMedia, setDetailMedia] = useState<AnalysisHistoryMedia | null>(null);
  const [detailItem, setDetailItem] = useState<AnalysisHistoryItem | null>(null);
  const [detailArtifactStatus, setDetailArtifactStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [taskStatusText, setTaskStatusText] = useState<string | null>(null);
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  const [selectedTimelineSegment, setSelectedTimelineSegment] = useState<AnalysisTimelineSegmentDetail | null>(null);
  const [rerunnableStageKeys, setRerunnableStageKeys] = useState<string[]>([]);
  const [rerunningStageKey, setRerunningStageKey] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [detailHeavyReady, setDetailHeavyReady] = useState(false);
  const [detailTimelineReady, setDetailTimelineReady] = useState(false);
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
        setDetailArtifactStatus(nextItem.artifact ? "ready" : "loading");
        setTaskStatusText(statusTextForAnalysisItem(nextItem));
        setHistoryRefreshKey((value) => value + 1);
        if (isAnalysisItemRunning(nextItem)) {
          terminalPollsRemaining = 4;
          return;
        }
        terminalPollsRemaining -= 1;
        if (terminalPollsRemaining <= 0) stopPolling();
      } catch {
        if (token !== operationTokenRef.current) return;
        setDetailArtifactStatus("error");
        setTaskStatusText("刷新分析状态失败");
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

  const openHistoryDetail = (item: AnalysisHistoryItem) => {
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
    setDetailArtifactStatus(item.artifact ? "ready" : "loading");
    setTaskStatusText(statusTextForAnalysisItem(item));
    setSelectedTimelineSegment(null);
    setRerunnableStageKeys([]);
    setRerunningStageKey(null);
    setView("detail");
  };

  const handleUploadFiles = useCallback(async (files: FileList | File[]) => {
    const file = Array.from(files).find((item) => item.type.startsWith("video/") || /\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(item.name));
    if (!file) return;
    const token = operationTokenRef.current + 1;
    operationTokenRef.current = token;
    stopPolling();
    detailLoadKeyRef.current = null;
    detailPollingKeyRef.current = null;
    setIsUploading(true);
    setDetailHeavyReady(false);
    setDetailTimelineReady(false);
    setDetailTransitionKey((value) => value + 1);
    setDetailTitle(file.name.replace(/\.(mp4|mov|m4v|webm|mkv|avi)$/i, ""));
    setDetailMedia(null);
    setDetailItem(null);
    setDetailArtifactStatus("loading");
    setTaskStatusText("正在启动完整分析");
    setSelectedTimelineSegment(null);
    setRerunnableStageKeys([]);
    setRerunningStageKey(null);
    setView("detail");
    try {
      const { item, media } = await startAnalysisUpload(file);
      if (token !== operationTokenRef.current) return;
      setDetailItem(item);
      setDetailMedia(media);
      setDetailTitle(media.title);
      setDetailArtifactStatus(item.artifact ? "ready" : "loading");
      setTaskStatusText(statusTextForAnalysisItem(item));
      setHistoryRefreshKey((value) => value + 1);
    } catch (error) {
      if (token !== operationTokenRef.current) return;
      setDetailArtifactStatus("error");
      setTaskStatusText(error instanceof Error ? error.message : "启动完整分析失败");
    } finally {
      if (token === operationTokenRef.current) setIsUploading(false);
    }
  }, [stopPolling]);

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
    setTaskStatusText(`正在重跑${stageLabelForStatus(statusKey)}`);
    setSelectedTimelineSegment(null);
    try {
      const { item: nextItem, media: nextMedia } = await rerunAnalysisWorkflowStage(detailItem, stageKeys);
      if (token !== operationTokenRef.current) return;
      setDetailItem(nextItem);
      setDetailMedia(nextMedia);
      setDetailTitle(nextMedia.title);
      setDetailArtifactStatus(nextItem.artifact ? "ready" : "loading");
      setTaskStatusText(statusTextForAnalysisItem(nextItem));
      setHistoryRefreshKey((value) => value + 1);
      startDetailPolling(nextItem, token);
    } catch (error) {
      if (token !== operationTokenRef.current) return;
      setTaskStatusText(error instanceof Error ? error.message : "重跑分析步骤失败");
    } finally {
      if (token === operationTokenRef.current) setRerunningStageKey(null);
    }
  }, [detailItem, rerunningStageKey, startDetailPolling, stopPolling]);

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
    setDetailArtifactStatus("loading");
    loadAnalysisDetailItem(detailItem)
      .then(({ item: nextItem, media: nextMedia }) => {
        if (!mounted) return;
        setDetailItem(nextItem);
        setDetailMedia(nextMedia);
        setDetailTitle(nextMedia.title);
        setDetailArtifactStatus(nextItem.artifact ? "ready" : "loading");
        setTaskStatusText(statusTextForAnalysisItem(nextItem));
      })
      .catch(() => {
        if (!mounted) return;
        setDetailArtifactStatus("error");
        setTaskStatusText("完整分析结果暂时无法读取");
      });
    return () => {
      mounted = false;
    };
  }, [detailHeavyReady, detailItem, view]);

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
    });
  }, [detailItem, detailTimelineReady, detailTitle, handleWorkflowStageRerun, onDetailStateChange, rerunnableStageKeys, rerunningStageKey, selectedTimelineSegment, view]);

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
    });
  }, [detailHeavyReady, detailItem, detailTitle, handleWorkflowStageRerun, onDetailStateChange, rerunnableStageKeys, rerunningStageKey, view]);

  const handleTimelineReady = useCallback(() => {
    setDetailTimelineReady(true);
  }, []);

  return (
    <>
      <input
        ref={uploadInputRef}
        type="file"
        accept="video/*"
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
          aria-label="上传视频开始分析"
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
            <span className="new-ui-analysis-upload-primary">{isUploading ? "正在启动分析" : "拖拽视频到此处"}</span>
            <span className="new-ui-analysis-upload-secondary">{isUploading ? "正在创建分析任务" : "或点击选择文件"}</span>
          </span>
          <span className="new-ui-analysis-upload-limit" aria-hidden="true">MP4/MOV 单个视频 最大 2GB</span>
        </button>
        <AnalysisHistory refreshKey={historyRefreshKey} onOpenItem={openHistoryDetail} />
      </section>
      <AnalysisDetailPage
        hidden={view !== "detail"}
        title={detailTitle}
        media={detailMedia}
        item={detailItem}
        heavyReady={detailHeavyReady}
        artifactStatus={detailArtifactStatus}
        taskStatusText={taskStatusText}
        selectedTimelineSegment={selectedTimelineSegment}
        onTimelineReady={handleTimelineReady}
        onSelectTimelineSegment={selectTimelineSegment}
        onBack={() => {
          stopPolling();
          detailPollingKeyRef.current = null;
          setDetailHeavyReady(false);
          setDetailTimelineReady(false);
          setView("home");
        }}
        onUpload={openUploadDetail}
      />
    </>
  );
}

function AnalysisDetailPage({
  hidden,
  title,
  media,
  item,
  heavyReady,
  artifactStatus,
  taskStatusText,
  selectedTimelineSegment,
  onTimelineReady,
  onSelectTimelineSegment,
  onBack,
  onUpload,
}: {
  hidden: boolean;
  title: string;
  media: AnalysisHistoryMedia | null;
  item: AnalysisHistoryItem | null;
  heavyReady: boolean;
  artifactStatus: "idle" | "loading" | "ready" | "error";
  taskStatusText: string | null;
  selectedTimelineSegment: AnalysisTimelineSegmentDetail | null;
  onTimelineReady: () => void;
  onSelectTimelineSegment: (segment: AnalysisTimelineSegmentDetail) => void;
  onBack: () => void;
  onUpload: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const orientation = media?.orientation ?? "landscape";

  useEffect(() => {
    if (hidden) {
      videoRef.current?.pause();
    }
  }, [hidden]);

  const seekTimeline = (time: number) => {
    const nextTime = Math.max(0, time);
    const video = videoRef.current;
    if (video) {
      video.currentTime = Math.min(nextTime, Number.isFinite(video.duration) ? video.duration : nextTime);
      return;
    }
  };

  return (
    <section className={`new-ui-analysis-detail ${hidden ? "is-hidden" : ""}`.trim()} aria-hidden={hidden} aria-label="分析详情">
      <header className="new-ui-analysis-detail-header">
        <button className="new-ui-analysis-title-button" type="button" aria-label={`返回分析首页：${title}`} title={title} onClick={onBack}>
          <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
            <path d="M15 6 9 12l6 6" />
          </svg>
          <span className="new-ui-analysis-detail-title">{title}</span>
        </button>
      </header>
      <div className="new-ui-analysis-detail-body">
        <div className="new-ui-analysis-detail-media">
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
          {artifactStatus === "loading" ? <div className="new-ui-analysis-detail-status">正在加载完整分析结果</div> : null}
          {artifactStatus === "error" ? <div className="new-ui-analysis-detail-status">完整分析结果暂时无法读取</div> : null}
          {taskStatusText ? <div className="new-ui-analysis-detail-status">{taskStatusText}</div> : null}
          {!item && artifactStatus === "idle" ? (
            <button className="new-ui-analysis-detail-status" type="button" onClick={onUpload}>选择视频开始分析</button>
          ) : null}
        </div>
        <AnalysisTimelineTracks
          item={heavyReady && item?.artifact ? item : null}
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

function statusTextForAnalysisItem(item: AnalysisHistoryItem | null) {
  const runtimeStatus = String(item?.runtimeState?.status ?? item?.workflowRun?.status ?? item?.status ?? "").toLowerCase();
  if (!runtimeStatus) return null;
  if (["queued", "pending"].includes(runtimeStatus)) return "分析任务已排队";
  if (["running", "processing"].includes(runtimeStatus)) return "正在分析";
  if (["waiting", "blocked", "cache_waiting"].includes(runtimeStatus)) return null;
  if (runtimeStatus === "processed") return "分析完成";
  if (runtimeStatus === "partial_failed") return "部分分析失败";
  if (runtimeStatus === "failed") return "分析失败";
  return `状态：${runtimeStatus}`;
}

function analysisDetailPollingKey(item: AnalysisHistoryItem) {
  return `${item.sampleVideoId ?? ""}:${item.workflowRunId ?? ""}:${item.artifactId ?? ""}`;
}

function stageLabelForStatus(stageKey: string) {
  if (stageKey === "structureAnalysis") return "结构分析";
  if (stageKey === "shotBoundary") return "切镜";
  if (stageKey === "scriptSegment") return "脚本段落";
  if (stageKey === "rhythmStructure") return "节奏结构";
  if (stageKey === "packagingStructure") return "包装结构";
  if (stageKey === "functionSlotAtomization") return "功能槽位原子化";
  if (stageKey === "userMaterialTagger") return "素材识别";
  return "分析步骤";
}
