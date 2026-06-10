import { useRef } from "react";
import type { AgentChatConversation, AgentChatMessageSnapshot, AgentTurnTimeline } from "../../types";
import type { NewUiTurnTimelineTarget } from "./restructureWorkspaceTypes";

export function resolveRestructureTitle(title: string | null | undefined) {
  const trimmed = title?.trim() ?? "";
  if (!trimmed) return "重组";
  if (/^function-slot-restructure(?:\s+\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2}:\d{2})?)?$/i.test(trimmed)) return "重组";
  return trimmed.replace(/\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}$/, "");
}

export function resolveSendErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return normalizeSendErrorMessage(error.message.trim());
  return "发送失败，请稍后重试";
}

function normalizeSendErrorMessage(message: string) {
  const trimmed = message.trim() || "发送失败，请稍后重试";
  return trimmed.replace(/[。.\s]*请开启新对话\s*$/, "") || "发送失败，请稍后重试";
}

export function hasRealUserMessageForPending(pending: AgentChatMessageSnapshot, messages: AgentChatMessageSnapshot[]) {
  return messages.some((message) => (
    message.role === "user"
    && (
      message.id === pending.id
      || (Boolean(pending.turnId) && message.turnId === pending.turnId)
    )
  ));
}

export function isNearScrollBottom(element: HTMLElement) {
  return element.scrollHeight - element.scrollTop - element.clientHeight < 80;
}

export function resolveContextUsageFallbackTarget(conversation: AgentChatConversation | null, activeTarget: NewUiTurnTimelineTarget | null): NewUiTurnTimelineTarget | null {
  const activeThreadId = activeTarget?.threadId?.trim() ?? "";
  const activeTurnId = activeTarget?.turnId?.trim() ?? "";
  const threadId = conversation?.threadId?.trim() ?? "";
  const turnId = resolveConversationLatestTurnId(conversation);
  if (!threadId || !turnId) return null;
  if (activeThreadId === threadId && activeTurnId === turnId) return null;
  return {
    threadId,
    turnId,
    workspaceRoot: conversation?.workspaceRoot ?? null,
    running: false,
  };
}

function resolveConversationLatestTurnId(conversation: AgentChatConversation | null) {
  const explicit = conversation?.latestTurnId?.trim();
  if (explicit) return explicit;
  const latestMessage = [...(conversation?.messages ?? [])].reverse().find((message) => message.turnId?.trim());
  return latestMessage?.turnId?.trim() || null;
}

export function useLastKnownContextUsage(usage: AgentTurnTimeline["activity"]["tokenUsage"] | null, scopeKey: string | null) {
  const lastRef = useRef<{ scopeKey: string | null; usage: AgentTurnTimeline["activity"]["tokenUsage"] | null }>({ scopeKey: null, usage: null });
  if (lastRef.current.scopeKey !== scopeKey) {
    lastRef.current = { scopeKey, usage: null };
  }
  if (hasKnownContextUsage(usage)) {
    lastRef.current = { scopeKey, usage };
    return usage;
  }
  return lastRef.current.usage;
}

function hasKnownContextUsage(usage: AgentTurnTimeline["activity"]["tokenUsage"] | null): usage is NonNullable<AgentTurnTimeline["activity"]["tokenUsage"]> {
  return typeof usage?.contextUsageRatio === "number" && Number.isFinite(usage.contextUsageRatio);
}

export function isThinkingStatus(status: AgentChatMessageSnapshot["status"] | undefined) {
  return String(status ?? "").toLowerCase() === "running";
}

export function normalizeTimelineText(value: string | null | undefined) {
  const trimmed = String(value ?? "").trim();
  return trimmed || null;
}

export function sanitizeDomId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-") || "unknown";
}

export function hasRenderableAssistantText(text: string | null | undefined) {
  const normalized = String(text ?? "").trim();
  if (!normalized) return false;
  return !["正在思考", "正在评估替换", "生成中"].includes(normalized);
}
