const { normalizeText } = require("./shot-dialogue-review-utils");

const inFlightDialogueReviewKeys = new Set();

function buildDialogueReviewKey({ conversationId, shotDesignFinalPath, dialogueFingerprint }) {
  return [
    "dialogue-review",
    normalizeText(conversationId) ?? "conversation",
    normalizeText(shotDesignFinalPath) ?? "shot-design",
    normalizeText(dialogueFingerprint?.sha256) ?? "no-dialogue-fingerprint",
  ].join(":");
}

async function hasActiveDialogueReview(handlers, reviewKey) {
  if (!reviewKey || typeof handlers.activeTurnRuntime?.listActive !== "function") return false;
  const active = await handlers.activeTurnRuntime.listActive({ ownerType: "agent-chat-dialogue-review" }).catch(() => []);
  return active.some((binding) => binding?.replayRef?.refId === reviewKey);
}

module.exports = {
  buildDialogueReviewKey,
  hasActiveDialogueReview,
  inFlightDialogueReviewKeys,
};
