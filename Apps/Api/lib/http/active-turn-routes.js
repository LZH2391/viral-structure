const { sendJson } = require("./utils");
const { readJsonBody } = require("../observability/ui-debug-events");
const { canRetryBinding, handleActiveTurnRetry, releaseBindingLease, stopOwnerThread } = require("./active-turn-retry-routes");

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
  const result = await cancelActiveBinding(runtime, binding, body, handlers);
  if (result.ok === false) {
    return sendJson(res, result.statusCode ?? 502, {
      ok: false,
      error: result.errorCode ?? "active_turn_cancel_failed",
      code: result.errorCode ?? "active_turn_cancel_failed",
      message: result.message ?? "停止 active turn 失败",
      bindingId,
      ownerType: binding.ownerType,
      ownerId: binding.ownerId,
      threadId: binding.threadId,
      turnId: binding.turnId,
      retryable: true,
    });
  }
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
  const result = await cancelActiveBinding(runtime, binding, body, handlers);
  if (result.ok === false) {
    return sendJson(res, result.statusCode ?? 502, {
      ok: false,
      error: result.errorCode ?? "active_turn_cancel_failed",
      code: result.errorCode ?? "active_turn_cancel_failed",
      message: result.message ?? "结束 Thread 前停止 active turn 失败",
      bindingId,
      ownerType: binding.ownerType,
      ownerId: binding.ownerId,
      threadId: binding.threadId,
      turnId: binding.turnId,
      retryable: true,
    });
  }
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

async function cancelActiveBinding(runtime, binding, body, handlers) {
  try {
    return await runtime.cancel({
      workspaceRoot: body.workspaceRoot ?? body.rootDir ?? handlers.rootDir,
      threadId: binding.threadId,
      turnId: binding.turnId,
      timeoutSeconds: 30,
    });
  } catch (error) {
    return {
      ok: false,
      threadId: binding.threadId,
      turnId: binding.turnId,
      status: "failed",
      errorCode: error?.code ?? "active_turn_cancel_failed",
      message: safeErrorMessage(error, "停止 active turn 失败"),
      statusCode: error?.statusCode ?? 502,
      debugPayload: error?.debugPayload ?? null,
    };
  }
}

function safeErrorMessage(error, fallback) {
  const text = String(error?.message ?? fallback).replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 240) : fallback;
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

module.exports = {
  handleActiveTurnsList,
  handleActiveTurnStop,
  handleActiveTurnStopThread,
  handleActiveTurnRetry,
};
