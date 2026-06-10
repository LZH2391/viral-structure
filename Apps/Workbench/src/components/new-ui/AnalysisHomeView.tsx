import { AnalysisDetailPage, type TimelineSeekRequest } from "./AnalysisDetailPage";
import { AnalysisHomeLanding } from "./AnalysisHomeLanding";
import type { AnalysisWorkflowMode } from "./analysisBackend";
import type { AnalysisHistoryItem, AnalysisHistoryMedia } from "./analysisHistoryData";
import type { AnalysisTimelineSegmentDetail } from "./analysisTimelineSelection";

type AnalysisHomeViewProps = {
  view: "home" | "detail";
  mode: AnalysisWorkflowMode;
  isUploading: boolean;
  historyRefreshKey: number;
  detailTitle: string;
  detailMedia: AnalysisHistoryMedia | null;
  detailItem: AnalysisHistoryItem | null;
  detailHeavyReady: boolean;
  selectedTimelineSegment: AnalysisTimelineSegmentDetail | null;
  detailSeekRequest: TimelineSeekRequest | null;
  onUploadFiles: (files: File[]) => void;
  onOpenItem: (item: AnalysisHistoryItem) => void;
  onTimelineReady: () => void;
  onSelectTimelineSegment: (segment: AnalysisTimelineSegmentDetail) => void;
  onBack: () => void;
};

export function AnalysisHomeView({
  view,
  mode,
  isUploading,
  historyRefreshKey,
  detailTitle,
  detailMedia,
  detailItem,
  detailHeavyReady,
  selectedTimelineSegment,
  detailSeekRequest,
  onUploadFiles,
  onOpenItem,
  onTimelineReady,
  onSelectTimelineSegment,
  onBack,
}: AnalysisHomeViewProps) {
  return (
    <>
      <AnalysisHomeLanding view={view} mode={mode} isUploading={isUploading} historyRefreshKey={historyRefreshKey} onUploadFiles={onUploadFiles} onOpenItem={onOpenItem} />
      <AnalysisDetailPage
        hidden={view !== "detail"}
        mode={mode}
        title={detailTitle}
        media={detailMedia}
        item={detailItem}
        heavyReady={detailHeavyReady}
        selectedTimelineSegment={selectedTimelineSegment}
        seekRequest={detailSeekRequest}
        onTimelineReady={onTimelineReady}
        onSelectTimelineSegment={onSelectTimelineSegment}
        onOpenItem={onOpenItem}
        onBack={onBack}
      />
    </>
  );
}
