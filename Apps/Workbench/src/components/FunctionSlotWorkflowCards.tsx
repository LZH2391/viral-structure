import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { autoRunShotStoryboardPrep, getProcessingJob, startFunctionSlotGovernanceRun, startFunctionSlotWorkflowPlaceholder, type FunctionSlotGovernanceRunResponse, type FunctionSlotWorkflowPlaceholderResponse } from "../api/client";
import type { AgentRunJob } from "../types";
import { shortId } from "../utils/format";
import { pollProcessingJob } from "../hooks/jobPolling";
import { AgentTurnTimelinePanel } from "./property-panel/AgentTurnTimeline";
import { readWorkbenchDraft, writeActiveSemanticGovernanceJob, writeActiveSemanticGovernanceJobSnapshot } from "../utils/workbenchDraft";
import type { ActiveJobDraft } from "../utils/workbenchHelpers";

type WorkflowKey = "semantic-governance" | "shot-storyboard-prep";

type FunctionSlotWorkflowCardsProps = {
  workflowKey?: WorkflowKey;
  sampleVideoId?: string | null;
  parentArtifactId?: string | null;
  onStatusChange?: (message: string) => void;
};

type CardState = {
  running: boolean;
  result: FunctionSlotWorkflowPlaceholderResponse | FunctionSlotGovernanceRunResponse | null;
  job: AgentRunJob | null;
  error: string | null;
};

const CARDS: Array<{
  key: WorkflowKey;
  title: string;
  agentName: string;
  description: string;
}> = [
  {
    key: "semantic-governance",
    title: "语义治理",
    agentName: "function-slot-library-builder",
    description: "刷新证据索引后运行真实语义治理。",
  },
  {
    key: "shot-storyboard-prep",
    title: "Shot Storyboard Prep",
    agentName: "shot-storyboard-prep",
    description: "占位入口：后续生成四格故事板 prompt。",
  },
];

export function FunctionSlotWorkflowCards({ workflowKey, sampleVideoId, parentArtifactId, onStatusChange }: FunctionSlotWorkflowCardsProps) {
  const [cardStates, setCardStates] = useState<Record<WorkflowKey, CardState>>(() => ({
    "semantic-governance": emptyState(),
    "shot-storyboard-prep": emptyState(),
  }));
  const restoredSemanticGovernanceRef = useRef(false);
  const visibleCards = workflowKey ? CARDS.filter((card) => card.key === workflowKey) : CARDS;

  useEffect(() => {
    if (workflowKey && workflowKey !== "semantic-governance") return;
    if (restoredSemanticGovernanceRef.current) return;
    restoredSemanticGovernanceRef.current = true;
    const draftJob = readWorkbenchDraft()?.activeSemanticGovernanceJob;
    if (!draftJob?.processingJobId) return;
    let active = true;
    setCardStates((current) => ({
      ...current,
      "semantic-governance": { ...current["semantic-governance"], running: true, job: draftJob.jobSnapshot ?? current["semantic-governance"].job, error: null },
    }));
    onStatusChange?.("恢复语义治理运行中");
    void attachSemanticGovernanceJob(draftJob, setCardStates, () => active)
      .then((job) => {
        if (!active) return;
        if (job?.status === "processed" || job?.status === "failed") writeActiveSemanticGovernanceJob(null);
        setCardStates((current) => ({
          ...current,
          "semantic-governance": {
            ...current["semantic-governance"],
            running: job ? !["processed", "failed"].includes(job.status) : false,
            job: job ?? current["semantic-governance"].job,
            error: job?.status === "failed" ? job.errorSummary?.message ?? "语义治理失败" : null,
          },
        }));
        if (job?.status === "processed") onStatusChange?.("语义治理已完成");
        if (job?.status === "failed") onStatusChange?.(job.errorSummary?.message ?? "语义治理失败");
      })
      .catch((error) => {
        if (!active) return;
        const message = error instanceof Error ? error.message : "恢复语义治理任务失败";
        setCardStates((current) => ({
          ...current,
          "semantic-governance": { ...current["semantic-governance"], running: false, error: message },
        }));
        onStatusChange?.(message);
      });
    return () => {
      active = false;
    };
  }, [onStatusChange, workflowKey]);

  const runWorkflow = async (workflowKey: WorkflowKey) => {
    setCardStates((current) => ({
      ...current,
      [workflowKey]: { ...current[workflowKey], running: true, error: null },
    }));
    onStatusChange?.(workflowKey === "semantic-governance" ? "语义治理运行中" : "功能槽位任务创建中");
    try {
      const result = workflowKey === "semantic-governance"
        ? await runSemanticGovernance(setCardStates)
        : workflowKey === "shot-storyboard-prep"
          ? await autoRunShotStoryboardPrep({
            sampleVideoId: sampleVideoId ?? "function-slot-workflow",
            parentArtifactId: parentArtifactId ?? null,
            restructureArtifactId: parentArtifactId ?? null,
          })
          : await startFunctionSlotWorkflowPlaceholder(workflowKey, {
            sampleVideoId: sampleVideoId ?? "function-slot-workflow",
            parentArtifactId: parentArtifactId ?? null,
          });
      setCardStates((current) => ({
        ...current,
        [workflowKey]: { ...current[workflowKey], running: false, result, error: null },
      }));
      onStatusChange?.(workflowKey === "semantic-governance" ? "语义治理已完成" : (result as FunctionSlotWorkflowPlaceholderResponse).message);
    } catch (error) {
      const message = error instanceof Error ? error.message : "占位任务创建失败";
      setCardStates((current) => ({
        ...current,
        [workflowKey]: { ...current[workflowKey], running: false, error: message },
      }));
      onStatusChange?.(message);
    }
  };

  return (
    <section className="property-section agent-run-panel" aria-label="功能槽位后续流程">
      <div className="section-heading">Agent</div>
      <div className="agent-trace-shell">
      {visibleCards.map((card) => {
        const state = cardStates[card.key];
        const statusText = card.key === "semantic-governance" && state.job
          ? renderGovernanceJobStatus(state.job)
          : state.running
            ? "placeholder / 40%"
          : state.result
            ? resultText(card.key, state.result)
            : card.description;
        if (card.key === "semantic-governance") {
          return (
            <AgentTurnTimelinePanel
              key={card.key}
              agentName={card.agentName}
              statusText={state.error ?? statusText}
              job={state.job}
              running={state.running}
              onRun={() => void runWorkflow(card.key)}
            />
          );
        }
        return (
          <article className="agent-summary-card" key={card.key}>
            <div className="agent-summary-top">
              <div>
                <strong>{card.agentName}</strong>
                <span>{statusText}</span>
              </div>
              <div className="agent-summary-actions">
                <span className="agent-status-badge">{state.result ? "占位完成" : state.running ? "创建中" : "未接入"}</span>
                <button className="primary-button" type="button" disabled={state.running} onClick={() => void runWorkflow(card.key)}>
                  {state.running ? "运行中" : "运行"}
                </button>
                <button className="ghost-button" type="button" disabled>
                  追踪
                </button>
              </div>
            </div>
            {state.result ? (
              <div className="agent-latest-activity">
                <span>占位产物</span>
                <strong>{activityText(card.key, state.result)}</strong>
              </div>
            ) : null}
            {state.error ? <div className="detail-hint">{state.error}</div> : null}
            {!state.result && !state.error ? <div className="detail-hint">当前是 ThreadPool 占位入口，真实执行链路稍后接入。</div> : null}
          </article>
        );
      })}
      </div>
    </section>
  );
}

