const TEXT_PREVIEW_LIMIT = 240;
const LONG_TEXT_PREVIEW_LIMIT = 600;

function summarizeAgentTurnTimeline(thread, turnId) {
  const safeThread = thread && typeof thread === "object" ? thread : {};
  const turn = findTurn(safeThread, turnId);
  if (!turn) return null;
  const items = Array.isArray(turn.items) ? turn.items : [];
  const timeline = [];
  items.forEach((item, index) => {
    const entry = summarizeTurnItem(item, index);
    if (entry) timeline.push(entry);
  });
  const tokenUsage = normalizeTurnTokenUsage(turn);
  if (tokenUsage) {
    timeline.push({
      id: `${turnId || "turn"}:token_usage`,
      index: timeline.length,
      kind: "token_usage",
      title: "Token usage",
      status: "completed",
      textPreview: formatTokenUsage(tokenUsage),
      createdAt: turn.updatedAt ?? turn.updated_at ?? turn.completedAt ?? turn.completed_at ?? null,
      metadata: tokenUsage,
    });
  }
  const activity = buildAgentActivityFromTurn({ thread: safeThread, turn, turnId });
  return {
    threadId: String(safeThread.id ?? safeThread.threadId ?? ""),
    turnId: String(turn.id ?? turn.turnId ?? turnId ?? ""),
    status: String(turn.status ?? activity.status ?? "unknown"),
    activity,
    items: timeline,
  };
}

function buildAgentActivityFromTurn({ thread, turn, turnId }) {
  const items = Array.isArray(turn?.items) ? turn.items : [];
  const summarized = items.map((item, index) => summarizeTurnItem(item, index)).filter(Boolean);
  const latest = latestMeaningfulItem(summarized);
  const tokenUsage = normalizeTurnTokenUsage(turn);
  return {
    threadId: String(thread?.id ?? thread?.threadId ?? "") || null,
    turnId: String(turn?.id ?? turn?.turnId ?? turnId ?? "") || null,
    status: turn?.status ? String(turn.status) : null,
    itemCount: items.length,
    effectiveItemCount: summarized.filter((item) => item.kind !== "user_input").length,
    latestItemType: latest?.kind ?? null,
    latestMessagePreview: latest?.textPreview ?? latest?.title ?? null,
    latestToolName: latest?.metadata?.toolName ?? null,
    tokenUsage,
    updatedAt: new Date().toISOString(),
  };
}

function buildAgentActivityFromTurnResult(turn) {
  const activity = normalizeTurnActivity(turn?.turnActivity);
  const activeMessage = safePreview(turn?.activeThreadMessage, TEXT_PREVIEW_LIMIT);
  if (!activity && !activeMessage) return null;
  return {
    threadId: turn?.threadId ?? activity?.threadId ?? null,
    turnId: turn?.turnId ?? activity?.turnId ?? null,
    status: turn?.status ?? activity?.status ?? null,
    itemCount: activity?.itemCount ?? 0,
    effectiveItemCount: activity?.effectiveItemCount ?? 0,
    latestItemType: activity?.latestItemType ?? (activeMessage ? "agent_message" : null),
    latestMessagePreview: activity?.latestMessagePreview ?? activeMessage,
    latestToolName: activity?.latestToolName ?? null,
    tokenUsage: activity?.tokenUsage ?? null,
    updatedAt: new Date().toISOString(),
  };
}

function summarizeTurnItem(item, index) {
  if (!item || typeof item !== "object") return null;
  const type = String(item.type ?? item.kind ?? "").trim();
  const normalizedType = type.toLowerCase();
  const role = String(item.role ?? item.author ?? "").trim().toLowerCase();
  const createdAt = item.createdAt ?? item.created_at ?? item.updatedAt ?? item.updated_at ?? null;
  if (["usermessage", "user_message", "inputtext", "text"].includes(normalizedType) || role === "user") {
    return buildItem({ item, index, kind: "user_input", title: "User input", createdAt, previewLimit: TEXT_PREVIEW_LIMIT });
  }
  if (["agentmessage", "assistantmessage", "assistant_message", "message"].includes(normalizedType) || ["assistant", "agent", "thread"].includes(role)) {
    return buildItem({ item, index, kind: "agent_message", title: "Agent message", createdAt, previewLimit: LONG_TEXT_PREVIEW_LIMIT });
  }
  if (normalizedType === "reasoning") {
    const text = extractText(item);
    const chars = text ? text.length : nullableNumber(item.characters ?? item.charCount ?? item.length);
    return {
      id: item.id ?? `item_${index}`,
      index,
      kind: "reasoning",
      title: chars ? `Reasoning ${chars} chars` : "Reasoning",
      status: normalizeItemStatus(item),
      textPreview: safePreview(text, TEXT_PREVIEW_LIMIT),
      createdAt,
      metadata: chars ? { byteLength: chars } : {},
    };
  }
  if (["toolcall", "tool_call"].includes(normalizedType)) {
    const toolName = resolveToolName(item);
    return {
      id: item.id ?? `item_${index}`,
      index,
      kind: "tool_call",
      title: toolName ? `Tool call: ${toolName}` : "Tool call",
      status: normalizeItemStatus(item),
      textPreview: safePreview(resolveToolPreview(item), TEXT_PREVIEW_LIMIT),
      createdAt,
      metadata: {
        toolName,
        commandPreview: safePreview(resolveToolCommand(item), TEXT_PREVIEW_LIMIT),
        durationMs: nullableNumber(item.durationMs ?? item.duration_ms),
      },
    };
  }
  if (["toolresult", "tool_result"].includes(normalizedType)) {
    const toolName = resolveToolName(item);
    const text = extractText(item) ?? resolveToolPreview(item);
    return {
      id: item.id ?? `item_${index}`,
      index,
      kind: "tool_result",
      title: toolName ? `Tool result: ${toolName}` : "Tool result",
      status: normalizeItemStatus(item),
      textPreview: safePreview(text, TEXT_PREVIEW_LIMIT),
      createdAt,
      metadata: {
        toolName,
        exitCode: nullableNumber(item.exitCode ?? item.exit_code ?? item.metadata?.exitCode ?? item.metadata?.exit_code),
        durationMs: nullableNumber(item.durationMs ?? item.duration_ms ?? item.metadata?.durationMs ?? item.metadata?.duration_ms),
        byteLength: byteLength(text),
      },
    };
  }
  return buildItem({ item, index, kind: "unknown", title: type ? `Item: ${type}` : "Item", createdAt, previewLimit: TEXT_PREVIEW_LIMIT });
}

