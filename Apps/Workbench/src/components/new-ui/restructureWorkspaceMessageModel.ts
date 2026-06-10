import type { AgentChatMessageSnapshot, AgentChatSlotAtomDisplay } from "../../types";
import type { RestructureMessageRenderItem, RestructureNotePillIcon, RestructureNotePillTone } from "./restructureWorkspaceTypes";
import { extractShotDesignFinalPath } from "./restructureWorkspaceStoryboard";
import { isThinkingStatus, normalizeTimelineText } from "./restructureWorkspaceUtils";

export function buildRestructureMessageRenderItems(messages: AgentChatMessageSnapshot[], timelineTurnId: string | null): RestructureMessageRenderItem[] {
  const result: RestructureMessageRenderItem[] = [];
  let pendingProcessMessages: AgentChatMessageSnapshot[] = [];
  const flushProcessMessages = () => {
    if (!pendingProcessMessages.length) return;
    result.push({
      kind: "process_group",
      id: createProcessMessageGroupId(pendingProcessMessages),
      messages: pendingProcessMessages,
    });
    pendingProcessMessages = [];
  };

  messages.forEach((message) => {
    if (isProcessOnlyAssistantMessage(message, timelineTurnId)) {
      pendingProcessMessages.push(message);
      return;
    }
    flushProcessMessages();
    result.push({ kind: "message", message });
  });
  flushProcessMessages();
  return result;
}

export function shouldInsertTimelineBeforeRenderItem(renderItem: RestructureMessageRenderItem, timelineInsertMessageId: string | null) {
  if (!timelineInsertMessageId) return false;
  if (renderItem.kind === "message") return renderItem.message.id === timelineInsertMessageId;
  return renderItem.messages.some((message) => message.id === timelineInsertMessageId);
}

export function hasTerminalAssistantMessageForProcessGroup(
  renderItem: Extract<RestructureMessageRenderItem, { kind: "process_group" }>,
  messages: AgentChatMessageSnapshot[],
) {
  const turnIds = new Set(renderItem.messages.map((message) => message.turnId).filter(Boolean));
  if (!turnIds.size) return true;
  return messages.some((message) => (
    message.role === "assistant"
    && Boolean(message.turnId && turnIds.has(message.turnId))
    && !isThinkingStatus(message.status)
    && resolveProcessMessageKind(message) === null
  ));
}

function isProcessOnlyAssistantMessage(message: AgentChatMessageSnapshot, timelineTurnId: string | null) {
  if (message.role !== "assistant") return false;
  if (message.slotAtomDisplay || message.dialogueRoboticReview) return false;
  if (timelineTurnId && message.turnId === timelineTurnId && isThinkingStatus(message.status)) return false;
  return resolveProcessMessageKind(message) !== null;
}

export function resolveProcessMessageKind(message: AgentChatMessageSnapshot) {
  if (message.dialogueRoboticReview) return "dialogue_review";
  if (message.materialGapMatrix) return "material_gap_matrix";
  const text = String(message.text ?? "").trim();
  if (/^reasoning\b/i.test(text)) return "reasoning";
  if (/^(?:tool call|tool_call|command|mcp tool|dynamic tool)\s*[:：]/i.test(text)) return "tool_call";
  if (/^上下文已压缩\b/.test(text) || /^context compacted\b/i.test(text)) return "context_compacted";
  if (/^(?:台词质检状态|台词审查状态|dialogue review status)\s*[:：]/i.test(text)) return "dialogue_review";
  return null;
}

function createProcessMessageGroupId(messages: AgentChatMessageSnapshot[]) {
  const first = messages[0];
  const last = messages[messages.length - 1];
  return `process-${first?.turnId ?? first?.id ?? "unknown"}-${last?.id ?? "last"}`;
}

export function formatProcessMessageLabel(message: AgentChatMessageSnapshot) {
  const kind = resolveProcessMessageKind(message);
  if (kind === "tool_call") {
    const text = String(message.text ?? "").trim();
    const match = text.match(/^(?:tool call|tool_call|command|mcp tool|dynamic tool)\s*[:：]\s*(.+)$/i);
    return match?.[1]?.trim() ? `Tool call: ${match[1].trim()}` : "Tool call";
  }
  if (kind === "context_compacted") return "上下文已压缩";
  if (kind === "dialogue_review") return "台词审查";
  if (kind === "material_gap_matrix") return "素材缺口";
  return "reasoning";
}

export function formatProcessMessageDetail(message: AgentChatMessageSnapshot) {
  const text = String(message.text ?? "").trim();
  const kind = resolveProcessMessageKind(message);
  if (kind === "reasoning") {
    return text.replace(/^reasoning\s*/i, "").trim() || "Reasoning";
  }
  if (kind === "dialogue_review") {
    const decision = message.dialogueRoboticReview?.decision ? formatDialogueReviewDecision(message.dialogueRoboticReview.decision) : null;
    const issueCount = message.dialogueRoboticReview?.issueCount ?? 0;
    if (message.dialogueRoboticReview) return decision ? `${decision} · ${issueCount} 项问题` : "等待审查";
    return text.replace(/^(?:台词质检状态|台词审查状态|dialogue review status)\s*[:：]\s*/i, "").trim()
      || (decision ? `${decision} · ${issueCount} 项问题` : "等待质检");
  }
  if (kind === "material_gap_matrix") {
    const summary = message.materialGapMatrix?.summary ?? {};
    const issueCount = (summary.missingCount ?? 0) + (summary.partialCount ?? 0) + (summary.unsafeCount ?? 0);
    const slotCount = summary.slotCount ?? message.materialGapMatrix?.rows?.length ?? 0;
    return `素材缺口矩阵已生成：${slotCount} 槽位 / ${issueCount} 需关注`;
  }
  return text.replace(/^(?:tool call|tool_call|command|mcp tool|dynamic tool)\s*[:：]\s*/i, "").trim() || text;
}

