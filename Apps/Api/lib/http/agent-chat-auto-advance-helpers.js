const { createHash } = require("crypto");
const { normalizeText } = require("./agent-chat-route-core");

function buildAutoAdvanceShotDesignSummary() {
  return "继续完善 Shot 设计";
}

function buildAutoAdvanceKey({ conversationId, restructureFinalPath, sourceTurnId = null, sourceRestructureFingerprint = null, sourceDisplayFingerprint = null }) {
  const payload = {
    conversationId: normalizeText(conversationId),
    restructureFinalPath: normalizeText(restructureFinalPath),
    sourceTurnId: normalizeText(sourceTurnId),
    restructureFingerprint: stableFingerprint(sourceRestructureFingerprint),
    displayFingerprint: stableFingerprint(sourceDisplayFingerprint),
  };
  return `auto_advance_${createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 24)}`;
}

function findDuplicateAutoAdvance(conversation, { autoAdvanceKey, restructureFinalPath, sourceRestructureFingerprint, sourceDisplayFingerprint }) {
  const messages = Array.isArray(conversation?.messages) ? conversation.messages : [];
  const restructurePath = normalizePath(restructureFinalPath);
  for (const message of messages) {
    if (message?.role !== "user" || normalizeText(message.userInputOrigin) !== "auto_advance") continue;
    if (normalizeText(message.autoAdvanceKey) === autoAdvanceKey) return message;
    if (restructurePath && normalizePath(message.sourceRestructurePath) === restructurePath) {
      const sameRestructure = fingerprintsMatch(message.sourceRestructureFingerprint, sourceRestructureFingerprint);
      const sameDisplay = fingerprintsMatch(message.sourceDisplayFingerprint, sourceDisplayFingerprint);
      if (sameRestructure || sameDisplay) return message;
    }
  }
  return null;
}

function normalizeFingerprint(value) {
  if (!value || typeof value !== "object") return null;
  return {
    path: normalizePath(value.path),
    size: normalizeNullableNumber(value.size),
    mtimeMs: normalizeNullableNumber(value.mtimeMs),
    sha256: normalizeText(value.sha256),
  };
}

function fingerprintsMatch(left, right) {
  const a = normalizeFingerprint(left);
  const b = normalizeFingerprint(right);
  if (!a || !b) return false;
  if (a.sha256 && b.sha256 && a.sha256 === b.sha256) return true;
  if (a.path && b.path && a.path === b.path && a.size === b.size && a.mtimeMs === b.mtimeMs) return true;
  return false;
}

function stableFingerprint(value) {
  const fingerprint = normalizeFingerprint(value);
  if (!fingerprint) return null;
  return {
    path: fingerprint.path,
    size: fingerprint.size,
    mtimeMs: fingerprint.mtimeMs,
    sha256: fingerprint.sha256,
  };
}

function normalizePath(value) {
  return normalizeText(value)?.replaceAll("\\", "/") ?? null;
}

function normalizeNullableNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function buildPlanRevisionKey({ conversationId, turnId, sourceRestructurePath, sourceShotDesignPath }) {
  return [
    normalizeText(conversationId) ?? "conversation",
    normalizeText(turnId) ?? "turn",
    normalizeText(sourceRestructurePath) ?? "restructure",
    normalizeText(sourceShotDesignPath) ?? "shot-design",
  ].join(":");
}

function resolveConfirmedPlanStatusFromStoryboard(storyboardResult) {
  const status = String(storyboardResult?.status ?? "").trim();
  if (status === "processed" || status === "completed") return "completed";
  if (status === "failed") return "storyboard_failed";
  return "storyboard_processing";
}

function isAutoAdvanceTurn(conversation, turnId) {
  const target = normalizeText(turnId);
  if (!target) return false;
  return (conversation.messages ?? []).some((message) => (
    message?.role === "user"
    && normalizeText(message.turnId) === target
    && normalizeText(message.userInputOrigin) === "auto_advance"
  ));
}

function buildConfirmationId(turnId) {
  const suffix = String(turnId ?? "turn").replace(/[^A-Za-z0-9_.-]+/g, "").slice(-8) || "turn";
  return `auto_confirm_${suffix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

module.exports = {
  buildAutoAdvanceKey,
  buildAutoAdvanceShotDesignSummary,
  buildConfirmationId,
  buildPlanRevisionKey,
  findDuplicateAutoAdvance,
  isAutoAdvanceTurn,
  normalizeFingerprint,
  resolveConfirmedPlanStatusFromStoryboard,
};
