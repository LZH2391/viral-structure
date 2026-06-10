import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { AnalysisTimelineTracks } from "./AnalysisTimelineTracks";
import type { AnalysisWorkflowMode } from "./analysisBackend";
import type { AnalysisHistoryItem, AnalysisHistoryMedia } from "./analysisHistoryData";
import type { AnalysisTimelineSegmentDetail } from "./analysisTimelineSelection";
import { ANALYSIS_PLAYER_QUEUE_REFRESH_MS, loadLatestVideoProcessingQueue, resolveVideoProcessingQueueItems, type AnalysisHomeQueueItem } from "./analysisHomeQueueModel";

export type TimelineSeekRequest = {
  requestId: number;
  time: number;
};

export function AnalysisDetailPage({
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
