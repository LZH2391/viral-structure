const { randomUUID } = require("crypto");

const SCHEMA_VERSION = "agent_chat_conversations.v1";
const TEXT_LIMIT = 12000;

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
    threadStopped: Boolean(value.threadStopped),
    threadStoppedAt: value.threadStoppedAt ?? null,
    threadStopReason: value.threadStopReason ? String(value.threadStopReason) : null,
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
    confirmationId: normalizeIdText(value.confirmationId),
    confirmedAt: value.confirmedAt ?? null,
    updatedAt: value.updatedAt ?? null,
    note: limitText(value.note),
    sourceRestructurePath: normalizePathText(value.sourceRestructurePath),
    sourceShotDesignPath: normalizePathText(value.sourceShotDesignPath),
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

function normalizeIdText(value) {
  const text = String(value ?? "").trim();
  return text ? text.replace(/[^A-Za-z0-9_.:-]+/g, "_") : null;
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
    status: normalizeMessageStatus(value.status),
    slotAtomDisplay: normalizeSlotAtomDisplay(value.slotAtomDisplay),
    dialogueRoboticReview: normalizeDialogueRoboticReview(value.dialogueRoboticReview),
    createdAt: value.createdAt ?? null,
    updatedAt: value.updatedAt ?? null,
  };
}

function normalizeDialogueRoboticReview(value) {
  if (!value || typeof value !== "object") return null;
  return {
    schemaVersion: String(value.schemaVersion ?? "function_slot_dialogue_robotic_review_summary.v1"),
    status: String(value.status ?? "processed"),
    decision: ["pass", "rework", "blocked"].includes(value.decision) ? value.decision : null,
    issueCount: normalizeCount(value.issueCount),
    shotDesignFinalPath: normalizePathText(value.shotDesignFinalPath),
    reviewOutputPath: normalizePathText(value.reviewOutputPath),
    sourceMode: value.sourceMode ? String(value.sourceMode) : null,
    trigger: value.trigger ? String(value.trigger) : null,
    artifactId: value.artifactId ? String(value.artifactId) : null,
    role: value.role ? String(value.role) : null,
    turnId: value.turnId ? String(value.turnId) : null,
    promptTemplateVersion: value.promptTemplateVersion ? String(value.promptTemplateVersion) : null,
    fileFingerprint: normalizeFileFingerprint(value.fileFingerprint),
    dialogueFingerprint: normalizeDialogueFingerprint(value.dialogueFingerprint),
  };
}

function normalizeSlotAtomDisplay(value) {
  if (!value || typeof value !== "object") return null;
  return {
    schemaVersion: String(value.schemaVersion ?? "function_slot_restructure_slot_atom_display.v1"),
    status: value.status === "available" ? "available" : value.status === "empty" ? "empty" : "available",
    displayJsonPath: normalizePathText(value.displayJsonPath),
    slotCount: normalizeCount(value.slotCount),
    atomBindingCount: normalizeCount(value.atomBindingCount),
    selectedSlotSubtypeId: value.selectedSlotSubtypeId ? String(value.selectedSlotSubtypeId) : null,
    fileFingerprint: normalizeFileFingerprint(value.fileFingerprint),
    slots: Array.isArray(value.slots) ? value.slots.map(normalizeSlotSummary).filter(Boolean) : [],
    atoms: Array.isArray(value.atoms) ? value.atoms.map(normalizeAtomSummary).filter(Boolean) : [],
  };
}

function normalizeFileFingerprint(value) {
  if (!value || typeof value !== "object") return null;
  return {
    path: normalizePathText(value.path),
    size: normalizeCount(value.size),
    mtimeMs: normalizeCount(value.mtimeMs),
    sha256: value.sha256 ? String(value.sha256) : null,
  };
}

function normalizeSlotSummary(value) {
  if (!value || typeof value !== "object") return null;
  return {
    index: normalizeCount(value.index),
    demand: limitText(value.demand),
    slotSubtype: limitText(value.slotSubtype),
    slotSubtypeId: value.slotSubtypeId ? String(value.slotSubtypeId) : null,
    archetype: limitText(value.archetype),
    archetypeId: value.archetypeId ? String(value.archetypeId) : null,
    functionText: limitText(value.functionText),
    usage: limitText(value.usage),
    reason: limitText(value.reason),
  };
}

function normalizeAtomSummary(value) {
  if (!value || typeof value !== "object") return null;
  return {
    slotSubtype: limitText(value.slotSubtype),
    slotSubtypeId: value.slotSubtypeId ? String(value.slotSubtypeId) : null,
    source: limitText(value.source),
    scriptAtom: limitText(value.scriptAtom),
    rhythmAtom: limitText(value.rhythmAtom),
    packagingAtom: limitText(value.packagingAtom),
    handling: limitText(value.handling),
  };
}

function normalizeDialogueFingerprint(value) {
  if (!value || typeof value !== "object") return null;
  return {
    path: normalizePathText(value.path),
    size: normalizeCount(value.size),
    sha256: value.sha256 ? String(value.sha256) : null,
    entryCount: normalizeCount(value.entryCount),
    nonEmptyCount: normalizeCount(value.nonEmptyCount),
  };
}

function normalizeCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
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

function normalizeMessageStatus(status) {
  const value = String(status ?? "").trim().toLowerCase();
  if (["running", "completed", "failed", "canceled"].includes(value)) return value;
  if (value === "cancelled") return "canceled";
  return isTerminalStatus(value) ? "completed" : "running";
}
module.exports = {
  assertActiveConversation,
  assertExpectedRevision,
  buildTitle,
  bumpRevision,
  createConversationConflictError,
  isTerminalStatus,
  limitText,
  normalizeArtifactRef,
  normalizeAtomSummary,
  normalizeConfirmedPlan,
  normalizeConversation,
  normalizeCount,
  normalizeDialogueFingerprint,
  normalizeDialogueRoboticReview,
  normalizeFileFingerprint,
  normalizeIdText,
  normalizeMessage,
  normalizeMessageStatus,
  normalizePathText,
  normalizeRevision,
  normalizeSlotAtomDisplay,
  normalizeSlotSummary,
  normalizeState,
  safeConversationFileName,
  upsertMessage,
};
