export type FunctionSlotAtomizationHistoryEntry = {
  artifactId: string;
  status: "processed" | "failed" | string;
  resultOrigin: "new_turn" | "repaired_turn" | "cache_reuse" | "failed_validation" | string;
  slotCount: number;
  scriptAtomCount: number;
  rhythmAtomCount: number;
  packagingAtomCount: number;
  bindingCount: number;
  boundaryReviewDecision?: string | null;
  boundaryReviewIssueCount?: number | null;
  boundaryReworkAttemptCount?: number | null;
  turnId: string | null;
  traceId: string | null;
  sourceTraceId?: string | null;
  sourceSampleVideoId?: string | null;
  sourceArtifactId?: string | null;
  sourceScriptSegmentArtifactId?: string | null;
  sourceRhythmStructureArtifactId?: string | null;
  sourcePackagingStructureArtifactId?: string | null;
  sourceTurnId?: string | null;
  cacheKey?: string | null;
  resultUri?: string | null;
  createdAt: string;
  validatorCode?: string | null;
};

export type FunctionSlotAtom = {
  id: string;
  slot: string;
  label: string;
  function: string;
  claimType?: string;
  packagingFunction?: string;
  proofType?: string;
  visualProofType?: string;
  proofNeed?: string;
  pace?: string;
  densityType?: string;
  beatShape?: string;
  visualHierarchy?: string;
  risk?: string;
  mustKeep: string[];
  replaceableVariables: string[];
  replaceableForms?: string[];
  syncPoints: string[];
  avoidFor: string[];
  sourceRefs: {
    scriptSegmentLabels?: string[];
    rhythmSectionLabels?: string[];
    packagingBlockLabels?: string[];
    shotRefs: string[];
  };
  confidence: number;
  needReview: boolean;
};

export type FunctionSlotAtomizationArtifact = {
  artifactId: string;
  parentArtifactId: string | null;
  type: "function-slot-atomization-analysis";
  status: "processed" | "failed" | string;
  resultOrigin?: "new_turn" | "repaired_turn" | "boundary_reworked_turn" | "manual_boundary_edit" | "cache_reuse" | "failed_validation" | string;
  stageName?: string | null;
  sampleVideoId?: string;
  sourceScriptSegmentArtifactId?: string | null;
  sourceRhythmStructureArtifactId?: string | null;
  sourcePackagingStructureArtifactId?: string | null;
  sourceShotBoundaryArtifactId?: string | null;
  sourceSampleVideoId?: string | null;
  sourceFunctionSlotAtomizationArtifactId?: string | null;
  sourceTurnId?: string | null;
  sourceCreatedAt?: string | null;
  cacheKey?: string | null;
  atomInventory: {
    scriptAtoms: FunctionSlotAtom[];
    rhythmAtoms: FunctionSlotAtom[];
    packagingAtoms: FunctionSlotAtom[];
  };
  slotMap: {
    slots: Array<{
      slotId: string;
      slotOrder: number;
      slotName: string;
      slotType: string;
      viewerStateBefore: string;
      viewerStateAfter: string;
      persuasionTask: string;
      scriptAtomIds: string[];
      rhythmAtomIds: string[];
      packagingAtomIds: string[];
      requiredSyncPoints: string[];
      substitutionRules: string[];
      sourceRefs: { shotRefs: string[] };
      confidence: number;
      needReview: boolean;
    }>;
  };
  bindingGraph: {
    bindings: Array<{
      id: string;
      type: "support" | "require" | "sync" | "substitute" | "conflict" | "carryover" | string;
      slotIds: string[];
      atomIds: string[];
      rule: string;
      riskIfBroken: string;
      confidence: number;
    }>;
  };
  conflictChecks: Array<{
    id: string;
    slotIds: string[];
    atomIds: string[];
    reason: string;
    fix: string;
  }>;
  recombinationRules: Array<{
    id: string;
    reason: string;
    appliesTo: string[];
    sourceBindingIds: string[];
  }>;
  recompositionTemplates: Array<{
    templateId: string;
    templateName: string;
    sequence: string[];
  }>;
  boundaryReview?: FunctionSlotBoundaryReview | null;
  boundaryReviewHistory?: FunctionSlotBoundaryReview[] | null;
  boundaryRework?: {
    attemptCount?: number | null;
    sourceBoundaryReviewArtifactId?: string | null;
    sourceBoundaryReviewDecision?: string | null;
    sourceBoundaryReviewIssueCount?: number | null;
  } | null;
  manualBoundaryEdit?: {
    sourceFunctionSlotAtomizationArtifactId?: string | null;
    sourceBoundaryReviewArtifactId?: string | null;
    sourceBoundaryReviewDecision?: string | null;
    sourceBoundaryReviewIssueCount?: number | null;
    fieldPaths?: string[];
    contentHash?: string | null;
    createdAt?: string | null;
  } | null;
  validation?: {
    status: "passed" | "failed" | string;
    slotCount: number;
    scriptAtomCount: number;
    rhythmAtomCount: number;
    packagingAtomCount: number;
    bindingCount: number;
    recombinationRuleCount: number;
    templateCount: number;
    validatorCode: string | null;
    repairAttemptCount: number;
    boundaryReworkAttemptCount?: number | null;
    manualEdit?: boolean | null;
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

export type FunctionSlotBoundaryReviewIssue = {
  issue: string;
  minimalFix?: string;
  minimal_fix?: string;
  fieldPaths?: string[];
  field_paths?: string[];
};

export type FunctionSlotBoundaryReview = {
  artifactId?: string | null;
  parentArtifactId?: string | null;
  type?: "function-slot-atomization-boundary-review" | string;
  decision: "pass" | "rework" | "blocked" | string;
  reason?: string | null;
  issues?: FunctionSlotBoundaryReviewIssue[];
  reviewAttemptCount?: number | null;
  manuallyResolved?: boolean | null;
  manualResolvedAt?: string | null;
  createdAt?: string | null;
};

