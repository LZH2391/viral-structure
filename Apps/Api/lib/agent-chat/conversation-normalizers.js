const { randomUUID } = require("crypto");

const SCHEMA_VERSION = "agent_chat_conversations.v1";
const TEXT_LIMIT = 12000;
const MATERIAL_GAP_TEXT_LIMIT = 360;
const MATERIAL_GAP_ROWS_LIMIT = 40;
const MATERIAL_GAP_ARRAY_LIMIT = 12;
const MATERIAL_GAP_DIRECT_SATISFACTIONS = new Set(["satisfied", "partial", "missing", "unsafe", "not_required"]);
const MATERIAL_GAP_MATERIAL_TYPES = new Set([
  "opening_hook_shot",
  "product_closeup_shot",
  "usage_process_shot",
  "comparison_shot",
  "ending_cta_shot",
]);
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
    title: limitText(value.title) || buildTitle(value.role, value.createdAt),
    titleState: normalizeTitleState(value.titleState),
    confirmedPlan: normalizeConfirmedPlan(value.confirmedPlan),
    messages: Array.isArray(value.messages) ? value.messages.map(normalizeMessage).filter(Boolean) : [],
  };
}

function normalizeTitleState(value) {
  if (!value || typeof value !== "object") return null;
  const status = String(value.status ?? "").trim();
  return {
    status: ["idle", "generating", "completed", "failed"].includes(status) ? status : "idle",
    source: value.source ? String(value.source) : null,
    role: value.role ? String(value.role) : null,
    sourceTurnId: value.sourceTurnId ? String(value.sourceTurnId) : null,
    titleThreadId: value.titleThreadId ? String(value.titleThreadId) : null,
    titleTurnId: value.titleTurnId ? String(value.titleTurnId) : null,
    leaseId: value.leaseId ? String(value.leaseId) : null,
    ownerId: value.ownerId ? String(value.ownerId) : null,
    workspaceRoot: value.workspaceRoot ? String(value.workspaceRoot) : null,
    firstMessagePreview: limitText(value.firstMessagePreview ?? value.firstSentencePreview),
    firstMessageChars: normalizeCount(value.firstMessageChars ?? value.firstSentenceChars),
    promptTemplateVersion: value.promptTemplateVersion ? String(value.promptTemplateVersion) : null,
    generatedAt: value.generatedAt ?? null,
    confidence: normalizeNullableNumber(value.confidence),
    rawPreview: limitText(value.rawPreview),
    errorSummary: value.errorSummary && typeof value.errorSummary === "object" ? value.errorSummary : null,
    traceId: value.traceId ? String(value.traceId) : null,
    runId: value.runId ? String(value.runId) : null,
    stageId: value.stageId ? String(value.stageId) : null,
  };
}

function normalizeConfirmedPlan(value) {
  if (!value || typeof value !== "object") return null;
  const status = normalizeConfirmedPlanStatus(value.status, value.storyboardArtifact, value.displayArtifact);
  const versions = normalizeStoryboardVersions(value.storyboardVersions ?? value.versions);
  const defaultVersionId = normalizeIdText(value.defaultVersionId) ?? versions[0]?.versionId ?? null;
  return {
    status,
    mode: normalizeStoryboardMode(value.storyboardMode ?? value.mode, versions),
    defaultVersionId,
    turnId: value.turnId ? String(value.turnId) : null,
    confirmationId: normalizeIdText(value.confirmationId),
    confirmedAt: value.confirmedAt ?? null,
    updatedAt: value.updatedAt ?? null,
    note: limitText(value.note),
    sourceRestructurePath: normalizePathText(value.sourceRestructurePath),
    sourceShotDesignPath: normalizePathText(value.sourceShotDesignPath),
    displayArtifact: normalizeArtifactRef(value.displayArtifact),
    storyboardArtifact: normalizeArtifactRef(value.storyboardArtifact),
    storyboardVersions: versions,
    traceId: value.traceId ? String(value.traceId) : null,
    runId: value.runId ? String(value.runId) : null,
    stageId: value.stageId ? String(value.stageId) : null,
  };
}

