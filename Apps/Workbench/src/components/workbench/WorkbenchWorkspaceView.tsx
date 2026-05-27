import type { Dispatch, RefObject, SetStateAction } from "react";
import type { WorkbenchAction } from "../../state";
import type { AudioFeatureMarker, SampleArtifact, StructureCard, WorkbenchState } from "../../types";
import { clampVisibleSeconds } from "../../utils/timeline";
import { findAudioFeatureMarker } from "../../utils/workbenchHelpers";
import type { useAnalysisJobFlow } from "../../hooks/useAnalysisJobFlow";
import type { useResizableWorkspaceLayout } from "../../hooks/useResizableWorkspaceLayout";
import type { useShotBoundaryFlow } from "../../hooks/useShotBoundaryFlow";
import type { useSubtitleDraftFlow } from "../../hooks/useSubtitleDraftFlow";
import type { useWorkbenchUploadFlow } from "../../hooks/useWorkbenchUploadFlow";
import { normalizeAnalysisFps } from "../workbenchRunStatus";
import { PreviewPanel } from "../PreviewPanel";
import { PropertyPanel, type PropertyPanelTab } from "../PropertyPanel";
import { ResourcePanel } from "../ResourcePanel";
import { TimelinePanel } from "../TimelinePanel";
import { WorkspaceResizeHandle } from "../WorkspaceResizeHandle";

type AudioSeekRequest = { requestId: number; time: number };
type UploadFlow = ReturnType<typeof useWorkbenchUploadFlow>;
type ShotBoundaryFlow = ReturnType<typeof useShotBoundaryFlow>;
type SubtitleDraftFlow = ReturnType<typeof useSubtitleDraftFlow>;
type AnalysisFlow = ReturnType<typeof useAnalysisJobFlow>;
type WorkspaceLayout = ReturnType<typeof useResizableWorkspaceLayout>;

type WorkbenchWorkspaceViewProps = {
  state: WorkbenchState;
  dispatch: Dispatch<WorkbenchAction>;
  active: boolean;
  workspaceGridRef: RefObject<HTMLElement>;
  workspaceLayout: WorkspaceLayout;
  uploadFlow: UploadFlow;
  shotBoundaryFlow: ShotBoundaryFlow;
  subtitleDraftFlow: SubtitleDraftFlow;
  scriptSegmentFlow: AnalysisFlow;
  rhythmStructureFlow: AnalysisFlow;
  packagingStructureFlow: AnalysisFlow;
  functionSlotAtomizationFlow: AnalysisFlow;
  fileLabel: string;
  processingText: string;
  traceText: string;
  frameSampleRate: number;
  enableAudioSeparation: boolean;
  enableSubtitleRecognition: boolean;
  enableAudioFeatureAnalysis: boolean;
  setFrameSampleRate: Dispatch<SetStateAction<number>>;
  setEnableAudioSeparation: Dispatch<SetStateAction<boolean>>;
  setEnableSubtitleRecognition: Dispatch<SetStateAction<boolean>>;
  setEnableAudioFeatureAnalysis: Dispatch<SetStateAction<boolean>>;
  agentAnalysisFps: number;
  setAgentAnalysisFps: Dispatch<SetStateAction<number>>;
  enableShotBoundaryReview: boolean;
  setEnableShotBoundaryReview: Dispatch<SetStateAction<boolean>>;
  propertyPanelTab: PropertyPanelTab;
  setPropertyPanelTab: Dispatch<SetStateAction<PropertyPanelTab>>;
  shotBoundaryAnalysis: SampleArtifact["shotBoundaryAnalysis"] | null;
  currentCard: StructureCard | null;
  currentShot: NonNullable<SampleArtifact["shotBoundaryAnalysis"]>["shots"][number] | null;
  currentShotId: string | null;
  audioSeekRequest: AudioSeekRequest | null;
  videoRef: RefObject<HTMLVideoElement>;
  audioRef: RefObject<HTMLAudioElement>;
  miniCanvasRef: RefObject<HTMLCanvasElement>;
  minAnalysisFps: number;
  maxAnalysisFps: number;
  setSaveStatus: (value: string) => void;
  handleSelectAudioFeature: (marker: AudioFeatureMarker) => void;
  handleSelectTimelineTime: (time: number) => void;
  handleUnderstand: () => Promise<SampleArtifact | null>;
  handleRhythmStructure: () => Promise<SampleArtifact | null>;
  handlePackagingStructure: () => Promise<SampleArtifact | null>;
  handleFunctionSlotAtomization: () => Promise<SampleArtifact | null>;
  handleFunctionSlotManualBoundaryEdit: (editedJsonText: string) => Promise<void>;
};

