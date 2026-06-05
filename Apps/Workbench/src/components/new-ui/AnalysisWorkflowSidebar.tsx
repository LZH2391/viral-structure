import { useState, type ReactNode } from "react";
import type { AnalysisHistoryItem } from "./analysisHistoryData";

type WorkflowStageStatus = "done" | "running" | "waiting" | "blocked";
type WorkflowStageKey =
  | "upload"
  | "shotBoundary"
  | "structureAnalysis"
  | "scriptSegment"
  | "rhythmStructure"
  | "packagingStructure"
  | "functionSlotAtomization"
  | "aggregate";

export type AnalysisDetailSidebarState = {
  visible: boolean;
  title: string;
  item: AnalysisHistoryItem | null;
};

type AnalysisWorkflowSidebarProps = {
  detail: AnalysisDetailSidebarState;
};

type WorkflowStage = {
  key: WorkflowStageKey;
  label: string;
  moduleLabel: string;
  dependencyLabel: string;
  status: WorkflowStageStatus;
};

type WorkflowStages = [
  WorkflowStage,
  WorkflowStage,
  WorkflowStage,
  WorkflowStage,
  WorkflowStage,
  WorkflowStage,
  WorkflowStage,
];

export function AnalysisWorkflowSidebar({ detail }: AnalysisWorkflowSidebarProps) {
  const stages = resolveWorkflowStages(detail.item);
  const [upload, shotBoundary, scriptSegment, rhythmStructure, packagingStructure, atomization, aggregate] = stages;
  const structureStatus = resolveGroupStatus([scriptSegment, rhythmStructure, packagingStructure]);
  const [selectedStageKey, setSelectedStageKey] = useState<WorkflowStageKey>("upload");

  return (
    <section className="new-ui-analysis-workflow" aria-label="完整分析总览">
      <div className="new-ui-analysis-workflow-flow">
        <h2 className="new-ui-analysis-workflow-title">分析流程</h2>
        <ol className="new-ui-analysis-workflow-list">
          <WorkflowStep stage={upload} connectorDone={upload.status === "done"} selected={selectedStageKey === upload.key} onSelect={setSelectedStageKey} />
          <WorkflowStep stage={shotBoundary} connectorDone={shotBoundary.status === "done"} selected={selectedStageKey === shotBoundary.key} onSelect={setSelectedStageKey} />
          <WorkflowStep
            stage={{
              key: "structureAnalysis",
              label: "结构分析",
              moduleLabel: "",
              dependencyLabel: "",
              status: structureStatus,
            }}
            connectorDone={structureStatus === "done"}
            selected={selectedStageKey === "structureAnalysis"}
            onSelect={setSelectedStageKey}
          >
            <div className="new-ui-analysis-workflow-parallel" aria-label="结构分析并行子任务">
              <ParallelStage stage={scriptSegment} selected={selectedStageKey === scriptSegment.key} onSelect={setSelectedStageKey} />
              <ParallelStage stage={rhythmStructure} selected={selectedStageKey === rhythmStructure.key} onSelect={setSelectedStageKey} />
              <ParallelStage stage={packagingStructure} selected={selectedStageKey === packagingStructure.key} onSelect={setSelectedStageKey} />
            </div>
          </WorkflowStep>
          <WorkflowStep stage={atomization} connectorDone={atomization.status === "done"} selected={selectedStageKey === atomization.key} onSelect={setSelectedStageKey} />
          <WorkflowStep stage={aggregate} isLast selected={selectedStageKey === aggregate.key} onSelect={setSelectedStageKey} />
        </ol>
      </div>
      <WorkflowDetailPanel selectedStageKey={selectedStageKey} />
    </section>
  );
}

function WorkflowStep({
  stage,
  connectorDone = false,
  isLast = false,
  selected,
  onSelect,
  children,
}: {
  stage: WorkflowStage;
  connectorDone?: boolean;
  isLast?: boolean;
  selected: boolean;
  onSelect: (stageKey: WorkflowStageKey) => void;
  children?: ReactNode;
}) {
  return (
    <li className={`new-ui-analysis-workflow-step is-${stage.status} ${selected ? "is-selected" : ""}`.trim()} data-stage={stage.key}>
      <div className="new-ui-analysis-workflow-connector" aria-hidden="true">
        <span className="new-ui-analysis-workflow-status-dot" />
        <span className={`new-ui-analysis-workflow-vline ${connectorDone ? "is-done" : ""} ${isLast ? "is-hidden" : ""}`.trim()} />
      </div>
      <div className="new-ui-analysis-workflow-step-body">
        <button
          className="new-ui-analysis-workflow-step-button"
          type="button"
          aria-pressed={selected}
          title={`查看或调整${stage.label}详情`}
          onClick={() => onSelect(stage.key)}
        >
          <span className="new-ui-analysis-workflow-step-copy">
            <span className="new-ui-analysis-workflow-step-label">{stage.label}</span>
            <span className="new-ui-analysis-workflow-badge">{statusLabel(stage.status)}</span>
          </span>
          <span className="new-ui-analysis-workflow-affordance" aria-hidden="true">
            <svg viewBox="0 0 16 16" focusable="false">
              <path d="M6.2 4.4 9.8 8l-3.6 3.6" />
            </svg>
          </span>
        </button>
        {children}
      </div>
    </li>
  );
}

