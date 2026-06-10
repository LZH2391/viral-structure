import type { AgentChatConversation } from "../../types";
import { RESTRUCTURE_CONVERSATION_ERROR_STORAGE_KEY } from "./NewUiLayoutTypes";

export function resolveConversationTitle(conversation: AgentChatConversation, index: number) { return conversation.title?.trim() || `会话 ${index + 1}`; }

export function createRestructureDraftId() { return `draft-restructure-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; }

export function mergeConversationPages(current: AgentChatConversation[], nextPage: AgentChatConversation[]) { if (!nextPage.length)
    return current; const nextById = new Map(nextPage.map((conversation) => [conversation.conversationId, conversation])); const merged = current.map((conversation) => nextById.get(conversation.conversationId) ?? conversation); const seen = new Set(merged.map((conversation) => conversation.conversationId)); nextPage.forEach((conversation) => { if (seen.has(conversation.conversationId))
    return; seen.add(conversation.conversationId); merged.push(conversation); }); return merged; }

export function formatConversationUpdatedAgo(value: string | null | undefined, nowMs: number) { const timestamp = Date.parse(value ?? ""); if (!Number.isFinite(timestamp))
    return null; const elapsedMs = Math.max(0, nowMs - timestamp); const minuteMs = 60000; const hourMs = 60 * minuteMs; const dayMs = 24 * hourMs; if (elapsedMs < hourMs)
    return `${Math.max(1, Math.floor(elapsedMs / minuteMs))}分`; if (elapsedMs < dayMs)
    return `${Math.max(1, Math.floor(elapsedMs / hourMs))}小时`; return `${Math.max(1, Math.floor(elapsedMs / dayMs))}天`; }

export function isTerminalAgentTurnStatus(status: string | null | undefined) { const normalized = String(status ?? "").toLowerCase(); if (!normalized)
    return false; return ["completed", "complete", "failed", "error", "errored", "cancelled", "canceled"].includes(normalized); }

export function readStoredRestructureConversationErrors() { try {
    const parsed = JSON.parse(window.localStorage.getItem(RESTRUCTURE_CONVERSATION_ERROR_STORAGE_KEY) ?? "null");
    if (!parsed || typeof parsed !== "object")
        return {};
    return Object.fromEntries(Object.entries(parsed).filter(([key, value]) => key.trim() && typeof value === "string" && value.trim()).map(([key, value]) => [key, normalizeRestructureSendError(String(value))]));
}
catch {
    return {};
} }

export function writeStoredRestructureConversationErrors(errors: Record<string, string>) { try {
    const entries = Object.entries(errors).filter(([key, value]) => key.trim() && value.trim()).map(([key, value]) => [key, normalizeRestructureSendError(value)]);
    if (!entries.length) {
        window.localStorage.removeItem(RESTRUCTURE_CONVERSATION_ERROR_STORAGE_KEY);
        return;
    }
    window.localStorage.setItem(RESTRUCTURE_CONVERSATION_ERROR_STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
}
catch { } }

export function formatRestructureConversationError(error: unknown) { if (error instanceof Error && error.message.trim())
    return normalizeRestructureSendError(error.message.trim()); return "发送失败，请稍后重试"; }

export function normalizeRestructureSendError(message: string) { const trimmed = message.trim() || "发送失败，请稍后重试"; return trimmed.replace(/[。.\s]*请开启新对话\s*$/, "") || "发送失败，请稍后重试"; }
