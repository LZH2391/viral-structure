import { useState } from "react";
import type {
  AgentRunJob,
  AudioFeatureAnalysisArtifact,
  MediaDerivative,
  SampleVideo,
  ScriptSegmentArtifact,
  ScriptSegmentHistoryEntry,
  ShotBoundaryAnalysisArtifact,
  ShotBoundaryAnalysisHistoryEntry,
  StructureCard,
  SubtitleArtifact,
  SubtitleDraft,
} from "../types";
import { AgentRunPanel } from "./property-panel/AgentRunPanel";
import { PropertyRows } from "./property-panel/PropertyRows";
import { ScriptSegmentPanel } from "./property-panel/ScriptSegmentPanel";

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
  scriptSegmentAnalysis?: ScriptSegmentArtifact | null;
  scriptSegmentAnalysisHistory?: ScriptSegmentHistoryEntry[] | null;
  scriptSegmentJob?: AgentRunJob | null;
  agentAnalysisFps: number;
  onAgentAnalysisFpsChange: (value: number) => void;
  onRunShotBoundary: () => void;
  onRunScriptSegment: () => void;
  onSelectShot: (time: number) => void;
  onSelectScriptSegment: (time: number) => void;
  onSubtitleDraftChange: (draft: { segmentId: string; text: string; start: number; end: number; sourceArtifactId: string | null }) => void;
};

export function PropertyPanel(props: PropertyPanelProps) {
  const [activeTab, setActiveTab] = useState<"shot" | "script">("shot");

  return (
    <aside className="property-panel" aria-label="属性区">
      <section className="property-section property-tabs-section">
        <div className="property-tabs" role="tablist" aria-label="分析面板">
          <button
            className={`property-tab ${activeTab === "shot" ? "active" : ""}`}
            type="button"
            role="tab"
            aria-selected={activeTab === "shot"}
            onClick={() => setActiveTab("shot")}
          >
            shot
          </button>
          <button
            className={`property-tab ${activeTab === "script" ? "active" : ""}`}
            type="button"
            role="tab"
            aria-selected={activeTab === "script"}
            onClick={() => setActiveTab("script")}
          >
            script
          </button>
        </div>
        {activeTab === "shot" ? (
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
        ) : (
          <ScriptSegmentPanel
            analysis={props.scriptSegmentAnalysis}
            analysisHistory={props.scriptSegmentAnalysisHistory}
            currentCard={props.currentCard}
            job={props.scriptSegmentJob}
            onRun={props.onRunScriptSegment}
            onSelectSegment={props.onSelectScriptSegment}
          />
        )}
      </section>
      <section className="property-section">
        <div className="section-heading">当前片段</div>
        <div id="currentSegment" className="detail-block">
          <PropertyRows {...props} />
        </div>
      </section>
    </aside>
  );
}
