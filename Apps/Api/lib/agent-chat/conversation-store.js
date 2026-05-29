const fs = require("fs/promises");
const path = require("path");
const { randomUUID } = require("crypto");

const SCHEMA_VERSION = "agent_chat_conversations.v1";
const TEXT_LIMIT = 12000;

function createAgentConversationStore({ store, filePath } = {}) {
  if (!store?.runtimeRoot && !filePath) throw new Error("store or filePath is required for agent conversation store");
  const resolvedFilePath = filePath ?? path.join(store.runtimeRoot, "AgentConversations", "conversations.json");

  async function list({ role, status = "active" } = {}) {
    const state = await readState();
    return state.conversations
      .filter((conversation) => !role || conversation.role === role)
      .filter((conversation) => !status || conversation.status === status)
      .sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));
  }

  async function get(conversationId) {
    const state = await readState();
    return state.conversations.find((conversation) => conversation.conversationId === conversationId) ?? null;
  }

  async function createOrUpdateFromSession(session, { conversationId = null, sampleVideoId = null } = {}) {
    const now = new Date().toISOString();
    return mutate((state) => {
      let conversation = conversationId
        ? state.conversations.find((item) => item.conversationId === conversationId)
        : null;
      if (!conversation) {
        conversation = {
          conversationId: conversationId || `conversation_${randomUUID()}`,
          schemaVersion: "agent_chat_conversation.v1",
          source: session.source ?? "threadpool-role",
          role: session.role ?? null,
          status: "active",
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
          messages: [],
        };
        state.conversations.unshift(conversation);
      } else {
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
          updatedAt: now,
          archivedAt: null,
        });
      }
      return conversation;
    });
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
    });
  }

  async function archive(conversationId) {
    const now = new Date().toISOString();
    return mutateConversation(conversationId, (conversation) => {
      conversation.status = "archived";
      conversation.archivedAt = now;
    });
  }

  async function mutateConversation(conversationId, updater) {
    return mutate((state) => {
      const conversation = state.conversations.find((item) => item.conversationId === conversationId);
      if (!conversation) return null;
      updater(conversation);
      conversation.updatedAt = new Date().toISOString();
      return conversation;
    });
  }

  async function mutate(updater) {
    const state = await readState();
    const result = updater(state);
    await writeState(state);
    return result;
  }

  async function readState() {
    try {
      const content = await fs.readFile(resolvedFilePath, "utf8");
      const parsed = JSON.parse(content);
      return normalizeState(parsed);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      return { schemaVersion: SCHEMA_VERSION, conversations: [] };
    }
  }

  async function writeState(state) {
    await fs.mkdir(path.dirname(resolvedFilePath), { recursive: true });
    await fs.writeFile(resolvedFilePath, JSON.stringify(normalizeState(state), null, 2), "utf8");
  }

  return {
    filePath: resolvedFilePath,
    list,
    get,
    createOrUpdateFromSession,
    recordUserTurn,
    recordAssistantTurn,
    archive,
  };
}

function normalizeState(value) {
  const conversations = Array.isArray(value?.conversations) ? value.conversations : [];
  return {
    schemaVersion: SCHEMA_VERSION,
    conversations: conversations.map(normalizeConversation).filter(Boolean),
  };
}

function normalizeConversation(value) {
  if (!value || typeof value !== "object") return null;
  const conversationId = String(value.conversationId ?? "").trim();
  if (!conversationId) return null;
  return {
    ...value,
    conversationId,
    role: value.role ? String(value.role) : null,
    status: value.status === "archived" ? "archived" : "active",
    messages: Array.isArray(value.messages) ? value.messages.map(normalizeMessage).filter(Boolean) : [],
  };
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