function normalizeArtifactRef(value) {
  if (!value || typeof value !== "object") return null;
  return {
    artifactId: value.artifactId ? String(value.artifactId) : null,
    processingJobId: value.processingJobId ? String(value.processingJobId) : null,
    traceId: value.traceId ? String(value.traceId) : null,
    runId: value.runId ? String(value.runId) : null,
    stageId: value.stageId ? String(value.stageId) : null,
    status: value.status ? String(value.status) : null,
  };
}

function normalizeStoryboardMode(value, versions = []) {
  const text = String(value ?? "").trim();
  if (text === "multi_version") return "multi_version";
  return versions.length > 1 ? "multi_version" : "single";
}

function normalizeConfirmedPlanStatus(status, storyboardArtifact = null, displayArtifact = null) {
  const value = String(status ?? "").trim();
  if (["confirmed", "storyboard_processing", "storyboard_failed", "completed"].includes(value)) return value;
  if (value === "storyboard_processed") return "completed";
  const storyboardStatus = String(storyboardArtifact?.status ?? "").trim();
  if (["processing", "submitted", "running"].includes(storyboardStatus)) return "storyboard_processing";
  if (storyboardStatus === "failed") return "storyboard_failed";
  if (storyboardStatus === "processed" || storyboardStatus === "completed" || displayArtifact) return "completed";
  return "confirmed";
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
    userInputOrigin: normalizeUserInputOrigin(value.userInputOrigin),
    autoAdvanceKey: normalizeIdText(value.autoAdvanceKey),
    sourceRestructurePath: normalizePathText(value.sourceRestructurePath),
    sourceRestructureFingerprint: normalizeFileFingerprint(value.sourceRestructureFingerprint),
    sourceDisplayFingerprint: normalizeFileFingerprint(value.sourceDisplayFingerprint),
    materialPackRef: normalizeMaterialPackRef(value.materialPackRef),
    slotAtomDisplay: normalizeSlotAtomDisplay(value.slotAtomDisplay),
    dialogueRoboticReview: normalizeDialogueRoboticReview(value.dialogueRoboticReview),
    storyboardResult: normalizeStoryboardResult(value.storyboardResult),
    materialGapMatrix: normalizeMaterialGapMatrix(value.materialGapMatrix),
    createdAt: value.createdAt ?? null,
    updatedAt: value.updatedAt ?? null,
  };
}

function normalizeUserInputOrigin(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized) return null;
  return normalized.slice(0, 80);
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

function normalizeStoryboardResult(value) {
  if (!value || typeof value !== "object") return null;
  const artifact = normalizeArtifactRef(value.storyboardArtifact);
  const versions = normalizeStoryboardVersions(value.versions ?? value.storyboardVersions);
  const defaultVersionId = normalizeIdText(value.defaultVersionId) ?? versions[0]?.versionId ?? null;
  return {
    schemaVersion: String(value.schemaVersion ?? "agent_chat_storyboard_result_message.v1"),
    mode: normalizeStoryboardMode(value.mode ?? value.storyboardMode, versions),
    defaultVersionId,
    planRevisionKey: normalizeIdText(value.planRevisionKey),
    turnId: value.turnId ? String(value.turnId) : null,
    confirmationId: normalizeIdText(value.confirmationId),
    status: normalizeConfirmedPlanStatus(value.status, value.storyboardArtifact, null),
    sourceRestructurePath: normalizePathText(value.sourceRestructurePath),
    sourceShotDesignPath: normalizePathText(value.sourceShotDesignPath),
    storyboardArtifact: artifact,
    versions,
    artifactId: value.artifactId ? String(value.artifactId) : artifact?.artifactId ?? null,
    processingJobId: value.processingJobId ? String(value.processingJobId) : artifact?.processingJobId ?? null,
    traceId: value.traceId ? String(value.traceId) : artifact?.traceId ?? null,
    runId: value.runId ? String(value.runId) : artifact?.runId ?? null,
    stageId: value.stageId ? String(value.stageId) : artifact?.stageId ?? null,
    createdAt: value.createdAt ?? null,
    updatedAt: value.updatedAt ?? null,
  };
}

function normalizeMaterialPackRef(value) {
  if (!value || typeof value !== "object") return null;
  const sampleVideoId = normalizeIdText(value.sampleVideoId);
  const resultUri = normalizePathText(value.resultUri ?? value.uri);
  if (!sampleVideoId && !resultUri) return null;
  return {
    sampleVideoId,
    artifactId: value.artifactId ? String(value.artifactId) : null,
    title: limitText(value.title),
    traceId: normalizeIdText(value.traceId),
    resultUri,
    shotCardCount: normalizeCount(value.shotCardCount),
    materialGroupCount: normalizeCount(value.materialGroupCount),
    proofCoverageCount: normalizeCount(value.proofCoverageCount),
  };
}

