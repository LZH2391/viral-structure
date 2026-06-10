import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { saveFunctionSlotAtomizationManualBoundaryEdit } from "../../api/client";
import type { WorkbenchAction } from "../../state";
import type { AudioFeatureMarker, ProcessingJob, SampleArtifact, WorkbenchState } from "../../types";
import { resolveAudioFeatureSourceId } from "../../utils/workbenchHelpers";
import { resolveFailedProcessingJob, STAGES } from "./workbenchAnalysisHelpers";

type AnalysisFlow = {
  run: (mode: "ask" | "refresh") => Promise<{ artifact?: SampleArtifact | null; job: ProcessingJob } | null>;
  applyCompletedArtifact: (artifact: SampleArtifact, traceId: string | null, status: string) => void;
  setJob: Dispatch<SetStateAction<ProcessingJob | null>>;
  job?: ProcessingJob | null;
};

type StageLogger<TStage> = {
  beginStage: (stageId: string, artifactId: string, payload?: any) => TStage;
  finishStage: (stage: TStage, artifactId?: string, payload?: any) => void;
  failStage: (stage: TStage, error: unknown, payload?: any) => void;
};

export function useWorkbenchAnalysisHandlers<TStage>({
  state,
  dispatch,
  stageLogger,
  scriptSegmentFlow,
  rhythmStructureFlow,
  packagingStructureFlow,
  functionSlotAtomizationFlow,
  userMaterialTaggerFlow,
  persistWorkbenchArtifact,
  setSaveStatus,
  audioSeekRequestIdRef,
  setAudioSeekRequest,
  videoRef,
  setCurrentTime,
}: {
  state: WorkbenchState;
  dispatch: Dispatch<WorkbenchAction>;
  stageLogger: StageLogger<TStage>;
  scriptSegmentFlow: AnalysisFlow;
  rhythmStructureFlow: AnalysisFlow;
  packagingStructureFlow: AnalysisFlow;
  functionSlotAtomizationFlow: AnalysisFlow;
  userMaterialTaggerFlow: AnalysisFlow;
  persistWorkbenchArtifact: (artifact: SampleArtifact, traceId: string | null) => void;
  setSaveStatus: Dispatch<SetStateAction<string>>;
  audioSeekRequestIdRef: MutableRefObject<number>;
  setAudioSeekRequest: Dispatch<SetStateAction<{ requestId: number; time: number } | null>>;
  videoRef: MutableRefObject<HTMLVideoElement | null>;
  setCurrentTime: (time: number) => void;
}) {
  const handleUnderstand = useCallback(async () => {
    if (!state.sampleVideo || !state.sampleArtifact?.shotBoundaryAnalysis?.shots?.length) return null;
    const stage = stageLogger.beginStage(STAGES.scriptSegmentAnalyze, state.sampleArtifact.shotBoundaryAnalysis.artifactId, {
      sampleVideoId: state.sampleVideo.id,
      sourceShotBoundaryArtifactId: state.sampleArtifact.shotBoundaryAnalysis.artifactId,
      shotCount: state.sampleArtifact.shotBoundaryAnalysis.shots.length,
    });
    try {
      const result = await scriptSegmentFlow.run("ask");
      if (!result?.artifact?.scriptSegmentAnalysis) throw new Error("脚本段落分析未返回有效产物");
      scriptSegmentFlow.applyCompletedArtifact(result.artifact, result.job.traceId ?? state.processingJob?.traceId ?? null, "结构理解完成");
      stageLogger.finishStage(stage, result.artifact.scriptSegmentAnalysis.artifactId, {
        segmentCount: result.artifact.scriptSegmentAnalysis.segments.length,
        validatorCode: result.artifact.scriptSegmentAnalysis.validation?.validatorCode ?? null,
      });
      return result.artifact;
    } catch (error) {
      scriptSegmentFlow.setJob(resolveFailedProcessingJob(error));
      stageLogger.failStage(stage, error, {
        errorCode: (error as { code?: string })?.code,
        errorMessage: error instanceof Error ? error.message : "脚本段落分析失败",
        errorStage: STAGES.scriptSegmentAnalyze,
        backendTraceId: scriptSegmentFlow.job?.traceId ?? state.processingJob?.traceId ?? null,
        debugPayload: { kind: "script-segment-failure", sampleVideoId: state.sampleVideo.id },
      });
      throw error;
    }
  }, [scriptSegmentFlow, stageLogger, state]);

  const handleRhythmStructure = useCallback(async () => {
    if (!state.sampleVideo || !state.sampleArtifact?.shotBoundaryAnalysis?.shots?.length) return null;
    const stage = stageLogger.beginStage(STAGES.rhythmStructureAnalyze, state.sampleArtifact.shotBoundaryAnalysis.artifactId, {
      sampleVideoId: state.sampleVideo.id,
      sourceShotBoundaryArtifactId: state.sampleArtifact.shotBoundaryAnalysis.artifactId,
      shotCount: state.sampleArtifact.shotBoundaryAnalysis.shots.length,
    });
    try {
      const result = await rhythmStructureFlow.run("ask");
      if (!result?.artifact?.rhythmStructureAnalysis) throw new Error("节奏结构分析未返回有效产物");
      rhythmStructureFlow.applyCompletedArtifact(result.artifact, result.job.traceId ?? state.processingJob?.traceId ?? null, "节奏结构完成");
      stageLogger.finishStage(stage, result.artifact.rhythmStructureAnalysis.artifactId, {
        sectionCount: result.artifact.rhythmStructureAnalysis.sections.length,
        validatorCode: result.artifact.rhythmStructureAnalysis.validation?.validatorCode ?? null,
      });
      return result.artifact;
    } catch (error) {
      rhythmStructureFlow.setJob(resolveFailedProcessingJob(error));
      stageLogger.failStage(stage, error, {
        errorCode: (error as { code?: string })?.code,
        errorMessage: error instanceof Error ? error.message : "节奏结构分析失败",
        errorStage: STAGES.rhythmStructureAnalyze,
        backendTraceId: rhythmStructureFlow.job?.traceId ?? state.processingJob?.traceId ?? null,
        debugPayload: { kind: "rhythm-structure-failure", sampleVideoId: state.sampleVideo.id },
      });
      throw error;
    }
  }, [rhythmStructureFlow, stageLogger, state]);

  const handlePackagingStructure = useCallback(async () => {
    if (!state.sampleVideo || !state.sampleArtifact?.shotBoundaryAnalysis?.shots?.length) return null;
    const stage = stageLogger.beginStage(STAGES.packagingStructureAnalyze, state.sampleArtifact.shotBoundaryAnalysis.artifactId, {
      sampleVideoId: state.sampleVideo.id,
      sourceShotBoundaryArtifactId: state.sampleArtifact.shotBoundaryAnalysis.artifactId,
      shotCount: state.sampleArtifact.shotBoundaryAnalysis.shots.length,
    });
    try {
      const result = await packagingStructureFlow.run("ask");
      if (!result?.artifact?.packagingStructureAnalysis) throw new Error("包装结构分析未返回有效产物");
      packagingStructureFlow.applyCompletedArtifact(result.artifact, result.job.traceId ?? state.processingJob?.traceId ?? null, "包装结构完成");
      stageLogger.finishStage(stage, result.artifact.packagingStructureAnalysis.artifactId, {
        packagingBlockCount: result.artifact.packagingStructureAnalysis.packagingBlocks.length,
        shotPackagingNoteCount: result.artifact.packagingStructureAnalysis.shotPackagingNotes.length,
        validatorCode: result.artifact.packagingStructureAnalysis.validation?.validatorCode ?? null,
      });
      return result.artifact;
    } catch (error) {
      packagingStructureFlow.setJob(resolveFailedProcessingJob(error));
      stageLogger.failStage(stage, error, {
        errorCode: (error as { code?: string })?.code,
        errorMessage: error instanceof Error ? error.message : "包装结构分析失败",
        errorStage: STAGES.packagingStructureAnalyze,
        backendTraceId: packagingStructureFlow.job?.traceId ?? state.processingJob?.traceId ?? null,
        debugPayload: { kind: "packaging-structure-failure", sampleVideoId: state.sampleVideo.id },
      });
      throw error;
    }
  }, [packagingStructureFlow, stageLogger, state]);

  const handleFunctionSlotAtomization = useCallback(async () => {
    const scriptArtifactId = state.sampleArtifact?.scriptSegmentAnalysis?.artifactId ?? null;
    const rhythmArtifactId = state.sampleArtifact?.rhythmStructureAnalysis?.artifactId ?? null;
    const packagingArtifactId = state.sampleArtifact?.packagingStructureAnalysis?.artifactId ?? null;
    if (!state.sampleVideo || !scriptArtifactId || !rhythmArtifactId || !packagingArtifactId) return null;
    const stage = stageLogger.beginStage(STAGES.functionSlotAtomizationAnalyze, packagingArtifactId, {
      sampleVideoId: state.sampleVideo.id,
      sourceScriptSegmentArtifactId: scriptArtifactId,
      sourceRhythmStructureArtifactId: rhythmArtifactId,
      sourcePackagingStructureArtifactId: packagingArtifactId,
    });
    try {
      const result = await functionSlotAtomizationFlow.run("refresh");
      if (!result?.artifact?.functionSlotAtomizationAnalysis) throw new Error("功能槽位原子化未返回有效产物");
      functionSlotAtomizationFlow.applyCompletedArtifact(result.artifact, result.job.traceId ?? state.processingJob?.traceId ?? null, "功能槽位原子化完成");
      stageLogger.finishStage(stage, result.artifact.functionSlotAtomizationAnalysis.artifactId, {
        slotCount: result.artifact.functionSlotAtomizationAnalysis.slotMap.slots.length,
        scriptAtomCount: result.artifact.functionSlotAtomizationAnalysis.atomInventory.scriptAtoms.length,
        rhythmAtomCount: result.artifact.functionSlotAtomizationAnalysis.atomInventory.rhythmAtoms.length,
        packagingAtomCount: result.artifact.functionSlotAtomizationAnalysis.atomInventory.packagingAtoms.length,
        validatorCode: result.artifact.functionSlotAtomizationAnalysis.validation?.validatorCode ?? null,
      });
      return result.artifact;
    } catch (error) {
      functionSlotAtomizationFlow.setJob(resolveFailedProcessingJob(error));
      stageLogger.failStage(stage, error, {
        errorCode: (error as { code?: string })?.code,
        errorMessage: error instanceof Error ? error.message : "功能槽位原子化失败",
        errorStage: STAGES.functionSlotAtomizationAnalyze,
        backendTraceId: functionSlotAtomizationFlow.job?.traceId ?? state.processingJob?.traceId ?? null,
        debugPayload: { kind: "function-slot-atomization-failure", sampleVideoId: state.sampleVideo.id },
      });
      throw error;
    }
  }, [functionSlotAtomizationFlow, stageLogger, state]);

  const handleUserMaterialTagger = useCallback(async () => {
    if (!state.sampleVideo || !state.sampleArtifact?.shotBoundaryAnalysis?.shots?.length) return null;
    const stage = stageLogger.beginStage(STAGES.userMaterialTaggerAnalyze, state.sampleArtifact.shotBoundaryAnalysis.artifactId, {
      sampleVideoId: state.sampleVideo.id,
      sourceShotBoundaryArtifactId: state.sampleArtifact.shotBoundaryAnalysis.artifactId,
      shotCount: state.sampleArtifact.shotBoundaryAnalysis.shots.length,
    });
    try {
      const result = await userMaterialTaggerFlow.run("ask");
      if (!result?.artifact?.userMaterialPack) throw new Error("素材识别未返回有效产物");
      userMaterialTaggerFlow.applyCompletedArtifact(result.artifact, result.job.traceId ?? state.processingJob?.traceId ?? null, "素材识别完成");
      stageLogger.finishStage(stage, result.artifact.userMaterialPack.artifactId, {
        shotCardCount: result.artifact.userMaterialPack.shotCards.length,
        materialGroupCount: result.artifact.userMaterialPack.materialGroups.length,
        proofCoverageCount: result.artifact.userMaterialPack.proofCoverage.length,
        validatorCode: result.artifact.userMaterialPack.validation?.validatorCode ?? null,
      });
      return result.artifact;
    } catch (error) {
      userMaterialTaggerFlow.setJob(resolveFailedProcessingJob(error));
      stageLogger.failStage(stage, error, {
        errorCode: (error as { code?: string })?.code,
        errorMessage: error instanceof Error ? error.message : "素材识别失败",
        errorStage: STAGES.userMaterialTaggerAnalyze,
        backendTraceId: userMaterialTaggerFlow.job?.traceId ?? state.processingJob?.traceId ?? null,
        debugPayload: { kind: "user-material-tagger-failure", sampleVideoId: state.sampleVideo.id },
      });
      throw error;
    }
  }, [stageLogger, state, userMaterialTaggerFlow]);

  const handleFunctionSlotManualBoundaryEdit = useCallback(async (editedJsonText: string) => {
    const sampleVideoId = state.sampleVideo?.id ?? state.sampleArtifact?.sampleVideoId ?? null;
    const analysis = state.sampleArtifact?.functionSlotAtomizationAnalysis ?? null;
    if (!sampleVideoId || !analysis) throw new Error("没有可手动修正的原子化结果");
    setSaveStatus("提交原子化手动修正");
    const result = await saveFunctionSlotAtomizationManualBoundaryEdit(sampleVideoId, {
      editedJsonText,
      expectedArtifactId: analysis.artifactId,
      sourceBoundaryReviewArtifactId: analysis.boundaryReview?.artifactId ?? null,
    });
    dispatch({ type: "apply-artifact", artifact: result.sampleArtifact });
    persistWorkbenchArtifact(result.sampleArtifact, result.traceId ?? state.processingJob?.traceId ?? null);
    setSaveStatus("原子化手动修正已落地");
  }, [dispatch, persistWorkbenchArtifact, setSaveStatus, state.processingJob?.traceId, state.sampleArtifact, state.sampleVideo?.id]);

  const handleSelectAudioFeature = useCallback((marker: AudioFeatureMarker) => {
    dispatch({ type: "select-media", activeMediaKind: "audioFeature", selectedDerivativeId: resolveAudioFeatureSourceId(state), selectedFrameId: null, selectedAudioFeatureMarkerId: marker.id });
    audioSeekRequestIdRef.current += 1;
    setAudioSeekRequest({ requestId: audioSeekRequestIdRef.current, time: marker.time });
  }, [audioSeekRequestIdRef, dispatch, setAudioSeekRequest, state]);

  const handleSelectTimelineTime = useCallback((time: number) => {
    if (videoRef.current) videoRef.current.currentTime = time;
    setCurrentTime(time);
    dispatch({ type: "select-media", activeMediaKind: "video", selectedDerivativeId: state.sampleVideo?.artifactId ?? state.selectedDerivativeId, selectedFrameId: null });
  }, [dispatch, setCurrentTime, state, videoRef]);

  return {
    handleUnderstand,
    handleRhythmStructure,
    handlePackagingStructure,
    handleFunctionSlotAtomization,
    handleUserMaterialTagger,
    handleFunctionSlotManualBoundaryEdit,
    handleSelectAudioFeature,
    handleSelectTimelineTime,
  };
}
