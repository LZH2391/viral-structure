import type { ShotBoundaryAnalysisArtifact } from "./artifact-shot-audio";

export type StructureCard = {
  id: string;
  artifactId: string;
  parentArtifactId: string | null;
  name: string;
  start: number;
  end: number;
  order: number;
  explanation: string;
  transferableRule: string;
  shotRefs: string[];
  evidence: string[];
  confidence: number;
  needReview: boolean;
  sourceSegmentId: string;
};

export type ScriptSegmentHistoryEntry = {
  artifactId: string;
  status: "processed" | "failed" | string;
  resultOrigin: "new_turn" | "repaired_turn" | "cache_reuse" | "failed_validation" | string;
  segmentCount: number;
  turnId: string | null;
  traceId: string | null;
  sourceTraceId?: string | null;
  sourceSampleVideoId?: string | null;
  sourceArtifactId?: string | null;
  sourceTurnId?: string | null;
  cacheKey?: string | null;
  resultUri?: string | null;
  createdAt: string;
  validatorCode?: string | null;
};

export type ScriptSegmentArtifact = {
  artifactId: string;
  parentArtifactId: string | null;
  type: "script-segment-analysis";
  status: "processed" | "failed" | string;
  resultOrigin?: "new_turn" | "repaired_turn" | "cache_reuse" | "failed_validation" | string;
  stageName?: string | null;
  sampleVideoId?: string;
  sourceShotBoundaryArtifactId?: string | null;
  sourceShotCount?: number | null;
  sourceSampleVideoId?: string | null;
  sourceScriptSegmentArtifactId?: string | null;
  sourceTurnId?: string | null;
  sourceCreatedAt?: string | null;
  cacheKey?: string | null;
  commerceBrief?: ShotBoundaryAnalysisArtifact["commerceBrief"];
  segments: Array<{
    segmentId: string;
    label: string;
    roleInScript: string;
    shotRefs: string[];
    evidence: string[];
    transferableRule: string;
    confidence: number;
    needReview: boolean;
    start: number;
    end: number;
  }>;
  validation?: {
    status: "passed" | "failed" | string;
    segmentCount: number;
    validatorCode: string | null;
    repairAttemptCount: number;
  } | null;
  agent?: {
    provider: "codex-appserver" | string;
    role: string;
    skillPath: string | null;
    skillHash?: string | null;
    threadId: string | null;
    leaseId: string | null;
    turnId: string | null;
  } | null;
  reason?: string | null;
  debugSnapshotUri?: string | null;
  createdAt: string;
};

export type RhythmStructureHistoryEntry = {
  artifactId: string;
  status: "processed" | "failed" | string;
  resultOrigin: "new_turn" | "repaired_turn" | "cache_reuse" | "failed_validation" | string;
  sectionCount: number;
  cardCount?: number;
  turnId: string | null;
  traceId: string | null;
  sourceTraceId?: string | null;
  sourceSampleVideoId?: string | null;
  sourceArtifactId?: string | null;
  sourceTurnId?: string | null;
  cacheKey?: string | null;
  resultUri?: string | null;
  createdAt: string;
  validatorCode?: string | null;
};

export type RhythmStructureArtifact = {
  artifactId: string;
  parentArtifactId: string | null;
  type: "rhythm-structure-analysis";
  status: "processed" | "failed" | string;
  resultOrigin?: "new_turn" | "repaired_turn" | "cache_reuse" | "failed_validation" | string;
  stageName?: string | null;
  sampleVideoId?: string;
  sourceShotBoundaryArtifactId?: string | null;
  sourceShotCount?: number | null;
  sourceScriptSegmentArtifactId?: string | null;
  sourceScriptSegmentCount?: number | null;
  sourceSampleVideoId?: string | null;
  sourceRhythmStructureArtifactId?: string | null;
  sourceTurnId?: string | null;
  sourceCreatedAt?: string | null;
  cacheKey?: string | null;
  overview: {
    summary: string;
    fields: Array<{
      label: string;
      value: string;
    }>;
    uncertainties: string[];
  } | null;
  sections: Array<{
    sectionId: string;
    label: string;
    shotRefs: string[];
    fields: Array<{
      label: string;
      value: string;
    }>;
    confidence: number;
    needReview: boolean;
    start: number;
    end: number;
  }>;
  cards?: Array<{
    cardId: string;
    label: string;
    rhythmRole: string;
    shotRefs: string[];
    evidence: string[];
    rhythmPattern: string;
    attentionEffect: string;
    transferableRule: string;
    confidence: number;
    needReview: boolean;
    start: number;
    end: number;
  }>;
  validation?: {
    status: "passed" | "failed" | string;
    sectionCount: number;
    cardCount?: number;
    validatorCode: string | null;
    repairAttemptCount: number;
  } | null;
  agent?: {
    provider: "codex-appserver" | string;
    role: string;
    skillPath: string;
    skillHash?: string | null;
    threadId: string | null;
    leaseId: string | null;
    turnId: string | null;
    profileVersion?: string | null;
    promptTemplateId?: string | null;
    promptTemplateVersion?: string | null;
    promptTemplateHash?: string | null;
  } | null;
  reason?: string | null;
  debugSnapshotUri?: string | null;
  createdAt: string;
};

