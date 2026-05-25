import type { ErrorSummary } from "./debug";
import type { LibraryItemSummary } from "./library";

export type ProcessingJob = {
  jobId: string | null;
  sampleVideoId: string | null;
  stage: string;
  status: "pending" | "processing" | "cache_waiting" | "processed" | "failed" | string;
  progress: number;
  traceId: string;
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
  activeThreadMessage?: {
    threadId?: string | null;
    turnId?: string | null;
    role?: string | null;
    text: string;
    createdAt?: string | null;
  } | null;
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
