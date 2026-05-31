const ACTIONS = {
  stopTurn: "stop_turn",
  stopThread: "stop_thread",
  retrySameThread: "retry_same_thread",
  retryNewThread: "retry_new_thread",
};

function buildAgentChatActionProjection({ conversation = null, threadId = null, turnId = null, status = null, retryable = null } = {}) {
  const activeConversation = !conversation || conversation.status !== "archived";
  const hasThread = Boolean(threadId ?? conversation?.threadId);
  const hasTurn = Boolean(turnId ?? conversation?.latestTurnId);
  const terminal = isTerminalStatus(status);
  const running = isRunningStatus(status);
  const canRetry = retryable !== false && activeConversation;
  const flags = {
    stopTurn: activeConversation && hasThread && hasTurn && running,
    stopThread: activeConversation && hasThread,
    retrySameThread: activeConversation && hasThread && hasTurn && terminal && canRetry,
    retryNewThread: activeConversation && hasTurn && terminal && canRetry,
  };
  return {
    flags,
    availableActions: Object.entries(flags)
      .filter(([, enabled]) => enabled)
      .map(([key]) => ACTIONS[key]),
  };
}

function findReplayTask(conversation, turnId) {
  const messages = Array.isArray(conversation?.messages) ? conversation.messages : [];
  const targetTurnId = String(turnId ?? conversation?.latestTurnId ?? "");
  if (!targetTurnId) return null;
  const message = messages.find((item) => item?.role === "user" && String(item.turnId ?? "") === targetTurnId)
    ?? messages.find((item) => item?.id === `user-${targetTurnId}`);
  const text = String(message?.text ?? "").trim();
  if (!text) return null;
  return {
    sourceTurnId: targetTurnId,
    text,
    messageId: message.id ?? null,
  };
}

function latestAssistantStatus(conversation, turnId = null) {
  const messages = Array.isArray(conversation?.messages) ? conversation.messages : [];
  const targetTurnId = String(turnId ?? conversation?.latestTurnId ?? "");
  const message = targetTurnId
    ? messages.find((item) => item?.role === "assistant" && String(item.turnId ?? "") === targetTurnId)
    : [...messages].reverse().find((item) => item?.role === "assistant");
  return message?.status ?? null;
}

function isTerminalStatus(status) {
  return ["completed", "complete", "processed", "success", "succeeded", "failed", "error", "errored", "cancelled", "canceled"].includes(String(status ?? "").trim().toLowerCase());
}

function isRunningStatus(status) {
  return ["created", "pending", "queued", "submitted", "running", "processing", "collecting", "turn_submitted", "in_progress", "inprogress"].includes(String(status ?? "").trim().toLowerCase());
}

module.exports = {
  ACTIONS,
  buildAgentChatActionProjection,
  findReplayTask,
  isRunningStatus,
  isTerminalStatus,
  latestAssistantStatus,
};
