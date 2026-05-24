export type StageLevel = "info" | "done" | "fail";
export type MediaKind = "video" | "cover" | "frame" | "audio" | "subtitle" | "audioFeature";

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
    cacheKind?: "sample" | "shot_boundary" | "script_segment" | "rhythm_structure" | string;
    cachedItem: LibraryItemSummary;
    sourceSampleVideoId?: string | null;
    sourceTurnId?: string | null;
    sourceCreatedAt?: string | null;
    cacheKey?: string | null;
    analysisFps?: number | null;
    enableReview?: boolean | null;
    reviewMode?: "reviewed" | "unreviewed" | string | null;
  } | null;
};

export type BackendCapabilities = {
  demucsAvailable: boolean;
  ffmpegAvailable?: boolean;
  librosaAvailable?: boolean;
  doubaoSaucConfigured: boolean;
  doubaoSaucRequiredEnv?: string[];
};

export type ErrorSummary = {
  code?: string;
  message?: string;
  debugSnapshotUri?: string | null;
  stageName?: string | null;
  retryable?: boolean | null;
  preAgentFailure?: boolean | null;
  turnSubmitted?: boolean | null;
};

export type FrameOutputSummary = {
  frameSampleRateFps: number;
  targetFrameCount: number;
  actualFrameCount: number;
  maxFrames: number;
  samplingPolicy?: string | null;
  cappedByMaxFrames?: boolean | null;
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
  frameOutputSummary?: FrameOutputSummary | null;
  audio?: ArtifactRef | null;
  audioFeatures?: AudioFeatureAnalysisArtifact | null;
  audioSeparation?: AudioSeparationArtifact | null;
  subtitles?: SubtitleArtifact | null;
  subtitlesRevisionHistory?: SubtitleRevisionHistoryEntry[] | null;
  shotBoundaryAnalysis?: ShotBoundaryAnalysisArtifact | null;
  shotBoundaryAnalysisHistory?: ShotBoundaryAnalysisHistoryEntry[] | null;
  scriptSegmentAnalysis?: ScriptSegmentArtifact | null;
  scriptSegmentAnalysisHistory?: ScriptSegmentHistoryEntry[] | null;
  rhythmStructureAnalysis?: RhythmStructureArtifact | null;
  rhythmStructureAnalysisHistory?: RhythmStructureHistoryEntry[] | null;
  metadata: {
    durationSeconds: number;
    durationSource?: string | null;
    width?: number | null;
    height?: number | null;
    formatName?: string | null;
    bitrate?: number | null;
    hasAudio?: boolean | null;
  };
};

export type ShotBoundaryAnalysisHistoryEntry = {
  artifactId: string;
  status: "processed" | "failed" | string;
  resultOrigin: "new_turn" | "repaired_turn" | "cache_reuse" | "failed_validation" | string;
  analysisFps: number | null;
  boundaryCount: number;
  shotCount: number;
    turnId: string | null;
    traceId: string | null;
    sourceTraceId?: string | null;
    enableReview?: boolean;
    reviewMode?: "reviewed" | "unreviewed" | string;
    createdAt: string;
  validatorCode?: string | null;
};

export type ShotBoundaryAnalysisArtifact = {
  artifactId: string;
  parentArtifactId: string | null;
  type: "shot-boundary-analysis";
  status: "processed" | "failed" | string;
  resultOrigin?: "new_turn" | "repaired_turn" | "cache_reuse" | "failed_validation" | string;
  sourceFrameArtifactIds: string[];
  extractSampling: {
    requestedFps: number;
    targetFrameCount: number;
    actualFrameCount: number;
    maxFrames: number;
    samplingPolicy?: string | null;
    cappedByMaxFrames?: boolean | null;
  } | null;
  analysisSampling: {
    fps: number;
    requestedFps?: number | null;
    targetFrameCount?: number | null;
    selectedFrameCount?: number | null;
    effectiveFps?: number | null;
    selectionPolicy?: string | null;
    duplicatePolicy?: string | null;
    stride?: number | null;
    roundingPolicy?: string | null;
  };
  subtitleContextSummary?: {
    subtitleArtifactId?: string | null;
    subtitleSegmentCount: number;
    subtitleTextHash?: string | null;
    truncated: boolean;
  } | null;
  agent?: {
    provider: "codex-appserver" | string;
    role: string;
    skillPath: string;
    skillHash?: string | null;
    threadId: string | null;
    leaseId: string | null;
    turnId: string | null;
    sheetCount?: number;
    inputMode?: string;
    enableReview?: boolean;
    reviewMode?: "reviewed" | "unreviewed" | string;
    rawAnalyzer?: {
      phase?: string | null;
      role?: string | null;
      threadId?: string | null;
      turnId?: string | null;
      leaseId?: string | null;
      inputMode?: string | null;
      rawResultPreview?: string | null;
    } | null;
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
      displayFrameLabel?: string;
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
  boundaries?: Array<{
    timestamp: number;
    confidence: number;
    boundaryType: string;
    reason: string;
    needReview: boolean;
  }>;
  commerceBrief?: {
    sellingObject: string;
    proofApproach: string;
    promisedOutcome: string;
    persuasionTarget: string;
    conversionAction: string;
    uncertainties: string[];
    videoSummary?: string | null;
  } | null;
  validation?: {
    status: "passed" | "failed" | string;
    rawBoundaryCount: number | null;
    normalizedBoundaryCount: number | null;
    repairAttemptCount: number;
    validatorCode: string | null;
    review?: unknown;
  } | null;
  shots: Array<{
    id: string;
    index: number;
    shotNo?: string;
    start: number;
    end: number;
    representativeFrameId: string;
    confidence: number;
    reason: string;
    summary?: string | null;
    endBoundaryReason?: string | null;
  }>;
  reason?: string | null;
  debugSnapshotUri?: string | null;
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
  type: "beat" | "onset" | "strong_cut_candidate" | "sfx_candidate";
  time: number;
  rms?: number | null;
  confidence?: number | null;
  usableForEdit?: boolean | null;
  evidenceLabels?: string[];
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
    flatnessMean?: number | null;
    entropyMean?: number | null;
  };
  audioEventCandidates?: AudioEventCandidate[];
  audioRegions?: AudioRegion[];
  classificationSummary?: AudioClassificationSummary;
  analysisParams?: {
    librosaVersion?: string | null;
    sampleRate?: number | null;
    hopLength?: number | null;
    nFft?: number | null;
    sourceRole?: string | null;
    eventWindowSeconds?: number | null;
    pannsEnabled?: boolean | null;
    pannsModel?: string | null;
    pannsCheckpointPath?: string | null;
  };
};