export function WorkbenchWorkspaceView({
  state,
  dispatch,
  active,
  workspaceGridRef,
  workspaceLayout,
  uploadFlow,
  shotBoundaryFlow,
  subtitleDraftFlow,
  scriptSegmentFlow,
  rhythmStructureFlow,
  packagingStructureFlow,
  functionSlotAtomizationFlow,
  fileLabel,
  processingText,
  traceText,
  frameSampleRate,
  enableAudioSeparation,
  enableSubtitleRecognition,
  enableAudioFeatureAnalysis,
  setFrameSampleRate,
  setEnableAudioSeparation,
  setEnableSubtitleRecognition,
  setEnableAudioFeatureAnalysis,
  agentAnalysisFps,
  setAgentAnalysisFps,
  enableShotBoundaryReview,
  setEnableShotBoundaryReview,
  propertyPanelTab,
  setPropertyPanelTab,
  shotBoundaryAnalysis,
  currentCard,
  currentShot,
  currentShotId,
  audioSeekRequest,
  videoRef,
  audioRef,
  miniCanvasRef,
  minAnalysisFps,
  maxAnalysisFps,
  setSaveStatus,
  handleSelectAudioFeature,
  handleSelectTimelineTime,
  handleUnderstand,
  handleRhythmStructure,
  handlePackagingStructure,
  handleFunctionSlotAtomization,
  handleFunctionSlotManualBoundaryEdit,
}: WorkbenchWorkspaceViewProps) {
  return (
    <main ref={workspaceGridRef} className={`workspace-grid ${active ? "" : "is-hidden-view"}`} aria-hidden={!active}>
      <ResourcePanel
        fileLabel={fileLabel}
        isUploading={state.isUploadingSample}
        frameSampleRate={frameSampleRate}
        capabilities={uploadFlow.capabilities}
        enableAudioSeparation={enableAudioSeparation}
        enableSubtitleRecognition={enableSubtitleRecognition}
        enableAudioFeatureAnalysis={enableAudioFeatureAnalysis}
        onFrameSampleRateChange={setFrameSampleRate}
        onEnableAudioSeparationChange={setEnableAudioSeparation}
        onEnableSubtitleRecognitionChange={setEnableSubtitleRecognition}
        onEnableAudioFeatureAnalysisChange={setEnableAudioFeatureAnalysis}
        onUpload={uploadFlow.handleSampleUpload}
      />
      <WorkspaceResizeHandle kind="left-panel" onResizeStart={workspaceLayout.startResize} onReset={workspaceLayout.resetSize} onNudge={workspaceLayout.nudgeSize} />
      <PreviewPanel
        sampleVideo={state.sampleVideo}
        mediaDerivatives={state.mediaDerivatives}
        activeMediaKind={state.activeMediaKind}
        selectedDerivativeId={state.selectedDerivativeId}
        selectedFrameId={state.selectedFrameId}
        selectedAudioFeatureMarkerId={state.selectedAudioFeatureMarkerId}
        audioFeatures={state.audioFeatures}
        audioSeekRequest={audioSeekRequest}
        processingText={processingText}
        traceText={traceText}
        uiTraceId={state.uiTraceId}
        backendTraceId={state.processingJob?.traceId ?? null}
        errorText={state.errorSummary?.message}
        videoRef={videoRef}
        audioRef={audioRef}
        miniCanvasRef={miniCanvasRef}
        onSelectAudioFeature={handleSelectAudioFeature}
      />
      <WorkspaceResizeHandle kind="right-panel" onResizeStart={workspaceLayout.startResize} onReset={workspaceLayout.resetSize} onNudge={workspaceLayout.nudgeSize} />
      <PropertyPanel
        sampleVideo={state.sampleVideo}
        activeMediaKind={state.activeMediaKind}
        selectedFrameId={state.selectedFrameId}
        selectedDerivativeId={state.selectedDerivativeId}
        selectedSubtitleId={state.selectedSubtitleId}
        selectedAudioFeatureMarkerId={state.selectedAudioFeatureMarkerId}
        mediaDerivatives={state.mediaDerivatives}
        audioFeatures={state.audioFeatures}
        subtitles={state.subtitles}
        subtitleDrafts={state.subtitleDrafts}
        currentCard={currentCard}
        processingTraceId={state.processingJob?.traceId}
        processingStatus={state.processingJob?.status}
        processingStage={state.processingJob?.stage}
        processingProgress={state.processingJob?.progress}
        errorMessage={state.errorSummary?.message}
        shotBoundaryAnalysis={shotBoundaryAnalysis}
        shotBoundaryAnalysisHistory={state.sampleArtifact?.shotBoundaryAnalysisHistory ?? null}
        currentShot={currentShot}
        currentShotId={currentShotId}
        agentJob={shotBoundaryFlow.agentJob}
        scriptSegmentAnalysis={state.sampleArtifact?.scriptSegmentAnalysis ?? null}
        scriptSegmentAnalysisHistory={state.sampleArtifact?.scriptSegmentAnalysisHistory ?? null}
        scriptSegmentJob={scriptSegmentFlow.job}
        rhythmStructureAnalysis={state.sampleArtifact?.rhythmStructureAnalysis ?? null}
        rhythmStructureAnalysisHistory={state.sampleArtifact?.rhythmStructureAnalysisHistory ?? null}
        rhythmStructureJob={rhythmStructureFlow.job}
        packagingStructureAnalysis={state.sampleArtifact?.packagingStructureAnalysis ?? null}
        packagingStructureAnalysisHistory={state.sampleArtifact?.packagingStructureAnalysisHistory ?? null}
        packagingStructureJob={packagingStructureFlow.job}
        functionSlotAtomizationAnalysis={state.sampleArtifact?.functionSlotAtomizationAnalysis ?? null}
        functionSlotAtomizationAnalysisHistory={state.sampleArtifact?.functionSlotAtomizationAnalysisHistory ?? null}
        functionSlotAtomizationJob={functionSlotAtomizationFlow.job}
        activeTab={propertyPanelTab}
        onActiveTabChange={setPropertyPanelTab}
        agentAnalysisFps={agentAnalysisFps}
        enableShotBoundaryReview={enableShotBoundaryReview}
        onAgentAnalysisFpsChange={(value) => setAgentAnalysisFps(normalizeAnalysisFps(value, minAnalysisFps, maxAnalysisFps))}
        onEnableShotBoundaryReviewChange={setEnableShotBoundaryReview}
        onRunShotBoundary={() => {
          subtitleDraftFlow.flushSubtitleDraftsBeforeShotBoundary()
            .then((ready) => {
              if (!ready) {
                setSaveStatus("字幕保存失败，已阻止切镜分析；请修复后重试");
                throw new Error("字幕保存失败，已阻止切镜分析");
              }
              return shotBoundaryFlow.run();
            })
            .catch((error) => setSaveStatus(error instanceof Error ? error.message : "切镜分析失败"));
        }}
        onRunScriptSegment={() => {
          void handleUnderstand().catch((error) => setSaveStatus(error instanceof Error ? error.message : "脚本段落分析失败"));
        }}
        onRunRhythmStructure={() => {
          void handleRhythmStructure().catch((error) => setSaveStatus(error instanceof Error ? error.message : "节奏结构分析失败"));
        }}
        onRunPackagingStructure={() => {
          void handlePackagingStructure().catch((error) => setSaveStatus(error instanceof Error ? error.message : "包装结构分析失败"));
        }}
        onRunFunctionSlotAtomization={() => {
          void handleFunctionSlotAtomization().catch((error) => setSaveStatus(error instanceof Error ? error.message : "功能槽位原子化失败"));
        }}
        onManualFunctionSlotBoundaryEdit={(editedJsonText) => handleFunctionSlotManualBoundaryEdit(editedJsonText).catch((error) => {
          setSaveStatus(error instanceof Error ? error.message : "原子化手动修正失败");
          throw error;
        })}
        onSelectScriptSegment={handleSelectTimelineTime}
        onSelectRhythmCard={handleSelectTimelineTime}
        onSelectPackagingBlock={handleSelectTimelineTime}
        onSelectShot={handleSelectTimelineTime}
        onSubtitleDraftChange={subtitleDraftFlow.handleSubtitleDraftChange}
      />
      <WorkspaceResizeHandle kind="timeline" onResizeStart={workspaceLayout.startResize} onReset={workspaceLayout.resetSize} onNudge={workspaceLayout.nudgeSize} />
      <TimelinePanel
        sampleVideo={state.sampleVideo}
        mediaDerivatives={state.mediaDerivatives}
        activeMediaKind={state.activeMediaKind}
        selectedDerivativeId={state.selectedDerivativeId}
        selectedFrameId={state.selectedFrameId}
        selectedSubtitleId={state.selectedSubtitleId}
        selectedAudioFeatureMarkerId={state.selectedAudioFeatureMarkerId}
        audioSeparation={state.audioSeparation}
        audioFeatures={state.audioFeatures}
        subtitles={state.subtitles}
        subtitleDrafts={state.subtitleDrafts}
        timelineFrameVisible={state.timelineFrameVisible}
        timelineVisibleSeconds={state.timelineVisibleSeconds}
        videoRef={videoRef}
        audioRef={audioRef}
        miniCanvasRef={miniCanvasRef}
        uiTraceId={state.uiTraceId}
        backendTraceId={state.processingJob?.traceId ?? null}
        onSelectVideo={() => {
          const video = state.mediaDerivatives.find((entry) => entry.type === "normalized-video" || entry.type === "original-video");
          dispatch({ type: "select-media", activeMediaKind: "video", selectedDerivativeId: video?.artifactId ?? state.sampleVideo?.artifactId ?? null, selectedFrameId: null });
        }}
        onSelectAudio={(artifactId) => {
          const audio = state.mediaDerivatives.find((entry) => entry.artifactId === artifactId) ?? state.mediaDerivatives.find((entry) => entry.type === "audio-track");
          dispatch({ type: "select-media", activeMediaKind: "audio", selectedDerivativeId: audio?.artifactId ?? state.sampleArtifact?.audio?.artifactId ?? null, selectedFrameId: null });
        }}
        onSelectFrame={(frameId) => {
          const frame = state.sampleVideo?.frameArtifacts.find((item) => item.id === frameId);
          if (!frame) return;
          dispatch({ type: "select-media", activeMediaKind: "frame", selectedDerivativeId: frame.artifactId, selectedFrameId: frame.id });
        }}
        onSelectSubtitle={(segmentId) => {
          dispatch({ type: "select-media", activeMediaKind: "subtitle", selectedDerivativeId: state.subtitles?.artifactId ?? null, selectedFrameId: null, selectedSubtitleId: segmentId });
        }}
        onSelectAudioFeature={(markerId) => {
          const marker = findAudioFeatureMarker(state.audioFeatures, markerId);
          if (marker) handleSelectAudioFeature(marker);
        }}
        onFrameVisibleChange={(visible) => dispatch({ type: "set-frame-visible", visible })}
        onVisibleSecondsChange={(value) => dispatch({ type: "set-visible-seconds", visibleSeconds: clampVisibleSeconds(value) })}
      />
    </main>
  );
}