export type PackagingStructureHistoryEntry = {
  artifactId: string;
  status: "processed" | "failed" | string;
  resultOrigin: "new_turn" | "repaired_turn" | "cache_reuse" | "failed_validation" | string;
  packagingBlockCount: number;
  shotPackagingNoteCount: number;
  turnId: string | null;
  traceId: string | null;
  sourceTraceId?: string | null;
  sourceSampleVideoId?: string | null;
  sourceArtifactId?: string | null;
  sourceTurnId?: string | null;
  cacheKey?: string | null;
  resultUri?: string | null;
  createdAt: string;
  validatorCode?: string | null;
};

export type PackagingField = {
  label: string;
  value: string;
};

export type PackagingStructureArtifact = {
  artifactId: string;
  parentArtifactId: string | null;
  type: "packaging-structure-analysis";
  status: "processed" | "failed" | string;
  resultOrigin?: "new_turn" | "repaired_turn" | "cache_reuse" | "failed_validation" | string;
  stageName?: string | null;
  sampleVideoId?: string;
  sourceShotBoundaryArtifactId?: string | null;
  sourceShotCount?: number | null;
  sourceSampleVideoId?: string | null;
  sourcePackagingStructureArtifactId?: string | null;
  sourceTurnId?: string | null;
  sourceCreatedAt?: string | null;
  cacheKey?: string | null;
  overview: {
    summary: string;
    fields: PackagingField[];
    uncertainties: string[];
  } | null;
  shotPackagingNotes: Array<{
    noteId: string;
    shotRef: string;
    shotNo?: string | null;
    fields: PackagingField[];
    packagingFunction: string;
    confidence: number;
    needReview: boolean;
    start: number;
    end: number;
  }>;
  packagingBlocks: Array<{
    blockId: string;
    label: string;
    shotRefs: string[];
    fields: PackagingField[];
    packagingFunction: string;
    confidence: number;
    needReview: boolean;
    start: number;
    end: number;
  }>;
  claimStack: Array<{
    claimId: string;
    label: string;
    shotRefs: string[];
    fields: PackagingField[];
    start: number | null;
    end: number | null;
  }>;
  proofStack: Array<{
    proofId: string;
    label: string;
    shotRefs: string[];
    fields: PackagingField[];
    start: number | null;
    end: number | null;
  }>;
  conversionWrap: {
    summary: string;
    fields: PackagingField[];
    shotRefs: string[];
    uncertainties: string[];
    start: number | null;
    end: number | null;
  } | null;
  validation?: {
    status: "passed" | "failed" | string;
    shotPackagingNoteCount: number;
    packagingBlockCount: number;
    claimStackCount?: number;
    proofStackCount?: number;
    validatorCode: string | null;
    repairAttemptCount: number;
  } | null;
  agent?: {
    provider: "codex-appserver" | string;
    role: string;
    skillPath: string;
    skillHash?: string | null;
    threadId: string | null;
    leaseId: string | null;
    turnId: string | null;
    profileVersion?: string | null;
    promptTemplateId?: string | null;
    promptTemplateVersion?: string | null;
    promptTemplateHash?: string | null;
  } | null;
  reason?: string | null;
  debugSnapshotUri?: string | null;
  createdAt: string;
};

