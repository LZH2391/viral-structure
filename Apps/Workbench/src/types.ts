export type StageLevel = "info" | "done" | "fail";
export type MediaKind = "video" | "cover" | "frame" | "audio" | "subtitle" | "audioFeature";
export type PreviewMode = "sample" | "generated" | "compare";

export type ArtifactRef = {
  artifactId: string;
  parentArtifactId: string | null;
  type: string;
  uri?: string | null;
  summary?: string | null;
};

export type FrameArtifact = {
  frameId: string;
  artifactId: string;
  parentArtifactId: string | null;
  timestamp: number;
  imageUri: string;
};

export type ProcessingJob = {
  jobId: string | null;
  sampleVideoId: string | null;
  stage: string;
  status: "pending" | "processing" | "processed" | "failed" | string;
  progress: number;
  traceId: string;
  errorSummary?: ErrorSummary | null;
};

export type BackendCapabilities = {
  demucsAvailable: boolean;
  ffmpegAvailable?: boolean;
  librosaAvailable?: boolean;
  xfyunIatConfigured: boolean;
  xfyunRequiredEnv?: string[];
};

export type ErrorSummary = {
  code?: string;
  message?: string;
  debugSnapshotUri?: string | null;
};

export type SampleArtifact = {
  sampleVideoId: string;
  workspaceId: string;
  status: string;
  trace?: {
    runId: string;
    traceId: string;
    stageId: string;
  };
  processingOptions?: {
    frameSampleRateFps?: number;
    enableAudioSeparation?: boolean;
    enableSubtitleRecognition?: boolean;
    enableAudioFeatureAnalysis?: boolean;
  };
  sampleVideo: {
    artifactId: string;
    parentArtifactId: string | null;
    original: ArtifactRef;
    normalized: ArtifactRef;
  };
  cover?: ArtifactRef | null;
  frames: FrameArtifact[];
  frameOutputSummary?: unknown;
  audio?: ArtifactRef | null;
  audioFeatures?: AudioFeatureAnalysisArtifact | null;
  audioSeparation?: AudioSeparationArtifact | null;
  subtitles?: SubtitleArtifact | null;
  shotBoundaryAnalysis?: ShotBoundaryAnalysisArtifact | null;
  metadata: {
    durationSeconds: number;
    width?: number | null;
    height?: number | null;
  };
};

export type ShotBoundaryAnalysisArtifact = {
  artifactId: string;
  parentArtifactId: string | null;
  type: "shot-boundary-analysis";
  status: "processed" | "failed" | string;
  sourceFrameArtifactIds: string[];
  extractSampling: {
    requestedFps: number;
    targetFrameCount: number;
    actualFrameCount: number;
    maxFrames: number;
  } | null;
  analysisSampling: {
    fps: number;
    stride: number | null;
  };
  agent?: {
    provider: "codex-appserver" | string;
    role: string;
    skillPath: string;
    threadId: string | null;
    leaseId: string | null;
    turnId: string | null;
    sheetCount?: number;
    inputMode?: string;
  };
  contactSheets?: Array<{
    artifactId: string;
    parentArtifactId: string | null;
    type: "contact_sheet" | string;
    artifactType?: "contact_sheet" | string;
    status?: string;
    sheetPurpose?: string;
    sheetId: string;
    sheetIndex: number;
    imagePath?: string | null;
    uri?: string | null;
    frameCount: number;
    overlapFrameIds: string[];
    gridItems: Array<{
      frameId: string;
      artifactId?: string | null;
      parentArtifactId?: string | null;
      timestamp: number;
      inputIndex: number;
      sourceFrameIndex: number;
      gridIndex: number;
      row: number;
      col: number;
    }>;
    layout: {
      rows: number;
      cols: number;
      width: number;
      height: number;
      cellWidth: number;
      cellHeight: number;
      visibleFrameWidth?: number;
      visibleFrameHeight?: number;
      labelHeight?: number;
    };
    constraints?: {
      maxDimension?: number;
      minFrameShortSide?: number;
      minFrameLongSide?: number;
      labelHeight?: number;
      overlapFrameCount?: number;
    };
    compression?: {
      format?: string;
      quality?: number;
    };
    createdAt?: string;
  }>;
  boundaryCandidateArtifacts?: Array<{
    artifactId: string;
    parentArtifactId: string | null;
    type: "shot_boundary_candidates" | string;
    artifactType?: "shot_boundary_candidates" | string;
    status?: string;
    sheetId: string;
    sheetIndex: number;
    frameCount?: number;
    boundaries: Array<{
      beforeFrameId: string;
      afterFrameId: string;
      confidence: number;
      boundaryType: string;
      reason: string;
      needReview: boolean;
    }>;
    createdAt?: string;
  }>;
  boundaries?: Array<{
    beforeFrameId: string;
    afterFrameId: string;
    confidence: number;
    boundaryType: string;
    reason: string;
    needReview: boolean;
    sheetId?: string;
    sheetIndex?: number;
  }>;
  shots: Array<{
    id: string;
    index: number;
    shotNo?: string;
    start: number;
    end: number;
    representativeFrameId: string;
    confidence: number;
    reason: string;
  }>;
  reason?: string | null;
  createdAt: string;
};

