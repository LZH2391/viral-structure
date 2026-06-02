const { createActiveTurnStore } = require("./store");
const { isRunningTurnStatus, isTerminalTurnStatus, normalizeTurnStatus } = require("./status");

function createActiveTurnRuntime({ store, activeTurnStore = null, appServer = null, ownerHandlers = null } = {}) {
  const bindingStore = activeTurnStore ?? createActiveTurnStore({ store });

  async function register(binding) {
    if (!isRunningTurnStatus(binding?.status)) return null;
    return bindingStore.upsert(binding);
  }

  async function start({ workspaceRoot, threadId, inputs, skillPath = null, timeoutSeconds = 180, binding, enforceThreadId = false }) {
    if (!appServer?.startTurnWithInputs) throw activeRuntimeError("appserver_turn_start_unavailable", "AppServer turn/start 能力不可用", null, true);
    const result = await appServer.startTurnWithInputs({ workspaceRoot, threadId, inputs, skillPath, timeoutSeconds });
    const turnId = result.turnId ?? result.turn?.id ?? null;
    if (result?.ok === false || !turnId) {
      const error = activeRuntimeError(
        result?.error ?? result?.code ?? "appserver_turn_start_failed",
        result?.message ?? "AppServer turn/start 未返回有效 turnId",
        result,
        true,
      );
      error.statusCode = result?.statusCode ?? 502;
      throw error;
    }
    if (enforceThreadId) assertExpectedStartThread(result, threadId);
    if (binding && turnId) {
      await register({
        ...binding,
        threadId,
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
    assertExpectedCollectTurn(result, turnId);
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
    if (!appServer?.cancelTurn) throw activeRuntimeError("appserver_turn_cancel_unavailable", "AppServer turn/interrupt 能力不可用", null, true);
    let result;
    try {
      result = await appServer.cancelTurn({ workspaceRoot, threadId, turnId, timeoutSeconds });
      if (result?.ok === false) throw resultToCancelError(result);
    } catch (error) {
      result = await resolveCancelFailure({ error, workspaceRoot, threadId, turnId, timeoutSeconds });
    }
    const previous = await bindingStore.getByTurnId(turnId);
    const binding = await bindingStore.markStatus({ turnId, status: result?.status ?? "canceled", result, traceContext });
    const handler = result?.cancelResolvedBy === "collect" ? ownerHandlers?.onCollect : ownerHandlers?.onCancel;
    const ownerResult = await handler?.(binding ?? previous, result);
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
        cancelResolvedBy: "collect",
        cancelWarning: summarizeCancelError(error),
      };
    }
    const cancelError = activeRuntimeError(error?.code ?? "appserver_turn_cancel_failed", safeCancelMessage(error), error?.debugPayload ?? null, true);
    cancelError.statusCode = 502;
    throw cancelError;
  }

  async function collectAfterCancelFailure({ workspaceRoot, threadId, turnId, timeoutSeconds }) {
    if (!appServer?.collectTurnResult) return null;
    const result = await appServer.collectTurnResult({
      workspaceRoot,
      threadId,
      turnId,
      timeoutSeconds: Math.min(Math.max(Number(timeoutSeconds) || 30, 5), 30),
    });
    assertExpectedCollectTurn(result, turnId);
    return result;
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

function resultToCancelError(result) {
  const error = activeRuntimeError(
    result?.error ?? result?.code ?? "appserver_turn_cancel_failed",
    result?.message ?? "AppServer turn/interrupt 请求失败",
    result,
    true,
  );
  error.statusCode = result?.statusCode ?? 502;
  return error;
}

function assertExpectedCollectTurn(result, expectedTurnId) {
  const actualTurnId = normalizeTurnId(result?.turnId ?? result?.turn?.id ?? null);
  const expected = normalizeTurnId(expectedTurnId);
  if (!actualTurnId || !expected || actualTurnId === expected) return;
  const error = activeRuntimeError("appserver_turn_collect_mismatch", "AppServer turn/collect 返回了非目标 turn", {
    expectedTurnId: expected,
    actualTurnId,
    status: result?.status ?? null,
  }, true);
  error.statusCode = 502;
  throw error;
}

function assertExpectedStartThread(result, expectedThreadId) {
  const actualThreadId = normalizeTurnId(result?.threadId ?? result?.thread?.id ?? null);
  const expected = normalizeTurnId(expectedThreadId);
  if (!actualThreadId || !expected || actualThreadId === expected) return;
  const error = activeRuntimeError("appserver_turn_start_thread_mismatch", "AppServer turn/start 返回了非目标 thread", {
    expectedThreadId: expected,
    actualThreadId,
    turnId: result?.turnId ?? result?.turn?.id ?? null,
    status: result?.status ?? null,
  }, true);
  error.statusCode = 502;
  throw error;
}

function normalizeTurnId(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function safeCancelMessage(error) {
  const message = String(error?.message ?? "AppServer turn/interrupt 请求失败").replace(/\s+/g, " ").trim();
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
