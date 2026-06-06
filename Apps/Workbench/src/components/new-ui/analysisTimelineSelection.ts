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
  shotRangeLabel: string | null;
  summary: string;
  fields: Array<{
    label: string;
    value: string;
  }>;
};