export type AudioEventCandidate = {
  time: number;
  start?: number | null;
  end?: number | null;
  kind: "strong_cut_candidate" | "weak_cut_candidate" | "sfx_candidate" | string;
  confidence?: number | null;
  usableForEdit?: boolean | null;
  evidence?: {
    rms?: number | null;
    onsetPeak?: number | null;
    harmonicRms?: number | null;
    percussiveRms?: number | null;
    spectralFlatness?: number | null;
    spectralEntropy?: number | null;
    bandEnergyRatios?: {
      low?: number | null;
      mid?: number | null;
      presence?: number | null;
      high?: number | null;
    };
    labels?: string[];
  };
};

export type AudioRegion = {
  label: string;
  start: number;
  end: number;
  peakRms?: number | null;
  peakOnset?: number | null;
  count?: number | null;
};

export type AudioClassificationSummary = {
  status?: string | null;
  reason?: string | null;
  model?: string | null;
  wholeFileTopLabels?: AudioClassificationLabel[];
  chunks?: Array<{ start: number; end: number; topLabels: AudioClassificationLabel[] }>;
};

export type AudioClassificationLabel = {
  label: string;
  score?: number | null;
};

export type SubtitleSegment = {
  id: string;
  start: number;
  end: number;
  text: string;
  confidence?: number | null;
};

export type SubtitleWord = {
  start: number;
  end: number;
  text: string;
};

export type SubtitleUtterance = {
  start: number;
  end: number;
  text: string;
  definite?: boolean | null;
  words: SubtitleWord[];
};

export type SubtitleArtifact = {
  artifactId: string;
  parentArtifactId: string | null;
  type: "subtitle-track";
  revisionOfArtifactId?: string | null;
  source?: "recognition" | "manual_edit" | "degraded" | string;
  revisionIndex?: number | null;
  textHash?: string | null;
  traceId?: string | null;
  createdAt?: string | null;
  uri?: string | null;
  summary?: string | null;
  provider?: "doubao-sauc" | string;
  providerMeta?: {
    resourceId?: string | null;
    connectId?: string | null;
    requestId?: string | null;
    logId?: string | null;
  } | null;
  utterances?: SubtitleUtterance[];
  words?: SubtitleWord[];
  segments: SubtitleSegment[];
  status?: string;
  reason?: string | null;
  debugSnapshotUri?: string | null;
};

export type SubtitleRevisionHistoryEntry = {
  artifactId: string;
  parentArtifactId: string | null;
  revisionOfArtifactId?: string | null;
  segmentCount: number;
  textHash?: string | null;
  traceId: string | null;
  createdAt: string;
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
  metadata?: SampleArtifact["metadata"] | null;
  processingOptions?: SampleArtifact["processingOptions"] | null;
  frameOutputSummary?: FrameOutputSummary | null;
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
  saveToken?: number | null;
  queuedAt?: number | null;
  saveState?: "idle" | "saving" | "saved" | "failed";
  errorMessage?: string | null;
  lastSavedArtifactId?: string | null;
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
  sourceTurnId?: string | null;
  cacheKey?: string | null;
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
    skillPath: string;
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
  cardCount: number;
  turnId: string | null;
  traceId: string | null;
  sourceTraceId?: string | null;
  sourceSampleVideoId?: string | null;
  sourceTurnId?: string | null;
  cacheKey?: string | null;
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
    rhythmShape: string;
    pacingSummary: string;
    peakRange: string;
    turningPoints: string[];
    transferableRhythmRule: string;
    uncertainties: string[];
  } | null;
  cards: Array<{
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
    cardCount: number;
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
  cacheKind?: "sample" | "shot_boundary" | "script_segment" | "rhythm_structure" | string;
  traceId?: string | null;
  sourceSampleVideoId?: string | null;
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