function ParallelStage({ stage, selected, onSelect }: { stage: WorkflowStage; selected: boolean; onSelect: (stageKey: WorkflowStageKey) => void }) {
  return (
    <button
      className={`new-ui-analysis-workflow-parallel-item is-${stage.status} ${selected ? "is-selected" : ""}`.trim()}
      type="button"
      aria-pressed={selected}
      title={`查看或调整${stage.label}详情`}
      onClick={() => onSelect(stage.key)}
    >
      <span className="new-ui-analysis-workflow-parallel-label">
        {stage.status === "running" ? <span className="new-ui-analysis-workflow-spinner" aria-hidden="true" /> : <span className="new-ui-analysis-workflow-mini-dot" aria-hidden="true" />}
        <span>{stage.label}</span>
      </span>
    </button>
  );
}

function WorkflowDetailPanel({ selectedStageKey }: { selectedStageKey: WorkflowStageKey }) {
  return (
    <section className="new-ui-analysis-workflow-detail" aria-label={`${stageTitle(selectedStageKey)}详情区域`} data-selected-stage={selectedStageKey}>
      <h2 className="new-ui-analysis-workflow-detail-title">详细信息</h2>
      <div className="new-ui-analysis-workflow-detail-content" />
    </section>
  );
}

function resolveWorkflowStages(item: AnalysisHistoryItem | null): WorkflowStages {
  const artifact = item?.artifact;
  const sampleRunning = isRunningStatus(item?.sample.status);
  const uploadDone = Boolean(item);
  const shotDone = Boolean(artifact?.shotBoundaryAnalysis);
  const scriptDone = Boolean(artifact?.scriptSegmentAnalysis);
  const rhythmDone = Boolean(artifact?.rhythmStructureAnalysis);
  const packagingDone = Boolean(artifact?.packagingStructureAnalysis);
  const atomizationDone = Boolean(artifact?.functionSlotAtomizationAnalysis);
  const structureDone = scriptDone && rhythmDone && packagingDone;

  return [
    {
      key: "upload",
      label: "上传素材",
      moduleLabel: "sample-ingest",
      dependencyLabel: "起点",
      status: statusFor({ done: uploadDone, dependenciesDone: true, running: sampleRunning }),
    },
    {
      key: "shotBoundary",
      label: "切镜",
      moduleLabel: "shot-boundary",
      dependencyLabel: "依赖：上传素材",
      status: statusFor({ done: shotDone, dependenciesDone: uploadDone, running: sampleRunning }),
    },
    {
      key: "scriptSegment",
      label: "脚本段落",
      moduleLabel: "script-segments",
      dependencyLabel: "依赖：切镜",
      status: statusFor({ done: scriptDone, dependenciesDone: shotDone, running: sampleRunning }),
    },
    {
      key: "rhythmStructure",
      label: "节奏结构",
      moduleLabel: "rhythm-structure",
      dependencyLabel: "依赖：切镜",
      status: statusFor({ done: rhythmDone, dependenciesDone: shotDone, running: sampleRunning }),
    },
    {
      key: "packagingStructure",
      label: "包装结构",
      moduleLabel: "packaging-structure",
      dependencyLabel: "依赖：切镜",
      status: statusFor({ done: packagingDone, dependenciesDone: shotDone, running: sampleRunning }),
    },
    {
      key: "functionSlotAtomization",
      label: "功能槽位原子化",
      moduleLabel: "function-slot-atomization",
      dependencyLabel: "依赖：脚本 + 节奏 + 包装",
      status: statusFor({ done: atomizationDone, dependenciesDone: structureDone, running: sampleRunning }),
    },
    {
      key: "aggregate",
      label: "汇总",
      moduleLabel: "workflow.aggregate",
      dependencyLabel: "依赖：功能槽位原子化",
      status: statusFor({ done: atomizationDone, dependenciesDone: atomizationDone, running: sampleRunning }),
    },
  ];
}

function statusFor({ done, dependenciesDone, running }: { done: boolean; dependenciesDone: boolean; running: boolean }): WorkflowStageStatus {
  if (done) return "done";
  if (!dependenciesDone) return "blocked";
  return running ? "running" : "waiting";
}

function resolveGroupStatus(stages: WorkflowStage[]): WorkflowStageStatus {
  if (stages.every((stage) => stage.status === "done")) return "done";
  if (stages.some((stage) => stage.status === "running")) return "running";
  if (stages.every((stage) => stage.status === "blocked")) return "blocked";
  return "waiting";
}

function statusLabel(status: WorkflowStageStatus) {
  if (status === "done") return "已完成";
  if (status === "running") return "处理中";
  if (status === "blocked") return "等待依赖";
  return "等待中";
}

function stageTitle(stageKey: WorkflowStageKey) {
  if (stageKey === "upload") return "上传素材";
  if (stageKey === "shotBoundary") return "切镜";
  if (stageKey === "structureAnalysis") return "结构分析";
  if (stageKey === "scriptSegment") return "脚本段落";
  if (stageKey === "rhythmStructure") return "节奏结构";
  if (stageKey === "packagingStructure") return "包装结构";
  if (stageKey === "functionSlotAtomization") return "功能槽位原子化";
  return "汇总";
}

function isRunningStatus(status: string | null | undefined) {
  return ["queued", "pending", "running", "processing", "waiting", "blocked", "cache_waiting"].includes(String(status ?? "").toLowerCase());
}
