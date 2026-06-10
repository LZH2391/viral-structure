import type { AnalysisHistoryItem } from "./analysisHistoryData";
import type { WorkflowStage, WorkflowStageKey, WorkflowStageStatus, WorkflowStages } from "./analysisWorkflowModel";

export function resolveWorkflowStages(item: AnalysisHistoryItem | null): WorkflowStages {
  const artifact = item?.artifact;
  const workflowStages = item?.workflowRun?.stages ?? [];
  const materialMode = isMaterialRecognitionItem(item);
  const sampleRunning = Boolean(item?.isRunning) || isRunningStatus(item?.status);
  const uploadDone = Boolean(item);
  const shotDone = Boolean(artifact?.shotBoundaryAnalysis);
  const scriptDone = Boolean(artifact?.scriptSegmentAnalysis);
  const rhythmDone = Boolean(artifact?.rhythmStructureAnalysis);
  const packagingDone = Boolean(artifact?.packagingStructureAnalysis);
  const atomizationDone = Boolean(artifact?.functionSlotAtomizationAnalysis);
  const materialDone = Boolean(artifact?.userMaterialPack);
  const structureDone = scriptDone && rhythmDone && packagingDone;

  if (materialMode) {
    return [
      {
        key: "upload",
        label: "上传素材",
        moduleLabel: "sample-ingest",
        dependencyLabel: "起点",
        status: statusForStage("upload", { done: uploadDone, dependenciesDone: true, running: sampleRunning, workflowStages }),
      },
      {
        key: "shotBoundary",
        label: "切镜",
        moduleLabel: "shot-boundary",
        dependencyLabel: "依赖：上传素材",
        status: statusForStage("shotBoundary", { done: shotDone, dependenciesDone: uploadDone, running: sampleRunning, workflowStages }),
      },
      {
        key: "userMaterialTagger",
        label: "素材识别",
        moduleLabel: "user-material-tagger",
        dependencyLabel: "依赖：切镜",
        status: statusForStage("userMaterialTagger", { done: materialDone, dependenciesDone: shotDone, running: sampleRunning, workflowStages }),
      },
      {
        key: "aggregate",
        label: "汇总",
        moduleLabel: "workflow.aggregate",
        dependencyLabel: "依赖：素材识别",
        status: statusForStage("aggregate", { done: materialDone, dependenciesDone: materialDone, running: sampleRunning, workflowStages }),
      },
    ];
  }

  return [
    {
      key: "upload",
      label: "上传样例",
      moduleLabel: "sample-ingest",
      dependencyLabel: "起点",
      status: statusForStage("upload", { done: uploadDone, dependenciesDone: true, running: sampleRunning, workflowStages }),
    },
    {
      key: "shotBoundary",
      label: "切镜",
      moduleLabel: "shot-boundary",
      dependencyLabel: "依赖：上传素材",
      status: statusForStage("shotBoundary", { done: shotDone, dependenciesDone: uploadDone, running: sampleRunning, workflowStages }),
    },
    {
      key: "scriptSegment",
      label: "脚本段落",
      moduleLabel: "script-segments",
      dependencyLabel: "依赖：切镜",
      status: statusForStage("scriptSegment", { done: scriptDone, dependenciesDone: shotDone, running: sampleRunning, workflowStages }),
    },
    {
      key: "rhythmStructure",
      label: "节奏结构",
      moduleLabel: "rhythm-structure",
      dependencyLabel: "依赖：切镜",
      status: statusForStage("rhythmStructure", { done: rhythmDone, dependenciesDone: shotDone, running: sampleRunning, workflowStages }),
    },
    {
      key: "packagingStructure",
      label: "包装结构",
      moduleLabel: "packaging-structure",
      dependencyLabel: "依赖：切镜",
      status: statusForStage("packagingStructure", { done: packagingDone, dependenciesDone: shotDone, running: sampleRunning, workflowStages }),
    },
    {
      key: "functionSlotAtomization",
      label: "功能槽位原子化",
      moduleLabel: "function-slot-atomization",
      dependencyLabel: "依赖：脚本 + 节奏 + 包装",
      status: statusForStage("functionSlotAtomization", { done: atomizationDone, dependenciesDone: structureDone, running: sampleRunning, workflowStages }),
    },
    {
      key: "aggregate",
      label: "汇总",
      moduleLabel: "workflow.aggregate",
      dependencyLabel: "依赖：功能槽位原子化",
      status: statusForStage("aggregate", { done: atomizationDone, dependenciesDone: atomizationDone, running: sampleRunning, workflowStages }),
    },
  ];
}

