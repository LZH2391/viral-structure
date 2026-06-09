const fs = require("fs");
const { buildStoryboardResultProjection, resolveStoryboardImagePath } = require("../agent-chat/storyboard-result-projection");
const { notFound, runtimeContentType, sendJson } = require("./utils");

async function handleAgentChatStoryboardResult(req, res, conversationId, handlers) {
  const conversation = await handlers.agentConversationStore.get(conversationId);
  if (!conversation) return sendJson(res, 404, { ok: false, error: "agent_chat_conversation_not_found" });
  const resultId = normalizeQueryText(new URL(req.url, "http://localhost").searchParams.get("resultId"));
  const versionId = normalizeQueryText(new URL(req.url, "http://localhost").searchParams.get("versionId"));
  const storyboardResult = findStoryboardResult(conversation, resultId);
  const imageBasePath = `/api/agent-chat/conversations/${encodeURIComponent(conversationId)}/storyboard-result`;
  const projection = await buildStoryboardResultProjection({
    rootDir: handlers.rootDir,
    conversation,
    imageBasePath,
    imageQuery: buildImageQuery({ resultId, versionId }),
    storyboardResult,
    versionId,
  });
  return sendJson(res, 200, projection);
}

async function handleAgentChatStoryboardImage(req, res, conversationId, shotId, handlers) {
  const conversation = await handlers.agentConversationStore.get(conversationId);
  if (!conversation) return notFound(res);
  const resultId = normalizeQueryText(new URL(req.url, "http://localhost").searchParams.get("resultId"));
  const versionId = normalizeQueryText(new URL(req.url, "http://localhost").searchParams.get("versionId"));
  const storyboardResult = findStoryboardResult(conversation, resultId);
  const filePath = await resolveStoryboardImagePath({
    rootDir: handlers.rootDir,
    conversation,
    shotId,
    storyboardResult,
    versionId,
  });
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return notFound(res);
  const stat = fs.statSync(filePath);
  res.writeHead(200, {
    "content-type": runtimeContentType(filePath),
    "content-length": stat.size,
    "access-control-allow-origin": "*",
  });
  fs.createReadStream(filePath).pipe(res);
  return undefined;
}

function findStoryboardResult(conversation, resultId) {
  if (!resultId) return null;
  const messages = Array.isArray(conversation?.messages) ? conversation.messages : [];
  const match = messages.find((message) => String(message?.id ?? "") === resultId);
  return match?.storyboardResult ?? null;
}

function normalizeQueryText(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || null;
}

function buildImageQuery({ resultId, versionId }) {
  const params = new URLSearchParams();
  if (resultId) params.set("resultId", resultId);
  if (versionId) params.set("versionId", versionId);
  const text = params.toString();
  return text || null;
}

module.exports = {
  handleAgentChatStoryboardImage,
  handleAgentChatStoryboardResult,
};
