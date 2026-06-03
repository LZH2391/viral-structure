const assert = require("assert/strict");
const test = require("node:test");

const { mergeThreadWithRollout, parseCodexRolloutText } = require("../../Apps/Api/lib/observability/codex-rollout-reader");
const { summarizeAgentTurnTimeline } = require("../../Apps/Api/lib/observability/agent-turn-timeline");

test("codex rollout parser reconstructs turn activity, token usage, and compact events", () => {
  const threadId = "019e8dc4-5633-79e0-ac38-6deb9d2a9003";
  const turnId = "019e8dc5-8b2d-7a42-b1d4-5f9dc845fa7d";
  const parsed = parseCodexRolloutText([
    event("2026-06-03T13:56:39.801Z", "session_meta", { id: threadId }),
    event("2026-06-03T13:56:39.816Z", "event_msg", { type: "task_started", turn_id: turnId, model_context_window: 258400 }),
    event("2026-06-03T13:56:39.830Z", "event_msg", { type: "user_message", message: "hello" }),
    event("2026-06-03T13:57:22.956Z", "event_msg", { type: "agent_message", message: "working" }),
    event("2026-06-03T13:57:22.957Z", "response_item", { type: "function_call", name: "shell_command", call_id: "call_1", arguments: JSON.stringify({ command: "Get-ChildItem" }) }),
    event("2026-06-03T13:57:23.278Z", "response_item", { type: "function_call_output", call_id: "call_1", output: "Exit code: 0" }),
    event("2026-06-03T13:57:23.279Z", "event_msg", {
      type: "token_count",
      info: {
        last_token_usage: { input_tokens: 1234, output_tokens: 56, reasoning_output_tokens: 7, total_tokens: 1290 },
        total_token_usage: { input_tokens: 1234, output_tokens: 56, total_tokens: 1290 },
        model_context_window: 258400,
      },
    }),
    event("2026-06-03T13:57:24.000Z", "event_msg", { type: "context_compacted" }),
    event("2026-06-03T13:57:25.000Z", "event_msg", { type: "task_complete", turn_id: turnId }),
  ].join("\n"));

  assert.equal(parsed.threadId, threadId);
  const timeline = summarizeAgentTurnTimeline(parsed.thread, turnId);
  assert.deepEqual(timeline.items.map((item) => item.kind), [
    "user_input",
    "agent_message",
    "tool_call",
    "tool_result",
    "token_usage",
    "context_compacted",
  ]);
  assert.equal(timeline.activity.tokenUsage.inputTokens, 1234);
  assert.equal(timeline.activity.tokenUsage.contextThresholdTokens, 25840);
});

test("rollout merge fills missing turn data without replacing appserver items", () => {
  const merged = mergeThreadWithRollout(
    { id: "thread_1", turns: [{ id: "turn_1", items: [{ type: "agentMessage", text: "from appserver" }] }] },
    { id: "thread_1", turns: [{ id: "turn_1", last_token_usage: { input_tokens: 9 }, items: [{ type: "contextCompacted", text: "Context compacted" }] }] },
  );
  assert.equal(merged.turns[0].items[0].text, "from appserver");
  assert.equal(merged.turns[0].items[1].type, "contextCompacted");
  assert.equal(merged.turns[0].last_token_usage.input_tokens, 9);
});

function event(timestamp, type, payload) {
  return JSON.stringify({ timestamp, type, payload });
}