export type AgentRunJob = ProcessingJob;

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

export type AudioSeparationArtifact = {
  original?: ArtifactRef | null;
  vocal?: ArtifactRef | null;
  music?: ArtifactRef | null;
  status?: string;
  reason?: string | null;
  debugSnapshotUri?: string | null;
};

export type AudioFeatureMarker = {
  id: string;
  type: "beat" | "onset";
  time: number;
  rms?: number | null;
};

export type EnergyFrame = {
  time: number;
  rms: number;
};

export type AudioFeatureAnalysisArtifact = {
  artifactId: string;
  parentArtifactId: string | null;
  type: "audio-feature-analysis";
  status?: string;
  reason?: string | null;
  debugSnapshotUri?: string | null;
  sourceAudioArtifactId?: string | null;
  durationSeconds?: number | null;
  tempoBpm?: number | null;
  beats: number[];
  onsets: number[];
  energyFrames: EnergyFrame[];
  spectralSummary?: {
    centroidMean?: number | null;
    bandwidthMean?: number | null;
    rolloffMean?: number | null;
    zeroCrossingRateMean?: number | null;
  };
  analysisParams?: {
    librosaVersion?: string | null;
    sampleRate?: number | null;
    hopLength?: number | null;
    nFft?: number | null;
    sourceRole?: string | null;
  };
};

export type SubtitleSegment = {
  id: string;
  start: number;
  end: number;
  text: string;
  confidence?: number | null;
};

export type SubtitleArtifact = {
  artifactId: string;
  parentArtifactId: string | null;
  type: "subtitle-track";
  uri?: string | null;
  summary?: string | null;
  segments: SubtitleSegment[];
  status?: string;
  reason?: string | null;
  debugSnapshotUri?: string | null;
};

export type SampleFrame = {
  id: string;
  artifactId: string;
  parentArtifactId: string | null;
  time: number;
  imageUri: string;
};

export type SampleVideo = {
  id: string;
  artifactId: string;
  parentArtifactId: string | null;
  fileName: string;
  duration: number;
  width: number | null;
  height: number | null;
  aspectRatio: number | null;
  processingStatus: string;
  videoUri?: string | null;
  coverUri?: string | null;
  audioUri?: string | null;
  audioSummary?: string | null;
  processingOptions?: SampleArtifact["processingOptions"] | null;
  frameOutputSummary?: unknown;
  frameArtifacts: SampleFrame[];
};

export type MediaDerivative = {
  id: string;
  name: string;
  type: string;
  uri?: string | null;
  artifactId: string;
  parentArtifactId: string | null;
  summary?: string | null;
};

export type SubtitleDraft = {
  segmentId: string;
  text: string;
  start: number;
  end: number;
  sourceArtifactId: string | null;
  draftVersionId: string;
};

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
};

export type ContentProfile = {
  topic: string;
  sellingPoints: string;
  audience: string;
  platform: string;
  duration: string;
  tone: string;
};

export type GeneratedShot = {
  id: string;
  sourceStructureId: string;
  start: number;
  end: number;
  beat: string;
  script: string;
  subtitle: string;
  camera: string;
};

