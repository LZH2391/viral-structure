const test = require("node:test");
const assert = require("node:assert/strict");
const { summarizeAgentTurnTimeline, summarizeAgentTurnTimelineFromItems } = require("../../Apps/Api/lib/observability/agent-turn-timeline");

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
  assert.equal(timeline.activity.tokenUsage.contextUsageState, "unknown");
  assert.ok(timeline.items.find((item) => item.kind === "reasoning").textPreview.length <= 243);
  assert.equal(timeline.items.find((item) => item.kind === "tool_call").metadata.toolName, "shell_command");
  assert.equal(timeline.items.find((item) => item.kind === "tool_result").metadata.exitCode, 0);
});

test("agent turn timeline enriches context usage from model context window", () => {
  const thread = {
    id: "thread_context",
    turns: [{
      id: "turn_context",
      status: "completed",
      last_token_usage: { input_tokens: 820, output_tokens: 30, total_tokens: 850 },
      model_context_window: 1000,
      items: [{ type: "agentMessage", text: "done" }],
    }],
  };

  const timeline = summarizeAgentTurnTimeline(thread, "turn_context");

  assert.equal(timeline.activity.tokenUsage.modelContextWindow, 1000);
  assert.equal(timeline.activity.tokenUsage.contextThresholdTokens, 800);
  assert.equal(timeline.activity.tokenUsage.contextUsageRatio, 0.82);
  assert.equal(timeline.activity.tokenUsage.contextUsageState, "danger");
  assert.equal(timeline.items.find((item) => item.kind === "token_usage").metadata.contextUsageState, "danger");
});

test("agent turn timeline treats zero model context window as unknown", () => {
  const thread = {
    id: "thread_zero_window",
    turns: [{
      id: "turn_zero_window",
      status: "completed",
      last_token_usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
      model_context_window: 0,
      items: [{ type: "agentMessage", text: "done" }],
    }],
  };

  const timeline = summarizeAgentTurnTimeline(thread, "turn_zero_window");

  assert.equal(timeline.activity.tokenUsage.modelContextWindow, null);
  assert.equal(timeline.activity.tokenUsage.contextThresholdTokens, null);
  assert.equal(timeline.activity.tokenUsage.contextUsageRatio, null);
  assert.equal(timeline.activity.tokenUsage.contextUsageState, "unknown");
});

test("agent turn timeline resolves unique short turn ids", () => {
  const fullTurnId = "019e8e0d-d97b-7eb2-a74f-5c48d30609d9";
  const timeline = summarizeAgentTurnTimeline({
    id: "thread_short_turn",
    turns: [{
      id: fullTurnId,
      status: "completed",
      last_token_usage: { input_tokens: 29854 },
      items: [{ type: "agentMessage", text: "done" }],
    }],
  }, "d30609d9");

  assert.equal(timeline.turnId, fullTurnId);
  assert.equal(timeline.activity.tokenUsage.inputTokens, 29854);
});

test("agent turn timeline rejects ambiguous short turn ids", () => {
  const timeline = summarizeAgentTurnTimeline({
    id: "thread_ambiguous_turn",
    turns: [
      { id: "019e8e0d-d97b-7eb2-a74f-5c48d30609d9", items: [{ type: "agentMessage", text: "first" }] },
      { id: "019e8e0d-d97b-7eb2-a74f-5c48eeee09d9", items: [{ type: "agentMessage", text: "second" }] },
    ],
  }, "09d9");

  assert.equal(timeline, null);
});

test("agent turn timeline returns null for missing turn", () => {
  const timeline = summarizeAgentTurnTimeline({ id: "thread_1", turns: [] }, "turn_missing");
  assert.equal(timeline, null);
});

