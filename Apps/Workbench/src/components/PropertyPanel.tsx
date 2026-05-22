import type {
  AgentRunJob,
  AudioFeatureAnalysisArtifact,
  ContentProfile,
  MediaDerivative,
  SampleVideo,
  ShotBoundaryAnalysisArtifact,
  ShotBoundaryAnalysisHistoryEntry,
  StructureCard,
  SubtitleArtifact,
  SubtitleDraft,
} from "../types";
import { AgentRunPanel } from "./property-panel/AgentRunPanel";
import { CommerceBriefPanel } from "./property-panel/CommerceBriefPanel";
import { PropertyRows } from "./property-panel/PropertyRows";

export type PropertyPanelProps = {
  sampleVideo: SampleVideo | null;
  activeMediaKind: string;
  selectedFrameId: string | null;
  selectedDerivativeId: string | null;
  selectedSubtitleId: string | null;
  selectedAudioFeatureMarkerId: string | null;
  mediaDerivatives: MediaDerivative[];
  audioFeatures?: AudioFeatureAnalysisArtifact | null;
  subtitles?: SubtitleArtifact | null;
  subtitleDrafts: Record<string, SubtitleDraft>;
  currentCard: StructureCard | null;
  processingTraceId?: string | null;
  processingStatus?: string | null;
  processingStage?: string | null;
  processingProgress?: number | null;
  errorMessage?: string | null;
  shotBoundaryAnalysis?: ShotBoundaryAnalysisArtifact | null;
  shotBoundaryAnalysisHistory?: ShotBoundaryAnalysisHistoryEntry[] | null;
  currentShot?: ShotBoundaryAnalysisArtifact["shots"][number] | null;
  currentShotId?: string | null;
  agentJob?: AgentRunJob | null;
  agentAnalysisFps: number;
  contentProfile: ContentProfile;
  onAgentAnalysisFpsChange: (value: number) => void;
  onRunShotBoundary: () => void;
  onContentProfileChange: (field: keyof ContentProfile, value: string) => void;
  onGeneratePlan: () => void;
  onSelectShot: (time: number) => void;
  onSubtitleDraftChange: (draft: { segmentId: string; text: string; start: number; end: number; sourceArtifactId: string | null }) => void;
};

export function PropertyPanel(props: PropertyPanelProps) {
  return (
    <aside className="property-panel" aria-label="属性区">
      <AgentRunPanel
        sampleVideo={props.sampleVideo}
        analysis={props.shotBoundaryAnalysis}
        analysisHistory={props.shotBoundaryAnalysisHistory}
        currentShot={props.currentShot}
        currentShotId={props.currentShotId}
        job={props.agentJob}
        analysisFps={props.agentAnalysisFps}
        onAnalysisFpsChange={props.onAgentAnalysisFpsChange}
        onRun={props.onRunShotBoundary}
        onSelectShot={props.onSelectShot}
      />
      <CommerceBriefPanel
        commerceBrief={props.shotBoundaryAnalysis?.commerceBrief ?? null}
        profile={props.contentProfile}
        onProfileChange={props.onContentProfileChange}
        onGeneratePlan={props.onGeneratePlan}
      />
      <section className="property-section">
        <div className="section-heading">当前片段</div>
        <div id="currentSegment" className="detail-block">
          <PropertyRows {...props} />
        </div>
      </section>
    </aside>
  );
}
