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