export type GeneratedPlan = {
  id: string;
  artifactId: string;
  parentArtifactId: string | null;
  title: string;
  coverTitle: string;
  shots: GeneratedShot[];
};

export type Mapping = {
  id: string;
  sourceName: string;
  targetName: string;
  sourceArtifactId: string;
  targetArtifactId: string;
  explanation: string;
};

export type VersionItem = {
  id: string;
  label: string;
  stageName: string;
  artifactId: string;
  parentArtifactId: string | null;
  createdAt: string;
};

export type UiLog = {
  id: string;
  event: string;
  level: StageLevel;
  time: string;
  fields: LogFields;
};

export type LogFields = {
  runId: string;
  uiTraceId: string;
  backendTraceId?: string | null;
  stageId: string;
  artifactId: string;
  parentArtifactId?: string | null;
  stageName?: string;
  errorName?: string;
  errorCode?: string;
  errorStage?: string | null;
  errorMessage?: string;
  canRetry?: boolean;
  debugSnapshotId?: string;
  debugSnapshotUri?: string | null;
  inputSummary?: unknown;
  outputSummary?: unknown;
  durationMs?: number | null;
};

export type DebugSnapshot = {
  id: string;
  runId: string;
  uiTraceId: string;
  backendTraceId?: string | null;
  stageId: string;
  stageName: string;
  artifactId: string;
  parentArtifactId: string | null;
  createdAt: string;
  payload: unknown;
};

export type WorkbenchState = {
  workspace: {
    id: string;
    name: string;
    currentVersionId: string | null;
  };
  uiTraceId: string;
  activeStageId: string | null;
  capabilities: BackendCapabilities | null;
  activePreviewMode: PreviewMode;
  activeMediaKind: MediaKind;
  timelineFrameVisible: boolean;
  timelineVisibleSeconds: number;
  selectedDerivativeId: string | null;
  selectedFrameId: string | null;
  selectedSubtitleId: string | null;
  selectedAudioFeatureMarkerId: string | null;
  sampleVideo: SampleVideo | null;
  mediaDerivatives: MediaDerivative[];
  audioSeparation?: AudioSeparationArtifact | null;
  audioFeatures?: AudioFeatureAnalysisArtifact | null;
  subtitles?: SubtitleArtifact | null;
  structureCards: StructureCard[];
  contentProfile: ContentProfile | null;
  generatedPlan: GeneratedPlan | null;
  mappings: Mapping[];
  versions: VersionItem[];
  logs: UiLog[];
  debugSnapshots: DebugSnapshot[];
  processingJob: ProcessingJob | null;
  isUploadingSample: boolean;
  uploadStatusText: string | null;
  sampleArtifact: SampleArtifact | null;
  errorSummary: ErrorSummary | null;
  subtitleDrafts: Record<string, SubtitleDraft>;
};

export type DebugTraceSummary = {
  traceId: string;
  latestEvent?: string | null;
  latestStageName?: string | null;
};

export type LibraryItemSummary = {
  sampleVideoId: string;
  filename: string;
  durationSeconds?: number | null;
  width?: number | null;
  height?: number | null;
  updatedAt?: string | null;
  tags: string[];
  cacheAvailable: boolean;
  traceId?: string | null;
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

export type DebugEvent = {
  event?: string;
  stage?: string;
  stageName?: string;
  createdAt?: string;
  time?: string;
  inputSummary?: unknown;
  outputSummary?: unknown;
  summary?: unknown;
  errorSummary?: unknown;
};

export type DebugTraceDetail = {
  traceId: string;
  logUri: string;
  events: DebugEvent[];
};

export type UiStageEvent = "stage.start" | "stage.end" | "stage.fail";

export type UiDebugEventRequest = {
  uiTraceId: string;
  runId: string;
  stageId: string;
  stageName: string;
  event: UiStageEvent;
  artifactId: string | null;
  parentArtifactId: string | null;
  inputSummary?: unknown;
  outputSummary?: unknown;
  durationMs?: number | null;
  errorSummary?: {
    code?: string | null;
    message?: string | null;
    stageName?: string | null;
    retryable?: boolean | null;
    debugSnapshotUri?: string | null;
  } | null;
  debugPayload?: unknown;
};
