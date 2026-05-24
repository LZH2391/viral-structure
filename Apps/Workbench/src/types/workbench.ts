import type {
  AudioFeatureAnalysisArtifact,
  AudioSeparationArtifact,
  MediaDerivative,
  SampleArtifact,
  SampleVideo,
  StructureCard,
  SubtitleArtifact,
  SubtitleDraft,
  VersionItem,
} from "./artifact";
import type { DebugSnapshot, UiLog, ErrorSummary } from "./debug";
import type { ProcessingJob } from "./job";

export type MediaKind = "video" | "cover" | "frame" | "audio" | "subtitle" | "audioFeature";

export type BackendCapabilities = {
  demucsAvailable: boolean;
  ffmpegAvailable?: boolean;
  librosaAvailable?: boolean;
  doubaoSaucConfigured: boolean;
  doubaoSaucRequiredEnv?: string[];
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
