import type { ProcessingJob, SampleArtifact, WorkflowRun, WorkflowStageState } from "../../types";
import { isRunExecuting } from "./fullAnalysisState";

export type FullAnalysisWorkbenchActiveSample = {
  artifact: SampleArtifact;
  activeSampleRevision: number;
  activeSampleSource: "workbench" | "fullAnalysis" | "materialRecognition" | "library";
};
export type FullAnalysisWorkbenchSync = {
  run: WorkflowRun;
  artifact: SampleArtifact | null;
  childJobs: Record<string, ProcessingJob | null>;
  activeSampleChanged: boolean;
};

export const POLL_INTERVAL_MS = 2000;
export const TERMINAL_SETTLE_POLL_COUNT = 5;
export const STAGE_ORDER = ["upload", "shotBoundary", "scriptSegment", "rhythmStructure", "packagingStructure", "functionSlotAtomization", "aggregate"];
export const MATERIAL_STAGE_ORDER = ["upload", "shotBoundary", "userMaterialTagger", "aggregate"];
export const CACHE_PROMPT_ORDER = ["shotBoundary", "scriptSegment", "rhythmStructure", "packagingStructure", "functionSlotAtomization"];
export const DEFAULT_STAGES: WorkflowStageState[] = [
  buildDefaultStage("upload", "上传"),
  buildDefaultStage("shotBoundary", "切镜"),
  buildDefaultStage("scriptSegment", "脚本段落"),
  buildDefaultStage("rhythmStructure", "节奏结构"),
  buildDefaultStage("packagingStructure", "包装结构"),
  buildDefaultStage("functionSlotAtomization", "功能槽位原子化"),
  buildDefaultStage("aggregate", "汇总"),
];
export const MATERIAL_DEFAULT_STAGES: WorkflowStageState[] = [
  buildDefaultStage("upload", "上传"),
  buildDefaultStage("shotBoundary", "切镜"),
  buildDefaultStage("userMaterialTagger", "素材识别"),
  buildDefaultStage("aggregate", "汇总"),
];

export function shouldPreserveActiveWorkflow(run: WorkflowRun | null, activeSample: FullAnalysisWorkbenchActiveSample) {
  if (!run) return false;
  if (activeSample.activeSampleSource === "fullAnalysis") return true;
  if (activeSample.activeSampleSource === "materialRecognition") return true;
  if (run.sampleVideoId && run.sampleVideoId === activeSample.artifact.sampleVideoId) return true;
  return isRunExecuting(run);
}

export function hasSettledArtifactForRun(run: WorkflowRun, artifact: SampleArtifact | null) {
  if (!artifact || !run.sampleVideoId || artifact.sampleVideoId !== run.sampleVideoId) return false;
  return run.stages.every((stage) => {
    if (stage.status !== "processed") return true;
    if (!stage.artifactId) return true;
    return sampleArtifactContainsStageArtifact(artifact, stage.key, stage.artifactId);
  });
}

function sampleArtifactContainsStageArtifact(artifact: SampleArtifact, stageKey: string, artifactId: string) {
  if (stageKey === "upload") return artifact.sampleVideo.artifactId === artifactId;
  if (stageKey === "shotBoundary") return artifact.shotBoundaryAnalysis?.artifactId === artifactId;
  if (stageKey === "scriptSegment") return artifact.scriptSegmentAnalysis?.artifactId === artifactId;
  if (stageKey === "rhythmStructure") return artifact.rhythmStructureAnalysis?.artifactId === artifactId;
  if (stageKey === "packagingStructure") return artifact.packagingStructureAnalysis?.artifactId === artifactId;
  if (stageKey === "functionSlotAtomization") return artifact.functionSlotAtomizationAnalysis?.artifactId === artifactId;
  if (stageKey === "userMaterialTagger") return artifact.userMaterialPack?.artifactId === artifactId;
  if (stageKey === "aggregate") return true;
  return true;
}

function buildDefaultStage(key: WorkflowStageState["key"], label: string): WorkflowStageState {
  return {
    key,
    stageName: key,
    label,
    status: "pending",
    attemptNo: 1,
    stageId: null,
    childJobId: null,
    childTraceId: null,
    artifactId: null,
    parentArtifactId: null,
    sampleVideoId: null,
    outputSummary: null,
    errorSummary: null,
  };
}
