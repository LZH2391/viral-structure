import { useCallback, useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { FunctionSlotGovernanceSchedulerState } from "../../api/client";
import type { AnalysisDetailSidebarState } from "./AnalysisWorkflowSidebar";
import type { TimelineSeekRequest } from "./AnalysisDetailPage";
import type { AnalysisHistoryItem } from "./analysisHistoryData";
import type { AnalysisTimelineSegmentDetail } from "./analysisTimelineSelection";
import type { AnalysisHomeQueueItem, AnalysisHomeQueueState } from "./analysisHomeQueueModel";

type AnalysisHomeSidebarSyncOptions = {
  actionBusyKey: string | null;
  detailHeavyReady: boolean;
  detailItem: AnalysisHistoryItem | null;
  detailSeekRequestIdRef: MutableRefObject<number>;
  detailTimelineReady: boolean;
  detailTitle: string;
  governanceSchedulerState: FunctionSlotGovernanceSchedulerState | null;
  handleQueueItemCancel: (item: AnalysisHomeQueueItem) => void;
  handleQueueItemRetry: (item: AnalysisHomeQueueItem) => void;
  handleWorkflowCancel: () => void;
  handleWorkflowCacheDecision: (target: { stageKey: string; jobId: string; decision: "reuse" | "refresh" }) => void;
  handleWorkflowResume: () => void;
  handleWorkflowStageRerun: (stageKey: string | string[]) => void;
  homeQueueItems: AnalysisHomeQueueItem[];
  homeQueueLoading: boolean;
  lastTimelineSelectionClearRequestRef: MutableRefObject<number>;
  onDetailStateChange?: (state: AnalysisDetailSidebarState) => void;
  onQueueStateChange?: (state: AnalysisHomeQueueState) => void;
  openHistoryDetail: (item: AnalysisHistoryItem) => void;
  queueActionBusyKey: string | null;
  cacheDecisionBusyKey: string | null;
  rerunnableStageKeys: string[];
  rerunningStageKey: string | null;
  selectedTimelineSegment: AnalysisTimelineSegmentDetail | null;
  setDetailSeekRequest: Dispatch<SetStateAction<TimelineSeekRequest | null>>;
  setSelectedTimelineSegment: Dispatch<SetStateAction<AnalysisTimelineSegmentDetail | null>>;
  timelineSelectionClearRequest: number;
  view: "home" | "detail";
};

export function useAnalysisHomeSidebarSync({
  actionBusyKey,
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
}: AnalysisHomeSidebarSyncOptions) {
  useEffect(() => {
    onQueueStateChange?.({
      items: homeQueueItems,
      loading: homeQueueLoading,
      governanceSchedulerState,
      onOpenItem: openHistoryDetail,
      onCancelItem: handleQueueItemCancel,
      onRetryItem: handleQueueItemRetry,
      actionBusyKey: queueActionBusyKey,
    });
  }, [governanceSchedulerState, handleQueueItemCancel, handleQueueItemRetry, homeQueueItems, homeQueueLoading, onQueueStateChange, openHistoryDetail, queueActionBusyKey]);

  useEffect(() => () => {
    onQueueStateChange?.({
      items: [],
      loading: false,
      governanceSchedulerState: null,
      onOpenItem: openHistoryDetail,
      actionBusyKey: null,
    });
  }, [onQueueStateChange, openHistoryDetail]);

  useEffect(() => {
    if (lastTimelineSelectionClearRequestRef.current === timelineSelectionClearRequest) return;
    lastTimelineSelectionClearRequestRef.current = timelineSelectionClearRequest;
    setSelectedTimelineSegment(null);
  }, [lastTimelineSelectionClearRequestRef, setSelectedTimelineSegment, timelineSelectionClearRequest]);

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
      workflowActionBusy: actionBusyKey,
      onWorkflowCancel: handleWorkflowCancel,
      onWorkflowResume: handleWorkflowResume,
      cacheDecisionBusyKey,
      onWorkflowCacheDecision: handleWorkflowCacheDecision,
    });
  }, [actionBusyKey, cacheDecisionBusyKey, detailHeavyReady, detailItem, detailTitle, handleWorkflowCacheDecision, handleWorkflowCancel, handleWorkflowResume, handleWorkflowStageRerun, onDetailStateChange, rerunnableStageKeys, rerunningStageKey, setSelectedTimelineSegment, view]);

  const handleWorkflowDetailCardSelect = useCallback((target: AnalysisTimelineSegmentDetail) => {
    selectTimelineSegment(target);
    const time = Number(target.start);
    if (!Number.isFinite(time) || time < 0) return;
    detailSeekRequestIdRef.current += 1;
    setDetailSeekRequest({ requestId: detailSeekRequestIdRef.current, time });
  }, [detailSeekRequestIdRef, selectTimelineSegment, setDetailSeekRequest]);

  useEffect(() => {
    onDetailStateChange?.({
      visible: view === "detail",
      title: detailTitle,
      item: detailItem,
      selectedTimelineSegment: detailTimelineReady ? selectedTimelineSegment : null,
      rerunnableStageKeys,
      rerunningStageKey,
      onWorkflowStageRerun: handleWorkflowStageRerun,
      workflowActionBusy: actionBusyKey,
      onWorkflowCancel: handleWorkflowCancel,
      onWorkflowResume: handleWorkflowResume,
      cacheDecisionBusyKey,
      onWorkflowCacheDecision: handleWorkflowCacheDecision,
      onWorkflowDetailCardSelect: handleWorkflowDetailCardSelect,
    });
  }, [actionBusyKey, cacheDecisionBusyKey, detailItem, detailTimelineReady, detailTitle, handleWorkflowCacheDecision, handleWorkflowCancel, handleWorkflowDetailCardSelect, handleWorkflowResume, handleWorkflowStageRerun, onDetailStateChange, rerunnableStageKeys, rerunningStageKey, selectedTimelineSegment, view]);

  return { handleWorkflowDetailCardSelect, selectTimelineSegment };
}
