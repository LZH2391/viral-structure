const { sendJson } = require("./utils");
const { readJsonBody } = require("../observability/ui-debug-events");

async function handleActiveTurnsList(res, handlers = {}, url = null) {
  const runtime = handlers.activeTurnRuntime;
  const activeTurns = runtime?.listActive ? await runtime.listActive({
    ownerType: url?.searchParams?.get("ownerType") || null,
    ownerId: url?.searchParams?.get("ownerId") || null,
  }) : [];
  return sendJson(res, 200, {
    ok: true,
    activeTurns,
    count: activeTurns.length,
  });
}

async function handleActiveTurnStop(req, res, bindingId, handlers = {}) {
  const runtime = handlers.activeTurnRuntime;
  if (!runtime?.getByBindingId || !runtime?.cancel) {
    return sendJson(res, 503, { ok: false, error: "active_turn_runtime_unavailable" });
  }
  const body = await (handlers.readJsonBodyImpl ?? readJsonBody)(req).catch(() => ({}));
  const binding = await runtime.getByBindingId(bindingId);
  if (!binding) return sendJson(res, 404, { ok: false, error: "active_turn_not_found" });
  if (body.turnId && String(body.turnId) !== String(binding.turnId)) {
    return sendJson(res, 409, { ok: false, error: "active_turn_mismatch", turnId: binding.turnId });
  }
  const result = await runtime.cancel({
    workspaceRoot: body.workspaceRoot ?? body.rootDir ?? handlers.rootDir,
    threadId: binding.threadId,
    turnId: binding.turnId,
    timeoutSeconds: 30,
  });
  await releaseBindingLease(binding, handlers);
  return sendJson(res, 200, {
    ok: true,
    action: "stop",
    bindingId,
    ownerType: binding.ownerType,
    ownerId: binding.ownerId,
    threadId: result.threadId ?? binding.threadId,
    turnId: result.turnId ?? binding.turnId,
    status: result.status,
    ownerResult: result.ownerResult ?? null,
  });
}

async function handleActiveTurnRetry(req, res, bindingId, handlers = {}) {
  const runtime = handlers.activeTurnRuntime;
  if (!runtime?.getByBindingId || !runtime?.start) {
    return sendJson(res, 503, { ok: false, error: "active_turn_runtime_unavailable" });
  }
  const body = await (handlers.readJsonBodyImpl ?? readJsonBody)(req).catch(() => ({}));
  const binding = await runtime.getByBindingId(bindingId);
  if (!binding) return sendJson(res, 404, { ok: false, error: "active_turn_not_found" });
  if (binding.ownerType === "agent-chat") {
    return retryAgentChatTurnFromBinding({ res, binding, body, handlers, runtime });
  }
  if (binding.replayRef?.type !== "processing-job-input") {
    return sendJson(res, 409, {
      ok: false,
      error: "active_turn_retry_replay_unavailable",
      message: "该 active turn 没有可由运行面板安全重放的 owner replayRef",
      ownerType: binding.ownerType,
      replayRefType: binding.replayRef?.type ?? null,
    });
  }
  const job = handlers.jobStore?.getJob?.(binding.ownerId);
  const replayInputs = job?.activeTurnReplay?.inputs ?? body.inputs ?? null;
  if (!Array.isArray(replayInputs) || !replayInputs.length) {
    return sendJson(res, 409, {
      ok: false,
      error: "active_turn_retry_input_unavailable",
      message: "该 owner 没有保存可安全重放的输入，不能由全局面板直接 retry",
      ownerType: binding.ownerType,
      ownerId: binding.ownerId,
    });
  }
  const started = await runtime.start({
    workspaceRoot: body.workspaceRoot ?? binding.workspaceRoot ?? handlers.rootDir,
    threadId: binding.threadId,
    inputs: replayInputs,
    skillPath: job?.agentRun?.skillPath ?? null,
    timeoutSeconds: 240,
    binding: {
      ...binding,
      bindingId: null,
      turnId: null,
      currentAttemptId: `${binding.ownerId}:${binding.stageName ?? "retry"}:${Date.now()}`,
      replayRef: {
        type: "processing-job-input",
        refId: binding.ownerId,
        sourceTurnId: binding.turnId,
      },
      status: "submitted",
    },
  });
  return sendJson(res, 202, {
    ok: true,
    action: "retry",
    bindingId,
    ownerType: binding.ownerType,
    ownerId: binding.ownerId,
    threadId: started.threadId ?? binding.threadId,
    turnId: started.turnId ?? null,
    status: started.status ?? "submitted",
  });
}

