const assert = require("assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");

const { createCodexRolloutReader, mergeThreadWithRollout, parseCodexRolloutText, resolveTurnId } = require("../../Apps/Api/lib/observability/codex-rollout-reader");
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
  assert.equal(timeline.activity.tokenUsage.contextThresholdTokens, 206720);
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

test("rollout reader matches file-name thread alias when session meta id differs", async () => {
  const requestedThreadId = "019ea694-19cd-7b91-b24a-ca260da45c63";
  const sessionMetaThreadId = "019ea08a-9d4b-7563-a373-e11a361342c6";
  const turnId = "019ea730-a84d-7321-b77f-e0da8771b58f";
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "codex-rollout-reader-"));
  const sessionsDir = path.join(codexHome, "sessions", "2026", "06", "08");
  fs.mkdirSync(sessionsDir, { recursive: true });
  fs.writeFileSync(
    path.join(sessionsDir, `rollout-2026-06-08T17-33-04-${requestedThreadId}.jsonl`),
    [
      event("2026-06-08T09:33:04.000Z", "session_meta", { id: sessionMetaThreadId }),
      event("2026-06-08T12:23:04.000Z", "event_msg", { type: "task_started", turn_id: turnId, model_context_window: 258400 }),
      event("2026-06-08T12:24:04.000Z", "event_msg", {
        type: "token_count",
        info: {
          last_token_usage: { input_tokens: 38671, output_tokens: 143, reasoning_output_tokens: 81, total_tokens: 38814 },
          model_context_window: 258400,
        },
      }),
      event("2026-06-08T12:24:12.000Z", "event_msg", { type: "task_complete", turn_id: turnId }),
    ].join("\n"),
    "utf8",
  );

  try {
    const reader = createCodexRolloutReader({ codexHome });
    const parsed = await reader.readThread({ threadId: requestedThreadId, turnId });
    assert.ok(parsed);
    assert.equal(parsed.thread.id, sessionMetaThreadId);
    assert.deepEqual(parsed.thread.aliases, [requestedThreadId, sessionMetaThreadId]);
    const timeline = summarizeAgentTurnTimeline(parsed.thread, turnId);
    assert.equal(timeline.activity.tokenUsage.inputTokens, 38671);
    assert.equal(timeline.activity.tokenUsage.contextUsageState, "normal");
  } finally {
    fs.rmSync(codexHome, { recursive: true, force: true });
  }
});

test("rollout merge accepts short turn ids from UI cards", () => {
  const fullTurnId = "019e8e0d-d97b-7eb2-a74f-5c48d30609d9";
  const merged = mergeThreadWithRollout(
    { id: "019e8bc9-0fd8-7590-ae69-4f84d947255a", turns: [{ id: "d30609d9", items: [{ type: "agentMessage", text: "from appserver" }] }] },
    { id: "019e8bc9-0fd8-7590-ae69-4f84d947255a", turns: [{ id: fullTurnId, last_token_usage: { input_tokens: 29854 }, items: [{ type: "tokenUsage", tokenUsage: { input_tokens: 29854 } }] }] },
  );
  assert.equal(resolveTurnId(merged, "d30609d9"), fullTurnId);
  const timeline = summarizeAgentTurnTimeline(merged, "d30609d9");
  assert.equal(timeline.turnId, fullTurnId);
  assert.equal(timeline.activity.tokenUsage.inputTokens, 29854);
  assert.deepEqual(timeline.items.map((item) => item.kind), ["agent_message", "token_usage"]);
});

test("short turn id resolution rejects ambiguous suffixes", () => {
  const thread = {
    id: "thread_ambiguous",
    turns: [
      { id: "019e8e0d-d97b-7eb2-a74f-5c48d30609d9" },
      { id: "019e8e0d-d97b-7eb2-a74f-5c48eeee09d9" },
    ],
  };

  assert.equal(resolveTurnId(thread, "09d9"), null);
  assert.equal(resolveTurnId(thread, "5c48d30609d9"), "019e8e0d-d97b-7eb2-a74f-5c48d30609d9");
});

function event(timestamp, type, payload) {
  return JSON.stringify({ timestamp, type, payload });
}
