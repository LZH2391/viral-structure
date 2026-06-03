const fs = require("fs");
const os = require("os");
const path = require("path");

const FILE_INDEX_TTL_MS = 5000;

function createCodexRolloutReader({ codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex") } = {}) {
  const sessionsRoot = path.join(codexHome, "sessions");
  let cachedIndex = { time: 0, files: [] };

  async function readThread({ threadId, turnId = null } = {}) {
    const targetThreadId = normalizeText(threadId);
    if (!targetThreadId) return null;
    const files = await findRolloutFiles(targetThreadId);
    for (const filePath of files) {
      const parsed = await parseCodexRolloutFile(filePath).catch(() => null);
      if (!parsed?.thread?.id) continue;
      if (parsed.thread.id !== targetThreadId && !parsed.thread.id.endsWith(targetThreadId)) continue;
      if (turnId && !findTurn(parsed.thread, turnId)) continue;
      return parsed;
    }
    return null;
  }

  async function findRolloutFiles(threadId) {
    const now = Date.now();
    if (!cachedIndex.files.length || now - cachedIndex.time > FILE_INDEX_TTL_MS) {
      cachedIndex = { time: now, files: await listRolloutFiles(sessionsRoot).catch(() => []) };
    }
    const target = normalizeText(threadId);
    return cachedIndex.files
      .filter((entry) => entry.name.includes(target))
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .map((entry) => entry.filePath);
  }

  return { codexHome, sessionsRoot, readThread, findRolloutFiles };
}

async function listRolloutFiles(root) {
  const result = [];
  async function walk(dir) {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    await Promise.all(entries.map(async (entry) => {
      const filePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(filePath);
        return;
      }
      if (!entry.isFile() || !entry.name.startsWith("rollout-") || !entry.name.endsWith(".jsonl")) return;
      const stat = await fs.promises.stat(filePath).catch(() => null);
      result.push({ name: entry.name, filePath, mtimeMs: stat?.mtimeMs ?? 0 });
    }));
  }
  await walk(root);
  return result;
}

async function parseCodexRolloutFile(filePath) {
  const text = await fs.promises.readFile(filePath, "utf8");
  return parseCodexRolloutText(text, { filePath });
}

function parseCodexRolloutText(text, { filePath = null } = {}) {
  const turns = new Map();
  let threadId = extractThreadIdFromRolloutPath(filePath);
  let currentTurnId = null;
  const lines = String(text ?? "").split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    const event = parseJson(line);
    if (!event || typeof event !== "object") continue;
    const payload = event.payload && typeof event.payload === "object" ? event.payload : {};
    if (event.type === "session_meta") {
      threadId = normalizeText(payload.id) || threadId;
      continue;
    }
    if (event.type === "event_msg") {
      const type = normalizeText(payload.type);
      const rawTurnId = normalizeText(payload.turn_id ?? payload.turnId);
      if (type === "task_started") {
        currentTurnId = rawTurnId || currentTurnId;
        const turn = ensureTurn(turns, currentTurnId, event.timestamp);
        turn.status = "running";
        turn.model_context_window = nullablePositiveNumber(payload.model_context_window ?? payload.modelContextWindow) ?? turn.model_context_window;
        continue;
      }
      const turn = ensureTurn(turns, rawTurnId || currentTurnId, event.timestamp);
      if (!turn) continue;
      if (type === "task_complete") {
        turn.status = "completed";
        turn.updatedAt = event.timestamp ?? turn.updatedAt;
        continue;
      }
      if (type === "user_message") {
        addItem(turn, { type: "userMessage", text: payload.message, role: "user", createdAt: event.timestamp });
        continue;
      }
      if (type === "agent_message") {
        addItem(turn, { type: "agentMessage", text: payload.message, role: "assistant", createdAt: event.timestamp });
        continue;
      }
      if (type === "token_count") {
        addTokenUsage(turn, payload.info, event.timestamp);
        continue;
      }
      if (type === "context_compacted") {
        addItem(turn, { type: "contextCompacted", text: "Context compacted", createdAt: event.timestamp, status: "completed" });
      }
      continue;
    }
    if (event.type !== "response_item") continue;
    const turn = ensureTurn(turns, normalizeText(payload.turn_id ?? payload.turnId) || currentTurnId, event.timestamp);
    if (!turn) continue;
    addResponseItem(turn, payload, event.timestamp);
  }
  const thread = {
    id: threadId || "",
    turns: Array.from(turns.values()),
  };
  return {
    ok: Boolean(thread.id),
    source: "codex-rollout",
    filePath,
    threadId: thread.id,
    thread,
  };
}

