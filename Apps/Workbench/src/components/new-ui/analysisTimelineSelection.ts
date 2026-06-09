export type AnalysisTimelineSegmentTone =
  | "shot"
  | "subtitle"
  | "script"
  | "rhythm"
  | "packaging"
  | "slot"
  | "materialClass"
  | "materialFunction"
  | "materialProof"
  | "materialSequence";

export type AnalysisTimelineSegmentDetail = {
  id: string;
  tone: AnalysisTimelineSegmentTone;
  title: string;
  timeLabel: string;
  start?: number | null;
  end?: number | null;
  shotRangeLabel: string | null;
  summary: string;
  fields: Array<{
    label: string;
    value: string;
  }>;
};
