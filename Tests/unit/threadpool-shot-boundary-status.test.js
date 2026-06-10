const { test, assert, summarizeThreadConversation, sanitizeRoleStatus } = require("./threadpool-shot-boundary.helpers");

test("thread conversation summary keeps compact turn-safe fields", () => {
  const summary = summarizeThreadConversation({
    id: "thread_1",
    title: "shot-boundary-transformer",
    status: "idle",
    turns: [
      {
        id: "turn_1",
        status: "completed",
        createdAt: "2026-05-21T10:00:00.000Z",
        items: [
          { type: "userMessage", text: "请分析这段视频的镜头变化和语义" },
          { type: "agentMessage", text: "已完成，输出 JSON。" },
        ],
        last_token_usage: { input_tokens: 120, output_tokens: 45, total_tokens: 165 },
      },
    ],
  });

  assert.equal(summary.threadId, "thread_1");
  assert.equal(summary.turns[0].turnId, "turn_1");
  assert.match(summary.turns[0].inputSummary, /请分析这段视频/);
  assert.match(summary.turns[0].finalMessage, /已完成/);
  assert.equal(summary.turns[0].tokenUsage.totalTokens, 165);
});

test("threadpool role status removes init prompt and keeps safe summary", () => {
  const status = sanitizeRoleStatus({
    ok: true,
    role: "shot-boundary-transformer",
    min_idle: 1,
    init_prompt: "very long prompt",
    skill_path: "C:\\x\\shot-boundary-transformer\\SKILL.md",
    counts: { idle: 1, leased: 0 },
    seed_thread_id: "thread_seed",
    can_acquire: true,
    can_init: true,
    thread_entries: [
      { thread_id: "thread_seed", thread_status: "idle", is_seed: true },
      { thread_id: "thread_1", thread_status: "idle", lease_id: null, is_seed: false, latest_input_tokens: 700, threshold_input_tokens: 1000, last_owner_id: "owner_1" },
    ],
    active_leases: [],
  });
  assert.equal(status.config.skill_path, "SKILL.md");
  assert.equal(status.config.profile_path, null);
  assert.equal(status.config.profile_version, null);
  assert.equal("init_prompt" in status, false);
  assert.equal(status.threads[0].seed, true);
  assert.equal(status.threads[1].status, "idle");
  assert.equal(status.threads[1].seed, false);
  assert.equal(status.threads[1].latest_input_tokens, 700);
  assert.equal(status.threads[1].threshold_input_tokens, 1000);
  assert.equal(status.threads[1].last_owner_id, "owner_1");
  assert.equal(status.canInit, true);
});