function normalizeMaterialGapMatrix(value) {
  if (!value || typeof value !== "object") return null;
  const rows = Array.isArray(value.rows) ? value.rows.map(normalizeMaterialGapRow).filter(Boolean).slice(0, MATERIAL_GAP_ROWS_LIMIT) : [];
  return {
    schemaVersion: String(value.schemaVersion ?? "material_gap_matrix.v1"),
    status: String(value.status ?? (rows.length ? "processed" : "failed")),
    artifactId: value.artifactId ? String(value.artifactId) : null,
    parentArtifactId: value.parentArtifactId ? String(value.parentArtifactId) : null,
    matrixJsonPath: normalizePathText(value.matrixJsonPath ?? value.outputJsonPath),
    sourceRestructurePath: normalizePathText(value.sourceRestructurePath),
    sourceMaterialPackArtifactId: value.sourceMaterialPackArtifactId ? String(value.sourceMaterialPackArtifactId) : null,
    sourceMaterialPackPath: normalizePathText(value.sourceMaterialPackPath),
    slotChainFingerprint: normalizePlainObject(value.slotChainFingerprint),
    summary: normalizeMaterialGapSummary(value.summary, rows),
    rows,
    traceId: normalizeIdText(value.traceId),
    runId: normalizeIdText(value.runId),
    stageId: normalizeIdText(value.stageId),
    stageName: value.stageName ? String(value.stageName) : null,
    role: value.role ? String(value.role) : null,
    turnId: value.turnId ? String(value.turnId) : null,
    promptTemplateVersion: value.promptTemplateVersion ? String(value.promptTemplateVersion) : null,
    error: value.error ? String(value.error) : null,
    message: limitText(value.message),
    debugSnapshotUri: normalizePathText(value.debugSnapshotUri),
    createdAt: value.createdAt ?? null,
    updatedAt: value.updatedAt ?? null,
  };
}

function normalizeMaterialGapSummary(value, rows) {
  const computed = rows.reduce((acc, row) => {
    if (row.directSatisfaction === "satisfied") acc.satisfiedCount += 1;
    if (row.directSatisfaction === "partial") acc.partialCount += 1;
    if (row.directSatisfaction === "missing") acc.missingCount += 1;
    if (row.directSatisfaction === "unsafe") acc.unsafeCount += 1;
    if (row.directSatisfaction === "not_required") acc.notRequiredCount += 1;
    row.missingMaterialTypes.forEach((item) => acc.missingTypeCounts.set(item, (acc.missingTypeCounts.get(item) ?? 0) + 1));
    return acc;
  }, {
    satisfiedCount: 0,
    partialCount: 0,
    missingCount: 0,
    unsafeCount: 0,
    notRequiredCount: 0,
    missingTypeCounts: new Map(),
  });
  const topMissingMaterialTypes = normalizeStringArray(value?.topMissingMaterialTypes, MATERIAL_GAP_ARRAY_LIMIT).filter((item) => MATERIAL_GAP_MATERIAL_TYPES.has(item));
  return {
    slotCount: normalizeCount(value?.slotCount) ?? rows.length,
    satisfiedCount: normalizeCount(value?.satisfiedCount) ?? computed.satisfiedCount,
    partialCount: normalizeCount(value?.partialCount) ?? computed.partialCount,
    missingCount: normalizeCount(value?.missingCount) ?? computed.missingCount,
    unsafeCount: normalizeCount(value?.unsafeCount) ?? computed.unsafeCount,
    notRequiredCount: normalizeCount(value?.notRequiredCount ?? value?.not_requiredCount) ?? computed.notRequiredCount,
    topMissingMaterialTypes: topMissingMaterialTypes.length ? topMissingMaterialTypes : Array.from(computed.missingTypeCounts.entries()).sort((a, b) => b[1] - a[1]).map(([key]) => key).slice(0, 5),
    overallImpact: limitTextTo(value?.overallImpact, MATERIAL_GAP_TEXT_LIMIT),
  };
}

