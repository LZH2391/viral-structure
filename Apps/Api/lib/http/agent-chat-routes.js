const {
  handleAgentChatConversationArchive,
  handleAgentChatConversationConfirm,
  handleAgentChatConversationList,
  handleAgentChatConversationResume,
  handleAgentChatConversationSystemMessage,
} = require("./agent-chat-conversation-routes");
const {
  handleAgentChatConversationDialogueReview,
  handleAgentChatConversationDialogueRework,
} = require("./agent-chat-dialogue-routes");
const {
  handleAgentChatLeaseRelease,
  handleAgentChatThreadCompact,
  handleAgentChatThreadStart,
} = require("./agent-chat-thread-routes");
const {
  handleAgentChatManualReplacementSubmit,
  handleAgentChatTurnSubmit,
} = require("./agent-chat-submit-routes");
const {
  handleAgentChatThreadStop,
  handleAgentChatTurnRetry,
  handleAgentChatTurnStop,
} = require("./agent-chat-turn-control-routes");
const {
  handleAgentChatTurnCollect,
  handleAgentChatTurnTimeline,
} = require("./agent-chat-turn-result-routes");

module.exports = {
  handleAgentChatConversationArchive,
  handleAgentChatConversationConfirm,
  handleAgentChatConversationDialogueReview,
  handleAgentChatConversationDialogueRework,
  handleAgentChatConversationList,
  handleAgentChatConversationResume,
  handleAgentChatConversationSystemMessage,
  handleAgentChatLeaseRelease,
  handleAgentChatManualReplacementSubmit,
  handleAgentChatThreadCompact,
  handleAgentChatThreadStart,
  handleAgentChatTurnCollect,
  handleAgentChatThreadStop,
  handleAgentChatTurnRetry,
  handleAgentChatTurnSubmit,
  handleAgentChatTurnStop,
  handleAgentChatTurnTimeline,
};