function buildItem({ item, index, kind, title, createdAt, previewLimit }) {
  return {
    id: item.id ?? `item_${index}`,
    index,
    kind,
    title,
    status: normalizeItemStatus(item),
    textPreview: safePreview(extractText(item), previewLimit),
    createdAt,
    metadata: {},
  };
}

function findTurn(thread, turnId) {
  const turns = Array.isArray(thread?.turns) ? thread.turns : [];
  const target = String(turnId ?? "");
  if (!target) return turns.at(-1) ?? null;
  return turns.find((turn) => String(turn?.id ?? turn?.turnId ?? "") === target) ?? null;
}

function latestMeaningfulItem(items) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (!item || item.kind === "user_input") continue;
    return item;
  }
  return null;
}

function extractText(value) {
  if (typeof value === "string") return value.trim() || null;
  if (!value || typeof value !== "object") return null;
  for (const key of ["text", "message", "summary", "final_message", "finalMessage", "output", "result"]) {
    const text = stringifyContent(value[key]);
    if (text) return text;
  }
  return stringifyContent(value.content ?? value.arguments ?? value.args ?? null);
}

function stringifyContent(value) {
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value)) {
    const parts = value.map((entry) => stringifyContent(entry)).filter(Boolean);
    return parts.length ? parts.join("\n").trim() : null;
  }
  if (value && typeof value === "object") {
    if (typeof value.text === "string") return value.text.trim() || null;
    if (typeof value.content === "string") return value.content.trim() || null;
  }
  return null;
}

function resolveToolName(item) {
  return stringOrNull(item.toolName ?? item.tool_name ?? item.name ?? item.tool ?? item.metadata?.toolName ?? item.metadata?.tool_name);
}

function resolveToolCommand(item) {
  return stringOrNull(item.command ?? item.arguments?.command ?? item.args?.command ?? item.metadata?.command);
}

function resolveToolPreview(item) {
  return extractText(item) ?? resolveToolCommand(item) ?? resolveToolName(item);
}

function normalizeItemStatus(item) {
  const raw = String(item?.status ?? "").trim().toLowerCase();
  if (["running", "in_progress", "inprogress", "pending"].includes(raw)) return "running";
  if (["completed", "complete", "success", "succeeded"].includes(raw)) return "completed";
  if (["failed", "error", "errored"].includes(raw)) return "failed";
  return "unknown";
}

function normalizeTurnActivity(value) {
  if (!value || typeof value !== "object") return null;
  return {
    threadId: value.threadId ?? null,
    turnId: value.turnId ?? null,
    status: value.status ?? null,
    itemCount: nullableNumber(value.itemCount) ?? 0,
    effectiveItemCount: nullableNumber(value.effectiveItemCount) ?? 0,
    latestItemType: value.latestItemType ?? null,
    latestMessagePreview: safePreview(value.latestMessagePreview, TEXT_PREVIEW_LIMIT),
    latestToolName: value.latestToolName ?? null,
    tokenUsage: normalizeTokenUsage(value.tokenUsage),
  };
}

function normalizeTurnTokenUsage(turn) {
  if (!turn || typeof turn !== "object") return null;
  return normalizeTokenUsage(turn.last_token_usage ?? turn.lastTokenUsage ?? turn.token_usage ?? turn.tokenUsage);
}

function normalizeTokenUsage(usage) {
  if (!usage || typeof usage !== "object") return null;
  const result = {
    inputTokens: nullableNumber(usage.inputTokens ?? usage.input_tokens),
    outputTokens: nullableNumber(usage.outputTokens ?? usage.output_tokens),
    totalTokens: nullableNumber(usage.totalTokens ?? usage.total_tokens),
    reasoningOutputTokens: nullableNumber(usage.reasoningOutputTokens ?? usage.reasoning_output_tokens),
  };
  return Object.values(result).some((value) => value != null) ? result : null;
}

function formatTokenUsage(usage) {
  return [
    usage.inputTokens != null ? `input ${usage.inputTokens}` : null,
    usage.outputTokens != null ? `output ${usage.outputTokens}` : null,
    usage.reasoningOutputTokens != null ? `reasoning ${usage.reasoningOutputTokens}` : null,
    usage.totalTokens != null ? `total ${usage.totalTokens}` : null,
  ].filter(Boolean).join(" / ");
}

function safePreview(value, maxLength) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}...`;
}

function stringOrNull(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function nullableNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function byteLength(value) {
  if (!value) return null;
  return Buffer.byteLength(String(value), "utf8");
}

module.exports = {
  summarizeAgentTurnTimeline,
  buildAgentActivityFromTurn,
  buildAgentActivityFromTurnResult,
};