function normalizeMaterialGapRow(value) {
  if (!value || typeof value !== "object") return null;
  const directSatisfaction = MATERIAL_GAP_DIRECT_SATISFACTIONS.has(String(value.directSatisfaction ?? "")) ? String(value.directSatisfaction) : "missing";
  return {
    slotId: limitTextTo(value.slotId, 80),
    slotSubtype: limitTextTo(value.slotSubtype, 160),
    slotFunction: limitTextTo(value.slotFunction, MATERIAL_GAP_TEXT_LIMIT),
    requiredMaterialTypes: normalizeStringArray(value.requiredMaterialTypes, MATERIAL_GAP_ARRAY_LIMIT).filter((item) => MATERIAL_GAP_MATERIAL_TYPES.has(item)),
    directSatisfaction,
    missingMaterialTypes: normalizeStringArray(value.missingMaterialTypes, MATERIAL_GAP_ARRAY_LIMIT).filter((item) => MATERIAL_GAP_MATERIAL_TYPES.has(item)),
    impact: limitTextTo(value.impact, MATERIAL_GAP_TEXT_LIMIT),
    availableEvidenceRefs: normalizeStringArray(value.availableEvidenceRefs, MATERIAL_GAP_ARRAY_LIMIT),
    handoffToShotDesign: limitTextTo(value.handoffToShotDesign, MATERIAL_GAP_TEXT_LIMIT),
  };
}

function normalizeStoryboardVersions(value) {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeStoryboardVersion).filter(Boolean);
}

function normalizeStoryboardVersion(value) {
  if (!value || typeof value !== "object") return null;
  const versionId = normalizeIdText(value.versionId);
  const artifact = normalizeArtifactRef(value.storyboardArtifact);
  if (!versionId && !artifact && !value.sourceRestructurePath && !value.sourceShotDesignPath) return null;
  return {
    versionId,
    versionName: limitText(value.versionName || value.name || versionId || "默认方案"),
    status: normalizeConfirmedPlanStatus(value.status, artifact, null),
    sourceRestructurePath: normalizePathText(value.sourceRestructurePath ?? value.restructureFinalPath),
    sourceShotDesignPath: normalizePathText(value.sourceShotDesignPath ?? value.shotDesignFinalPath),
    storyboardArtifact: artifact,
    artifactId: value.artifactId ? String(value.artifactId) : artifact?.artifactId ?? null,
    processingJobId: value.processingJobId ? String(value.processingJobId) : artifact?.processingJobId ?? null,
    traceId: value.traceId ? String(value.traceId) : artifact?.traceId ?? null,
    runId: value.runId ? String(value.runId) : artifact?.runId ?? null,
    stageId: value.stageId ? String(value.stageId) : artifact?.stageId ?? null,
    error: value.error ? String(value.error) : null,
    message: limitText(value.message),
  };
}

function normalizeSlotAtomDisplay(value) {
  if (!value || typeof value !== "object") return null;
  return {
    schemaVersion: String(value.schemaVersion ?? "function_slot_restructure_slot_atom_display.v1"),
    status: value.status === "available" ? "available" : "empty",
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

function normalizeNullableNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
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

function limitTextTo(value, limit) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function normalizeStringArray(value, limit = 12) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => limitTextTo(item, 120)).filter(Boolean).slice(0, limit);
}

function normalizePlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return Object.fromEntries(Object.entries(value)
    .slice(0, 24)
    .map(([key, item]) => [limitTextTo(key, 80), limitTextTo(typeof item === "object" ? JSON.stringify(item) : item, 240)])
    .filter(([key]) => key));
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
  normalizeConfirmedPlanStatus,
  normalizeConversation,
  normalizeCount,
  normalizeDialogueFingerprint,
  normalizeDialogueRoboticReview,
  normalizeFileFingerprint,
  normalizeIdText,
  normalizeMaterialGapMatrix,
  normalizeMaterialPackRef,
  normalizeMessage,
  normalizeMessageStatus,
  normalizePathText,
  normalizeRevision,
  normalizeSlotAtomDisplay,
  normalizeSlotSummary,
  normalizeStoryboardResult,
  normalizeStoryboardVersions,
  normalizeState,
  normalizeTitleState,
  safeConversationFileName,
  upsertMessage,
};
