import type { AgentChatConversation, AgentChatDialogueRoboticReview, AgentChatSlotAtomDisplay, AgentTurnTimeline, ThreadConversation, ThreadPoolRoleSummary } from "../../types";
import type { AgentChatSessionResponse, AgentChatTurnResponse } from "../../api/client";
import { extractRestructureFinalPath, normalizeRestructureFinalPath } from "../../utils/restructurePath";

export type ChatMode = "direct" | "threadpool-role";
export type RightPanelTab = "timeline" | "slotAtom";
export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  status?: "running" | "completed" | "failed" | "canceled";
  slotAtomDisplay?: AgentChatSlotAtomDisplay | null;
  dialogueRoboticReview?: AgentChatDialogueRoboticReview | null;
};
export type PendingAgentChatSend = {
  text: string;
  role: string;
  userMessageId: string;
  generation: number;
};

export function normalizeActiveMessage(value: unknown) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "text" in value) return String((value as { text?: unknown }).text ?? "");
  return "";
}

export function isTerminalStatus(status: string | null | undefined) {
  return ["completed", "complete", "failed", "cancelled", "canceled"].includes(String(status ?? "").toLowerCase());
}

export function toChatMessageStatus(status: string | null | undefined): ChatMessage["status"] {
  const value = String(status ?? "").trim().toLowerCase();
  if (value === "canceled" || value === "cancelled") return "canceled";
  if (value === "failed" || value === "error" || value === "errored") return "failed";
  return isTerminalStatus(value) ? "completed" : "running";
}

export function messagesFromConversation(conversation: AgentChatConversation): ChatMessage[] {
  return (conversation.messages ?? []).map((message) => ({
    id: message.id,
    role: message.role,
    text: message.text,
    status: message.status ?? "completed",
    slotAtomDisplay: message.slotAtomDisplay ?? null,
    dialogueRoboticReview: message.dialogueRoboticReview ?? null,
  }));
}

export function isAssistantTurnRunning(messages: ChatMessage[], turnId: string | null) {
  if (!turnId) return false;
  return messages.some((message) => (
    message.id === `assistant-${turnId}`
    && message.role === "assistant"
    && message.status === "running"
  ));
}

export function messagesFromThreadConversation(conversation: ThreadConversation): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (const turn of conversation.turns ?? []) {
    if (isAgentChatBootstrapTurn(turn)) continue;
    if (turn.inputSummary) {
      messages.push({
        id: `user-${turn.turnId}`,
        role: "user",
        text: turn.inputSummary,
        status: "completed",
      });
    }
    const threadMessages = turn.threadMessages ?? [];
    const assistantText = turn.finalMessage || threadMessages[threadMessages.length - 1]?.text || null;
    if (assistantText) {
      messages.push({
        id: `assistant-${turn.turnId}`,
        role: "assistant",
        text: assistantText,
        status: isTerminalStatus(turn.status) ? "completed" : "running",
      });
    }
  }
  return messages;
}

export function latestVisibleTurnId(turns: ThreadConversation["turns"] = []) {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (!isAgentChatBootstrapTurn(turn)) return turn.turnId ?? null;
  }
  return null;
}

export function isAgentChatBootstrapTurn(turn: NonNullable<ThreadConversation["turns"]>[number]) {
  const inputText = String(turn.inputSummary ?? "").trim();
  const finalText = String(turn.finalMessage ?? "").trim();
  return Boolean(
    inputText.includes("初始化阶段阅读")
    || inputText.includes("你是功能槽位结构重组对话 Agent")
    || (finalText === "已就绪" && inputText.includes("Agent"))
  );
}

export function uniqueId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function resolveActiveSlotAtomDisplay(messages: ChatMessage[], currentTurnId: string | null) {
  const current = currentTurnId
    ? messages.find((message) => message.id === `assistant-${currentTurnId}` && message.slotAtomDisplay)?.slotAtomDisplay ?? null
    : null;
  if (current) return current;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const display = messages[index].slotAtomDisplay;
    if (display) return display;
  }
  return null;
}

export function resolveActiveDialogueReview(messages: ChatMessage[], currentTurnId: string | null) {
  const current = currentTurnId
    ? messages.find((message) => message.id === `assistant-${currentTurnId}` && message.dialogueRoboticReview)?.dialogueRoboticReview ?? null
    : null;
  if (current) return current;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const review = messages[index].dialogueRoboticReview;
    if (review) return review;
  }
  return null;
}

export function attachDialogueReviewToMessages(messages: ChatMessage[], currentTurnId: string | null, review: AgentChatDialogueRoboticReview | null): ChatMessage[] {
  if (!review) return messages;
  const targetId = currentTurnId ? `assistant-${currentTurnId}` : null;
  const targetIndex = targetId ? messages.findIndex((message) => message.id === targetId) : -1;
  if (targetIndex >= 0) {
    return messages.map((message, index) => index === targetIndex ? { ...message, dialogueRoboticReview: review } : message);
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "assistant") {
      return messages.map((message, cursor) => cursor === index ? { ...message, dialogueRoboticReview: review } : message);
    }
  }
  return [...messages, {
    id: uniqueId("assistant-dialogue-review"),
    role: "assistant",
    text: "台词机器人感审查已完成",
    status: "completed",
    dialogueRoboticReview: review,
  }];
}

