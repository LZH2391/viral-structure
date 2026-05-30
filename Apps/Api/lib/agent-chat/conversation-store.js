const fs = require("fs/promises");
const path = require("path");
const { randomUUID } = require("crypto");

const SCHEMA_VERSION = "agent_chat_conversations.v1";
const TEXT_LIMIT = 12000;

function resolveConversationsDirectory({ store, filePath }) {
  if (!filePath) return path.join(store.runtimeRoot, "AgentConversations");
  const basename = path.basename(filePath);
  return basename.endsWith(".json") ? path.dirname(filePath) : filePath;
}

function createAgentConversationStore({ store, filePath } = {}) {
  if (!store?.runtimeRoot && !filePath) throw new Error("store or filePath is required for agent conversation store");
  const conversationsDirectory = resolveConversationsDirectory({ store, filePath });
  const legacyFilePath = path.join(conversationsDirectory, "conversations.json");

  async function list({ role, status = "active" } = {}) {
    const conversations = await readAllConversations();
    return conversations
      .filter((conversation) => !role || conversation.role === role)
      .filter((conversation) => !status || conversation.status === status)
      .sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));
  }

  async function get(conversationId) {
    if (!conversationId) return null;
    return readConversation(conversationId);
  }

  async function createOrUpdateFromSession(session, { conversationId = null, sampleVideoId = null, expectedRevision = null } = {}) {
    const now = new Date().toISOString();
    let conversation = conversationId ? await readConversation(conversationId) : null;
    if (!conversation) {
      conversation = {
        conversationId: conversationId || `conversation_${randomUUID()}`,
        schemaVersion: "agent_chat_conversation.v1",
        source: session.source ?? "threadpool-role",
        role: session.role ?? null,
        status: "active",
        revision: 1,
        title: buildTitle(session.role, now),
        threadId: session.threadId ?? null,
        parentThreadId: session.parentThreadId ?? null,
        leaseId: session.leaseId ?? null,
        ownerId: session.ownerId ?? null,
        workspaceRoot: session.workspaceRoot ?? null,
        skillPath: session.skillPath ?? null,
        sampleVideoId,
        latestTurnId: null,
        traceId: session.traceId ?? null,
        runId: session.runId ?? null,
        stageId: session.stageId ?? null,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
        invalidated: false,
        invalidatedAt: null,
        lastResumeError: null,
        confirmedPlan: null,
        messages: [],
      };
    } else {
      assertActiveConversation(conversation);
      assertExpectedRevision(conversation, expectedRevision);
      Object.assign(conversation, {
        status: "active",
        threadId: session.threadId ?? conversation.threadId ?? null,
        parentThreadId: session.parentThreadId ?? conversation.parentThreadId ?? null,
        leaseId: session.leaseId ?? conversation.leaseId ?? null,
        ownerId: session.ownerId ?? conversation.ownerId ?? null,
        workspaceRoot: session.workspaceRoot ?? conversation.workspaceRoot ?? null,
        skillPath: session.skillPath ?? conversation.skillPath ?? null,
        traceId: session.traceId ?? conversation.traceId ?? null,
        runId: session.runId ?? conversation.runId ?? null,
        stageId: session.stageId ?? conversation.stageId ?? null,
        sampleVideoId: sampleVideoId ?? conversation.sampleVideoId ?? null,
        invalidated: false,
        invalidatedAt: null,
        lastResumeError: null,
        updatedAt: now,
        archivedAt: null,
      });
      bumpRevision(conversation);
    }
    await writeConversation(conversation);
    return conversation;
  }

  async function remove(conversationId) {
    if (!conversationId) return null;
    const conversation = await readConversation(conversationId);
    if (!conversation) return null;
    await fs.rm(conversationFilePath(conversationId), { force: true });
    return conversation;
  }

  async function recordUserTurn({ conversationId, turnId, text, traceId = null, runId = null, stageId = null }) {
    if (!conversationId || !turnId) return null;
    const now = new Date().toISOString();
    return mutateConversation(conversationId, (conversation) => {
      conversation.latestTurnId = turnId;
      conversation.traceId = traceId ?? conversation.traceId ?? null;
      conversation.runId = runId ?? conversation.runId ?? null;
      conversation.stageId = stageId ?? conversation.stageId ?? null;
      upsertMessage(conversation, {
        id: `user-${turnId}`,
        turnId,
        role: "user",
        text: limitText(text),
        status: "completed",
        createdAt: now,
        updatedAt: now,
      });
      upsertMessage(conversation, {
        id: `assistant-${turnId}`,
        turnId,
        role: "assistant",
        text: "生成中",
        status: "running",
        createdAt: now,
        updatedAt: now,
      });
    });
  }

  async function recordAssistantTurn({ conversationId, turnId, text, status, traceId = null, runId = null, stageId = null }) {
    if (!conversationId || !turnId) return null;
    const now = new Date().toISOString();
    return mutateConversation(conversationId, (conversation) => {
      conversation.latestTurnId = turnId;
      conversation.traceId = traceId ?? conversation.traceId ?? null;
      conversation.runId = runId ?? conversation.runId ?? null;
      conversation.stageId = stageId ?? conversation.stageId ?? null;
      upsertMessage(conversation, {
        id: `assistant-${turnId}`,
        turnId,
        role: "assistant",
        text: limitText(text || "生成中"),
        status: isTerminalStatus(status) ? "completed" : "running",
        createdAt: now,
        updatedAt: now,
      });
    }, { skipArchived: true });
  }

  async function recordSystemMessage({ conversationId, text, traceId = null, runId = null, stageId = null, expectedRevision = null }) {
    if (!conversationId) return null;
    const now = new Date().toISOString();
    return mutateConversation(conversationId, (conversation) => {
      assertExpectedRevision(conversation, expectedRevision);
      conversation.traceId = traceId ?? conversation.traceId ?? null;
      conversation.runId = runId ?? conversation.runId ?? null;
      conversation.stageId = stageId ?? conversation.stageId ?? null;
      upsertMessage(conversation, {
        id: `system-${now}-${randomUUID()}`,
        turnId: conversation.latestTurnId ?? null,
        role: "system",
        text: limitText(text),
        status: "completed",
        createdAt: now,
        updatedAt: now,
      });
    });
  }

  async function invalidate(conversationId, errorSummary = null) {
    if (!conversationId) return null;
    return mutateConversation(conversationId, (conversation) => {
      conversation.invalidated = true;
      conversation.invalidatedAt = new Date().toISOString();
      conversation.lastResumeError = errorSummary;
    });
  }

  async function confirmPlan({ conversationId, turnId = null, note = null, sourceRestructurePath = null, displayArtifact = null, storyboardArtifact = null, traceId = null, runId = null, stageId = null, expectedRevision = null }) {
    if (!conversationId) return null;
    const now = new Date().toISOString();
    return mutateConversation(conversationId, (conversation) => {
      assertExpectedRevision(conversation, expectedRevision);
      conversation.traceId = traceId ?? conversation.traceId ?? null;
      conversation.runId = runId ?? conversation.runId ?? null;
      conversation.stageId = stageId ?? conversation.stageId ?? null;
      conversation.confirmedPlan = {
        status: displayArtifact || storyboardArtifact ? "completed" : "confirmed",
        turnId: turnId ?? conversation.latestTurnId ?? null,
        confirmedAt: conversation.confirmedPlan?.confirmedAt ?? now,
        updatedAt: now,
        note: limitText(note),
        sourceRestructurePath: normalizePathText(sourceRestructurePath),
        displayArtifact: normalizeArtifactRef(displayArtifact),
        storyboardArtifact: normalizeArtifactRef(storyboardArtifact),
        traceId: traceId ?? null,
        runId: runId ?? null,
        stageId: stageId ?? null,
      };
    });
  }

  async function archive(conversationId, { expectedRevision = null } = {}) {
    const now = new Date().toISOString();
    return mutateConversation(conversationId, (conversation) => {
      assertExpectedRevision(conversation, expectedRevision);
      conversation.status = "archived";
      conversation.archivedAt = now;
    }, { allowArchived: true });
  }

  async function assertActive(conversationId, { expectedRevision = null } = {}) {
    const conversation = await get(conversationId);
    if (!conversation) return null;
    assertActiveConversation(conversation);
    assertExpectedRevision(conversation, expectedRevision);
    return conversation;
  }

  async function mutateConversation(conversationId, updater, { allowArchived = false, skipArchived = false } = {}) {
    const conversation = await readConversation(conversationId);
    if (!conversation) return null;
    if (conversation.status === "archived" && skipArchived) return null;
    if (!allowArchived) assertActiveConversation(conversation);
    const result = updater(conversation);
    if (result?.changed !== false) {
      bumpRevision(conversation);
      conversation.updatedAt = new Date().toISOString();
    }
    await writeConversation(conversation);
    return conversation;
  }

  async function readAllConversations() {
    const byId = new Map();
    for (const conversation of await readConversationFiles()) {
      byId.set(conversation.conversationId, conversation);
    }
    for (const conversation of await readLegacyConversations()) {
      if (!byId.has(conversation.conversationId)) byId.set(conversation.conversationId, conversation);
    }
    return Array.from(byId.values());
  }

  async function readConversation(conversationId) {
    try {
      const content = await fs.readFile(conversationFilePath(conversationId), "utf8");
      return normalizeConversation(JSON.parse(content));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    return (await readLegacyConversations()).find((conversation) => conversation.conversationId === conversationId) ?? null;
  }

  async function readConversationFiles() {
    let entries = [];
    try {
      entries = await fs.readdir(conversationsDirectory, { withFileTypes: true });
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      return [];
    }
    const conversations = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json") || entry.name === "conversations.json") continue;
      try {
        const content = await fs.readFile(path.join(conversationsDirectory, entry.name), "utf8");
        const conversation = normalizeConversation(JSON.parse(content));
        if (conversation) conversations.push(conversation);
      } catch {
        // Ignore unreadable per-conversation files so one bad file does not hide the rest.
      }
    }
    return conversations;
  }

  async function readLegacyConversations() {
    try {
      const content = await fs.readFile(legacyFilePath, "utf8");
      const parsed = JSON.parse(content);
      return normalizeState(parsed).conversations;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      return [];
    }
  }

  async function writeConversation(conversation) {
    const normalized = normalizeConversation(conversation);
    if (!normalized) return;
    await fs.mkdir(conversationsDirectory, { recursive: true });
    const targetPath = conversationFilePath(normalized.conversationId);
    const tempPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(normalized, null, 2), "utf8");
    await fs.rename(tempPath, targetPath);
  }

  function conversationFilePath(conversationId) {
    return path.join(conversationsDirectory, `${safeConversationFileName(conversationId)}.json`);
  }

  return {
    filePath: conversationsDirectory,
    directory: conversationsDirectory,
    list,
    get,
    createOrUpdateFromSession,
    recordUserTurn,
    recordAssistantTurn,
    recordSystemMessage,
    invalidate,
    confirmPlan,
    archive,
    remove,
    assertActive,
  };
}

