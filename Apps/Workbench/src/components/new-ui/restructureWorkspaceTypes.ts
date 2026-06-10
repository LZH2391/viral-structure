import type { AgentChatMaterialPackRef, AgentChatStructureRef } from "../../api/client";
import type { AgentChatMessageSnapshot, AgentTimelineItem } from "../../types";

export type NewUiTurnTimelineTarget = {
  threadId?: string | null;
  turnId?: string | null;
  workspaceRoot?: string | null;
  running?: boolean;
  pending?: boolean;
};

export type NewUiPendingStoryboardConfirmation = {
  conversationId?: string | null;
  messageId?: string | null;
  confirmationId?: string | null;
  sourceRestructurePath?: string | null;
  sourceShotDesignPath?: string | null;
};

export type NewUiRestructureSendContext = {
  materialPackRef?: AgentChatMaterialPackRef | null;
  structureRef?: AgentChatStructureRef | null;
};

export type NewUiMaterialPackOption = AgentChatMaterialPackRef & {
  coverUrl?: string | null;
  durationSeconds?: number | null;
  updatedAt?: string | null;
  uploadKey?: string | null;
  pending?: boolean;
  failed?: boolean;
  errorMessage?: string | null;
  cancelled?: boolean;
};

export type NewUiStructureOption = AgentChatStructureRef & {
  updatedAt?: string | null;
};

export type RestructureTimelineActivityItem = {
  id: string;
  sourceKey: string;
  kind: "reasoning" | "context_compacting" | "context_compacted" | "tool_call" | "dialogue_review" | "material_gap_matrix";
  label: string;
  detail: string | null;
  status: AgentTimelineItem["status"];
};

export type RestructureTimelineAgentMessageItem = {
  id: string;
  sourceKey: string;
  kind: "agent_message";
  text: string;
  status: AgentTimelineItem["status"];
};

export type RestructureTimelineDisplayItem = RestructureTimelineActivityItem | RestructureTimelineAgentMessageItem;
export type RestructureTimelineStreamableItem =
  | (RestructureTimelineActivityItem & { detail: string })
  | RestructureTimelineAgentMessageItem;
export type RestructureMessageRenderItem =
  | { kind: "message"; message: AgentChatMessageSnapshot }
  | { kind: "process_group"; id: string; messages: AgentChatMessageSnapshot[] };
export type RestructureNotePillTone = "neutral" | "success" | "warning" | "danger";
export type RestructureNotePillIcon = "slot" | "atom" | "check" | "review" | "rework" | "issue" | "trace" | "confirm" | "rerun";
export type ConfirmedPlanStatusDisplay = { label: string; status: AgentTimelineItem["status"] };