async function releaseBindingLease(binding, handlers) {
  if (binding?.ownerType === "agent-chat") return null;
  if (!binding?.leaseId || !handlers.threadPool?.releaseLease) return null;
  const ownerId = binding.threadPoolOwnerId ?? binding.traceId ?? binding.ownerId ?? null;
  if (!ownerId) return null;
  return handlers.threadPool.releaseLease({ leaseId: binding.leaseId, ownerId }).catch(() => null);
}

async function retryAgentChatTurnFromBinding({ res, binding, body, handlers, runtime }) {
  const conversation = await handlers.agentConversationStore?.get?.(binding.ownerId);
  if (!conversation) return sendJson(res, 404, { ok: false, error: "active_turn_owner_missing", ownerType: binding.ownerType, ownerId: binding.ownerId });
  if (conversation.threadStopped) {
    return sendJson(res, 409, {
      ok: false,
      error: "active_turn_retry_new_thread_required",
      message: "该 AgentChat thread 已停止，需要在会话内新建 thread 重试",
      ownerType: binding.ownerType,
      ownerId: binding.ownerId,
    });
  }
  if (conversation.latestTurnId && String(conversation.latestTurnId) !== String(binding.turnId)) {
    return sendJson(res, 409, { ok: false, error: "active_turn_stale", ownerType: binding.ownerType, ownerId: binding.ownerId, latestTurnId: conversation.latestTurnId });
  }
  const replayText = resolveAgentChatReplayText(conversation, binding);
  if (!replayText) {
    return sendJson(res, 409, {
      ok: false,
      error: "active_turn_retry_input_unavailable",
      message: "未找到该 AgentChat turn 对应的用户消息，不能安全重试",
      ownerType: binding.ownerType,
      ownerId: binding.ownerId,
    });
  }
  await runtime.cancel({
    workspaceRoot: body.workspaceRoot ?? conversation.workspaceRoot ?? handlers.rootDir,
    threadId: binding.threadId,
    turnId: binding.turnId,
    timeoutSeconds: 30,
  });
  const started = await runtime.start({
    workspaceRoot: body.workspaceRoot ?? conversation.workspaceRoot ?? handlers.rootDir,
    threadId: binding.threadId,
    inputs: buildTextInputs(replayText),
    skillPath: conversation.skillPath ?? null,
    timeoutSeconds: 240,
    binding: {
      ownerType: "agent-chat",
      ownerId: conversation.conversationId,
      currentAttemptId: null,
      stageName: binding.stageName ?? "agentChat.turn.retry",
      traceId: binding.traceId ?? conversation.traceId ?? null,
      runId: binding.runId ?? conversation.runId ?? null,
      stageId: binding.stageId ?? conversation.stageId ?? null,
      artifactId: binding.artifactId ?? null,
      parentArtifactId: binding.parentArtifactId ?? null,
      leaseId: binding.leaseId ?? conversation.leaseId ?? null,
      threadPoolOwnerId: binding.threadPoolOwnerId ?? conversation.ownerId ?? null,
      replayRef: {
        type: "agent-chat-message",
        refId: `user-${binding.turnId}`,
        messageId: `user-${binding.turnId}`,
        sourceTurnId: binding.turnId,
      },
    },
  });
  const retryTurnId = started.turnId ?? null;
  if (retryTurnId) {
    await handlers.agentConversationStore?.recordUserTurn?.({
      conversationId: conversation.conversationId,
      turnId: retryTurnId,
      text: replayText,
      traceId: binding.traceId ?? conversation.traceId ?? null,
      runId: binding.runId ?? conversation.runId ?? null,
      stageId: binding.stageId ?? conversation.stageId ?? null,
    });
  }
  return sendJson(res, 202, {
    ok: true,
    action: "retry",
    bindingId: binding.bindingId,
    ownerType: binding.ownerType,
    ownerId: binding.ownerId,
    threadId: started.threadId ?? binding.threadId,
    turnId: retryTurnId,
    status: started.status ?? "submitted",
  });
}

function resolveAgentChatReplayText(conversation, binding) {
  const sourceTurnId = binding.replayRef?.sourceTurnId ?? binding.turnId;
  const messages = Array.isArray(conversation?.messages) ? conversation.messages : [];
  return messages.find((message) => message.id === `user-${sourceTurnId}` || (message.role === "user" && String(message.turnId ?? "") === String(sourceTurnId)))?.text ?? "";
}

function buildTextInputs(text) {
  return [{ type: "text", text, text_elements: [] }];
}

module.exports = {
  handleActiveTurnsList,
  handleActiveTurnStop,
  handleActiveTurnRetry,
};
