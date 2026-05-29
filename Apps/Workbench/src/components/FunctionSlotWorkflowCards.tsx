import { useState } from "react";
import { startFunctionSlotWorkflowPlaceholder, type FunctionSlotWorkflowPlaceholderResponse } from "../api/client";
import { shortId } from "../utils/format";

type WorkflowKey = "semantic-governance" | "restructure" | "shot-storyboard-prep";

type FunctionSlotWorkflowCardsProps = {
  workflowKey?: WorkflowKey;
  sampleVideoId?: string | null;
  parentArtifactId?: string | null;
  onStatusChange?: (message: string) => void;
};

type CardState = {
  running: boolean;
  result: FunctionSlotWorkflowPlaceholderResponse | null;
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
    description: "占位入口：后续刷新治理 JSON 和图谱证据。",
  },
  {
    key: "restructure",
    title: "结构重组",
    agentName: "function-slot-restructure",
    description: "占位入口：后续提交 brief 并生成重组方案。",
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
    restructure: emptyState(),
    "shot-storyboard-prep": emptyState(),
  }));
  const visibleCards = workflowKey ? CARDS.filter((card) => card.key === workflowKey) : CARDS;

  const runPlaceholder = async (workflowKey: WorkflowKey) => {
    setCardStates((current) => ({
      ...current,
      [workflowKey]: { ...current[workflowKey], running: true, error: null },
    }));
    onStatusChange?.("功能槽位占位任务创建中");
    try {
      const result = await startFunctionSlotWorkflowPlaceholder(workflowKey, {
        sampleVideoId: sampleVideoId ?? "function-slot-workflow",
        parentArtifactId: parentArtifactId ?? null,
      });
      setCardStates((current) => ({
        ...current,
        [workflowKey]: { running: false, result, error: null },
      }));
      onStatusChange?.(result.message);
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
        const statusText = state.running
          ? "placeholder / 40%"
          : state.result
            ? `占位完成 / artifact ${shortId(state.result.artifactId)}`
            : card.description;
        return (
          <article className="agent-summary-card" key={card.key}>
            <div className="agent-summary-top">
              <div>
                <strong>{card.agentName}</strong>
                <span>{statusText}</span>
              </div>
              <div className="agent-summary-actions">
                <span className="agent-status-badge">{state.result ? "占位完成" : state.running ? "创建中" : "未接入"}</span>
                <button className="primary-button" type="button" disabled={state.running} onClick={() => void runPlaceholder(card.key)}>
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
                <strong>trace {shortId(state.result.traceId)} · artifact {shortId(state.result.artifactId)}</strong>
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
  return { running: false, result: null, error: null };
}
