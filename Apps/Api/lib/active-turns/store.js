const fs = require("fs/promises");
const path = require("path");
const { randomUUID } = require("crypto");
const { isRunningTurnStatus, isTerminalTurnStatus, normalizeTurnStatus } = require("./status");

const SCHEMA_VERSION = "active_turn_bindings.v1";

function createActiveTurnStore({ store, filePath } = {}) {
  const bindingsPath = filePath || path.join(store.runtimeRoot, "ActiveTurns", "active-turns.json");
  let stateQueue = Promise.resolve();

  async function upsert(binding) {
    const normalized = normalizeBinding(binding);
    if (!normalized) throw activeTurnError("active_turn_binding_invalid", "active turn binding 缺少必要字段", { required: ["threadId", "turnId", "ownerType", "ownerId", "currentAttemptId", "replayRef"] }, false);
    return withStateLock(async () => {
      const state = await readState();
      const existingIndex = state.bindings.findIndex((item) => item.bindingId === normalized.bindingId || item.turnId === normalized.turnId);
      const next = {
        ...(existingIndex >= 0 ? state.bindings[existingIndex] : {}),
        ...normalized,
        updatedAt: new Date().toISOString(),
      };
      if (isTerminalTurnStatus(next.status)) next.archivedAt = next.archivedAt ?? new Date().toISOString();
      if (existingIndex >= 0) state.bindings[existingIndex] = next;
      else state.bindings.push({ ...next, createdAt: next.createdAt ?? new Date().toISOString() });
      await writeState(pruneTerminalBindings(state));
      return next;
    });
  }

  async function markStatus({ turnId, status, result = null, traceContext = null } = {}) {
    return withStateLock(async () => {
      const state = await readState();
      const index = state.bindings.findIndex((item) => item.turnId === turnId);
      if (index < 0) return null;
      const current = state.bindings[index];
      const next = {
        ...current,
        status: normalizeTurnStatus(status),
        lastResultSummary: summarizeResult(result),
        updatedAt: new Date().toISOString(),
        traceId: traceContext?.traceId ?? current.traceId ?? null,
        runId: traceContext?.runId ?? current.runId ?? null,
        stageId: traceContext?.stageId ?? current.stageId ?? null,
      };
      if (isTerminalTurnStatus(next.status)) next.archivedAt = next.archivedAt ?? new Date().toISOString();
      state.bindings[index] = next;
      await writeState(pruneTerminalBindings(state));
      return next;
    });
  }

  async function getByTurnId(turnId) {
    const state = await readState();
    return state.bindings.find((item) => item.turnId === turnId) ?? null;
  }

  async function getByBindingId(bindingId) {
    const state = await readState();
    return state.bindings.find((item) => item.bindingId === bindingId) ?? null;
  }

  async function removeByTurnId(turnId) {
    return withStateLock(async () => {
      const state = await readState();
      const next = state.bindings.filter((item) => item.turnId !== turnId);
      if (next.length === state.bindings.length) return null;
      await writeState({ ...state, bindings: next, updatedAt: new Date().toISOString() });
      return true;
    });
  }

  async function listActive(filters = {}) {
    return (await listActiveBindingsRaw(filters)).map(toSafeBinding);
  }

  async function listActiveBindingsRaw(filters = {}) {
    const state = await pruneAndPersistTerminalBindings();
    return state.bindings
      .filter((binding) => isRunningTurnStatus(binding.status))
      .filter((binding) => !filters.ownerType || binding.ownerType === filters.ownerType)
      .filter((binding) => !filters.ownerId || binding.ownerId === filters.ownerId)
      .sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));
  }

  async function readState() {
    try {
      const content = await fs.readFile(bindingsPath, "utf8");
      const parsed = JSON.parse(content);
      return {
        schemaVersion: SCHEMA_VERSION,
        updatedAt: parsed.updatedAt ?? null,
        bindings: Array.isArray(parsed.bindings) ? parsed.bindings.map(normalizeBinding).filter(Boolean) : [],
      };
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      return { schemaVersion: SCHEMA_VERSION, updatedAt: null, bindings: [] };
    }
  }

  async function writeState(state) {
    await fs.mkdir(path.dirname(bindingsPath), { recursive: true });
    const next = { schemaVersion: SCHEMA_VERSION, updatedAt: new Date().toISOString(), bindings: state.bindings };
    const tempPath = `${bindingsPath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(next, null, 2), "utf8");
    await fs.rename(tempPath, bindingsPath);
  }

  async function pruneAndPersistTerminalBindings() {
    return withStateLock(async () => {
      const state = await readState();
      const pruned = pruneTerminalBindings(state);
      if (pruned.bindings.length !== state.bindings.length) await writeState(pruned);
      return pruned;
    });
  }

  function withStateLock(operation) {
    const run = stateQueue.catch(() => undefined).then(operation);
    stateQueue = run.catch(() => undefined);
    return run;
  }

  return {
    filePath: bindingsPath,
    upsert,
    markStatus,
    getByTurnId,
    getByBindingId,
    removeByTurnId,
    listActive,
    listActiveBindings: listActiveBindingsRaw,
    toSafeBinding,
  };
}

function normalizeBinding(value) {
  if (!value || typeof value !== "object") return null;
  const threadId = normalizeText(value.threadId);
  const turnId = normalizeText(value.turnId);
  const ownerType = normalizeText(value.ownerType);
  const ownerId = normalizeText(value.ownerId);
  const currentAttemptId = normalizeText(value.currentAttemptId ?? turnId);
  const replayRef = normalizeReplayRef(value.replayRef);
  if (!threadId || !turnId || !ownerType || !ownerId || !currentAttemptId || !replayRef) return null;
  return {
    bindingId: normalizeText(value.bindingId) || `active_turn_${randomUUID()}`,
    threadId,
    turnId,
    ownerType,
    ownerId,
    currentAttemptId,
    stageName: normalizeText(value.stageName),
    traceId: normalizeText(value.traceId),
    runId: normalizeText(value.runId),
    stageId: normalizeText(value.stageId),
    artifactId: normalizeText(value.artifactId),
    parentArtifactId: normalizeText(value.parentArtifactId),
    leaseId: normalizeText(value.leaseId),
    threadPoolOwnerId: normalizeText(value.threadPoolOwnerId),
    workspaceRoot: normalizeText(value.workspaceRoot),
    replayRef,
    status: normalizeTurnStatus(value.status),
    activeThreadMessageSummary: summarizeText(value.activeThreadMessageSummary ?? value.activeThreadMessage),
    finalMessageSummary: summarizeText(value.finalMessageSummary ?? value.finalMessage),
    lastResultSummary: value.lastResultSummary ?? null,
    createdAt: value.createdAt ?? new Date().toISOString(),
    updatedAt: value.updatedAt ?? new Date().toISOString(),
    archivedAt: value.archivedAt ?? null,
  };
}

function normalizeReplayRef(value) {
  if (!value || typeof value !== "object") return null;
  const type = normalizeText(value.type) || "text";
  if (type === "text") {
    const text = typeof value.text === "string" ? value.text : "";
    if (!text.trim()) return null;
    return {
      type,
      text,
      messageId: normalizeText(value.messageId),
      sourceTurnId: normalizeText(value.sourceTurnId),
    };
  }
  const refId = normalizeText(value.refId ?? value.messageId ?? value.sourceTurnId);
  if (!refId) return null;
  return {
    type,
    refId,
    messageId: normalizeText(value.messageId),
    sourceTurnId: normalizeText(value.sourceTurnId),
  };
}

function pruneTerminalBindings(state) {
  return {
    ...state,
    bindings: state.bindings.filter((binding) => isRunningTurnStatus(binding.status)),
  };
}

function toSafeBinding(binding) {
  return {
    bindingId: binding.bindingId,
    threadId: binding.threadId,
    turnId: binding.turnId,
    ownerType: binding.ownerType,
    ownerId: binding.ownerId,
    currentAttemptId: binding.currentAttemptId,
    stageName: binding.stageName,
    traceId: binding.traceId,
    runId: binding.runId,
    stageId: binding.stageId,
    artifactId: binding.artifactId,
    parentArtifactId: binding.parentArtifactId,
    leaseId: binding.leaseId,
    threadPoolOwnerId: binding.threadPoolOwnerId,
    workspaceRoot: binding.workspaceRoot,
    replayRef: {
      type: binding.replayRef?.type ?? null,
      sourceTurnId: binding.replayRef?.sourceTurnId ?? null,
      messageId: binding.replayRef?.messageId ?? null,
      refId: binding.replayRef?.refId ?? null,
      textSummary: summarizeText(binding.replayRef?.text),
    },
    status: binding.status,
    activeThreadMessageSummary: binding.activeThreadMessageSummary,
    finalMessageSummary: binding.finalMessageSummary,
    lastResultSummary: binding.lastResultSummary,
    createdAt: binding.createdAt,
    updatedAt: binding.updatedAt,
  };
}

function summarizeResult(result) {
  if (!result || typeof result !== "object") return null;
  return {
    status: normalizeText(result.status),
    threadId: normalizeText(result.threadId),
    turnId: normalizeText(result.turnId),
    activeThreadMessageSummary: summarizeText(result.activeThreadMessage),
    finalMessageSummary: summarizeText(result.finalMessage),
    turnActivity: summarizeTurnActivity(result.turnActivity),
  };
}

function summarizeTurnActivity(activity) {
  if (!activity || typeof activity !== "object") return null;
  return {
    status: normalizeText(activity.status),
    itemCount: normalizeNonNegativeInteger(activity.itemCount),
    effectiveItemCount: normalizeNonNegativeInteger(activity.effectiveItemCount),
    latestItemType: normalizeText(activity.latestItemType),
    latestMessageSummary: summarizeText(activity.latestMessagePreview),
    latestToolName: normalizeText(activity.latestToolName),
  };
}

function normalizeNonNegativeInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : null;
}

function summarizeText(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  return {
    length: text.length,
    preview: text.replace(/[A-Za-z]:[\\/][^\s"'<>]+/g, "[local-path]").slice(0, 160),
  };
}

function normalizeText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function activeTurnError(code, message, debugPayload = null, retryable = true) {
  const error = new Error(message);
  error.code = code;
  error.debugPayload = debugPayload;
  error.retryable = retryable;
  return error;
}

module.exports = {
  createActiveTurnStore,
  activeTurnError,
};
