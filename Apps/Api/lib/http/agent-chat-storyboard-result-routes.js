const fs = require("fs");
const { buildStoryboardResultProjection, resolveStoryboardImagePath } = require("../agent-chat/storyboard-result-projection");
const { notFound, runtimeContentType, sendJson } = require("./utils");

async function handleAgentChatStoryboardResult(res, conversationId, handlers) {
  const conversation = await handlers.agentConversationStore.get(conversationId);
  if (!conversation) return sendJson(res, 404, { ok: false, error: "agent_chat_conversation_not_found" });
  const imageBasePath = `/api/agent-chat/conversations/${encodeURIComponent(conversationId)}/storyboard-result`;
  const projection = await buildStoryboardResultProjection({
    rootDir: handlers.rootDir,
    conversation,
    imageBasePath,
  });
  return sendJson(res, 200, projection);
}

async function handleAgentChatStoryboardImage(req, res, conversationId, shotId, handlers) {
  const conversation = await handlers.agentConversationStore.get(conversationId);
  if (!conversation) return notFound(res);
  const filePath = await resolveStoryboardImagePath({
    rootDir: handlers.rootDir,
    conversation,
    shotId,
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

module.exports = {
  handleAgentChatStoryboardImage,
  handleAgentChatStoryboardResult,
};
