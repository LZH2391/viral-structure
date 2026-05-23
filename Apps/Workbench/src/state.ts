import type {
  BackendCapabilities,
  DebugSnapshot,
  ErrorSummary,
  LogFields,
  MediaDerivative,
  MediaKind,
  ProcessingJob,
  SampleArtifact,
  SampleVideo,
  StructureCard,
  UiLog,
  VersionItem,
  WorkbenchState,
} from "./types";
import { createId } from "./utils/format";
import { createStructureCardsFromSegments } from "./domain";

export const STAGES = {
  ingest: "sample.ingest",
  understand: "sample.understand",
} as const;

export type RunStatus = {
  level: "info" | "done" | "fail" | "idle";
  text: string;
  traceText: string;
};

export function createInitialState(): WorkbenchState {
  return {
    workspace: {
      id: createId("workspace"),
      name: "结构迁移工作台",
      currentVersionId: null,
    },
    uiTraceId: createId("uiTrace"),
    activeStageId: null,
    capabilities: null,
    activeMediaKind: "video",
    timelineFrameVisible: true,
    timelineVisibleSeconds: 10,
    selectedDerivativeId: null,
    selectedFrameId: null,
    selectedSubtitleId: null,
    selectedAudioFeatureMarkerId: null,
    sampleVideo: null,
    mediaDerivatives: [],
    audioSeparation: null,
    audioFeatures: null,
    subtitles: null,
    structureCards: [],
    versions: [],
    logs: [],
    debugSnapshots: [],
    processingJob: null,
    isUploadingSample: false,
    uploadStatusText: null,
    sampleArtifact: null,
    errorSummary: null,
    subtitleDrafts: {},
  };
}

export type WorkbenchAction =
  | { type: "set-upload-state"; isUploadingSample: boolean; uploadStatusText: string | null; processingJob?: ProcessingJob | null; errorSummary?: ErrorSummary | null }
  | { type: "set-processing-job"; processingJob: ProcessingJob | null; uploadStatusText: string | null }
  | { type: "apply-artifact"; artifact: SampleArtifact }
  | { type: "sync-subtitle-artifact"; artifact: SampleArtifact }
  | { type: "set-shot-boundary-analysis"; artifact: SampleArtifact }
  | { type: "set-error"; errorSummary: ErrorSummary | null; uploadStatusText: string | null }
  | { type: "select-media"; activeMediaKind: MediaKind; selectedDerivativeId: string | null; selectedFrameId: string | null; selectedSubtitleId?: string | null; selectedAudioFeatureMarkerId?: string | null }
  | { type: "set-frame-visible"; visible: boolean }
  | { type: "set-visible-seconds"; visibleSeconds: number }
  | { type: "set-structure-cards"; cards: StructureCard[] }
  | { type: "add-version"; version: VersionItem }
  | { type: "add-log"; log: UiLog; fields: LogFields }
  | { type: "add-snapshot"; snapshot: DebugSnapshot }
  | { type: "set-active-stage"; stageId: string | null }
  | { type: "set-capabilities"; capabilities: BackendCapabilities }
  | { type: "update-subtitle-draft"; segmentId: string; text: string; start: number; end: number; sourceArtifactId: string | null; saveToken?: number | null; queuedAt?: number | null }
  | { type: "set-subtitle-draft-status"; segmentId: string; saveState: "idle" | "saving" | "saved" | "failed"; saveToken?: number | null; errorMessage?: string | null; lastSavedArtifactId?: string | null }
  | { type: "clear-subtitle-draft"; segmentId: string; saveToken?: number | null }
  | { type: "restore-draft"; draft: DraftState };

export type DraftState = {
  sampleVideoId?: string;
  artifactId?: string;
  traceId?: string | null;
  sampleArtifact: SampleArtifact;
  selectedFrameId?: string | null;
  selectedDerivativeId?: string | null;
  versions?: VersionItem[];
  activeUploadJob?: { processingJobId: string; sampleVideoId: string; traceId: string };
  activeAgentJob?: { processingJobId: string; sampleVideoId: string; traceId: string; analysisFps: number };
};

