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

  return (
    <section className="new-ui-analysis-workflow" aria-label="完整分析步骤">
      <div className="new-ui-analysis-workflow-flow">
        <WorkflowStageCard stage={upload} />
        <WorkflowConnector />
        <WorkflowStageCard stage={shotBoundary} />
        <WorkflowSplitConnector />

        <section className="new-ui-analysis-workflow-parallel" aria-label="结构分析并行组">
          <div className="new-ui-analysis-workflow-parallel-header">
            <strong>structure-analysis</strong>
          </div>
          <div className="new-ui-analysis-workflow-parallel-grid">
            <WorkflowStageCard compact stage={scriptSegment} />
            <WorkflowStageCard compact stage={rhythmStructure} />
            <WorkflowStageCard compact stage={packagingStructure} />
          </div>
        </section>

        <WorkflowMergeConnector />
        <WorkflowStageCard stage={atomization} />
        <WorkflowConnector />
        <WorkflowStageCard stage={aggregate} />
      </div>
    </section>
  );
}

function WorkflowStageCard({ stage, compact = false }: { stage: WorkflowStage; compact?: boolean }) {
  return (
    <article className={`new-ui-analysis-workflow-stage is-${stage.status} ${compact ? "is-compact" : ""}`.trim()}>
      <span className="new-ui-analysis-workflow-status-dot" aria-hidden="true" />
      <div className="new-ui-analysis-workflow-stage-main">
        <div className="new-ui-analysis-workflow-stage-topline">
          <h3>{stage.label}</h3>
          <span>{statusLabel(stage.status)}</span>
        </div>
        <p>{stage.moduleLabel}</p>
        <small>{stage.dependencyLabel}</small>
      </div>
    </article>
  );
}

function WorkflowConnector() {
  return <div className="new-ui-analysis-workflow-connector" aria-hidden="true" />;
}

function WorkflowSplitConnector() {
  return (
    <div className="new-ui-analysis-workflow-split" aria-hidden="true">
      <span />
    </div>
  );
}

function WorkflowMergeConnector() {
  return (
    <div className="new-ui-analysis-workflow-merge" aria-hidden="true">
      <span />
    </div>
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

function statusLabel(status: WorkflowStageStatus) {
  if (status === "done") return "已完成";
  if (status === "running") return "处理中";
  if (status === "blocked") return "等依赖";
  return "等待中";
}

function isRunningStatus(status: string | null | undefined) {
  return ["queued", "pending", "running", "processing", "waiting", "blocked", "cache_waiting"].includes(String(status ?? "").toLowerCase());
}
