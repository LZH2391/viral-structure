const { createActiveTurnStore } = require("./store");
const { isRunningTurnStatus, isTerminalTurnStatus, normalizeTurnStatus } = require("./status");

function createActiveTurnRuntime({ store, activeTurnStore = null, appServer = null } = {}) {
  const bindingStore = activeTurnStore ?? createActiveTurnStore({ store });

  async function register(binding) {
    if (!isRunningTurnStatus(binding?.status)) return null;
    return bindingStore.upsert(binding);
  }

  async function markCollectResult({ turnId, result, traceContext = null } = {}) {
    const binding = await bindingStore.markStatus({ turnId, status: result?.status ?? "running", result, traceContext });
    if (binding && isTerminalTurnStatus(result?.status)) await bindingStore.removeByTurnId(turnId);
    return binding;
  }

  async function cancel({ workspaceRoot, threadId, turnId, timeoutSeconds = 30, traceContext = null } = {}) {
    if (!appServer?.cancelTurn) throw activeRuntimeError("appserver_turn_cancel_unavailable", "AppServer turn/cancel 能力不可用", null, true);
    const result = await appServer.cancelTurn({ workspaceRoot, threadId, turnId, timeoutSeconds });
    await bindingStore.markStatus({ turnId, status: result?.status ?? "canceled", result, traceContext });
    await bindingStore.removeByTurnId(turnId);
    return {
      ok: result?.ok !== false,
      threadId: result?.threadId ?? threadId,
      turnId: result?.turnId ?? turnId,
      status: normalizeTurnStatus(result?.status ?? "canceled"),
    };
  }

  async function listActive(filters = {}) {
    return bindingStore.listActive(filters);
  }

  async function getByTurnId(turnId) {
    return bindingStore.getByTurnId(turnId);
  }

  return {
    store: bindingStore,
    register,
    markCollectResult,
    cancel,
    listActive,
    getByTurnId,
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