test("agent turn timeline recognizes appserver function call output and nested token usage", () => {
  const thread = {
    id: "thread_appserver",
    turns: [{
      id: "turn_appserver",
      status: "running",
      usage: {
        last_token_usage: {
          input_tokens: 222,
          output_tokens: 33,
          total_tokens: 255,
        },
      },
      input: [
        { type: "input_text", text: "分析 raw 切镜结果" },
      ],
      outputItems: [
        {
          type: "message_group",
          items: [
            { id: "m1", type: "output_text", text: "准备读取辅助文件" },
            { id: "f1", type: "function_call", name: "shell_command", arguments: { command: "Get-Content shots.json" } },
            { id: "o1", type: "function_call_output", name: "shell_command", output: "Exit code: 0\nOutput:\n[]" },
          ],
        },
      ],
    }],
  };

  const timeline = summarizeAgentTurnTimeline(thread, "turn_appserver");

  assert.deepEqual(timeline.items.map((item) => item.kind), [
    "user_input",
    "agent_message",
    "tool_call",
    "tool_result",
    "token_usage",
  ]);
  assert.equal(timeline.activity.itemCount, 4);
  assert.equal(timeline.activity.latestItemType, "tool_result");
  assert.equal(timeline.activity.latestToolName, "shell_command");
  assert.equal(timeline.activity.tokenUsage.inputTokens, 222);
  assert.equal(timeline.items.find((item) => item.kind === "tool_call").metadata.commandPreview, "Get-Content shots.json");
});

test("agent turn timeline recognizes appserver v2 thread item kinds", () => {
  const thread = {
    id: "thread_v2",
    turns: [{
      id: "turn_v2",
      status: "inProgress",
      items: [
        { id: "u1", type: "userMessage", content: [{ type: "text", text: "跑一下分析" }] },
        { id: "p1", type: "plan", text: "1. 读取文件" },
        { id: "r1", type: "reasoning", summary: ["需要先看 manifest"], content: ["正在判断输入"] },
        {
          id: "cmd1",
          type: "commandExecution",
          command: "Get-Content manifest.json",
          status: "completed",
          aggregatedOutput: "Exit code: 0\n{}",
          exitCode: 0,
          durationMs: 300,
        },
        {
          id: "mcp1",
          type: "mcpToolCall",
          server: "obsidian",
          tool: "read",
          status: "completed",
          arguments: { path: "note.md" },
          result: { content: "ok" },
          durationMs: 40,
        },
        {
          id: "dyn1",
          type: "dynamicToolCall",
          namespace: "web",
          tool: "search",
          status: "completed",
          arguments: { q: "codex" },
          contentItems: [{ type: "inputText", text: "result" }],
          success: true,
        },
        { id: "f1", type: "fileChange", status: "applied", changes: [{ path: "a.js", type: "modify" }] },
        { id: "w1", type: "webSearch", query: "Codex app-server" },
      ],
    }],
  };

  const timeline = summarizeAgentTurnTimeline(thread, "turn_v2");

  assert.deepEqual(timeline.items.map((item) => item.kind), [
    "user_input",
    "plan",
    "reasoning",
    "command_execution",
    "mcp_tool_call",
    "dynamic_tool_call",
    "file_change",
    "web_search",
  ]);
  assert.equal(timeline.activity.latestItemType, "web_search");
  assert.equal(timeline.items.find((item) => item.kind === "command_execution").metadata.exitCode, 0);
  assert.equal(timeline.items.find((item) => item.kind === "mcp_tool_call").metadata.toolName, "obsidian.read");
  assert.equal(timeline.items.find((item) => item.kind === "dynamic_tool_call").metadata.toolName, "web.search");
});

test("agent turn timeline can be built from official turn item list", () => {
  const timeline = summarizeAgentTurnTimelineFromItems({
    thread: { id: "thread_items" },
    turn: {
      id: "turn_items",
      status: "running",
      last_token_usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 },
    },
    turnId: "turn_items",
    items: [
      { id: "u1", type: "userMessage", text: "开始包装分析" },
      {
        id: "cmd1",
        type: "commandExecution",
        command: "Get-Content manifest.json",
        status: "completed",
        aggregatedOutput: "{}",
        exitCode: 0,
      },
    ],
  });

  assert.equal(timeline.threadId, "thread_items");
  assert.equal(timeline.turnId, "turn_items");
  assert.deepEqual(timeline.items.map((item) => item.kind), ["user_input", "command_execution", "token_usage"]);
  assert.equal(timeline.activity.itemCount, 2);
  assert.equal(timeline.activity.latestItemType, "command_execution");
  assert.equal(timeline.activity.tokenUsage.totalTokens, 12);
});
