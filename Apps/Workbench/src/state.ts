import type {
  DebugSnapshot,
  ErrorSummary,
  GeneratedPlan,
  LogFields,
  Mapping,
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

export const STAGES = {
  ingest: "sample-ingest",
  understand: "sample-understanding",
  transfer: "structure-transfer",
  rerun: "stage-rerun",
  snapshot: "debug-snapshot",
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
    activePreviewMode: "sample",
    activeMediaKind: "video",
    timelineFrameVisible: true,
    timelineVisibleSeconds: 10,
    selectedDerivativeId: null,
    selectedFrameId: null,
    sampleVideo: null,
    mediaDerivatives: [],
    structureCards: [],
    contentProfile: null,
    generatedPlan: null,
    mappings: [],
    versions: [],
    logs: [],
    debugSnapshots: [],
    processingJob: null,
    isUploadingSample: false,
    uploadStatusText: null,
    sampleArtifact: null,
    errorSummary: null,
  };
}

export type WorkbenchAction =
  | { type: "set-upload-state"; isUploadingSample: boolean; uploadStatusText: string | null; processingJob?: ProcessingJob | null; errorSummary?: ErrorSummary | null }
  | { type: "set-processing-job"; processingJob: ProcessingJob | null; uploadStatusText: string | null }
  | { type: "apply-artifact"; artifact: SampleArtifact }
  | { type: "set-error"; errorSummary: ErrorSummary | null; uploadStatusText: string | null }
  | { type: "select-media"; activeMediaKind: MediaKind; selectedDerivativeId: string | null; selectedFrameId: string | null }
  | { type: "set-frame-visible"; visible: boolean }
  | { type: "set-visible-seconds"; visibleSeconds: number }
  | { type: "set-structure-cards"; cards: StructureCard[] }
  | { type: "set-generated-plan"; generatedPlan: GeneratedPlan; mappings: Mapping[] }
  | { type: "add-version"; version: VersionItem }
  | { type: "add-log"; log: UiLog; fields: LogFields }
  | { type: "add-snapshot"; snapshot: DebugSnapshot }
  | { type: "set-active-stage"; stageId: string | null }
  | { type: "restore-draft"; draft: DraftState };

export type DraftState = {
  sampleVideoId?: string;
  artifactId?: string;
  traceId?: string | null;
  sampleArtifact: SampleArtifact;
  selectedFrameId?: string | null;
  selectedDerivativeId?: string | null;
  versions?: VersionItem[];
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
    case "set-error":
      return { ...state, errorSummary: action.errorSummary, isUploadingSample: false, uploadStatusText: action.uploadStatusText };
    case "select-media":
      return {
        ...state,
        activeMediaKind: action.activeMediaKind,
        selectedDerivativeId: action.selectedDerivativeId,
        selectedFrameId: action.selectedFrameId,
      };
    case "set-frame-visible":
      return { ...state, timelineFrameVisible: action.visible };
    case "set-visible-seconds":
      return { ...state, timelineVisibleSeconds: action.visibleSeconds };
    case "set-structure-cards":
      return { ...state, structureCards: action.cards };
    case "set-generated-plan":
      return { ...state, generatedPlan: action.generatedPlan, mappings: action.mappings, activePreviewMode: "generated" };
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
    case "restore-draft": {
      const restored = applySampleArtifact(state, action.draft.sampleArtifact);
      return {
        ...restored,
        processingJob: buildRestoredJob(action.draft),
        selectedFrameId: action.draft.selectedFrameId ?? restored.selectedFrameId,
        selectedDerivativeId: action.draft.selectedDerivativeId ?? restored.selectedDerivativeId,
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
    selectedFrameId: sampleVideo.frameArtifacts[0]?.id ?? null,
    selectedDerivativeId: artifact.sampleVideo.normalized.artifactId,
    activeMediaKind: "video",
    structureCards: [],
    generatedPlan: null,
    mappings: [],
  };
}

export function buildDerivatives(artifact: SampleArtifact): MediaDerivative[] {
  return [
    artifact.sampleVideo.original,
    artifact.sampleVideo.normalized,
    artifact.cover,
    { artifactId: "frame-set", type: "frame-set", summary: `${artifact.frames.length} 帧`, parentArtifactId: artifact.sampleVideo.artifactId },
    artifact.audio,
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
  };
}

function artifactName(type: string) {
  const names: Record<string, string> = {
    "original-video": "原始视频引用",
    "normalized-video": "标准化视频引用",
    "cover-frame": "封面帧",
    "frame-set": "抽帧结果",
    "audio-track": "音频轨",
  };
  return names[type] ?? type;
}

function buildAspectRatio(width: number | null, height: number | null) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || !height || height <= 0) return null;
  return Number(width) / Number(height);
}
