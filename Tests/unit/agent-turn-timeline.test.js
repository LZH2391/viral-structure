const test = require("node:test");
const assert = require("node:assert/strict");
const { summarizeAgentTurnTimeline } = require("../../Apps/Api/lib/observability/agent-turn-timeline");

test("agent turn timeline summarizes key item kinds with safe previews", () => {
  const thread = {
    id: "thread_1",
    turns: [{
      id: "turn_1",
      status: "running",
      last_token_usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120, reasoning_output_tokens: 7 },
      items: [
        { id: "u1", type: "userMessage", text: "提交原子化输入包" },
        { id: "a1", type: "agentMessage", text: "开始检查三份上游结构" },
        { id: "r1", type: "reasoning", text: "x".repeat(400) },
        { id: "c1", type: "toolCall", toolName: "shell_command", arguments: { command: "Get-Content function-slot-input.json" } },
        { id: "t1", type: "toolResult", toolName: "shell_command", exitCode: 0, durationMs: 2100, text: "输出 4.2KB，正在继续解析" },
        { id: "z1", type: "customThing", payload: "unknown payload" },
      ],
    }],
  };

  const timeline = summarizeAgentTurnTimeline(thread, "turn_1");

  assert.equal(timeline.threadId, "thread_1");
  assert.equal(timeline.turnId, "turn_1");
  assert.deepEqual(timeline.items.slice(0, 6).map((item) => item.kind), [
    "user_input",
    "agent_message",
    "reasoning",
    "tool_call",
    "tool_result",
    "unknown",
  ]);
  assert.equal(timeline.activity.itemCount, 6);
  assert.equal(timeline.activity.latestItemType, "unknown");
  assert.equal(timeline.activity.tokenUsage.totalTokens, 120);
  assert.ok(timeline.items.find((item) => item.kind === "reasoning").textPreview.length <= 243);
  assert.equal(timeline.items.find((item) => item.kind === "tool_call").metadata.toolName, "shell_command");
  assert.equal(timeline.items.find((item) => item.kind === "tool_result").metadata.exitCode, 0);
});

test("agent turn timeline returns null for missing turn", () => {
  const timeline = summarizeAgentTurnTimeline({ id: "thread_1", turns: [] }, "turn_missing");
  assert.equal(timeline, null);
});