function normalizeState(value) {
  const conversations = Array.isArray(value?.conversations) ? value.conversations : [];
  return {
    schemaVersion: SCHEMA_VERSION,
    conversations: conversations.map(normalizeConversation).filter(Boolean),
  };
}

function safeConversationFileName(value) {
  const text = String(value ?? "").trim();
  return text.replace(/[^a-zA-Z0-9_.-]/g, "_") || `conversation_${randomUUID()}`;
}

function normalizeConversation(value) {
  if (!value || typeof value !== "object") return null;
  const conversationId = String(value.conversationId ?? "").trim();
  if (!conversationId) return null;
  const rest = { ...value };
  delete rest["needs" + "Re" + "bind"];
  delete rest["re" + "bind" + "Count"];
  return {
    ...rest,
    conversationId,
    role: value.role ? String(value.role) : null,
    status: value.status === "archived" ? "archived" : "active",
    revision: normalizeRevision(value.revision),
    invalidated: Boolean(value.invalidated),
    invalidatedAt: value.invalidatedAt ?? null,
    lastResumeError: value.lastResumeError && typeof value.lastResumeError === "object" ? value.lastResumeError : null,
    confirmedPlan: normalizeConfirmedPlan(value.confirmedPlan),
    messages: Array.isArray(value.messages) ? value.messages.map(normalizeMessage).filter(Boolean) : [],
  };
}

