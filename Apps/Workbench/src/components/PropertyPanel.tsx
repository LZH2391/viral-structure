import { useEffect, useRef, useState } from "react";
import type {
  AgentRunJob,
  AudioFeatureAnalysisArtifact,
  MediaDerivative,
  RhythmStructureArtifact,
  RhythmStructureHistoryEntry,
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
import { MetaInfoPanel } from "./property-panel/MetaInfoPanel";
import { RhythmStructurePanel } from "./property-panel/RhythmStructurePanel";
import { ScriptSegmentPanel } from "./property-panel/ScriptSegmentPanel";
import { StructurePlaceholderPanel } from "./property-panel/StructurePlaceholderPanel";

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
  rhythmStructureAnalysis?: RhythmStructureArtifact | null;
  rhythmStructureAnalysisHistory?: RhythmStructureHistoryEntry[] | null;
  rhythmStructureJob?: AgentRunJob | null;
  agentAnalysisFps: number;
  onAgentAnalysisFpsChange: (value: number) => void;
  onRunShotBoundary: () => void;
  onRunScriptSegment: () => void;
  onRunRhythmStructure: () => void;
  onSelectShot: (time: number) => void;
  onSelectScriptSegment: (time: number) => void;
  onSelectRhythmCard: (time: number) => void;
  onSubtitleDraftChange: (draft: { segmentId: string; text: string; start: number; end: number; sourceArtifactId: string | null }) => void;
};

export function PropertyPanel(props: PropertyPanelProps) {
  const [activeTab, setActiveTab] = useState<"shot" | "script" | "rhythm" | "packaging" | "meta">("shot");
  const tabsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const tabs = tabsRef.current;
    if (!tabs) return;

    const handleTabsWheel = (event: WheelEvent) => {
      if (tabs.scrollWidth <= tabs.clientWidth) return;

      const rawDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      if (!rawDelta) return;

      const deltaUnit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? tabs.clientWidth : 1;
      event.preventDefault();
      event.stopPropagation();
      tabs.scrollLeft += rawDelta * deltaUnit;
    };

    tabs.addEventListener("wheel", handleTabsWheel, { passive: false });
    return () => tabs.removeEventListener("wheel", handleTabsWheel);
  }, []);

  return (
    <aside className="property-panel" aria-label="属性区">
      <section className="property-section property-tabs-section">
        <div ref={tabsRef} className="property-tabs" role="tablist" aria-label="分析面板">
          <button
            className={`property-tab ${activeTab === "shot" ? "active" : ""}`}
            type="button"
            role="tab"
            aria-selected={activeTab === "shot"}
            onClick={() => setActiveTab("shot")}
          >
            切镜
          </button>
          <button
            className={`property-tab ${activeTab === "script" ? "active" : ""}`}
            type="button"
            role="tab"
            aria-selected={activeTab === "script"}
            onClick={() => setActiveTab("script")}
          >
            脚本
          </button>
          <button
            className={`property-tab ${activeTab === "rhythm" ? "active" : ""}`}
            type="button"
            role="tab"
            aria-selected={activeTab === "rhythm"}
            onClick={() => setActiveTab("rhythm")}
          >
            节奏结构
          </button>
          <button
            className={`property-tab ${activeTab === "packaging" ? "active" : ""}`}
            type="button"
            role="tab"
            aria-selected={activeTab === "packaging"}
            onClick={() => setActiveTab("packaging")}
          >
            包装结构
          </button>
          <button
            className={`property-tab ${activeTab === "meta" ? "active" : ""}`}
            type="button"
            role="tab"
            aria-selected={activeTab === "meta"}
            onClick={() => setActiveTab("meta")}
          >
            元信息
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
        ) : activeTab === "script" ? (
          <ScriptSegmentPanel
            analysis={props.scriptSegmentAnalysis}
            analysisHistory={props.scriptSegmentAnalysisHistory}
            currentCard={props.currentCard}
            job={props.scriptSegmentJob}
            onRun={props.onRunScriptSegment}
            onSelectSegment={props.onSelectScriptSegment}
          />
        ) : activeTab === "rhythm" ? (
          <RhythmStructurePanel
            analysis={props.rhythmStructureAnalysis}
            analysisHistory={props.rhythmStructureAnalysisHistory}
            job={props.rhythmStructureJob}
            onRun={props.onRunRhythmStructure}
            onSelectCard={props.onSelectRhythmCard}
          />
        ) : activeTab === "packaging" ? (
          <StructurePlaceholderPanel
            title="包装结构分析"
            capabilityId="packaging-structure-analyzer"
            description="预留用于分析卖点包装、信任包装、价格包装和行动包装如何被镜头与话术组合出来。"
            inputs={["shots[]", "commerceBrief", "scriptSegmentAnalysis", "rhythmStructureAnalysis"]}
            outputs={["packagingBlocks", "claimStack", "proofStack", "conversionWrap"]}
          />
        ) : (
          <MetaInfoPanel
            sampleVideo={props.sampleVideo}
            mediaDerivatives={props.mediaDerivatives}
            audioFeatures={props.audioFeatures}
            selectedAudioFeatureMarkerId={props.selectedAudioFeatureMarkerId}
            selectedSubtitleId={props.selectedSubtitleId}
            subtitles={props.subtitles}
            shotBoundaryAnalysis={props.shotBoundaryAnalysis}
            scriptSegmentAnalysis={props.scriptSegmentAnalysis}
            processingTraceId={props.processingTraceId}
            processingStatus={props.processingStatus}
            processingStage={props.processingStage}
            processingProgress={props.processingProgress}
            errorMessage={props.errorMessage}
          />
        )}
      </section>
    </aside>
  );
}
