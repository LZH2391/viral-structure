const test = require("node:test");
const assert = require("node:assert/strict");
const { buildAgentChatActionProjection, findReplayTask } = require("../../Apps/Api/lib/agent-chat/actions");

test("agent chat action projection exposes stop actions for running turns", () => {
  const projection = buildAgentChatActionProjection({
    conversation: { status: "active", threadId: "thread_1", latestTurnId: "turn_1" },
    status: "running",
    retryable: true,
  });
  assert.equal(projection.flags.stopTurn, true);
  assert.equal(projection.flags.stopThread, true);
  assert.equal(projection.flags.retrySameThread, false);
  assert.deepEqual(projection.availableActions, ["stop_turn", "stop_thread"]);
});

test("agent chat action projection exposes retry actions for terminal retryable turns", () => {
  const projection = buildAgentChatActionProjection({
    conversation: { status: "active", threadId: "thread_1", latestTurnId: "turn_1" },
    status: "canceled",
    retryable: true,
  });
  assert.equal(projection.flags.stopTurn, false);
  assert.equal(projection.flags.retrySameThread, true);
  assert.equal(projection.flags.retryNewThread, true);
  assert.deepEqual(projection.availableActions, ["stop_thread", "retry_same_thread", "retry_new_thread"]);
});

test("agent chat action projection hides actions without turn identifiers or archived conversations", () => {
  const missingTurn = buildAgentChatActionProjection({
    conversation: { status: "active", threadId: "thread_1", latestTurnId: null },
    status: "running",
    retryable: true,
  });
  assert.equal(missingTurn.flags.stopTurn, false);
  assert.equal(missingTurn.flags.retrySameThread, false);

  const archived = buildAgentChatActionProjection({
    conversation: { status: "archived", threadId: "thread_1", latestTurnId: "turn_1" },
    status: "running",
    retryable: true,
  });
  assert.deepEqual(archived.availableActions, []);
});

test("agent chat replay task is read from persisted user message", () => {
  const task = findReplayTask({
    latestTurnId: "turn_1",
    messages: [
      { id: "assistant-turn_1", role: "assistant", turnId: "turn_1", text: "done" },
      { id: "user-turn_1", role: "user", turnId: "turn_1", text: "原始任务" },
    ],
  });
  assert.deepEqual(task, { sourceTurnId: "turn_1", text: "原始任务", messageId: "user-turn_1" });
});