export function appendAutoDialogueReworkMessages(
  messages: ChatMessage[],
  rework: NonNullable<AgentChatTurnResponse["autoDialogueRework"]>,
  turnId: string,
): ChatMessage[] {
  const next = [...messages];
  if (!next.some((message) => message.id === `user-${turnId}`)) {
    next.push({
      id: `user-${turnId}`,
      role: "user",
      text: rework.userTurnText ?? "根据台词机器人感审查结果返工当前 Shot 设计台词。",
      status: "completed",
    });
  }
  if (!next.some((message) => message.id === `assistant-${turnId}`)) {
    next.push({
      id: `assistant-${turnId}`,
      role: "assistant",
      text: "生成中",
      status: "running",
    });
  }
  return next;
}

export function buildConfirmationId(turnId: string | null) {
  const suffix = String(turnId ?? "turn").replace(/[^A-Za-z0-9_.-]+/g, "").slice(-8) || "turn";
  return `confirm_${suffix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function resolveCurrentRestructureFinalPath({
  messages,
  currentTurnId,
  confirmedPlan,
}: {
  messages: ChatMessage[];
  currentTurnId: string | null;
  confirmedPlan: AgentChatConversation["confirmedPlan"];
}) {
  const reversed = [...messages].reverse();
  const currentAssistantPath = normalizeRestructureFinalPath(extractRestructureFinalPath(
    reversed.find((message) => message.id === `assistant-${currentTurnId}`)?.text,
  ));
  if (currentAssistantPath) return currentAssistantPath;
  for (const message of reversed) {
    if (message.role !== "assistant") continue;
    const path = normalizeRestructureFinalPath(extractRestructureFinalPath(message.text));
    if (path) return path;
  }
  return normalizeRestructureFinalPath(confirmedPlan?.sourceRestructurePath);
}

export function resolveCurrentShotDesignFinalPath(messages: ChatMessage[], currentTurnId: string | null) {
  const reversed = [...messages].reverse();
  const currentAssistantPath = normalizeShotDesignFinalPath(extractShotDesignFinalPath(
    reversed.find((message) => message.id === `assistant-${currentTurnId}`)?.text,
  ));
  if (currentAssistantPath) return currentAssistantPath;
  for (const message of reversed) {
    if (message.dialogueRoboticReview?.shotDesignFinalPath) return normalizeShotDesignFinalPath(message.dialogueRoboticReview.shotDesignFinalPath);
    if (message.role !== "assistant") continue;
    const path = normalizeShotDesignFinalPath(extractShotDesignFinalPath(message.text));
    if (path) return path;
  }
  return null;
}

export function extractShotDesignFinalPath(text?: string | null) {
  const value = String(text ?? "");
  const saved = value.match(/保存路径[：:]\s*`([^`]+shot-design\.final\.md)`/i);
  if (saved?.[1]) return saved[1];
  const artifactPath = value.match(/(Artifacts[\\/]+FunctionSlotRestructure[^\n`]*?shot-design\.final\.md)/i);
  if (artifactPath?.[1]) return artifactPath[1];
  const absolutePath = value.match(/([A-Za-z]:[\\/][^\n`)]*?shot-design\.final\.md)/i);
  return absolutePath?.[1] ?? null;
}

export function normalizeShotDesignFinalPath(pathText?: string | null) {
  const text = String(pathText ?? "").trim();
  if (!text) return null;
  const normalized = text.replace(/\\/g, "/").replace(/^\/*[A-Za-z]:\//, "");
  const marker = "Artifacts/FunctionSlotRestructure/";
  const index = normalized.indexOf(marker);
  return index >= 0 ? normalized.slice(index) : normalized;
}

export function buildDialogueReworkPreview(review: AgentChatDialogueRoboticReview) {
  return [
    "根据台词机器人感审查结果返工当前 Shot 设计台词。",
    review.shotDesignFinalPath ? `shot-design: ${review.shotDesignFinalPath}` : null,
    review.reviewOutputPath ? `review: ${review.reviewOutputPath}` : null,
    review.decision ? `decision: ${review.decision}` : null,
  ].filter(Boolean).join("\n");
}

export function normalizeConversationRevision(value: unknown) {
  const revision = Number(value);
  return Number.isFinite(revision) && revision > 0 ? Math.floor(revision) : null;
}

export function buildContextUsageKey(threadId: string, usage: NonNullable<AgentTurnTimeline["activity"]["tokenUsage"]>) {
  return [
    threadId,
    usage.inputTokens ?? "input_unknown",
    usage.modelContextWindow ?? "window_unknown",
    usage.contextThresholdTokens ?? "threshold_unknown",
  ].join(":");
}

export function isConversationConflictError(error: unknown) {
  const apiError = error as { statusCode?: unknown; code?: unknown } | null;
  if (!apiError || typeof apiError !== "object") return false;
  return apiError.statusCode === 409 || String(apiError.code ?? "").includes("conversation_revision_conflict") || String(apiError.code ?? "").includes("conversation_archived");
}

export function isThreadPoolWarmingError(error: unknown) {
  const apiError = error as { code?: unknown; retryable?: unknown; message?: unknown } | null;
  if (!apiError || typeof apiError !== "object") return false;
  const code = String(apiError.code ?? "");
  const message = String(apiError.message ?? "");
  return code === "threadpool_warming" || (Boolean(apiError.retryable) && message.includes("warming"));
}

export function isThreadPoolRoleReady(role?: ThreadPoolRoleSummary | null) {
  if (!role) return false;
  return Boolean(role.canAcquire) && role.readyForLeases !== false && !role.warming && !role.recovering && !role.seedMissing;
}

export function agentChatSessionError(session: AgentChatSessionResponse) {
  const error = new Error(session.message || "Agent 会话创建失败") as Error & { code?: string; retryable?: boolean | null };
  error.code = session.error || "agent_chat_session_failed";
  error.retryable = session.retryable ?? null;
  return error;
}