export function workbenchReducer(state: WorkbenchState, action: WorkbenchAction): WorkbenchState {
  switch (action.type) {
    case "set-upload-state":
      return {
        ...state,
        isUploadingSample: action.isUploadingSample,
        uploadStatusText: action.uploadStatusText,
        processingJob: action.processingJob === undefined ? state.processingJob : action.processingJob,
        errorSummary: action.errorSummary === undefined ? state.errorSummary : action.errorSummary,
      };
    case "set-processing-job":
      return { ...state, processingJob: action.processingJob, uploadStatusText: action.uploadStatusText };
    case "apply-artifact":
      return applySampleArtifact(state, action.artifact);
    case "sync-subtitle-artifact":
      return {
        ...state,
        sampleArtifact: action.artifact,
        subtitles: action.artifact.subtitles ?? null,
      };
    case "set-shot-boundary-analysis":
      return applySampleArtifact(state, action.artifact);
    case "set-error":
      return { ...state, errorSummary: action.errorSummary, isUploadingSample: false, uploadStatusText: action.uploadStatusText };
    case "select-media":
      return {
        ...state,
        activeMediaKind: action.activeMediaKind,
        selectedDerivativeId: action.selectedDerivativeId,
        selectedFrameId: action.selectedFrameId,
        selectedSubtitleId: action.selectedSubtitleId ?? null,
        selectedAudioFeatureMarkerId: action.selectedAudioFeatureMarkerId ?? null,
      };
    case "set-frame-visible":
      return { ...state, timelineFrameVisible: action.visible };
    case "set-visible-seconds":
      return { ...state, timelineVisibleSeconds: action.visibleSeconds };
    case "set-structure-cards":
      return { ...state, structureCards: action.cards };
    case "add-version":
      return {
        ...state,
        workspace: { ...state.workspace, currentVersionId: action.version.id },
        versions: [action.version, ...state.versions],
      };
    case "add-log":
      return { ...state, logs: [action.log, ...state.logs].slice(0, 60) };
    case "add-snapshot":
      return { ...state, debugSnapshots: [action.snapshot, ...state.debugSnapshots] };
    case "set-active-stage":
      return { ...state, activeStageId: action.stageId };
    case "set-capabilities":
      return { ...state, capabilities: action.capabilities };
    case "update-subtitle-draft":
      return {
        ...state,
        subtitleDrafts: {
          ...state.subtitleDrafts,
          [action.segmentId]: {
            segmentId: action.segmentId,
            text: action.text,
            start: action.start,
            end: action.end,
            sourceArtifactId: action.sourceArtifactId,
            draftVersionId: state.subtitleDrafts[action.segmentId]?.draftVersionId ?? createId("version"),
            saveToken: action.saveToken ?? state.subtitleDrafts[action.segmentId]?.saveToken ?? null,
            queuedAt: action.queuedAt ?? Date.now(),
            saveState: state.subtitleDrafts[action.segmentId]?.saveState ?? "idle",
            errorMessage: null,
            lastSavedArtifactId: state.subtitleDrafts[action.segmentId]?.lastSavedArtifactId ?? null,
          },
        },
      };
    case "set-subtitle-draft-status": {
      const current = state.subtitleDrafts[action.segmentId];
      if (!current) return state;
      if (action.saveToken != null && current.saveToken != null && current.saveToken !== action.saveToken) return state;
      return {
        ...state,
        subtitleDrafts: {
          ...state.subtitleDrafts,
          [action.segmentId]: {
            ...current,
            saveToken: action.saveToken ?? current.saveToken ?? null,
            saveState: action.saveState,
            errorMessage: action.errorMessage ?? null,
            lastSavedArtifactId: action.lastSavedArtifactId ?? current.lastSavedArtifactId ?? null,
          },
        },
      };
    }
    case "clear-subtitle-draft": {
      if (!state.subtitleDrafts[action.segmentId]) return state;
      if (action.saveToken != null && state.subtitleDrafts[action.segmentId]?.saveToken != null && state.subtitleDrafts[action.segmentId]?.saveToken !== action.saveToken) return state;
      const nextDrafts = { ...state.subtitleDrafts };
      delete nextDrafts[action.segmentId];
      return {
        ...state,
        subtitleDrafts: nextDrafts,
      };
    }
    case "restore-draft": {
      const restored = applySampleArtifact(state, action.draft.sampleArtifact);
      return {
        ...restored,
        processingJob: buildRestoredJob(action.draft),
        selectedFrameId: action.draft.selectedFrameId ?? restored.selectedFrameId,
        selectedDerivativeId: action.draft.selectedDerivativeId ?? restored.selectedDerivativeId,
        selectedSubtitleId: null,
        selectedAudioFeatureMarkerId: null,
        versions: Array.isArray(action.draft.versions) ? action.draft.versions : [],
      };
    }
    default:
      return state;
  }
}