function addResponseItem(turn, payload, timestamp) {
  const type = normalizeText(payload.type);
  if (type === "message") {
    const role = normalizeText(payload.role)?.toLowerCase();
    if (!["user", "assistant", "agent"].includes(role)) return;
    addItem(turn, {
      type: role === "user" ? "userMessage" : "agentMessage",
      role,
      text: extractContentText(payload.content),
      createdAt: timestamp,
    });
    return;
  }
  if (type === "reasoning") {
    const text = extractContentText(payload.summary);
    addItem(turn, { type: "reasoning", text, createdAt: timestamp, status: payload.status });
    return;
  }
  if (["function_call", "custom_tool_call"].includes(type)) {
    addItem(turn, {
      type: "toolCall",
      id: payload.id,
      callId: payload.call_id ?? payload.callId,
      toolName: payload.name,
      arguments: parseJson(payload.arguments) ?? parseJson(payload.input) ?? payload.arguments ?? payload.input,
      text: payload.input ?? payload.arguments ?? payload.name,
      createdAt: timestamp,
      status: payload.status,
    });
    return;
  }
  if (["function_call_output", "custom_tool_call_output"].includes(type)) {
    addItem(turn, {
      type: "toolResult",
      id: payload.id,
      callId: payload.call_id ?? payload.callId,
      output: payload.output,
      text: payload.output,
      createdAt: timestamp,
      status: payload.status,
    });
  }
}

function addTokenUsage(turn, info, timestamp) {
  const payload = info && typeof info === "object" ? info : {};
  const modelContextWindow = nullablePositiveNumber(payload.model_context_window ?? payload.modelContextWindow);
  const last = normalizePersistedUsage(payload.last_token_usage ?? payload.lastTokenUsage, modelContextWindow);
  const total = normalizePersistedUsage(payload.total_token_usage ?? payload.totalTokenUsage, modelContextWindow);
  if (last) turn.last_token_usage = last;
  if (total) turn.total_token_usage = total;
  if (modelContextWindow != null) turn.model_context_window = modelContextWindow;
  addItem(turn, {
    type: "tokenUsage",
    tokenUsage: last,
    totalTokenUsage: total,
    modelContextWindow,
    createdAt: timestamp,
    status: "completed",
  });
}

function mergeThreadWithRollout(thread, rolloutThread) {
  const base = thread && typeof thread === "object" ? { ...thread } : {};
  const fallbackTurns = Array.isArray(rolloutThread?.turns) ? rolloutThread.turns : [];
  if (!fallbackTurns.length) return base;
  const turns = Array.isArray(base.turns) ? [...base.turns] : [];
  for (const fallbackTurn of fallbackTurns) {
    const fallbackTurnId = normalizeText(fallbackTurn.id ?? fallbackTurn.turnId);
    if (!fallbackTurnId) continue;
    const index = turns.findIndex((turn) => normalizeText(turn?.id ?? turn?.turnId) === fallbackTurnId);
    if (index >= 0) turns[index] = mergeTurnWithRollout(turns[index], fallbackTurn);
    else turns.push(fallbackTurn);
  }
  return { ...base, id: normalizeText(base.id ?? base.threadId) || normalizeText(rolloutThread?.id ?? rolloutThread?.threadId) || "", turns };
}

