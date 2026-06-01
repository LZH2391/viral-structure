import type {
  AudioFeatureAnalysisArtifact,
  AudioSeparationArtifact,
  FunctionSlotAtomizationArtifact,
  FunctionSlotAtomizationHistoryEntry,
  PackagingStructureArtifact,
  PackagingStructureHistoryEntry,
  RhythmStructureArtifact,
  RhythmStructureHistoryEntry,
  ScriptSegmentArtifact,
  ScriptSegmentHistoryEntry,
  ShotBoundaryAnalysisArtifact,
  ShotBoundaryAnalysisHistoryEntry,
  StructureCard,
  SubtitleArtifact,
  SubtitleRevisionHistoryEntry,
} from "./artifact-analysis";

export type {
  AudioClassificationLabel,
  AudioClassificationSummary,
  AudioEventCandidate,
  AudioFeatureAnalysisArtifact,
  AudioFeatureMarker,
  AudioRegion,
  AudioSeparationArtifact,
  EnergyFrame,
  FunctionSlotAtom,
  FunctionSlotAtomizationArtifact,
  FunctionSlotAtomizationHistoryEntry,
  FunctionSlotBoundaryReview,
  FunctionSlotBoundaryReviewIssue,
  PackagingField,
  PackagingStructureArtifact,
  PackagingStructureHistoryEntry,
  RhythmStructureArtifact,
  RhythmStructureHistoryEntry,
  ScriptSegmentArtifact,
  ScriptSegmentHistoryEntry,
  ShotBoundaryAnalysisArtifact,
  ShotBoundaryAnalysisHistoryEntry,
  StructureCard,
  SubtitleArtifact,
  SubtitleRevisionHistoryEntry,
  SubtitleSegment,
  SubtitleUtterance,
  SubtitleWord,
} from "./artifact-analysis";

export type ArtifactRef = {
  artifactId: string;
  parentArtifactId: string | null;
  type: string;
  uri?: string | null;
  summary?: string | null;
};

export type AnalysisResultRef = {
  artifactId: string;
  artifactType: string;
  uri: string;
  current: boolean;
  createdAt: string;
  parentArtifactId: string | null;
};

export type FrameArtifact = {
  frameId: string;
  artifactId: string;
  parentArtifactId: string | null;
  timestamp: number;
  imageUri: string;
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
  scriptSegmentAnalysisRef?: AnalysisResultRef | null;
  scriptSegmentAnalysisHistory?: ScriptSegmentHistoryEntry[] | null;
  rhythmStructureAnalysis?: RhythmStructureArtifact | null;
  rhythmStructureAnalysisRef?: AnalysisResultRef | null;
  rhythmStructureAnalysisHistory?: RhythmStructureHistoryEntry[] | null;
  packagingStructureAnalysis?: PackagingStructureArtifact | null;
  packagingStructureAnalysisRef?: AnalysisResultRef | null;
  packagingStructureAnalysisHistory?: PackagingStructureHistoryEntry[] | null;
  functionSlotAtomizationAnalysis?: FunctionSlotAtomizationArtifact | null;
  functionSlotAtomizationAnalysisRef?: AnalysisResultRef | null;
  functionSlotAtomizationAnalysisHistory?: FunctionSlotAtomizationHistoryEntry[] | null;
  userMaterialPack?: UserMaterialPackArtifact | null;
  userMaterialPackRef?: AnalysisResultRef | null;
  userMaterialPackHistory?: UserMaterialPackHistoryEntry[] | null;
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

export type UserMaterialPackHistoryEntry = {
  artifactId: string;
  status: "processed" | "failed" | string;
  resultOrigin: "new_turn" | "repaired_turn" | "cache_reuse" | "failed_validation" | string;
  shotCardCount: number;
  materialGroupCount: number;
  proofCoverageCount: number;
  turnId: string | null;
  traceId: string | null;
  sourceTraceId?: string | null;
  sourceSampleVideoId?: string | null;
  sourceArtifactId?: string | null;
  sourceTurnId?: string | null;
  cacheKey?: string | null;
  resultUri?: string | null;
  createdAt: string;
  validatorCode?: string | null;
};

export type UserMaterialPackArtifact = {
  artifactId: string;
  parentArtifactId: string | null;
  traceId?: string | null;
  type: "user-material-pack";
  schemaVersion: "user-material-pack.stable" | string;
  status: "processed" | "failed" | string;
  sampleVideoId?: string | null;
  sourceShotBoundaryArtifactId?: string | null;
  shotCards: Array<{
    shotRef: string;
    shotNo?: string | null;
    shotClass: string;
    shotFunctions: string[];
    visualSummary: string;
    spokenOrSubtitleSummary?: string | null;
    materialTags: string[];
    constraints: string[];
    confidence: number;
    needReview: boolean;
    timeRange?: { start: number; end: number } | null;
    visualRef?: {
      type: "shot_representative_frame" | string;
      sheetId: string;
      attachmentIndex?: number | null;
      pageIndex?: number | null;
      row?: number | null;
      col?: number | null;
      timeRange?: { start: number; end: number } | null;
      middleTimestamp?: number | null;
      representativeFrameTimestamp?: number | null;
    } | null;
  }>;
  materialGroups: Array<{
    groupId: string;
    groupType: string;
    shotRefs: string[];
    groupSummary: string;
    constraints: string[];
  }>;
  proofCoverage: Array<{
    proofNeedClass: string;
    coverage: string;
    candidateShots: string[];
    candidateGroups: string[];
    reason: string;
    safeUsage: string;
    gapAdvice: string;
  }>;
  sequenceRecommendations: {
    openingCandidates: Array<UserMaterialSequenceCandidate>;
    middleCandidates: Array<UserMaterialSequenceCandidate>;
    endingCandidates: Array<UserMaterialSequenceCandidate>;
  };
  restructureInputSummary?: {
    strongMaterialAreas: string[];
    weakMaterialAreas: string[];
    missingMaterialAreas: string[];
    recommendedUse: string[];
    doNotUseFor: string[];
    needsRestructureAttention: string[];
  } | null;
  validation?: {
    status: "passed" | "failed" | string;
    shotCardCount: number;
    materialGroupCount: number;
    proofCoverageCount: number;
    validatorCode: string | null;
    repairAttemptCount: number;
  } | null;
  createdAt: string;
};

export type UserMaterialSequenceCandidate = {
  shotRef: string;
  fit: "strong" | "medium" | "weak" | string;
  recommendedPosition: "opening" | "middle" | "ending" | string;
  reason: string;
  requiredSupport: string[];
  doNotUseAs: string[];
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

export type VersionItem = {
  id: string;
  label: string;
  stageName: string;
  artifactId: string;
  parentArtifactId: string | null;
  createdAt: string;
};
