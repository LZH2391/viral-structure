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
    const result = await appServer.cancelTurn({ workspaceRoot, threadId, turnId, timeoutSeconds });
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

  async function listActive(filters = {}) {
    return bindingStore.listActive(filters);
  }

  async function getByTurnId(turnId) {
    return bindingStore.getByTurnId(turnId);
  }

  async function getByBindingId(bindingId) {
    return bindingStore.getByBindingId(bindingId);
  }

  return {
    store: bindingStore,
    register,
    start,
    collect,
    markCollectResult,
    cancel,
    listActive,
    getByTurnId,
    getByBindingId,
  };
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
