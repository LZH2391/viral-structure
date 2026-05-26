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
  sourceArtifactId?: string | null;
  sourceTurnId?: string | null;
  cacheKey?: string | null;
  resultUri?: string | null;
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
  sectionCount: number;
  cardCount?: number;
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
    summary: string;
    fields: Array<{
      label: string;
      value: string;
    }>;
    uncertainties: string[];
  } | null;
  sections: Array<{
    sectionId: string;
    label: string;
    shotRefs: string[];
    fields: Array<{
      label: string;
      value: string;
    }>;
    confidence: number;
    needReview: boolean;
    start: number;
    end: number;
  }>;
  cards?: Array<{
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
    sectionCount: number;
    cardCount?: number;
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

export type PackagingStructureHistoryEntry = {
  artifactId: string;
  status: "processed" | "failed" | string;
  resultOrigin: "new_turn" | "repaired_turn" | "cache_reuse" | "failed_validation" | string;
  packagingBlockCount: number;
  shotPackagingNoteCount: number;
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

export type PackagingField = {
  label: string;
  value: string;
};

export type PackagingStructureArtifact = {
  artifactId: string;
  parentArtifactId: string | null;
  type: "packaging-structure-analysis";
  status: "processed" | "failed" | string;
  resultOrigin?: "new_turn" | "repaired_turn" | "cache_reuse" | "failed_validation" | string;
  stageName?: string | null;
  sampleVideoId?: string;
  sourceShotBoundaryArtifactId?: string | null;
  sourceShotCount?: number | null;
  sourceSampleVideoId?: string | null;
  sourcePackagingStructureArtifactId?: string | null;
  sourceTurnId?: string | null;
  sourceCreatedAt?: string | null;
  cacheKey?: string | null;
  overview: {
    summary: string;
    fields: PackagingField[];
    uncertainties: string[];
  } | null;
  shotPackagingNotes: Array<{
    noteId: string;
    shotRef: string;
    shotNo?: string | null;
    fields: PackagingField[];
    packagingFunction: string;
    confidence: number;
    needReview: boolean;
    start: number;
    end: number;
  }>;
  packagingBlocks: Array<{
    blockId: string;
    label: string;
    shotRefs: string[];
    fields: PackagingField[];
    packagingFunction: string;
    confidence: number;
    needReview: boolean;
    start: number;
    end: number;
  }>;
  claimStack: Array<{
    claimId: string;
    label: string;
    shotRefs: string[];
    fields: PackagingField[];
    start: number | null;
    end: number | null;
  }>;
  proofStack: Array<{
    proofId: string;
    label: string;
    shotRefs: string[];
    fields: PackagingField[];
    start: number | null;
    end: number | null;
  }>;
  conversionWrap: {
    summary: string;
    fields: PackagingField[];
    shotRefs: string[];
    uncertainties: string[];
    start: number | null;
    end: number | null;
  } | null;
  validation?: {
    status: "passed" | "failed" | string;
    shotPackagingNoteCount: number;
    packagingBlockCount: number;
    claimStackCount?: number;
    proofStackCount?: number;
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

export type FunctionSlotAtomizationHistoryEntry = {
  artifactId: string;
  status: "processed" | "failed" | string;
  resultOrigin: "new_turn" | "repaired_turn" | "cache_reuse" | "failed_validation" | string;
  slotCount: number;
  scriptAtomCount: number;
  rhythmAtomCount: number;
  packagingAtomCount: number;
  bindingCount: number;
  turnId: string | null;
  traceId: string | null;
  sourceTraceId?: string | null;
  sourceSampleVideoId?: string | null;
  sourceArtifactId?: string | null;
  sourceScriptSegmentArtifactId?: string | null;
  sourceRhythmStructureArtifactId?: string | null;
  sourcePackagingStructureArtifactId?: string | null;
  sourceTurnId?: string | null;
  cacheKey?: string | null;
  resultUri?: string | null;
  createdAt: string;
  validatorCode?: string | null;
};

export type FunctionSlotAtom = {
  id: string;
  slot: string;
  label: string;
  function: string;
  claimType?: string;
  proofNeed?: string;
  pace?: string;
  densityType?: string;
  beatShape?: string;
  visualHierarchy?: string;
  risk?: string;
  mustKeep: string[];
  replaceableVariables: string[];
  syncPoints: string[];
  avoidFor: string[];
  sourceRefs: {
    scriptSegmentLabels?: string[];
    rhythmSectionLabels?: string[];
    packagingBlockLabels?: string[];
    shotRefs: string[];
  };
  confidence: number;
  needReview: boolean;
};

export type FunctionSlotAtomizationArtifact = {
  artifactId: string;
  parentArtifactId: string | null;
  type: "function-slot-atomization-analysis";
  status: "processed" | "failed" | string;
  resultOrigin?: "new_turn" | "repaired_turn" | "cache_reuse" | "failed_validation" | string;
  stageName?: string | null;
  sampleVideoId?: string;
  sourceScriptSegmentArtifactId?: string | null;
  sourceRhythmStructureArtifactId?: string | null;
  sourcePackagingStructureArtifactId?: string | null;
  sourceShotBoundaryArtifactId?: string | null;
  sourceSampleVideoId?: string | null;
  sourceFunctionSlotAtomizationArtifactId?: string | null;
  sourceTurnId?: string | null;
  sourceCreatedAt?: string | null;
  cacheKey?: string | null;
  atomInventory: {
    scriptAtoms: FunctionSlotAtom[];
    rhythmAtoms: FunctionSlotAtom[];
    packagingAtoms: FunctionSlotAtom[];
  };
  slotMap: {
    slots: Array<{
      slotId: string;
      slotOrder: number;
      slotName: string;
      slotType: string;
      viewerStateBefore: string;
      viewerStateAfter: string;
      persuasionTask: string;
      scriptAtomIds: string[];
      rhythmAtomIds: string[];
      packagingAtomIds: string[];
      requiredSyncPoints: string[];
      substitutionRules: string[];
      sourceRefs: { shotRefs: string[] };
      confidence: number;
      needReview: boolean;
    }>;
  };
  bindingGraph: {
    bindings: Array<{
      id: string;
      type: "support" | "require" | "sync" | "substitute" | "conflict" | "carryover" | string;
      slotIds: string[];
      atomIds: string[];
      rule: string;
      riskIfBroken: string;
      confidence: number;
    }>;
  };
  conflictChecks: Array<{
    id: string;
    slotIds: string[];
    atomIds: string[];
    reason: string;
    fix: string;
  }>;
  recombinationRules: Array<{
    id: string;
    reason: string;
    appliesTo: string[];
    sourceBindingIds: string[];
  }>;
  recompositionTemplates: Array<{
    templateId: string;
    templateName: string;
    sequence: string[];
  }>;
  validation?: {
    status: "passed" | "failed" | string;
    slotCount: number;
    scriptAtomCount: number;
    rhythmAtomCount: number;
    packagingAtomCount: number;
    bindingCount: number;
    recombinationRuleCount: number;
    templateCount: number;
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