export function shouldShowSlotAtomDisplayPills(message: AgentChatMessageSnapshot) {
  if (!message.slotAtomDisplay) return false;
  if (message.dialogueRoboticReview) return false;
  if (extractShotDesignFinalPath(message.text)) return false;
  return true;
}

export function shouldRenderConversationMessage(
  message: AgentChatMessageSnapshot,
  options: { timelineTurnId: string | null; timelineHasAgentMessages: boolean },
) {
  if (
    message.role === "assistant"
    && message.status === "running"
    && message.turnId
    && message.turnId === options.timelineTurnId
    && options.timelineHasAgentMessages
    && !message.slotAtomDisplay
    && !message.dialogueRoboticReview
  ) {
    return false;
  }
  return true;
}

export function countSlotAtomDisplayAtoms(display: AgentChatSlotAtomDisplay) {
  const atoms = display.atoms ?? [];
  const count = atoms.reduce((total, atom) => (
    total
    + (atom.scriptAtom ? 1 : 0)
    + (atom.rhythmAtom ? 1 : 0)
    + (atom.packagingAtom ? 1 : 0)
  ), 0);
  return count || display.atomBindingCount || 0;
}

export function formatSlotAtomStatus(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "available") return "可用";
  if (normalized === "empty") return "为空";
  return value;
}

export function slotAtomStatusTone(value: string): RestructureNotePillTone {
  const normalized = value.trim().toLowerCase();
  if (normalized === "available") return "success";
  if (normalized === "empty") return "warning";
  return "neutral";
}

export function formatDialogueReviewDecision(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "pass") return "通过";
  if (normalized === "rework") return "返工";
  if (normalized === "blocked") return "阻塞";
  return value;
}

export function dialogueReviewDecisionTone(value: string): RestructureNotePillTone {
  const normalized = value.trim().toLowerCase();
  if (normalized === "pass") return "success";
  if (normalized === "rework") return "warning";
  if (normalized === "blocked") return "danger";
  return "neutral";
}

export function dialogueReviewDecisionIcon(value: string): RestructureNotePillIcon {
  return value.trim().toLowerCase() === "rework" ? "rework" : "check";
}

export function isDialogueReviewPassed(message: AgentChatMessageSnapshot) {
  return message.dialogueRoboticReview?.decision?.trim().toLowerCase() === "pass";
}

export function resolveMessagePlanTraceDisplay(message: AgentChatMessageSnapshot): AgentChatSlotAtomDisplay | null {
  const display = message.slotAtomDisplay;
  if (!display) return null;
  if (display.displayJsonPath) return display;
  const versionDisplays = display.versionDisplays?.filter(Boolean) ?? [];
  return versionDisplays.find((version) => version.versionId && version.versionId === display.defaultVersionId && version.displayJsonPath)
    ?? versionDisplays.find((version) => Boolean(version.displayJsonPath))
    ?? null;
}

export function resolveUserInputOriginDisplay(message: AgentChatMessageSnapshot) {
  if (message.role !== "user") return null;
  const origin = String(message.userInputOrigin ?? "").trim();
  if (origin === "manual_replacement") {
    return {
      label: "替换评估",
      tooltip: "这条输入来自右侧 Slot/Atom 替换面板，已提交给 Agent 做替换影响评估和重组。",
      icon: "rework" as const,
      tone: "warning" as const,
    };
  }
  if (origin === "auto_dialogue_rework") {
    return {
      label: "台词返工",
      tooltip: "这条输入由台词审查结果自动触发，用于让 Agent 按审查问题继续返工台词。",
      icon: "review" as const,
      tone: "warning" as const,
    };
  }
  if (origin === "auto_advance") {
    return {
      label: "自动推进",
      tooltip: "这条输入由自动推进触发，用于从已完成的槽位方案继续完善具体 Shot 设计。",
      icon: "confirm" as const,
      tone: "success" as const,
    };
  }
  if (origin === "material_context") {
    return {
      label: "附素材包",
      tooltip: "这条输入发送时附带了素材识别产出的 user-material-pack。",
      icon: "slot" as const,
      tone: "success" as const,
    };
  }
  if (origin === "structure_context") {
    return {
      label: "引用结构",
      tooltip: "这条输入发送时固定引用了一个样例结构，重组会基于 brief 做迁移处理。",
      icon: "trace" as const,
      tone: "warning" as const,
    };
  }
  if (origin === "material_and_structure_context") {
    return {
      label: "素材+结构",
      tooltip: "这条输入同时附带素材识别包，并固定引用了一个样例结构。",
      icon: "confirm" as const,
      tone: "success" as const,
    };
  }
  return null;
}
