export type * from "./types/artifact";
export type * from "./types/debug";
export type * from "./types/threadpool";
export type * from "./types/library";
export type * from "./types/job";
export type * from "./types/workbench";

import type {
  PackagingStructureArtifact,
  PackagingStructureHistoryEntry,
  RhythmStructureArtifact,
  ScriptSegmentArtifact,
  ScriptSegmentHistoryEntry,
  ShotBoundaryAnalysisHistoryEntry,
} from "./types/artifact";

export type StaticTraceTypeCompatibility = {
  saveToken?: number | null;
  queuedAt?: number | null;
  dependencies?: {
    shotBoundaryArtifactId?: string | null;
    scriptSegmentArtifactId?: string | null;
  } | null;
  analysisOptions?: Record<string, string | number | boolean | null | undefined> | null;
  commerceBrief?: {
    sellingObject: string;
  } | null;
  shotBoundaryAnalysisHistory?: ShotBoundaryAnalysisHistoryEntry[] | null;
  scriptSegmentAnalysisHistory?: ScriptSegmentHistoryEntry[] | null;
  packagingStructureAnalysisHistory?: PackagingStructureHistoryEntry[] | null;
  cacheKind?: "sample" | "shot_boundary" | "script_segment" | "rhythm_structure" | "packaging_structure" | string;
  segmentCount?: number | null;
  sectionCount?: number | null;
  cardCount?: number | null;
  packagingBlockCount?: number | null;
  shotPackagingNoteCount?: number | null;
  sourceSegmentId: string;
  sourceArtifactId?: string | null;
  sourceTraceId?: string | null;
  summary?: string | null;
  endBoundaryReason?: string | null;
  scriptSegmentAnalysis?: ScriptSegmentArtifact | null;
  rhythmStructureAnalysis?: RhythmStructureArtifact | null;
  packagingStructureAnalysis?: PackagingStructureArtifact | null;
  activeThreadMessage?: {
    threadId?: string | null;
    turnId?: string | null;
    role?: string | null;
    text: string;
    createdAt?: string | null;
  } | null;
  agentRun?: {
    provider?: "codex-appserver" | string;
    role?: string;
    skillPath?: string;
    skillHash?: string | null;
    threadId?: string | null;
    leaseId?: string | null;
    turnId?: string | null;
    status?: string;
    startedAt?: string | null;
    updatedAt?: string | null;
  } | null;
};
