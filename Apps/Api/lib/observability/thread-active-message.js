function extractLatestThreadMessage(thread, { turnId = null } = {}) {
  const safeThread = thread && typeof thread === "object" ? thread : {};
  const turns = Array.isArray(safeThread.turns) ? safeThread.turns : [];
  const relevantTurns = turnId ? turns.filter((turn) => String(turn?.id ?? turn?.turnId ?? "") === String(turnId)) : turns;
  for (let turnIndex = relevantTurns.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const message = extractLatestThreadMessageFromTurn(relevantTurns[turnIndex]);
    if (message) {
      return {
        threadId: String(safeThread.id ?? safeThread.threadId ?? ""),
        turnId: String(relevantTurns[turnIndex]?.id ?? relevantTurns[turnIndex]?.turnId ?? turnId ?? ""),
        ...message,
      };
    }
  }
  return null;
}

function extractLatestThreadMessageFromTurn(turn) {
  if (!turn || typeof turn !== "object") return null;
  const items = Array.isArray(turn.items) ? turn.items : [];
  const finalMessage = normalizeText(turn.finalMessage ?? turn.final_message);
  const completed = isCompletedTurn(turn);
  let lastAgentIndex = -1;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (isAgentMessageItem(items[index]) && extractText(items[index])) {
      lastAgentIndex = index;
      break;
    }
  }

  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (!isAgentMessageItem(item)) continue;
    const text = extractText(item);
    if (!text) continue;
    if (finalMessage && text === finalMessage) continue;
    if (!finalMessage && completed && index === lastAgentIndex) continue;
    return {
      role: "thread",
      text: safePreview(text, 1200),
      createdAt: item.createdAt ?? item.created_at ?? null,
    };
  }
  return null;
}

function isAgentMessageItem(item) {
  if (!item || typeof item !== "object") return false;
  const type = String(item.type ?? "").trim();
  const role = String(item.role ?? item.author ?? "").trim().toLowerCase();
  return ["agentMessage", "assistantMessage", "assistant_message", "message"].includes(type)
    || ["assistant", "agent", "thread"].includes(role);
}

function isCompletedTurn(turn) {
  return ["completed", "complete", "success", "succeeded"].includes(String(turn?.status ?? "").trim().toLowerCase());
}

function extractText(item) {
  if (!item || typeof item !== "object") return null;
  for (const key of ["text", "message", "content", "final_message", "finalMessage"]) {
    const text = stringifyMessageContent(item[key]);
    if (text) return text;
  }
  return null;
}

function stringifyMessageContent(value) {
  if (typeof value === "string") return normalizeText(value);
  if (Array.isArray(value)) {
    const parts = value.map((entry) => {
      if (typeof entry === "string") return normalizeText(entry);
      if (entry && typeof entry === "object") return stringifyMessageContent(entry.text ?? entry.content);
      return "";
    }).filter(Boolean);
    return normalizeText(parts.join("\n"));
  }
  if (value && typeof value === "object") return stringifyMessageContent(value.text ?? value.content);
  return null;
}

function normalizeText(value) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text || null;
}

function safePreview(value, maxLength) {
  const text = normalizeText(value);
  if (!text) return null;
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}...`;
}

module.exports = { extractLatestThreadMessage };