function emptyState(): CardState {
  return { running: false, result: null, job: null, error: null };
}

async function runSemanticGovernance(setCardStates: Dispatch<SetStateAction<Record<WorkflowKey, CardState>>>) {
  const started = await startFunctionSlotGovernanceRun({ refreshEvidence: true });
  writeActiveSemanticGovernanceJob({
    processingJobId: started.processingJobId,
    sampleVideoId: started.sampleVideoId,
    traceId: started.traceId,
  });
  const finalJob = await attachSemanticGovernanceJob(started, setCardStates);
  setCardStates((current) => ({
    ...current,
    "semantic-governance": { ...current["semantic-governance"], job: finalJob ?? current["semantic-governance"].job },
  }));
  if (finalJob?.status === "failed") {
    writeActiveSemanticGovernanceJob(null);
    throw new Error(finalJob.errorSummary?.message ?? "语义治理失败");
  }
  if (finalJob?.status === "processed") writeActiveSemanticGovernanceJob(null);
  if (finalJob && finalJob.status !== "processed") {
    throw new Error("语义治理仍在运行或轮询超时，请打开追踪查看当前 Agent 状态");
  }
  return started;
}

async function attachSemanticGovernanceJob(
  jobDraft: Pick<ActiveJobDraft, "processingJobId" | "sampleVideoId" | "traceId">,
  setCardStates: Dispatch<SetStateAction<Record<WorkflowKey, CardState>>>,
  shouldUpdate: () => boolean = () => true,
) {
  if (!jobDraft.processingJobId) return null;
  return await pollProcessingJob(
    () => getProcessingJob(jobDraft.processingJobId).catch(() => null),
    {
      idleTimeoutMs: 30 * 60 * 1000,
      preservePreviousOnNull: true,
      onUpdate: (job) => {
        if (!shouldUpdate()) return;
        writeActiveSemanticGovernanceJobSnapshot(job);
        setCardStates((current) => ({
          ...current,
          "semantic-governance": { ...current["semantic-governance"], job },
        }));
      },
    },
  ) as AgentRunJob | null;
}

function resultText(workflowKey: WorkflowKey, result: FunctionSlotWorkflowPlaceholderResponse | FunctionSlotGovernanceRunResponse) {
  if (workflowKey === "semantic-governance") {
    const governance = result as FunctionSlotGovernanceRunResponse;
    return `治理完成 / trace ${shortId(governance.traceId)}`;
  }
  return `占位完成 / artifact ${shortId((result as FunctionSlotWorkflowPlaceholderResponse).artifactId)}`;
}

function activityText(workflowKey: WorkflowKey, result: FunctionSlotWorkflowPlaceholderResponse | FunctionSlotGovernanceRunResponse) {
  if (workflowKey === "semantic-governance") {
    const governance = result as FunctionSlotGovernanceRunResponse;
    return `trace ${shortId(governance.traceId)} · ${governance.artifactId ? shortId(governance.artifactId) : "governance"}`;
  }
  const placeholder = result as FunctionSlotWorkflowPlaceholderResponse;
  return `trace ${shortId(placeholder.traceId)} · artifact ${shortId(placeholder.artifactId)}`;
}

function renderGovernanceJobStatus(job: AgentRunJob | null) {
  if (!job) return "任务提交中";
  if (job.status === "failed") return "治理失败";
  if (job.status === "processed") return "治理完成";
  if (job.stage?.includes("evidence_refresh")) return "证据刷新中";
  if (job.stage?.includes("agent_analyze")) return "Agent 治理中";
  if (job.stage?.includes("validate")) return "校验中";
  if (job.stage?.includes("repair")) return "Agent 修复中";
  if (job.stage?.includes("materialize")) return "写回治理结果";
  return "治理运行中";
}
