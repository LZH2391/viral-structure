const fs = require("fs/promises");
const path = require("path");
const { randomUUID } = require("crypto");
const {
  assertActiveConversation,
  assertExpectedRevision,
  buildTitle,
  bumpRevision,
  createConversationConflictError,
  isTerminalStatus,
  limitText,
  normalizeArtifactRef,
  normalizeConfirmedPlan,
  normalizeConversation,
  normalizeDialogueRoboticReview,
  normalizeIdText,
  normalizeMessage,
  normalizeMessageStatus,
  normalizePathText,
  normalizeRevision,
  normalizeSlotAtomDisplay,
  normalizeState,
  normalizeTitleState,
  safeConversationFileName,
  upsertMessage,
} = require("./conversation-normalizers");

function resolveConversationsDirectory({ store, filePath }) {
  if (!filePath) return path.join(store.runtimeRoot, "AgentConversations");
  const basename = path.basename(filePath);
  return basename.endsWith(".json") ? path.dirname(filePath) : filePath;
}

function createAgentConversationStore({ store, filePath } = {}) {
  if (!store?.runtimeRoot && !filePath) throw new Error("store or filePath is required for agent conversation store");
  const conversationsDirectory = resolveConversationsDirectory({ store, filePath });
  const legacyFilePath = path.join(conversationsDirectory, "conversations.json");
  const conversationLocks = new Map();

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
    if (conversationId) {
      return withConversationLock(conversationId, () => createOrUpdateFromSessionUnlocked(session, { conversationId, sampleVideoId, expectedRevision }));
    }
    return createOrUpdateFromSessionUnlocked(session, { conversationId, sampleVideoId, expectedRevision });
  }

  async function createOrUpdateFromSessionUnlocked(session, { conversationId = null, sampleVideoId = null, expectedRevision = null } = {}) {
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
        threadStopped: false,
        threadStoppedAt: null,
        threadStopReason: null,
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
        threadStopped: false,
        threadStoppedAt: null,
        threadStopReason: null,
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
    return withConversationLock(conversationId, async () => {
      const conversation = await readConversation(conversationId);
      if (!conversation) return null;
      await fs.rm(conversationFilePath(conversationId), { force: true });
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

  async function recordAssistantTurn({ conversationId, turnId, text, status, traceId = null, runId = null, stageId = null, slotAtomDisplay = null, dialogueRoboticReview = null }) {
    if (!conversationId || !turnId) return null;
    const now = new Date().toISOString();
    return mutateConversation(conversationId, (conversation) => {
      const isCurrentTurn = !conversation.latestTurnId || String(conversation.latestTurnId) === String(turnId);
      if (isCurrentTurn) conversation.latestTurnId = turnId;
      conversation.traceId = traceId ?? conversation.traceId ?? null;
      conversation.runId = runId ?? conversation.runId ?? null;
      conversation.stageId = stageId ?? conversation.stageId ?? null;
      upsertMessage(conversation, {
        id: `assistant-${turnId}`,
        turnId,
        role: "assistant",
        text: limitText(text || "生成中"),
        status: normalizeMessageStatus(status),
        slotAtomDisplay: normalizeSlotAtomDisplay(slotAtomDisplay),
        dialogueRoboticReview: normalizeDialogueRoboticReview(dialogueRoboticReview),
        createdAt: now,
        updatedAt: now,
      });
    }, { skipArchived: true });
  }

  async function attachDialogueRoboticReview({ conversationId, turnId = null, dialogueRoboticReview = null, traceId = null, runId = null, stageId = null, expectedRevision = null }) {
    if (!conversationId || !dialogueRoboticReview) return null;
    const now = new Date().toISOString();
    return mutateConversation(conversationId, (conversation) => {
      assertExpectedRevision(conversation, expectedRevision);
      const targetTurnId = turnId ?? conversation.latestTurnId ?? null;
      const messages = Array.isArray(conversation.messages) ? conversation.messages : [];
      let index = targetTurnId
        ? messages.findIndex((message) => message.id === `assistant-${targetTurnId}` || (message.role === "assistant" && String(message.turnId ?? "") === String(targetTurnId)))
        : -1;
      if (index < 0) {
        for (let cursor = messages.length - 1; cursor >= 0; cursor -= 1) {
          if (messages[cursor]?.role === "assistant") {
            index = cursor;
            break;
          }
        }
      }
      conversation.traceId = traceId ?? conversation.traceId ?? null;
      conversation.runId = runId ?? conversation.runId ?? null;
      conversation.stageId = stageId ?? conversation.stageId ?? null;
      if (index >= 0) {
        messages[index] = {
          ...messages[index],
          dialogueRoboticReview: normalizeDialogueRoboticReview(dialogueRoboticReview),
          updatedAt: now,
        };
        conversation.messages = messages;
      } else {
        upsertMessage(conversation, {
          id: `assistant-dialogue-review-${targetTurnId ?? now}`,
          turnId: targetTurnId,
          role: "assistant",
          text: "台词机器人感审查已完成",
          status: "completed",
          dialogueRoboticReview: normalizeDialogueRoboticReview(dialogueRoboticReview),
          createdAt: now,
          updatedAt: now,
        });
      }
    }, { skipArchived: true });
  }

  async function recordTurnStopped({ conversationId, turnId, text = "已停止当前 turn", traceId = null, runId = null, stageId = null, expectedRevision = null }) {
    if (!conversationId || !turnId) return null;
    const now = new Date().toISOString();
    return mutateConversation(conversationId, (conversation) => {
      assertExpectedRevision(conversation, expectedRevision);
      conversation.latestTurnId = turnId;
      conversation.traceId = traceId ?? conversation.traceId ?? null;
      conversation.runId = runId ?? conversation.runId ?? null;
      conversation.stageId = stageId ?? conversation.stageId ?? null;
      upsertMessage(conversation, {
        id: `assistant-${turnId}`,
        turnId,
        role: "assistant",
        text: limitText(text),
        status: "canceled",
        createdAt: now,
        updatedAt: now,
      });
    }, { skipArchived: true });
  }

  async function updateTitleState({ conversationId, titleState = null, traceId = null, runId = null, stageId = null, expectedRevision = null }) {
    if (!conversationId || !titleState) return null;
    return mutateConversation(conversationId, (conversation) => {
      assertExpectedRevision(conversation, expectedRevision);
      conversation.titleState = normalizeTitleState(titleState);
      conversation.traceId = traceId ?? conversation.traceId ?? null;
      conversation.runId = runId ?? conversation.runId ?? null;
      conversation.stageId = stageId ?? conversation.stageId ?? null;
    }, { skipArchived: true });
  }

  async function updateTitle({ conversationId, title = null, titleState = null, traceId = null, runId = null, stageId = null, expectedRevision = null }) {
    if (!conversationId) return null;
    return mutateConversation(conversationId, (conversation) => {
      assertExpectedRevision(conversation, expectedRevision);
      const normalizedTitle = limitText(title).trim();
      if (normalizedTitle) conversation.title = normalizedTitle;
      if (titleState) conversation.titleState = normalizeTitleState(titleState);
      conversation.traceId = traceId ?? conversation.traceId ?? null;
      conversation.runId = runId ?? conversation.runId ?? null;
      conversation.stageId = stageId ?? conversation.stageId ?? null;
    }, { skipArchived: true });
  }

  async function stopThread({ conversationId, reason = null, traceId = null, runId = null, stageId = null, expectedRevision = null }) {
    if (!conversationId) return null;
    const now = new Date().toISOString();
    return mutateConversation(conversationId, (conversation) => {
      assertExpectedRevision(conversation, expectedRevision);
      conversation.threadStopped = true;
      conversation.threadStoppedAt = now;
      conversation.threadStopReason = limitText(reason);
      conversation.traceId = traceId ?? conversation.traceId ?? null;
      conversation.runId = runId ?? conversation.runId ?? null;
      conversation.stageId = stageId ?? conversation.stageId ?? null;
      upsertMessage(conversation, {
        id: `system-thread-stopped-${now}-${randomUUID()}`,
        turnId: conversation.latestTurnId ?? null,
        role: "system",
        text: limitText(reason ? `已停止当前 thread：${reason}` : "已停止当前 thread"),
        status: "completed",
        createdAt: now,
        updatedAt: now,
      });
    });
  }

  async function bindThread({ conversationId, threadId, parentThreadId = null, leaseId = null, ownerId = null, workspaceRoot = null, skillPath = null, source = null, traceId = null, runId = null, stageId = null, expectedRevision = null, replace = false }) {
    if (!conversationId || !threadId) return null;
    return mutateConversation(conversationId, (conversation) => {
      assertExpectedRevision(conversation, expectedRevision);
      conversation.threadId = threadId;
      conversation.parentThreadId = replace ? parentThreadId ?? null : parentThreadId ?? conversation.parentThreadId ?? null;
      conversation.leaseId = replace ? leaseId ?? null : leaseId ?? conversation.leaseId ?? null;
      conversation.ownerId = replace ? ownerId ?? null : ownerId ?? conversation.ownerId ?? null;
      conversation.workspaceRoot = replace ? workspaceRoot ?? null : workspaceRoot ?? conversation.workspaceRoot ?? null;
      conversation.skillPath = replace ? skillPath ?? null : skillPath ?? conversation.skillPath ?? null;
      conversation.source = replace ? source ?? null : source ?? conversation.source ?? null;
      conversation.threadStopped = false;
      conversation.threadStoppedAt = null;
      conversation.threadStopReason = null;
      conversation.traceId = traceId ?? conversation.traceId ?? null;
      conversation.runId = runId ?? conversation.runId ?? null;
      conversation.stageId = stageId ?? conversation.stageId ?? null;
    });
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

  async function confirmPlan({ conversationId, turnId = null, confirmationId = null, note = null, sourceRestructurePath = null, sourceShotDesignPath = null, displayArtifact = null, storyboardArtifact = null, traceId = null, runId = null, stageId = null, expectedRevision = null }) {
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
        confirmationId: normalizeIdText(confirmationId),
        confirmedAt: conversation.confirmedPlan?.confirmedAt ?? now,
        updatedAt: now,
        note: limitText(note),
        sourceRestructurePath: normalizePathText(sourceRestructurePath),
        sourceShotDesignPath: normalizePathText(sourceShotDesignPath),
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
    return withConversationLock(conversationId, () => mutateConversationUnlocked(conversationId, updater, { allowArchived, skipArchived }));
  }

  async function mutateConversationUnlocked(conversationId, updater, { allowArchived = false, skipArchived = false } = {}) {
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
    const tempPath = `${targetPath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(normalized, null, 2), "utf8");
    await fs.rename(tempPath, targetPath);
  }

  async function withConversationLock(conversationId, action) {
    if (!conversationId) return action();
    const key = String(conversationId);
    const previous = conversationLocks.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(action);
    conversationLocks.set(key, next);
    try {
      return await next;
    } finally {
      if (conversationLocks.get(key) === next) conversationLocks.delete(key);
    }
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
    attachDialogueRoboticReview,
    recordTurnStopped,
    updateTitleState,
    updateTitle,
    stopThread,
    bindThread,
    recordSystemMessage,
    invalidate,
    confirmPlan,
    archive,
    remove,
    assertActive,
  };
}

module.exports = {
  createAgentConversationStore,
};