export function applySampleArtifact(state: WorkbenchState, artifact: SampleArtifact): WorkbenchState {
  const sampleVideo: SampleVideo = {
    id: artifact.sampleVideoId,
    artifactId: artifact.sampleVideo.artifactId,
    parentArtifactId: artifact.sampleVideo.parentArtifactId,
    fileName: artifact.sampleVideo.original.summary ?? "样例视频",
    duration: artifact.metadata.durationSeconds,
    width: artifact.metadata.width ?? null,
    height: artifact.metadata.height ?? null,
    aspectRatio: buildAspectRatio(artifact.metadata.width ?? null, artifact.metadata.height ?? null),
    processingStatus: artifact.status,
    videoUri: artifact.sampleVideo.normalized.uri,
    coverUri: artifact.cover?.uri ?? null,
    audioUri: artifact.audio?.uri ?? null,
    audioSummary: artifact.audio?.summary ?? null,
    metadata: artifact.metadata ?? null,
    processingOptions: artifact.processingOptions ?? null,
    frameOutputSummary: artifact.frameOutputSummary ?? null,
    frameArtifacts: artifact.frames.map((frame) => ({
      id: frame.frameId,
      artifactId: frame.artifactId,
      parentArtifactId: frame.parentArtifactId,
      time: frame.timestamp,
      imageUri: frame.imageUri,
    })),
  };
  return {
    ...state,
    sampleArtifact: artifact,
    errorSummary: null,
    sampleVideo,
    mediaDerivatives: buildDerivatives(artifact),
    audioSeparation: artifact.audioSeparation ?? null,
    audioFeatures: artifact.audioFeatures ?? null,
    subtitles: artifact.subtitles ?? null,
    selectedFrameId: sampleVideo.frameArtifacts[0]?.id ?? null,
    selectedDerivativeId: artifact.sampleVideo.normalized.artifactId,
    selectedSubtitleId: null,
    selectedAudioFeatureMarkerId: null,
    activeMediaKind: "video",
    structureCards: createStructureCardsFromSegments(artifact),
    subtitleDrafts: {},
  };
}

export function buildDerivatives(artifact: SampleArtifact): MediaDerivative[] {
  return [
    artifact.sampleVideo.original,
    artifact.sampleVideo.normalized,
    artifact.cover,
    { artifactId: "frame-set", type: "frame-set", summary: `${artifact.frames.length} 帧`, parentArtifactId: artifact.sampleVideo.artifactId },
    artifact.audio,
    artifact.audioSeparation?.vocal,
    artifact.audioSeparation?.music,
  ]
    .filter(Boolean)
    .map((item) => {
      const entry = item as NonNullable<SampleArtifact["audio"]>;
      return {
        id: entry.artifactId,
        name: artifactName(entry.type),
        type: entry.type,
        uri: entry.uri,
        artifactId: entry.artifactId,
        parentArtifactId: entry.parentArtifactId,
        summary: entry.summary,
      };
    });
}

export function addVersion(label: string, stageName: string, artifactId: string, parentArtifactId: string | null): VersionItem {
  return {
    id: createId("version"),
    label,
    stageName,
    artifactId,
    parentArtifactId,
    createdAt: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
  };
}

function buildRestoredJob(draft: DraftState): ProcessingJob | null {
  if (!draft.traceId) return null;
  return {
    jobId: null,
    sampleVideoId: draft.sampleVideoId ?? draft.sampleArtifact?.sampleVideoId ?? null,
    status: "processed",
    stage: "restored",
    progress: 100,
    traceId: draft.traceId,
    activeThreadMessage: null,
  };
}

function artifactName(type: string) {
  const names: Record<string, string> = {
    "original-video": "原始视频引用",
    "normalized-video": "标准化视频引用",
    "cover-frame": "封面帧",
    "frame-set": "抽帧结果",
    "audio-track": "音频轨",
    "audio-vocal": "人声",
    "audio-music": "伴奏",
  };
  return names[type] ?? type;
}

function buildAspectRatio(width: number | null, height: number | null) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || !height || height <= 0) return null;
  return Number(width) / Number(height);
}
