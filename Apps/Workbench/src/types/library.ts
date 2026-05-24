import type { SampleArtifact } from "./artifact";

export type LibraryItemSummary = {
  sampleVideoId: string;
  filename: string;
  durationSeconds?: number | null;
  width?: number | null;
  height?: number | null;
  updatedAt?: string | null;
  tags: string[];
  cacheAvailable: boolean;
  cacheKind?: "sample" | "shot_boundary" | "script_segment" | "rhythm_structure" | string;
  traceId?: string | null;
  sourceSampleVideoId?: string | null;
  sourceTraceId?: string | null;
  sourceArtifactId?: string | null;
  sourceTurnId?: string | null;
  sourceCreatedAt?: string | null;
  cacheKey?: string | null;
  boundaryCount?: number | null;
  shotCount?: number | null;
  analysisFps?: number | null;
  enableReview?: boolean | null;
  reviewMode?: "reviewed" | "unreviewed" | string | null;
  segmentCount?: number | null;
  cardCount?: number | null;
  profileVersion?: string | null;
  promptTemplateId?: string | null;
  promptTemplateVersion?: string | null;
};

export type LibraryArtifactNode = {
  id: string;
  label: string;
  stageName: string;
  artifactId: string;
  parentArtifactId: string | null;
  status: string;
  params?: unknown;
  traceId?: string | null;
  cacheKey?: string | null;
  uri?: string | null;
  summary?: string | null;
};

export type LibraryItemDetail = LibraryItemSummary & {
  workspaceId?: string;
  fileHash?: string;
  processorVersion?: string;
  artifact: SampleArtifact;
  artifactNodes: LibraryArtifactNode[];
  artifactTree: LibraryArtifactNode[];
  cacheEntries: Array<{
    cacheKey: string;
    stageName: string;
    artifactId: string;
    parentArtifactId: string | null;
    params?: unknown;
    processorVersion?: string;
    status?: string;
    uri?: string | null;
  }>;
};
