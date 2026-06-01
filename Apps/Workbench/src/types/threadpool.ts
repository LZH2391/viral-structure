export type ThreadPoolHealth = {
  ok: boolean;
  ready_for_leases?: boolean;
  recovering?: boolean;
  startup_error?: string | null;
  startup_thread_alive?: boolean;
  startup_elapsed_ms?: number | null;
  startup_stalled?: boolean;
  warming_roles?: string[];
  unavailable?: boolean;
  message?: string;
};

export type ThreadPoolRoleSummary = {
  role: string;
  minIdle: number;
  idle: number;
  leased: number;
  seedThreadId?: string | null;
  canAcquire: boolean;
  readyForLeases?: boolean;
  recovering?: boolean;
  warming?: boolean;
  replenishing?: boolean;
  seedMissing?: boolean;
  skillPath?: string | null;
};

export type ThreadPoolRoleDetail = {
  ok: boolean;
  role: string;
  config: unknown;
  minIdle?: number;
  counts: {
    idle: number;
    leased: number;
    retired?: number;
    discarded?: number;
    initializing?: number;
    activeLeases?: number;
  };
  seedThreadId?: string | null;
  skillPath?: string | null;
  workspaceRoot?: string | null;
  canAcquire: boolean;
  canInit?: boolean;
  warming?: boolean;
  replenishing?: boolean;
  seedMissing?: boolean;
  warmupDetail?: string | null;
  warmupError?: string | null;
  startupError?: string | null;
  startupThreadAlive?: boolean;
  startupElapsedMs?: number | null;
  startupStalled?: boolean;
  readyForLeases?: boolean;
  recovering?: boolean;
  threads?: Array<{
    thread_id: string;
    role: string;
    status: "idle" | "leased" | "retired" | "discarded" | "initializing";
    lease_id?: string | null;
    owner_id?: string | null;
    last_owner_id?: string | null;
    latest_input_tokens?: number | null;
    threshold_input_tokens?: number | null;
    seed?: boolean;
    last_seen_at?: string | null;
  }>;
  leases?: Array<{
    lease_id: string;
    thread_id: string;
    owner_id: string;
    status: "active" | "released" | string;
    thread_status?: string | null;
    last_seen_at?: string | null;
  }>;
};

export type ThreadConversationTurn = {
  turnId: string;
  status: string;
  createdAt?: string | null;
  inputSummary?: string | null;
  threadMessages?: Array<{
    role?: string | null;
    text: string;
    createdAt?: string | null;
  }>;
  finalMessage?: string | null;
  tokenUsage?: {
    inputTokens?: number | null;
    outputTokens?: number | null;
    totalTokens?: number | null;
  } | null;
};

export type ThreadConversation = {
  threadId: string;
  title?: string | null;
  status?: string | null;
  turns: ThreadConversationTurn[];
};

export type AgentChatMessageSnapshot = {
  id: string;
  turnId?: string | null;
  role: "user" | "assistant" | "system";
  text: string;
  status?: "running" | "completed" | "failed";
  slotAtomDisplay?: AgentChatSlotAtomDisplay | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type AgentChatConversation = {
  conversationId: string;
  schemaVersion?: string;
  revision?: number;
  source: "threadpool-role" | "direct" | string;
  role?: string | null;
  status: "active" | "archived" | string;
  title?: string | null;
  threadId?: string | null;
  parentThreadId?: string | null;
  leaseId?: string | null;
  ownerId?: string | null;
  workspaceRoot?: string | null;
  skillPath?: string | null;
  sampleVideoId?: string | null;
  latestTurnId?: string | null;
  traceId?: string | null;
  runId?: string | null;
  stageId?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  archivedAt?: string | null;
  invalidated?: boolean;
  invalidatedAt?: string | null;
  lastResumeError?: {
    code?: string | null;
    message?: string | null;
  } | null;
  confirmedPlan?: {
    status?: "confirmed" | "completed" | string;
    turnId?: string | null;
    confirmationId?: string | null;
    confirmedAt?: string | null;
    updatedAt?: string | null;
    note?: string | null;
    sourceRestructurePath?: string | null;
    displayArtifact?: AgentChatArtifactRef | null;
    storyboardArtifact?: AgentChatArtifactRef | null;
    traceId?: string | null;
    runId?: string | null;
    stageId?: string | null;
  } | null;
  messages?: AgentChatMessageSnapshot[];
};

export type AgentChatArtifactRef = {
  artifactId?: string | null;
  traceId?: string | null;
  runId?: string | null;
  stageId?: string | null;
  status?: string | null;
};

export type AgentChatSlotAtomDisplay = {
  schemaVersion?: string;
  status?: "available" | "empty" | string;
  displayJsonPath?: string | null;
  slotCount?: number;
  atomBindingCount?: number;
  selectedSlotSubtypeId?: string | null;
  fileFingerprint?: {
    path?: string | null;
    size?: number;
    mtimeMs?: number;
    sha256?: string | null;
  } | null;
  slots?: AgentChatSlotSummary[];
  atoms?: AgentChatAtomSummary[];
};

export type AgentChatSlotSummary = {
  index?: number;
  demand?: string | null;
  slotSubtype?: string | null;
  slotSubtypeId?: string | null;
  archetype?: string | null;
  archetypeId?: string | null;
  functionText?: string | null;
  usage?: string | null;
  reason?: string | null;
};

export type AgentChatAtomSummary = {
  slotSubtype?: string | null;
  slotSubtypeId?: string | null;
  source?: string | null;
  scriptAtom?: string | null;
  rhythmAtom?: string | null;
  packagingAtom?: string | null;
  handling?: string | null;
};

export type ReplacementCandidate = {
  kind: "slot" | "atom" | string;
  atomKind?: "script" | "rhythm" | "packaging" | string | null;
  candidateId: string;
  slotSubtypeId?: string | null;
  sourceSlotId?: string | null;
  atomId?: string | null;
  label?: string | null;
  functionText?: string | null;
  sourceSampleId?: string | null;
  sourceArtifactId?: string | null;
  order?: number | null;
  confidence?: number | null;
  needReview?: boolean | null;
  evidenceTags?: string[];
  evidence?: Record<string, unknown> | null;
  bindingEvidence?: {
    bindings?: Array<Record<string, unknown>>;
    rules?: Array<Record<string, unknown>>;
  } | null;
};

export type SlotReplacement = {
  type: "slot";
  slotOrder?: number | null;
  fromSlotSubtypeId: string;
  fromSlotLabel?: string | null;
  toSlotSubtypeId: string;
  toSlotLabel?: string | null;
  candidateId: string;
  sourceSampleId?: string | null;
  sourceArtifactId?: string | null;
  affectedAtomIds?: string[];
};

export type AtomReplacement = {
  type: "atom";
  atomKind: "script" | "rhythm" | "packaging";
  slotSubtypeId: string;
  slotLabel?: string | null;
  fromAtomId: string;
  fromAtomLabel?: string | null;
  toAtomId: string;
  toAtomLabel?: string | null;
  candidateId: string;
  sourceSampleId?: string | null;
  sourceArtifactId?: string | null;
};

export type ReplacementDraft = {
  sourceDisplayJsonPath?: string | null;
  sourceRestructureFinalPath?: string | null;
  displayFingerprint?: AgentChatSlotAtomDisplay["fileFingerprint"];
  replacements: Array<SlotReplacement | AtomReplacement>;
};
