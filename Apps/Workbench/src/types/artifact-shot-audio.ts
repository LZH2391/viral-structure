import type { ArtifactRef } from "./artifact";

export type ShotBoundaryAnalysisHistoryEntry = {
  artifactId: string;
  status: "processed" | "failed" | string;
  resultOrigin: "new_turn" | "repaired_turn" | "boundary_reworked_turn" | "manual_boundary_edit" | "cache_reuse" | "failed_validation" | string;
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
    skillPath: string | null;
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
    boundaryType: string | null;
    reason: string | null;
    needReview: boolean;
  }>;
  commerceBrief?: {
    sellingObject: string;
    proofApproach: string;
    promisedOutcome: string;
    persuasionTarget: string;
    conversionAction: string;
    uncertainties: string[];
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
    reason: string | null;
    summary?: string | null;
    endBoundaryReason?: string | null;
  }>;
  reason?: string | null;
  debugSnapshotUri?: string | null;
  createdAt: string;
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