function statusForStage(
  stageKey: WorkflowStageKey,
  {
    done,
    dependenciesDone,
    running,
    workflowStages,
  }: {
    done: boolean;
    dependenciesDone: boolean;
    running: boolean;
    workflowStages: NonNullable<AnalysisHistoryItem["workflowRun"]>["stages"];
  },
): WorkflowStageStatus {
  const workflowStage = workflowStages.find((stage) => stage.key === stageKey);
  const workflowStatus = workflowStageStatus(workflowStage?.status);
  if (done) return "done";
  if (workflowStatus) return workflowStatus;
  return statusFor({ done, dependenciesDone, running });
}

function statusFor({ done, dependenciesDone, running }: { done: boolean; dependenciesDone: boolean; running: boolean }): WorkflowStageStatus {
  if (done) return "done";
  if (!dependenciesDone) return "waiting";
  return running ? "running" : "waiting";
}

export function resolveGroupStatus(stages: WorkflowStage[]): WorkflowStageStatus {
  if (stages.every((stage) => stage.status === "done")) return "done";
  if (stages.some((stage) => stage.status === "failed")) return "failed";
  if (stages.some((stage) => stage.status === "canceled")) return "canceled";
  if (stages.some((stage) => stage.status === "running")) return "running";
  return "waiting";
}

export function statusLabel(status: WorkflowStageStatus) {
  if (status === "done") return "已完成";
  if (status === "running") return "处理中";
  if (status === "failed") return "失败";
  if (status === "canceled") return "已停止";
  return "等待中";
}

export function stageTitle(stageKey: WorkflowStageKey) {
  if (stageKey === "upload") return "上传素材";
  if (stageKey === "shotBoundary") return "切镜";
  if (stageKey === "structureAnalysis") return "结构分析";
  if (stageKey === "scriptSegment") return "脚本段落";
  if (stageKey === "rhythmStructure") return "节奏结构";
  if (stageKey === "packagingStructure") return "包装结构";
  if (stageKey === "userMaterialTagger") return "素材识别";
  if (stageKey === "functionSlotAtomization") return "功能槽位原子化";
  return "汇总";
}

export function workflowStageStatus(status: string | null | undefined): WorkflowStageStatus | null {
  const text = String(status ?? "").toLowerCase();
  if (!text || text === "pending") return null;
  if (text === "processed") return "done";
  if (text === "failed" || text === "partial_failed") return "failed";
  if (text === "canceled") return "canceled";
  if (["running", "processing", "waiting", "blocked", "cache_waiting"].includes(text)) return "running";
  return null;
}

function isRunningStatus(status: string | null | undefined) {
  return ["queued", "pending", "running", "processing", "waiting", "blocked", "cache_waiting"].includes(String(status ?? "").toLowerCase());
}

export function isMaterialRecognitionItem(item: AnalysisHistoryItem | null) {
  if (item?.artifact?.functionSlotAtomizationAnalysis || item?.hasFunctionSlotAtomization) return false;
  if (item?.workflowRun?.workflowKey === "material-recognition") return true;
  if (item?.workflowKey === "material-recognition") return true;
  return Boolean(item?.hasUserMaterialPack && !item.hasFunctionSlotAtomization);
}
