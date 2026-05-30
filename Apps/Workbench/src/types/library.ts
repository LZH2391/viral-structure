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
  sectionCount?: number | null;
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

export type FunctionSlotGraphNode = {
  id: string;
  type: "libraryItem" | "slotInstance" | "atomInstance" | "binding" | "slotConcept" | string;
  label: string;
  group: string;
  data: Record<string, unknown>;
};

export type FunctionSlotGraphEdge = {
  id: string;
  source: string;
  target: string;
  type: string;
  label?: string | null;
};

export type FunctionSlotLibraryGraph = {
  schemaVersion: "function_slot_library_graph.v1" | "function_slot_governance_graph.v1" | string;
  artifactId: string;
  governanceId?: string | null;
  sampleVideoId?: string | null;
  traceId?: string | null;
  nodes: FunctionSlotGraphNode[];
  edges: FunctionSlotGraphEdge[];
  summary: {
    slotCount: number;
    atomCount: number;
    bindingCount: number;
    ruleCount?: number;
    sampleCount?: number;
    needReviewCount?: number;
    unmappedAtomCount?: number;
    unmappedBindingCount?: number;
    unmappedRuleCount?: number;
    validationOk?: boolean;
    conceptCount: number;
  };
};

export type GovernancePlanOverlay = {
  schemaVersion: "governance_plan_overlays.v1" | string;
  baseGraphId: string;
  updatedAt?: string | null;
  plans: Array<{
    planId: string;
    color: string;
    sourceRestructurePath?: string | null;
    displayJsonPath?: string | null;
    updatedAt?: string | null;
    nodeCount?: number;
    edgeCount?: number;
  }>;
  projectedNodes: Array<{
    id: string;
    planId: string;
    type: string;
    label: string;
    color: string;
    governanceNodeId?: string | null;
    evidence?: Record<string, unknown> | null;
  }>;
  projectedEdges: Array<{
    id: string;
    planId: string;
    source: string;
    target: string;
    type: string;
  }>;
  sharedUsage: Record<string, string[]>;
  reviewFlags: Array<{
    planId: string;
    nodeId?: string | null;
    reason?: string | null;
    evidence?: Record<string, unknown> | null;
  }>;
  summary: {
    planCount: number;
    projectedNodeCount: number;
    projectedEdgeCount: number;
    sharedNodeCount: number;
    reviewFlagCount: number;
  };
};
