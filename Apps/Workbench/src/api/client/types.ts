import type { AgentChatArtifactRef, AgentChatConversation, AgentChatDialogueRoboticReview, AgentChatMaterialGapMatrix, AgentChatSlotAtomDisplay, AgentTurnTimeline, AnalysisRoleSummary, AtomReplacement, BackendCapabilities, DebugTraceDetail, DebugTraceSummary, FullAnalysisBatchRun, FunctionSlotLibraryGraph, LibraryItemDetail, LibraryItemSummary, ModuleSummary, ProcessingJob, ReplacementCandidate, SampleArtifact, SlotReplacement, ThreadConversation, ThreadPoolHealth, ThreadPoolRoleDetail, ThreadPoolRoleSummary, UiDebugEventRequest, WorkflowRun } from "../../types";

export type UploadSampleResponse =
  | { cacheHit: true; cachedItem: LibraryItemSummary; fileHash?: string }
  | { processingJobId: string; sampleVideoId: string; traceId: string; cacheHit?: false };

export type ShotBoundaryStartResponse =
  | { cacheHit: true; cachedItem: LibraryItemSummary }
  | { processingJobId: string; sampleVideoId: string; traceId: string; cacheHit?: false };

export type AnalysisStartResponse =
  | { cacheHit: true; cachedItem: LibraryItemSummary }
  | { processingJobId: string; sampleVideoId: string; traceId: string; cacheHit?: false };

export type ScriptSegmentStartResponse = AnalysisStartResponse;
export type RhythmStructureStartResponse = AnalysisStartResponse;
export type PackagingStructureStartResponse = AnalysisStartResponse;
export type FunctionSlotAtomizationStartResponse = AnalysisStartResponse;

export type FunctionSlotWorkflowPlaceholderResponse = {
  ok?: boolean;
  mode?: "single" | "multi_version" | string;
  defaultVersionId?: string | null;
  versions?: AgentChatStoryboardVersion[];
  processingJobId?: string;
  sampleVideoId: string;
  traceId: string;
  runId: string;
  stageId: string;
  artifactId: string | null;
  parentArtifactId: string | null;
  status: "placeholder" | "submitted" | "running" | "processing" | string;
  message: string;
  role?: string | null;
  threadId?: string | null;
  turnId?: string | null;
  leaseId?: string | null;
  ownerId?: string | null;
  workspaceRoot?: string | null;
};

export type AgentChatSessionResponse = {
  ok: boolean;
  source: "direct" | "threadpool-role";
  status: string;
  threadId: string | null;
  traceId: string;
  runId: string;
  stageId: string;
  role?: string | null;
  ownerId?: string | null;
  leaseId?: string | null;
  parentThreadId?: string | null;
  workspaceRoot?: string | null;
  skillPath?: string | null;
  conversationId?: string | null;
  conversationStatus?: "active" | "archived" | string | null;
  conversationRevision?: number | null;
  error?: string;
  message?: string;
  retryable?: boolean;
};

