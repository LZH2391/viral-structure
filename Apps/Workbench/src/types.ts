export type * from "./types/artifact";
export type * from "./types/debug";
export type * from "./types/threadpool";
export type * from "./types/library";
export type * from "./types/job";
export type * from "./types/workbench";
export type * from "./types/workflow";

import type {
  PackagingStructureArtifact,
  PackagingStructureHistoryEntry,
  RhythmStructureArtifact,
  FunctionSlotAtomizationArtifact,
  FunctionSlotAtomizationHistoryEntry,
  ScriptSegmentArtifact,
  ScriptSegmentHistoryEntry,
  ShotBoundaryAnalysisHistoryEntry,
} from "./types/artifact";
import type { AgentActivitySummary } from "./types/job";

export type StaticTraceTypeCompatibility = {
  saveToken?: number | null;
  queuedAt?: number | null;
  dependencies?: {
    shotBoundaryArtifactId?: string | null;
    scriptSegmentArtifactId?: string | null;
    rhythmStructureArtifactId?: string | null;
    packagingStructureArtifactId?: string | null;
    functionSlotAtomizationArtifactId?: string | null;
  } | null;
  analysisOptions?: Record<string, string | number | boolean | null | undefined> | null;
  commerceBrief?: {
    sellingObject: string;
  } | null;
  shotBoundaryAnalysisHistory?: ShotBoundaryAnalysisHistoryEntry[] | null;
  scriptSegmentAnalysisHistory?: ScriptSegmentHistoryEntry[] | null;
  packagingStructureAnalysisHistory?: PackagingStructureHistoryEntry[] | null;
  functionSlotAtomizationAnalysisHistory?: FunctionSlotAtomizationHistoryEntry[] | null;
  cacheKind?: "sample" | "shot_boundary" | "script_segment" | "rhythm_structure" | "packaging_structure" | "function_slot_atomization" | string;
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
  functionSlotAtomizationAnalysis?: FunctionSlotAtomizationArtifact | null;
  activeThreadMessage?: {
    threadId?: string | null;
    turnId?: string | null;
    role?: string | null;
    text: string;
    createdAt?: string | null;
  } | null;
  agentActivity?: AgentActivitySummary | null;
  agentRun?: {
    provider?: "codex-appserver" | string;
    role?: string;
    skillPath?: string | null;
    skillHash?: string | null;
    threadId?: string | null;
    leaseId?: string | null;
    turnId?: string | null;
    status?: string;
    startedAt?: string | null;
    updatedAt?: string | null;
  } | null;
};

export type AnalysisRoleSummary = {
  analysisId: string;
  stageKind: string;
  cacheKind: string;
  artifactKey: string | null;
  artifactType: string | null;
  route: string;
  legacyRoute: string;
  dependencies: Array<{
    key: string;
    artifactKey: string;
    requestKey: string;
    label: string;
  }>;
  ui: {
    label: string;
    displayName?: string;
    stageId?: string;
    completeReason?: string;
    refreshReason?: string;
    reuseReason?: string;
    invalidResultMessage?: string;
    failureMessage?: string;
    timeoutMessage?: string;
  };
  stages: Record<string, string>;
};

export type ModuleSummary = {
  moduleId: string;
  moduleKind: string;
  executorKind: string;
  cacheKind: string | null;
  artifactKey: string | null;
  artifactType: string | null;
  route: string;
  legacyRoute: string | null;
  dependencies: Array<{
    key: string;
    artifactKey: string;
    requestKey: string;
    label: string;
  }>;
  ui: {
    label: string;
    stageKind?: string;
    displayName?: string;
    stageId?: string;
    completeReason?: string;
    refreshReason?: string;
    reuseReason?: string;
    invalidResultMessage?: string;
    failureMessage?: string;
    timeoutMessage?: string;
  } | null;
  stages: Record<string, string> | null;
  supportsCacheReuse: boolean;
  supportsRerun: boolean;
  artifactPolicy: "required" | "optional" | "none" | string;
};
