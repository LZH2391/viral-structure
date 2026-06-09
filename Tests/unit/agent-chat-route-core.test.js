const test = require("node:test");
const assert = require("node:assert/strict");
const { assertConversationReadyForNewTurn } = require("../../Apps/Api/lib/http/agent-chat-route-core");

test("agent chat route core rejects new turns while latest assistant turn is running", () => {
  assert.throws(
    () => assertConversationReadyForNewTurn({
      conversationId: "conversation_1",
      latestTurnId: "turn_1",
      messages: [
        { role: "user", turnId: "turn_1", status: "completed" },
        { role: "assistant", turnId: "turn_1", status: "running" },
      ],
    }),
    (error) => {
      assert.equal(error.statusCode, 409);
      assert.equal(error.code, "agent_chat_conversation_turn_running");
      assert.equal(error.retryable, false);
      assert.equal(error.debugPayload.turnId, "turn_1");
      return true;
    },
  );
});

test("agent chat route core allows new turns after latest assistant turn is terminal", () => {
  assert.doesNotThrow(() => assertConversationReadyForNewTurn({
    conversationId: "conversation_1",
    latestTurnId: "turn_1",
    messages: [
      { role: "user", turnId: "turn_1", status: "completed" },
      { role: "assistant", turnId: "turn_1", status: "completed" },
    ],
  }));
});
