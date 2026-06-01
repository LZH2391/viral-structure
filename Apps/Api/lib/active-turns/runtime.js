const { createActiveTurnStore } = require("./store");
const { isRunningTurnStatus, isTerminalTurnStatus, normalizeTurnStatus } = require("./status");

function createActiveTurnRuntime({ store, activeTurnStore = null, appServer = null, ownerHandlers = null } = {}) {
  const bindingStore = activeTurnStore ?? createActiveTurnStore({ store });

  async function register(binding) {
    if (!isRunningTurnStatus(binding?.status)) return null;
    return bindingStore.upsert(binding);
  }

  async function start({ workspaceRoot, threadId, inputs, skillPath = null, timeoutSeconds = 180, binding }) {
    if (!appServer?.startTurnWithInputs) throw activeRuntimeError("appserver_turn_start_unavailable", "AppServer turn/start 能力不可用", null, true);
    const result = await appServer.startTurnWithInputs({ workspaceRoot, threadId, inputs, skillPath, timeoutSeconds });
    const turnId = result.turnId ?? result.turn?.id ?? null;
    if (binding && turnId) {
      await register({
        ...binding,
        threadId: result.threadId ?? threadId,
        turnId,
        currentAttemptId: binding.currentAttemptId ?? turnId,
        status: result.status ?? "submitted",
      });
    }
    return result;
  }

  async function collect({ workspaceRoot, threadId, turnId, timeoutSeconds = 60, traceContext = null, skipOwnerHandler = false } = {}) {
    if (!appServer?.collectTurnResult) throw activeRuntimeError("appserver_turn_collect_unavailable", "AppServer turn/collect 能力不可用", null, true);
    const result = await appServer.collectTurnResult({ workspaceRoot, threadId, turnId, timeoutSeconds });
    await markCollectResult({ turnId, result, traceContext, skipOwnerHandler });
    return result;
  }

  async function markCollectResult({ turnId, result, traceContext = null, skipOwnerHandler = false } = {}) {
    const previous = await bindingStore.getByTurnId(turnId);
    const binding = await bindingStore.markStatus({ turnId, status: result?.status ?? "running", result, traceContext });
    const activeBinding = binding ?? previous;
    let ownerResult = null;
    if (activeBinding && isTerminalTurnStatus(result?.status)) {
      if (!skipOwnerHandler) ownerResult = await ownerHandlers?.onCollect?.(activeBinding, result);
      await bindingStore.removeByTurnId(turnId);
    }
    return { binding: activeBinding, ownerResult };
  }

  async function cancel({ workspaceRoot, threadId, turnId, timeoutSeconds = 30, traceContext = null } = {}) {
    if (!appServer?.cancelTurn) throw activeRuntimeError("appserver_turn_cancel_unavailable", "AppServer turn/cancel 能力不可用", null, true);
    let result;
    try {
      result = await appServer.cancelTurn({ workspaceRoot, threadId, turnId, timeoutSeconds });
    } catch (error) {
      result = await resolveCancelFailure({ error, workspaceRoot, threadId, turnId, timeoutSeconds });
    }
    const previous = await bindingStore.getByTurnId(turnId);
    const binding = await bindingStore.markStatus({ turnId, status: result?.status ?? "canceled", result, traceContext });
    const ownerResult = await ownerHandlers?.onCancel?.(binding ?? previous, result);
    await bindingStore.removeByTurnId(turnId);
    return {
      ok: result?.ok !== false,
      threadId: result?.threadId ?? threadId,
      turnId: result?.turnId ?? turnId,
      status: normalizeTurnStatus(result?.status ?? "canceled"),
      ownerResult,
    };
  }

  async function resolveCancelFailure({ error, workspaceRoot, threadId, turnId, timeoutSeconds }) {
    const message = String(error?.message ?? "");
    if (isIdempotentCancelError(message)) {
      return {
        ok: true,
        threadId,
        turnId,
        status: "canceled",
        cancelWarning: summarizeCancelError(error),
      };
    }
    const collected = await collectAfterCancelFailure({ workspaceRoot, threadId, turnId, timeoutSeconds }).catch(() => null);
    if (collected && isTerminalTurnStatus(collected.status)) {
      return {
        ...collected,
        ok: collected.ok !== false,
        threadId: collected.threadId ?? threadId,
        turnId: collected.turnId ?? turnId,
        cancelWarning: summarizeCancelError(error),
      };
    }
    const cancelError = activeRuntimeError(error?.code ?? "appserver_turn_cancel_failed", safeCancelMessage(error), error?.debugPayload ?? null, true);
    cancelError.statusCode = 502;
    throw cancelError;
  }

  async function collectAfterCancelFailure({ workspaceRoot, threadId, turnId, timeoutSeconds }) {
    if (!appServer?.collectTurnResult) return null;
    return appServer.collectTurnResult({
      workspaceRoot,
      threadId,
      turnId,
      timeoutSeconds: Math.min(Math.max(Number(timeoutSeconds) || 30, 5), 30),
    });
  }

  async function listActive(filters = {}) {
    await reconcileActiveBindings(filters);
    return bindingStore.listActive(filters);
  }

  async function getByTurnId(turnId) {
    return bindingStore.getByTurnId(turnId);
  }

  async function getByBindingId(bindingId) {
    return bindingStore.getByBindingId(bindingId);
  }

  async function reconcileActiveBindings(filters = {}) {
    if (!bindingStore.listActiveBindings || !bindingStore.removeByTurnId || !ownerHandlers?.validateActiveBinding) return [];
    const activeBindings = await bindingStore.listActiveBindings(filters);
    const removed = [];
    for (const binding of activeBindings) {
      const validation = await ownerHandlers.validateActiveBinding(binding).catch((error) => ({
        ok: false,
        reason: "owner_validation_failed",
        code: error?.code ?? null,
      }));
      if (validation?.ok !== false) continue;
      await bindingStore.removeByTurnId(binding.turnId);
      removed.push({
        bindingId: binding.bindingId,
        ownerType: binding.ownerType,
        ownerId: binding.ownerId,
        threadId: binding.threadId,
        turnId: binding.turnId,
        reason: validation.reason ?? "invalid",
      });
    }
    return removed;
  }

  return {
    store: bindingStore,
    register,
    start,
    collect,
    markCollectResult,
    cancel,
    listActive,
    reconcileActiveBindings,
    getByTurnId,
    getByBindingId,
  };
}

function isIdempotentCancelError(message) {
  const value = String(message ?? "").toLowerCase();
  return ["not found", "unknown turn", "no such turn", "already completed", "already cancelled", "already canceled", "terminal", "not running"].some((marker) => value.includes(marker));
}

function summarizeCancelError(error) {
  return {
    code: error?.code ?? null,
    message: safeCancelMessage(error),
  };
}

function safeCancelMessage(error) {
  const message = String(error?.message ?? "AppServer turn/cancel 请求失败").replace(/\s+/g, " ").trim();
  return message.length > 240 ? `${message.slice(0, 240)}...` : message;
}

function activeRuntimeError(code, message, debugPayload = null, retryable = true) {
  const error = new Error(message);
  error.code = code;
  error.debugPayload = debugPayload;
  error.retryable = retryable;
  return error;
}

module.exports = {
  createActiveTurnRuntime,
  activeRuntimeError,
};
