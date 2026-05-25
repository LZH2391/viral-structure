export type ThreadPoolHealth = {
  ok: boolean;
  ready_for_leases?: boolean;
  recovering?: boolean;
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
  warming?: boolean;
  replenishing?: boolean;
  skillPath?: string | null;
};

export type ThreadPoolRoleDetail = {
  ok: boolean;
  role: string;
  config: unknown;
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
  canAcquire: boolean;
  canInit?: boolean;
  warming?: boolean;
  replenishing?: boolean;
  warmupDetail?: string | null;
  warmupError?: string | null;
  startupError?: string | null;
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