export type AgentChatTurnResponse = {
  ok: boolean;
  source?: "direct" | "threadpool-role" | string;
  role?: string | null;
  leaseId?: string | null;
  parentThreadId?: string | null;
  conversationId?: string | null;
  workspaceRoot?: string | null;
  threadId: string;
  turnId: string;
  status: string;
  traceId: string;
  runId: string;
  stageId: string;
  conversationRevision?: number | null;
  conversationTitle?: string | null;
  conversationTitleState?: AgentChatConversation["titleState"] | null;
  titleGeneration?: {
    ok?: boolean;
    status?: string | null;
    titleTurnId?: string | null;
    error?: string | null;
  } | null;
  latestTurnId?: string | null;
  threadStopped?: boolean | null;
  retryable?: boolean | null;
  activeTurnStatus?: string | null;
  actionProjection?: AgentChatActionProjection;
  finalMessage?: string | null;
  userTurnText?: string | null;
  activeThreadMessage?: { text?: string; role?: string | null; createdAt?: string | null } | string | null;
  materializedDisplay?: { ok: boolean; planId?: string | null; displayJsonPath?: string | null; traceGraphPath?: string | null; error?: string | null; message?: string | null } | null;
  autoDisplayTransform?: {
    ok: boolean;
    status: string;
    artifactId?: string | null;
    traceId?: string | null;
    runId?: string | null;
    stageId?: string | null;
    stageName?: string | null;
    restructureFinalPath?: string | null;
    displayJsonPath?: string | null;
    repairRequestPath?: string | null;
    missingSections?: string[];
    repairAttemptCount?: number;
    error?: string | null;
    message?: string | null;
    slotAtomDisplay?: AgentChatSlotAtomDisplay | null;
    slotAtomDisplays?: AgentChatSlotAtomDisplay[];
  } | null;
  autoDialogueRoboticReview?: AgentChatDialogueRoboticReview | null;
  autoMaterialGapMatrix?: AgentChatMaterialGapMatrix | null;
  autoDialogueRework?: {
    ok: boolean;
    source?: "direct" | "threadpool-role";
    role?: string | null;
    conversationId?: string | null;
    conversationRevision?: number | null;
    workspaceRoot?: string | null;
    threadId?: string | null;
    turnId?: string | null;
    status?: string | null;
    userTurnText?: string | null;
    latestTurnId?: string | null;
    threadStopped?: boolean | null;
    retryable?: boolean | null;
    activeTurnStatus?: string | null;
    actionProjection?: AgentChatActionProjection;
    error?: string | null;
    message?: string | null;
  } | null;
  autoAdvanceConfirmation?: {
    ok: boolean;
    status?: string | null;
    confirmationId?: string | null;
    conversationRevision?: number | null;
    storyboardArtifact?: AgentChatArtifactRef | null;
    skipped?: boolean | null;
    traceId?: string | null;
    runId?: string | null;
    stageId?: string | null;
    error?: string | null;
    message?: string | null;
    retryable?: boolean | null;
    debugSnapshotUri?: string | null;
  } | null;
};

export type AgentChatCompactResponse = {
  ok: boolean;
  threadId: string;
  status: string;
  compactStatus?: string | null;
  compactTurnId?: string | null;
  compactCompleted?: boolean | null;
  traceId: string;
  runId: string;
  stageId: string;
  conversationRevision?: number | null;
};

export type AgentChatActionProjection = {
  flags: {
    stopTurn: boolean;
    stopThread: boolean;
    retrySameThread: boolean;
    retryNewThread: boolean;
  };
  availableActions: Array<"stop_turn" | "stop_thread" | "retry_same_thread" | "retry_new_thread" | string>;
};

export type AgentChatStoryboardResult = {
  ok: boolean;
  status: "available" | "missing" | string;
  mode?: "single" | "multi_version" | string;
  defaultVersionId?: string | null;
  selectedVersionId?: string | null;
  versions?: AgentChatStoryboardVersion[];
  reason?: string | null;
  conversationId?: string | null;
  title?: string | null;
  aspect?: {
    ratio?: "9:16" | "16:9" | string;
    orientation?: "portrait" | "landscape" | string;
    css?: string | null;
  } | null;
  source?: {
    manifestPath?: string | null;
    cropsPath?: string | null;
    pdfInputPath?: string | null;
    traceId?: string | null;
    artifactId?: string | null;
    parentArtifactId?: string | null;
  } | null;
  cover?: AgentChatStoryboardCover | null;
  groups: AgentChatStoryboardGroup[];
};

export type AgentChatStoryboardVersion = {
  versionId?: string | null;
  versionName?: string | null;
  status?: string | null;
  sourceRestructurePath?: string | null;
  sourceShotDesignPath?: string | null;
  storyboardArtifact?: AgentChatArtifactRef | null;
  artifactId?: string | null;
  processingJobId?: string | null;
  traceId?: string | null;
  runId?: string | null;
  stageId?: string | null;
  error?: string | null;
  message?: string | null;
};

export type AgentChatStoryboardCover = {
  id: string;
  title: string;
  kind: "cover" | string;
  kindLabel: string;
  imageUrl?: string | null;
  dialogue?: string | null;
  aspect?: {
    ratio?: "9:16" | "16:9" | string;
    orientation?: "portrait" | "landscape" | string;
    css?: string | null;
  } | null;
};

export type AgentChatStoryboardGroup = {
  id: string;
  label: string;
  key: string;
  title: string;
  shotCount: number;
  shots: AgentChatStoryboardShot[];
};