function mergeTurnWithRollout(turn, fallbackTurn) {
  const base = turn && typeof turn === "object" ? { ...turn } : {};
  return {
    ...fallbackTurn,
    ...base,
    status: base.status ?? fallbackTurn.status,
    model_context_window: base.model_context_window ?? base.modelContextWindow ?? fallbackTurn.model_context_window ?? fallbackTurn.modelContextWindow,
    last_token_usage: base.last_token_usage ?? base.lastTokenUsage ?? base.token_usage ?? base.tokenUsage ?? fallbackTurn.last_token_usage,
    total_token_usage: base.total_token_usage ?? base.totalTokenUsage ?? fallbackTurn.total_token_usage,
    items: mergeTurnItems(base.items, fallbackTurn.items),
  };
}

function mergeTurnItems(items, fallbackItems) {
  const result = Array.isArray(items) ? [...items] : [];
  const seen = new Set(result.map(itemKey));
  for (const item of Array.isArray(fallbackItems) ? fallbackItems : []) {
    const key = itemKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function findTurn(thread, turnId) {
  const target = normalizeText(turnId);
  const turns = Array.isArray(thread?.turns) ? thread.turns : [];
  return turns.find((turn) => normalizeText(turn?.id ?? turn?.turnId) === target) ?? null;
}

function ensureTurn(turns, turnId, timestamp) {
  const id = normalizeText(turnId);
  if (!id) return null;
  if (!turns.has(id)) turns.set(id, { id, status: "running", createdAt: timestamp ?? null, updatedAt: timestamp ?? null, items: [] });
  return turns.get(id);
}

function addItem(turn, item) {
  const key = itemKey(item);
  if (turn.items.some((existing) => itemKey(existing) === key)) return;
  turn.items.push(item);
  turn.updatedAt = item.createdAt ?? turn.updatedAt;
}

function itemKey(item) {
  const type = normalizeText(item?.type ?? item?.kind) || "";
  const id = normalizeText(item?.id ?? item?.callId ?? item?.call_id) || "";
  const text = safePreview(extractContentText(item?.text ?? item?.output ?? item?.content ?? item?.arguments ?? item?.tokenUsage), 120) || "";
  return `${type}:${id}:${text}`;
}

function normalizePersistedUsage(usage, modelContextWindow) {
  if (!usage || typeof usage !== "object") return null;
  const result = {
    input_tokens: nullableNumber(usage.input_tokens ?? usage.inputTokens),
    cached_input_tokens: nullableNumber(usage.cached_input_tokens ?? usage.cachedInputTokens),
    output_tokens: nullableNumber(usage.output_tokens ?? usage.outputTokens),
    reasoning_output_tokens: nullableNumber(usage.reasoning_output_tokens ?? usage.reasoningOutputTokens),
    total_tokens: nullableNumber(usage.total_tokens ?? usage.totalTokens),
    model_context_window: nullablePositiveNumber(usage.model_context_window ?? usage.modelContextWindow ?? modelContextWindow),
  };
  return Object.fromEntries(Object.entries(result).filter(([, value]) => value != null));
}

function extractThreadIdFromRolloutPath(filePath) {
  const name = normalizeText(filePath ? path.basename(filePath) : null);
  const match = name?.match(/rollout-.+?-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i);
  return match ? match[1] : null;
}

function extractContentText(value) {
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value)) return value.map(extractContentText).filter(Boolean).join("\n") || null;
  if (value && typeof value === "object") return extractContentText(value.text ?? value.content ?? value.output ?? value.input ?? null);
  return null;
}

function parseJson(value) {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function nullableNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nullablePositiveNumber(value) {
  const number = nullableNumber(value);
  return number != null && number > 0 ? number : null;
}

function safePreview(value, maxLength) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}...`;
}

module.exports = {
  createCodexRolloutReader,
  parseCodexRolloutFile,
  parseCodexRolloutText,
  mergeThreadWithRollout,
  mergeTurnItems,
  findTurn,
};
