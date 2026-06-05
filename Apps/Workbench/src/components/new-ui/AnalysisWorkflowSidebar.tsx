import type { ReactNode } from "react";
import type { AnalysisHistoryItem } from "./analysisHistoryData";

type WorkflowStageStatus = "done" | "running" | "waiting" | "blocked";

export type AnalysisDetailSidebarState = {
  visible: boolean;
  title: string;
  item: AnalysisHistoryItem | null;
};

type AnalysisWorkflowSidebarProps = {
  detail: AnalysisDetailSidebarState;
};

type WorkflowStage = {
  key: string;
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

  return (
    <section className="new-ui-analysis-workflow" aria-label="完整分析总览">
      <div className="new-ui-analysis-workflow-title">分析流程</div>
      <ol className="new-ui-analysis-workflow-list">
        <WorkflowStep stage={upload} connectorDone={upload.status === "done"} />
        <WorkflowStep stage={shotBoundary} connectorDone={shotBoundary.status === "done"} />
        <WorkflowStep
          stage={{
            key: "structureAnalysis",
            label: "结构分析",
            moduleLabel: "三路并行",
            dependencyLabel: "依赖：切镜",
            status: structureStatus,
          }}
          connectorDone={structureStatus === "done"}
        >
          <div className="new-ui-analysis-workflow-parallel" aria-label="结构分析并行子任务">
            <ParallelStage stage={scriptSegment} />
            <ParallelStage stage={rhythmStructure} />
            <ParallelStage stage={packagingStructure} />
          </div>
        </WorkflowStep>
        <WorkflowStep stage={atomization} connectorDone={atomization.status === "done"} />
        <WorkflowStep stage={aggregate} isLast />
      </ol>
    </section>
  );
}

function WorkflowStep({
  stage,
  connectorDone = false,
  isLast = false,
  children,
}: {
  stage: WorkflowStage;
  connectorDone?: boolean;
  isLast?: boolean;
  children?: ReactNode;
}) {
  return (
    <li className={`new-ui-analysis-workflow-step is-${stage.status}`}>
      <div className="new-ui-analysis-workflow-connector" aria-hidden="true">
        <span className="new-ui-analysis-workflow-status-dot" />
        <span className={`new-ui-analysis-workflow-vline ${connectorDone ? "is-done" : ""} ${isLast ? "is-hidden" : ""}`.trim()} />
      </div>
      <div className="new-ui-analysis-workflow-step-body">
        <div className="new-ui-analysis-workflow-step-label">{stage.label}</div>
        <div className="new-ui-analysis-workflow-step-sub">
          {stage.moduleLabel}
          {stage.dependencyLabel ? <span> · {stage.dependencyLabel}</span> : null}
        </div>
        <span className="new-ui-analysis-workflow-badge">{statusLabel(stage.status)}</span>
        {children}
      </div>
    </li>
  );
}

function ParallelStage({ stage }: { stage: WorkflowStage }) {
  return (
    <article className={`new-ui-analysis-workflow-parallel-item is-${stage.status}`}>
      <div className="new-ui-analysis-workflow-parallel-label">
        {stage.status === "running" ? <span className="new-ui-analysis-workflow-spinner" aria-hidden="true" /> : <span className="new-ui-analysis-workflow-mini-dot" aria-hidden="true" />}
        <span>{stage.label}</span>
      </div>
      <div className="new-ui-analysis-workflow-parallel-sub">{stage.moduleLabel}</div>
    </article>
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

function isRunningStatus(status: string | null | undefined) {
  return ["queued", "pending", "running", "processing", "waiting", "blocked", "cache_waiting"].includes(String(status ?? "").toLowerCase());
}