export type AgentChatStoryboardShot = {
  id: string;
  index: number;
  title: string;
  duration?: string | null;
  durationRaw?: string | null;
  durationTooltip?: string | null;
  dialogue?: string | null;
  strategy?: string | null;
  strategyRaw?: string | null;
  sourceRefs?: string[];
  slotSubtype?: string | null;
  slotKey?: string | null;
  scriptSegment?: string | null;
  rhythmRange?: string | null;
  packagingBlock?: string | null;
  visualPrompt?: string | null;
  overlayPackaging?: string | null;
  syncPoint?: string | null;
  proofFunction?: string | null;
  kind: "material" | "generated" | string;
  kindLabel: string;
  imageUrl?: string | null;
  aspect?: {
    ratio?: "9:16" | "16:9" | string;
    orientation?: "portrait" | "landscape" | string;
    css?: string | null;
  } | null;
};

export type AgentChatStopResponse = {
  ok: boolean;
  action: "stop_turn" | "stop_thread";
  threadId: string;
  turnId?: string | null;
  activeTurnId?: string | null;
  status?: string | null;
  conversationStatus?: string | null;
  conversationRevision?: number | null;
  latestTurnId?: string | null;
  threadStopped?: boolean | null;
  retryable?: boolean | null;
  activeTurnStatus?: string | null;
  actionProjection?: AgentChatActionProjection;
  traceId: string;
  runId: string;
  stageId: string;
};

export type AgentChatRetryResponse = {
  ok: boolean;
  action: "retry_same_thread" | "retry_new_thread";
  sourceTurnId: string;
  previousThreadId: string;
  threadId: string;
  turnId: string;
  status: string;
  conversationRevision?: number | null;
  latestTurnId?: string | null;
  threadStopped?: boolean | null;
  retryable?: boolean | null;
  activeTurnStatus?: string | null;
  actionProjection?: AgentChatActionProjection;
  traceId: string;
  runId: string;
  stageId: string;
};

export type ActiveTurnSummary = {
  bindingId?: string | null;
  threadId: string;
  turnId: string;
  ownerType: string;
  ownerId: string;
  currentAttemptId?: string | null;
  stageName?: string | null;
  traceId?: string | null;
  runId?: string | null;
  stageId?: string | null;
  artifactId?: string | null;
  parentArtifactId?: string | null;
  leaseId?: string | null;
  threadPoolOwnerId?: string | null;
  replayRef?: {
    type?: string | null;
    sourceTurnId?: string | null;
    messageId?: string | null;
    refId?: string | null;
    textSummary?: { length?: number | null; preview?: string | null } | null;
  } | null;
  status: string;
  activeThreadMessageSummary?: { length?: number | null; preview?: string | null } | null;
  finalMessageSummary?: { length?: number | null; preview?: string | null } | null;
  actionProjection?: AgentChatActionProjection | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type FunctionSlotLibraryBuilderRefreshResponse = {
  ok: boolean;
  traceId: string;
  runId: string;
  stageId: string;
  exported: {
    sampleCount: number;
    exportedCount: number;
    skippedCount: number;
    items: Array<{ sampleVideoId: string; artifactId: string | null; exported: boolean; skipped: boolean; itemPath: string | null }>;
  };
  validation: { exitCode: number; path: string; stdout?: string | null; stderr?: string | null };
  slotIndex: { path: string; stdout?: string | null };
  governance: { path: string; stdout?: string | null } | null;
};

export type FunctionSlotGovernanceRunResponse = {
  processingJobId: string;
  sampleVideoId: string;
  traceId: string;
  runId: string;
  stageId: string;
  artifactId: string;
  parentArtifactId: string | null;
  status: "submitted" | string;
  message: string;
};

export type FunctionSlotGovernanceSchedulerState = {
  schemaVersion: "function_slot_governance_scheduler.v1" | string;
  status: "idle" | "scheduled" | "running" | "dirty" | "skipped" | "failed" | string;
  quietWindowMs: number;
  scheduledAt?: string | null;
  processingJobId?: string | null;
  traceId?: string | null;
  lastEvidenceHash?: string | null;
  lastGovernedEvidenceHash?: string | null;
  dirtySince?: string | null;
  lastRunCompletedAt?: string | null;
  message?: string | null;
};

export type AgentChatMaterialPackRef = {
  sampleVideoId?: string | null;
  artifactId?: string | null;
  title?: string | null;
  traceId?: string | null;
  resultUri?: string | null;
  shotCardCount?: number | null;
  materialGroupCount?: number | null;
  proofCoverageCount?: number | null;
};

export type AgentChatStructureRef = {
  artifactId: string;
  sampleVideoId?: string | null;
  title?: string | null;
  traceId?: string | null;
  slotCount?: number | null;
  atomCount?: number | null;
};
