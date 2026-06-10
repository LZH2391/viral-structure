function buildWorkflowContext(fields = {}) {
  const targetConversationId = normalizeContextText(fields.targetConversationId);
  return {
    targetConversationId,
    bindMaterialToConversation: normalizeBooleanFlag(fields.bindMaterialToConversation) || Boolean(targetConversationId),
  };
}

function normalizeContextText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function normalizeBooleanFlag(value) {
  return value === true || String(value ?? "").trim().toLowerCase() === "true";
}

module.exports = {
  buildWorkflowContext,
};
