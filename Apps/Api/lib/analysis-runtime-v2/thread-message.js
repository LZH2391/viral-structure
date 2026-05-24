function buildActiveThreadMessage(threadId, turnId, message, status) {
  const text = String(message ?? "").trim();
  if (!text || !isPendingTurnStatus(status)) return null;
  return {
    threadId: threadId ?? null,
    turnId: turnId ?? null,
    role: "thread",
    text: text.length <= 1200 ? text : `${text.slice(0, 1200)}...`,
    createdAt: new Date().toISOString(),
  };
}

function isPendingTurnStatus(status) {
  return ["created", "pending", "queued", "submitted", "running", "inprogress", "in_progress", "collecting"].includes(
    String(status ?? "").trim().toLowerCase(),
  );
}

module.exports = {
  buildActiveThreadMessage,
  isPendingTurnStatus,
};