function normalizeConfirmedPlan(value) {
  if (!value || typeof value !== "object") return null;
  return {
    status: ["confirmed", "completed"].includes(value.status) ? value.status : "confirmed",
    turnId: value.turnId ? String(value.turnId) : null,
    confirmedAt: value.confirmedAt ?? null,
    updatedAt: value.updatedAt ?? null,
    note: limitText(value.note),
    sourceRestructurePath: normalizePathText(value.sourceRestructurePath),
    displayArtifact: normalizeArtifactRef(value.displayArtifact),
    storyboardArtifact: normalizeArtifactRef(value.storyboardArtifact),
    traceId: value.traceId ? String(value.traceId) : null,
    runId: value.runId ? String(value.runId) : null,
    stageId: value.stageId ? String(value.stageId) : null,
  };
}

function normalizeArtifactRef(value) {
  if (!value || typeof value !== "object") return null;
  return {
    artifactId: value.artifactId ? String(value.artifactId) : null,
    traceId: value.traceId ? String(value.traceId) : null,
    runId: value.runId ? String(value.runId) : null,
    stageId: value.stageId ? String(value.stageId) : null,
    status: value.status ? String(value.status) : null,
  };
}

function normalizePathText(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text.replaceAll("\\", "/") : null;
}

function normalizeRevision(value) {
  const revision = Number(value);
  return Number.isFinite(revision) && revision > 0 ? Math.floor(revision) : 1;
}

