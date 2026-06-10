const TEXT_PREVIEW_LIMIT = 240;
const LONG_TEXT_PREVIEW_LIMIT = 600;
const { formatTokenUsage, normalizeTokenUsage, normalizeTurnActivity, normalizeTurnTokenUsage, summarizeThreadContextUsage } = require("./agent-turn-token-usage");
const { byteLength, nullableNumber, safePreview, stringOrNull, summarizeDynamicToolContent, summarizeFileChanges, summarizeJson } = require("./agent-turn-text-utils");


function summarizeAgentTurnTimeline(thread, turnId) {
  const safeThread = thread && typeof thread === "object" ? thread : {};
  const turn = findTurn(safeThread, turnId);
  if (!turn) return null;
  const items = collectTurnItems(turn);
  const timeline = [];
  items.forEach((item, index) => {
    const entry = summarizeTurnItem(item, index);
    if (entry) timeline.push(entry);
  });
  const tokenUsage = normalizeTurnTokenUsage(turn);
  if (tokenUsage && !timeline.some((item) => item.kind === "token_usage")) {
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

function summarizeAgentTurnTimelineFromItems({ thread, turn, items, turnId }) {
  const safeThread = thread && typeof thread === "object" ? thread : {};
  const safeTurn = turn && typeof turn === "object" ? turn : {};
  const mergedTurn = {
    ...safeTurn,
    id: safeTurn.id ?? safeTurn.turnId ?? turnId,
    items: Array.isArray(items) ? items : [],
  };
  const timeline = [];
  collectTurnItems(mergedTurn).forEach((item, index) => {
    const entry = summarizeTurnItem(item, index);
    if (entry) timeline.push(entry);
  });
  const tokenUsage = normalizeTurnTokenUsage(mergedTurn);
  if (tokenUsage && !timeline.some((item) => item.kind === "token_usage")) {
    timeline.push({
      id: `${turnId || "turn"}:token_usage`,
      index: timeline.length,
      kind: "token_usage",
      title: "Token usage",
      status: "completed",
      textPreview: formatTokenUsage(tokenUsage),
      createdAt: mergedTurn.updatedAt ?? mergedTurn.updated_at ?? mergedTurn.completedAt ?? mergedTurn.completed_at ?? null,
      metadata: tokenUsage,
    });
  }
  const activity = buildAgentActivityFromTurn({ thread: safeThread, turn: mergedTurn, turnId });
  return {
    threadId: String(safeThread.id ?? safeThread.threadId ?? ""),
    turnId: String(mergedTurn.id ?? mergedTurn.turnId ?? turnId ?? ""),
    status: String(mergedTurn.status ?? activity.status ?? "unknown"),
    activity,
    items: timeline,
  };
}

function buildAgentActivityFromTurn({ thread, turn, turnId }) {
  const items = collectTurnItems(turn);
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
  const compactType = normalizedType.replace(/[^a-z0-9]/g, "");
  const role = String(item.role ?? item.author ?? "").trim().toLowerCase();
  const createdAt = resolveItemCreatedAt(item);
  if (["usermessage", "userinput", "inputtext", "text"].includes(compactType) || role === "user") {
    return buildItem({ item, index, kind: "user_input", title: "User input", createdAt, previewLimit: TEXT_PREVIEW_LIMIT });
  }
  if (["agentmessage", "assistantmessage", "message", "outputtext"].includes(compactType) || ["assistant", "agent", "thread"].includes(role)) {
    return buildItem({ item, index, kind: "agent_message", title: "Agent message", createdAt, previewLimit: LONG_TEXT_PREVIEW_LIMIT });
  }
  if (compactType === "plan") {
    return buildItem({ item, index, kind: "plan", title: "Plan", createdAt, previewLimit: TEXT_PREVIEW_LIMIT });
  }
  if (["reasoning", "reasoningsummary", "reasoningtext"].includes(compactType)) {
    const text = extractText(item);
    const chars = text ? text.length : nullableNumber(item.characters ?? item.charCount ?? item.length);
    return {
      id: item.id ?? `item_${index}`,
      index,
      kind: "reasoning",
      title: chars ? `Reasoning ${chars} chars` : "Reasoning",
      status: normalizeItemStatus(item),
      text,
      textPreview: safePreview(text, TEXT_PREVIEW_LIMIT),
      createdAt,
      metadata: chars ? { byteLength: chars } : {},
    };
  }
  if (["tokenusage", "tokencount", "tokenusageevent"].includes(compactType)) {
    const tokenUsage = normalizeTokenUsage(item.tokenUsage ?? item.token_usage ?? item.last_token_usage ?? item.lastTokenUsage, item.model_context_window ?? item.modelContextWindow);
    const totalTokenUsage = normalizeTokenUsage(item.totalTokenUsage ?? item.total_token_usage, item.model_context_window ?? item.modelContextWindow);
    return {
      id: item.id ?? `item_${index}`,
      index,
      kind: "token_usage",
      title: "Token usage",
      status: normalizeItemStatus(item),
      textPreview: formatTokenUsage(tokenUsage ?? totalTokenUsage ?? {}),
      createdAt,
      metadata: {
        ...(tokenUsage ?? {}),
        totalTokenUsage,
      },
    };
  }
  if (["contextcompacted", "contextcompact", "compactcontext"].includes(compactType)) {
    return {
      id: item.id ?? `item_${index}`,
      index,
      kind: "context_compacted",
      title: "Context compacted",
      status: normalizeItemStatus(item),
      text: extractText(item) ?? "Context compacted",
      textPreview: safePreview(extractText(item) ?? "Context compacted", TEXT_PREVIEW_LIMIT),
      createdAt,
      metadata: {},
    };
  }
  if (compactType === "commandexecution") {
    const text = extractText(item) ?? item.aggregatedOutput ?? item.command ?? null;
    return {
      id: item.id ?? `item_${index}`,
      index,
      kind: "command_execution",
      title: item.command ? `Command: ${safePreview(item.command, 80)}` : "Command execution",
      status: normalizeItemStatus(item),
      text,
      textPreview: safePreview(text, TEXT_PREVIEW_LIMIT),
      createdAt,
      metadata: {
        toolName: "shell",
        commandPreview: safePreview(item.command, TEXT_PREVIEW_LIMIT),
        exitCode: nullableNumber(item.exitCode ?? item.exit_code),
        durationMs: nullableNumber(item.durationMs ?? item.duration_ms),
        byteLength: byteLength(item.aggregatedOutput),
      },
    };
  }
  if (compactType === "mcptoolcall") {
    const toolName = [item.server, item.tool].filter(Boolean).join(".") || resolveToolName(item);
    const text = extractText(item) ?? item.error?.message ?? summarizeJson(item.result) ?? summarizeJson(item.arguments);
    return {
      id: item.id ?? `item_${index}`,
      index,
      kind: "mcp_tool_call",
      title: toolName ? `MCP tool: ${toolName}` : "MCP tool call",
      status: normalizeItemStatus(item),
      text,
      textPreview: safePreview(text, TEXT_PREVIEW_LIMIT),
      createdAt,
      metadata: {
        toolName,
        durationMs: nullableNumber(item.durationMs ?? item.duration_ms),
        byteLength: byteLength(text),
      },
    };
  }
  if (compactType === "dynamictoolcall") {
    const toolName = [item.namespace, item.tool].filter(Boolean).join(".") || resolveToolName(item);
    const text = extractText(item) ?? summarizeDynamicToolContent(item.contentItems) ?? summarizeJson(item.arguments);
    return {
      id: item.id ?? `item_${index}`,
      index,
      kind: "dynamic_tool_call",
      title: toolName ? `Dynamic tool: ${toolName}` : "Dynamic tool call",
      status: normalizeItemStatus(item),
      text,
      textPreview: safePreview(text, TEXT_PREVIEW_LIMIT),
      createdAt,
      metadata: {
        toolName,
        durationMs: nullableNumber(item.durationMs ?? item.duration_ms),
        byteLength: byteLength(text),
      },
    };
  }
  if (compactType === "filechange") {
    const count = Array.isArray(item.changes) ? item.changes.length : 0;
    return {
      id: item.id ?? `item_${index}`,
      index,
      kind: "file_change",
      title: count ? `File changes: ${count}` : "File changes",
      status: normalizeItemStatus(item),
      textPreview: safePreview(summarizeFileChanges(item.changes), TEXT_PREVIEW_LIMIT),
      createdAt,
      metadata: count ? { byteLength: count } : {},
    };
  }
  if (compactType === "websearch") {
    return {
      id: item.id ?? `item_${index}`,
      index,
      kind: "web_search",
      title: "Web search",
      status: normalizeItemStatus(item),
      textPreview: safePreview(item.query ?? item.action?.query ?? summarizeJson(item.action), TEXT_PREVIEW_LIMIT),
      createdAt,
      metadata: { toolName: "web_search" },
    };
  }
  if (["toolcall", "functioncall", "customtoolcall", "localtoolcall", "localshellcall", "shellcall", "commandcall"].includes(compactType)) {
    const toolName = resolveToolName(item);
    const text = resolveToolPreview(item);
    return {
      id: item.id ?? `item_${index}`,
      index,
      kind: "tool_call",
      title: toolName ? `Tool call: ${toolName}` : "Tool call",
      status: normalizeItemStatus(item),
      text,
      textPreview: safePreview(text, TEXT_PREVIEW_LIMIT),
      createdAt,
      metadata: {
        toolName,
        commandPreview: safePreview(resolveToolCommand(item), TEXT_PREVIEW_LIMIT),
        durationMs: nullableNumber(item.durationMs ?? item.duration_ms),
      },
    };
  }
  if (["toolresult", "functioncalloutput", "customtoolcalloutput", "functionoutput", "toolcalloutput", "localtoolresult", "localshellresult", "shellresult", "commandresult"].includes(compactType)) {
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
  const text = extractText(item);
  return {
    id: item.id ?? `item_${index}`,
    index,
    kind,
    title,
    status: normalizeItemStatus(item),
    text,
    textPreview: safePreview(text, previewLimit),
    createdAt,
    metadata: {},
  };
}

function collectTurnItems(turn) {
  if (!turn || typeof turn !== "object") return [];
  const turnCreatedAt = firstValidTimestamp([
    turn.createdAt,
    turn.created_at,
    turn.startedAt,
    turn.started_at,
    turn.updatedAt,
    turn.updated_at,
  ]);
  const candidates = [
    turn.input,
    turn.inputs,
    turn.items,
    turn.output_items,
    turn.outputItems,
    turn.events,
    turn.steps,
    turn.history,
  ];
  const result = [];
  const seen = new Set();
  for (const candidate of candidates) {
    for (const item of flattenItemArray(candidate)) {
      const normalizedItem = item && typeof item === "object" && turnCreatedAt && !resolveItemCreatedAt(item)
        ? { ...item, createdAt: turnCreatedAt }
        : item;
      const key = item && typeof item === "object"
        ? `${item.id ?? ""}:${item.type ?? item.kind ?? ""}:${safePreview(extractText(item), 80) ?? ""}`
        : String(item);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(normalizedItem);
    }
  }
  return result;
}

function flattenItemArray(value) {
  if (!Array.isArray(value)) return [];
  const result = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    if (isWrapperItem(item)) {
      const wrapperCreatedAt = resolveItemCreatedAt(item);
      result.push(...withFallbackCreatedAt(flattenItemArray(item.items), wrapperCreatedAt));
      result.push(...withFallbackCreatedAt(flattenItemArray(item.output_items), wrapperCreatedAt));
      result.push(...withFallbackCreatedAt(flattenItemArray(item.outputItems), wrapperCreatedAt));
      result.push(...withFallbackCreatedAt(flattenItemArray(item.content), wrapperCreatedAt));
      continue;
    }
    result.push(item);
  }
  return result;
}

function withFallbackCreatedAt(items, fallbackCreatedAt) {
  if (!fallbackCreatedAt) return items;
  return items.map((item) => {
    if (!item || typeof item !== "object" || resolveItemCreatedAt(item)) return item;
    return { ...item, createdAt: fallbackCreatedAt };
  });
}

function resolveItemCreatedAt(item) {
  if (!item || typeof item !== "object") return null;
  return firstValidTimestamp([
    item.createdAt,
    item.created_at,
    item.timestamp,
    item.time,
    item.ts,
    item.startedAt,
    item.started_at,
    item.updatedAt,
    item.updated_at,
    item.completedAt,
    item.completed_at,
    item.payload?.createdAt,
    item.payload?.created_at,
    item.payload?.timestamp,
    item.payload?.time,
    item.event?.createdAt,
    item.event?.created_at,
    item.event?.timestamp,
    item.metadata?.createdAt,
    item.metadata?.created_at,
    item.metadata?.timestamp,
  ]);
}

function firstValidTimestamp(values) {
  for (const value of values) {
    const timestamp = stringOrNull(value);
    if (!timestamp) continue;
    if (Number.isNaN(Date.parse(timestamp))) continue;
    return timestamp;
  }
  return null;
}

function isWrapperItem(item) {
  const type = String(item.type ?? item.kind ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  return ["event", "step", "response", "messagegroup"].includes(type)
    && (Array.isArray(item.items) || Array.isArray(item.output_items) || Array.isArray(item.outputItems) || Array.isArray(item.content));
}

function findTurn(thread, turnId) {
  const turns = Array.isArray(thread?.turns) ? thread.turns : [];
  const target = String(turnId ?? "");
  if (!target) return turns.at(-1) ?? null;
  const resolvedTurnId = resolveId(turns.map((turn) => turn?.id ?? turn?.turnId), target);
  return turns.find((turn) => String(turn?.id ?? turn?.turnId ?? "") === resolvedTurnId) ?? null;
}

function resolveId(values, target) {
  const requested = stringOrNull(target);
  if (!requested) return null;
  const candidates = (Array.isArray(values) ? values : [])
    .map((value) => stringOrNull(value))
    .filter(Boolean);
  const exact = candidates.find((value) => value === requested);
  if (exact) return exact;
  const suffixMatches = candidates.filter((value) => value.endsWith(requested));
  return suffixMatches.length === 1 ? suffixMatches[0] : null;
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
  for (const key of ["text", "message", "summary", "content", "final_message", "finalMessage", "output", "aggregatedOutput", "result", "arguments", "args"]) {
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
    if (typeof value.output === "string") return value.output.trim() || null;
    if (typeof value.delta === "string") return value.delta.trim() || null;
  }
  return null;
}

function resolveToolName(item) {
  return stringOrNull(item.toolName ?? item.tool_name ?? item.name ?? item.tool ?? item.call?.name ?? item.function?.name ?? item.metadata?.toolName ?? item.metadata?.tool_name);
}

function resolveToolCommand(item) {
  return stringOrNull(item.command ?? item.arguments?.command ?? item.args?.command ?? item.call?.arguments?.command ?? item.function?.arguments?.command ?? item.metadata?.command);
}

function resolveToolPreview(item) {
  return extractText(item) ?? resolveToolCommand(item) ?? resolveToolName(item);
}

function normalizeItemStatus(item) {
  const raw = String(item?.status ?? "").trim().toLowerCase();
  if (["running", "in_progress", "inprogress", "pending"].includes(raw)) return "running";
  if (["completed", "complete", "success", "succeeded", "applied"].includes(raw) || item?.success === true) return "completed";
  if (["failed", "error", "errored", "rejected"].includes(raw) || item?.success === false || item?.error) return "failed";
  return "unknown";
}


module.exports = {
  summarizeAgentTurnTimeline,
  summarizeAgentTurnTimelineFromItems,
  buildAgentActivityFromTurn,
  buildAgentActivityFromTurnResult,
  summarizeThreadContextUsage,
  normalizeTokenUsage,
};
