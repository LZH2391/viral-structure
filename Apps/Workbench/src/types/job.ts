import type { ErrorSummary } from "./debug";
import type { LibraryItemSummary } from "./library";

export type ProcessingJob = {
  jobId: string | null;
  sampleVideoId: string | null;
  stage: string;
  status: "pending" | "processing" | "cache_waiting" | "processed" | "failed" | string;
  progress: number;
  traceId: string;
  finalMessage?: string | null;
  agentRun?: {
    provider?: "codex-appserver" | string;
    role?: string;
    skillPath?: string;
    skillHash?: string | null;
    threadId?: string | null;
    leaseId?: string | null;
    turnId?: string | null;
    traceId?: string | null;
    artifactId?: string | null;
    parentArtifactId?: string | null;
    status?: string;
    startedAt?: string | null;
    updatedAt?: string | null;
  } | null;
  shotBoundaryTransform?: Partial<AgentTraceCard> | null;
  agentTraceCards?: AgentTraceCard[] | null;
  activeThreadMessage?: {
    threadId?: string | null;
    turnId?: string | null;
    role?: string | null;
    text: string;
    createdAt?: string | null;
  } | null;
  agentActivity?: AgentActivitySummary | null;
  errorSummary?: ErrorSummary | null;
  cachePrompt?: {
    cacheKind?: "sample" | "shot_boundary" | "script_segment" | "rhythm_structure" | "packaging_structure" | string;
    cachedItem: LibraryItemSummary;
    sourceSampleVideoId?: string | null;
    sourceArtifactId?: string | null;
    sourceTurnId?: string | null;
    sourceTraceId?: string | null;
    sourceCreatedAt?: string | null;
    cacheKey?: string | null;
    dependencies?: {
      shotBoundaryArtifactId?: string | null;
      scriptSegmentArtifactId?: string | null;
      [key: string]: string | number | boolean | null | undefined;
    } | null;
    analysisOptions?: Record<string, string | number | boolean | null | undefined> | null;
    analysisFps?: number | null;
    enableReview?: boolean | null;
    reviewMode?: "reviewed" | "unreviewed" | string | null;
  } | null;
};

export type AgentRunJob = ProcessingJob;

export type AgentTraceCard = {
  id: string;
  label: string;
  role: string | null;
  stageName: string | null;
  status: "pending" | "running" | "completed" | "failed" | "unknown";
  threadId: string | null;
  turnId: string | null;
  leaseId: string | null;
  traceId: string | null;
  artifactId: string | null;
  parentArtifactId: string | null;
  activity: AgentActivitySummary | null;
  latestMessagePreview: string | null;
  startedAt: string | null;
  updatedAt: string | null;
};

export type AgentActivitySummary = {
  threadId: string | null;
  turnId: string | null;
  status: string | null;
  itemCount: number;
  effectiveItemCount: number;
  latestItemType: string | null;
  latestMessagePreview: string | null;
  latestToolName: string | null;
  tokenUsage?: {
    inputTokens?: number | null;
    outputTokens?: number | null;
    totalTokens?: number | null;
    reasoningOutputTokens?: number | null;
  } | null;
  updatedAt: string;
};

export type AgentTimelineItem = {
  id: string;
  index: number;
  kind: "user_input" | "agent_message" | "reasoning" | "tool_call" | "tool_result" | "token_usage" | "turn_status" | "unknown";
  title: string;
  status?: "running" | "completed" | "failed" | "unknown";
  textPreview?: string | null;
  createdAt?: string | null;
  metadata?: {
    toolName?: string | null;
    commandPreview?: string | null;
    exitCode?: number | null;
    durationMs?: number | null;
    byteLength?: number | null;
    inputTokens?: number | null;
    outputTokens?: number | null;
    totalTokens?: number | null;
    reasoningOutputTokens?: number | null;
  };
};

export type AgentTurnTimeline = {
  threadId: string;
  turnId: string;
  status: string;
  activity: AgentActivitySummary;
  items: AgentTimelineItem[];
};