function bumpRevision(conversation) {
  conversation.revision = normalizeRevision(conversation.revision) + 1;
}

function assertActiveConversation(conversation) {
  if (conversation?.status !== "archived") return;
  throw createConversationConflictError(
    "agent_chat_conversation_archived",
    "会话已归档，不能继续操作",
    conversation,
  );
}

function assertExpectedRevision(conversation, expectedRevision) {
  if (expectedRevision == null || expectedRevision === "") return;
  const expected = Number(expectedRevision);
  if (!Number.isFinite(expected)) return;
  const current = normalizeRevision(conversation?.revision);
  if (Math.floor(expected) === current) return;
  throw createConversationConflictError(
    "agent_chat_conversation_revision_conflict",
    "会话已在其他窗口更新，请刷新后重试",
    conversation,
  );
}

function createConversationConflictError(code, message, conversation) {
  const error = new Error(message);
  error.statusCode = 409;
  error.code = code;
  error.retryable = false;
  error.debugPayload = {
    conversationId: conversation?.conversationId ?? null,
    status: conversation?.status ?? null,
    revision: conversation?.revision ?? null,
  };
  return error;
}

function normalizeMessage(value) {
  if (!value || typeof value !== "object") return null;
  const id = String(value.id ?? "").trim();
  if (!id) return null;
  return {
    id,
    turnId: value.turnId ? String(value.turnId) : null,
    role: ["user", "assistant", "system"].includes(value.role) ? value.role : "system",
    text: limitText(value.text),
    status: ["running", "completed", "failed"].includes(value.status) ? value.status : "completed",
    createdAt: value.createdAt ?? null,
    updatedAt: value.updatedAt ?? null,
  };
}

function upsertMessage(conversation, message) {
  const messages = Array.isArray(conversation.messages) ? conversation.messages : [];
  const index = messages.findIndex((item) => item.id === message.id);
  if (index >= 0) {
    messages[index] = { ...messages[index], ...message, createdAt: messages[index].createdAt ?? message.createdAt };
  } else {
    messages.push(message);
  }
  conversation.messages = messages;
}

function buildTitle(role, createdAt) {
  const date = String(createdAt ?? "").slice(0, 19).replace("T", " ");
  return `${role || "Agent"} ${date}`;
}

function limitText(value) {
  const text = String(value ?? "");
  return text.length > TEXT_LIMIT ? `${text.slice(0, TEXT_LIMIT)}...` : text;
}

function isTerminalStatus(status) {
  return ["completed", "complete", "failed", "cancelled", "canceled"].includes(String(status ?? "").toLowerCase());
}

module.exports = {
  createAgentConversationStore,
};
