const { sendJson } = require("./utils");
const { readJsonBody } = require("../observability/ui-debug-events");
const { SAMPLE_STATUS } = require("../../../../Core/Workspace/sample-video-contracts");

async function handleActiveTurnsList(res, handlers = {}, url = null) {
  const runtime = handlers.activeTurnRuntime;
  const activeTurns = runtime?.listActive ? await runtime.listActive({
    ownerType: url?.searchParams?.get("ownerType") || null,
    ownerId: url?.searchParams?.get("ownerId") || null,
  }) : [];
  const projectedTurns = activeTurns.map((binding) => ({
    ...binding,
    actionProjection: buildActiveTurnActionProjection(binding, handlers),
  }));
  return sendJson(res, 200, {
    ok: true,
    activeTurns: projectedTurns,
    count: projectedTurns.length,
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

async function handleActiveTurnStopThread(req, res, bindingId, handlers = {}) {
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
  await releaseBindingLease(binding, handlers, { forceAgentChat: true });
  const ownerResult = await stopOwnerThread(binding, handlers, body);
  return sendJson(res, 200, {
    ok: true,
    action: "stop_thread",
    bindingId,
    ownerType: binding.ownerType,
    ownerId: binding.ownerId,
    threadId: result.threadId ?? binding.threadId,
    turnId: result.turnId ?? binding.turnId,
    status: result.status,
    ownerResult: ownerResult ?? result.ownerResult ?? null,
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
  const mode = normalizeRetryMode(body.mode);
  if (binding.ownerType === "agent-chat") {
    return retryAgentChatTurnFromBinding({ res, binding, body, handlers, runtime, mode });
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
  if (!job) {
    return sendJson(res, 404, { ok: false, error: "active_turn_owner_missing", ownerType: binding.ownerType, ownerId: binding.ownerId });
  }
  if (!isCurrentProcessingJobTurn(job, binding)) {
    return sendJson(res, 409, { ok: false, error: "active_turn_stale", ownerType: binding.ownerType, ownerId: binding.ownerId, latestTurnId: job.agentRun?.turnId ?? null });
  }
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
  await runtime.cancel({
    workspaceRoot: body.workspaceRoot ?? job?.agentRun?.workspaceRoot ?? binding.workspaceRoot ?? handlers.rootDir,
    threadId: binding.threadId,
    turnId: binding.turnId,
    timeoutSeconds: 30,
  });
  const currentAttemptId = `${binding.ownerId}:${binding.stageName ?? "retry"}:${Date.now()}`;
  const retryThread = mode === "new_thread"
    ? await createProcessingJobRetryThread({ binding, body, handlers, job })
    : { threadId: binding.threadId, workspaceRoot: body.workspaceRoot ?? binding.workspaceRoot ?? handlers.rootDir };
  const started = await runtime.start({
    workspaceRoot: retryThread.workspaceRoot,
    threadId: retryThread.threadId,
    inputs: replayInputs,
    skillPath: job?.agentRun?.skillPath ?? null,
    timeoutSeconds: 240,
    binding: {
      ...binding,
      bindingId: null,
      turnId: null,
      currentAttemptId,
      leaseId: retryThread.leaseId ?? (mode === "same_thread" ? binding.leaseId : null),
      threadPoolOwnerId: retryThread.ownerId ?? (mode === "same_thread" ? binding.threadPoolOwnerId : null),
      replayRef: {
        type: "processing-job-input",
        refId: binding.ownerId,
        sourceTurnId: binding.turnId,
      },
      status: "submitted",
    },
  });
  const startedThreadId = started.threadId ?? retryThread.threadId;
  const startedTurnId = started.turnId ?? null;
  if (startedTurnId) {
    handlers.jobStore.updateJob(binding.ownerId, {
      status: SAMPLE_STATUS.processing,
      stage: binding.stageName ?? job.stage ?? "active_turn.retry",
      progress: normalizeProgress(job.progress),
      errorSummary: null,
      agentRun: {
        ...(job.agentRun ?? {}),
        provider: job.agentRun?.provider ?? "codex-appserver",
        threadId: startedThreadId,
        turnId: startedTurnId,
        currentAttemptId,
        leaseId: retryThread.leaseId ?? (mode === "same_thread" ? job.agentRun?.leaseId ?? binding.leaseId ?? null : null),
        ownerId: retryThread.ownerId ?? job.agentRun?.ownerId ?? binding.threadPoolOwnerId ?? null,
        skillPath: job.agentRun?.skillPath ?? null,
        status: "turn_submitted",
        retrySourceTurnId: binding.turnId,
        previousThreadId: binding.threadId,
        retryMode: mode,
        updatedAt: new Date().toISOString(),
      },
    });
  }
  return sendJson(res, 202, {
    ok: true,
    action: mode === "new_thread" ? "retry_new_thread" : "retry",
    bindingId,
    ownerType: binding.ownerType,
    ownerId: binding.ownerId,
    threadId: startedThreadId,
    previousThreadId: binding.threadId,
    turnId: startedTurnId,
    status: started.status ?? "submitted",
  });
}

function buildActiveTurnActionProjection(binding, handlers = {}) {
  const availableActions = [];
  const stopTurn = Boolean(binding?.threadId && binding?.turnId);
  const stopThread = Boolean(binding?.threadId && binding?.turnId);
  const retrySameThread = canRetryBinding(binding, handlers, "same_thread");
  const retryNewThread = canRetryBinding(binding, handlers, "new_thread");
  if (stopTurn) availableActions.push("stop_turn");
  if (stopThread) availableActions.push("stop_thread");
  if (retrySameThread) availableActions.push("retry_same_thread");
  if (retryNewThread) availableActions.push("retry_new_thread");
  return {
    flags: { stopTurn, stopThread, retrySameThread, retryNewThread },
    availableActions,
  };
}

function canRetryBinding(binding, handlers = {}, mode = "same_thread") {
  if (!binding?.replayRef?.type) return false;
  if (binding.ownerType === "agent-chat") return binding.replayRef.type === "agent-chat-message";
  if (binding.ownerType !== "processing-job" || binding.replayRef.type !== "processing-job-input") return false;
  const job = handlers.jobStore?.getJob?.(binding.ownerId);
  const hasReplayInputs = Array.isArray(job?.activeTurnReplay?.inputs) && job.activeTurnReplay.inputs.length > 0;
  if (!hasReplayInputs || !isCurrentProcessingJobTurn(job, binding)) return false;
  if (mode === "new_thread") return Boolean(handlers.appServer?.startThread || handlers.threadPool?.acquireLease);
  return true;
}

async function releaseBindingLease(binding, handlers, options = {}) {
  if (binding?.ownerType === "agent-chat" && !options.forceAgentChat) return null;
  if (!binding?.leaseId || !handlers.threadPool?.releaseLease) return null;
  const ownerId = binding.threadPoolOwnerId ?? binding.traceId ?? binding.ownerId ?? null;
  if (!ownerId) return null;
  return handlers.threadPool.releaseLease({ leaseId: binding.leaseId, ownerId }).catch(() => null);
}

async function retryAgentChatTurnFromBinding({ res, binding, body, handlers, runtime, mode }) {
  const conversation = await handlers.agentConversationStore?.get?.(binding.ownerId);
  if (!conversation) return sendJson(res, 404, { ok: false, error: "active_turn_owner_missing", ownerType: binding.ownerType, ownerId: binding.ownerId });
  if (conversation.threadStopped && mode !== "new_thread") {
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
  const retrySession = mode === "new_thread"
    ? await createAgentChatRetryThreadSession({ conversation, binding, body, handlers })
    : {
        source: conversation.source ?? "direct",
        role: conversation.role ?? null,
        threadId: binding.threadId,
        previousThreadId: binding.threadId,
        workspaceRoot: body.workspaceRoot ?? conversation.workspaceRoot ?? handlers.rootDir,
        skillPath: conversation.skillPath ?? null,
        leaseId: conversation.leaseId ?? binding.leaseId ?? null,
        ownerId: conversation.ownerId ?? binding.threadPoolOwnerId ?? null,
        parentThreadId: conversation.parentThreadId ?? null,
      };
  const started = await runtime.start({
    workspaceRoot: retrySession.workspaceRoot,
    threadId: retrySession.threadId,
    inputs: buildTextInputs(replayText),
    skillPath: retrySession.skillPath,
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
      leaseId: retrySession.leaseId ?? null,
      threadPoolOwnerId: retrySession.ownerId ?? null,
      replayRef: {
        type: "agent-chat-message",
        refId: `user-${binding.turnId}`,
        messageId: `user-${binding.turnId}`,
        sourceTurnId: binding.turnId,
      },
    },
  });
  const retryTurnId = started.turnId ?? null;
  if (mode === "new_thread") {
    await handlers.agentConversationStore?.bindThread?.({
      conversationId: conversation.conversationId,
      threadId: retrySession.threadId,
      parentThreadId: retrySession.parentThreadId,
      leaseId: retrySession.leaseId,
      ownerId: retrySession.ownerId,
      workspaceRoot: retrySession.workspaceRoot,
      skillPath: retrySession.skillPath,
      source: retrySession.source,
    });
  }
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
    action: mode === "new_thread" ? "retry_new_thread" : "retry",
    bindingId: binding.bindingId,
    ownerType: binding.ownerType,
    ownerId: binding.ownerId,
    threadId: started.threadId ?? retrySession.threadId,
    previousThreadId: binding.threadId,
    turnId: retryTurnId,
    status: started.status ?? "submitted",
  });
}

async function stopOwnerThread(binding, handlers, body) {
  if (binding.ownerType === "agent-chat") {
    return handlers.agentConversationStore?.stopThread?.({
      conversationId: binding.ownerId,
      reason: body.reason ?? "已从运行面板结束 Thread",
      traceId: binding.traceId ?? null,
      runId: binding.runId ?? null,
      stageId: binding.stageId ?? null,
    });
  }
  return { status: "thread_stopped" };
}

async function createAgentChatRetryThreadSession({ conversation, binding, body, handlers }) {
  const source = String(conversation.source ?? body.source ?? "direct") === "threadpool-role" ? "threadpool-role" : "direct";
  if (source === "threadpool-role") {
    const role = conversation.role ?? body.role ?? null;
    if (!role) throw routeError("active_turn_retry_role_missing", "ThreadPool AgentChat 新线程重试缺少 role", 409);
    const ownerId = conversation.ownerId ?? binding.threadPoolOwnerId ?? `active-turn-retry-${Date.now()}`;
    const readiness = await handlers.threadPool.ensureRoleReady(role);
    if (!readiness?.ok) throw routeError(readiness?.error ?? "threadpool_role_unavailable", readiness?.message ?? "ThreadPool role 暂不可用", 503);
    const lease = await handlers.threadPool.acquireLease({ role, ownerId });
    return {
      source,
      role,
      ownerId,
      leaseId: lease.lease_id ?? lease.leaseId ?? null,
      threadId: lease.thread_id ?? lease.threadId ?? null,
      parentThreadId: lease.parent_thread_id ?? lease.parentThreadId ?? readiness.status?.seedThreadId ?? conversation.threadId ?? null,
      workspaceRoot: readiness.status?.workspaceRoot ?? conversation.workspaceRoot ?? handlers.rootDir,
      skillPath: readiness.status?.skillPath ?? conversation.skillPath ?? null,
    };
  }
  const workspaceRoot = body.workspaceRoot ?? conversation.workspaceRoot ?? handlers.rootDir;
  const result = await handlers.appServer.startThread({ workspaceRoot, timeoutSeconds: 180 });
  return {
    source,
    role: conversation.role ?? null,
    ownerId: null,
    leaseId: null,
    threadId: result.threadId ?? result.thread?.id ?? null,
    parentThreadId: conversation.threadId ?? null,
    workspaceRoot,
    skillPath: conversation.skillPath ?? null,
  };
}

async function createProcessingJobRetryThread({ binding, body, handlers, job }) {
  if (body.threadId) return { threadId: body.threadId, workspaceRoot: body.workspaceRoot ?? binding.workspaceRoot ?? handlers.rootDir };
  if (body.role && handlers.threadPool?.acquireLease) {
    const ownerId = binding.threadPoolOwnerId ?? binding.traceId ?? binding.ownerId;
    const readiness = handlers.threadPool.ensureRoleReady ? await handlers.threadPool.ensureRoleReady(body.role) : { ok: true, status: {} };
    if (!readiness?.ok) throw routeError(readiness?.error ?? "threadpool_role_unavailable", readiness?.message ?? "ThreadPool role 暂不可用", 503);
    const lease = await handlers.threadPool.acquireLease({ role: body.role, ownerId });
    return {
      threadId: lease.thread_id ?? lease.threadId ?? null,
      leaseId: lease.lease_id ?? lease.leaseId ?? null,
      ownerId,
      workspaceRoot: readiness.status?.workspaceRoot ?? body.workspaceRoot ?? binding.workspaceRoot ?? handlers.rootDir,
    };
  }
  if (handlers.appServer?.startThread) {
    const workspaceRoot = body.workspaceRoot ?? job?.agentRun?.workspaceRoot ?? binding.workspaceRoot ?? handlers.rootDir;
    const result = await handlers.appServer.startThread({ workspaceRoot, timeoutSeconds: 180 });
    return { threadId: result.threadId ?? result.thread?.id ?? null, workspaceRoot };
  }
  throw routeError("active_turn_retry_new_thread_unavailable", "无法创建新 thread", 409);
}

function normalizeRetryMode(value) {
  return String(value ?? "").trim() === "new_thread" ? "new_thread" : "same_thread";
}

function isCurrentProcessingJobTurn(job, binding) {
  const agentRun = job?.agentRun;
  if (!agentRun) return false;
  return String(agentRun.turnId ?? "") === String(binding.turnId ?? "")
    || String(agentRun.currentAttemptId ?? "") === String(binding.currentAttemptId ?? "");
}

function normalizeProgress(value) {
  const progress = Number(value);
  if (!Number.isFinite(progress)) return 0;
  return Math.max(0, Math.min(99, progress));
}

function routeError(code, message, statusCode) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  throw error;
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
  handleActiveTurnStopThread,
  handleActiveTurnRetry,
};
