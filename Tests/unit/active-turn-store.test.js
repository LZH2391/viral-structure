const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createActiveTurnStore } = require("../../Apps/Api/lib/active-turns/store");

test("active turn store lists only running bindings and redacts replay text", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "active-turn-store-"));
  try {
    const store = createActiveTurnStore({ filePath: path.join(tempRoot, "active-turns.json") });
    await store.upsert({
      threadId: "thread_1",
      turnId: "turn_running",
      ownerType: "agent-chat",
      ownerId: "conversation_1",
      currentAttemptId: "turn_running",
      stageName: "agentChat.turn.submit",
      replayRef: { type: "text", text: "run C:\\secret\\prompt.txt please" },
      status: "submitted",
    });
    await store.upsert({
      threadId: "thread_1",
      turnId: "turn_done",
      ownerType: "agent-chat",
      ownerId: "conversation_1",
      currentAttemptId: "turn_done",
      stageName: "agentChat.turn.submit",
      replayRef: { type: "text", text: "done" },
      status: "completed",
    });

    const active = await store.listActive();
    assert.equal(active.length, 1);
    assert.equal(active[0].turnId, "turn_running");
    assert.equal(active[0].replayRef.textSummary.preview.includes("secret"), false);
    assert.equal(await store.getByTurnId("turn_done"), null);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("active turn store accepts owner replay refs without full text", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "active-turn-store-ref-"));
  try {
    const store = createActiveTurnStore({ filePath: path.join(tempRoot, "active-turns.json") });
    await store.upsert({
      threadId: "thread_1",
      turnId: "turn_ref",
      ownerType: "agent-chat",
      ownerId: "conversation_1",
      currentAttemptId: "turn_ref",
      stageName: "agentChat.turn.submit",
      replayRef: { type: "agent-chat-message", refId: "user-turn_ref", sourceTurnId: "turn_source" },
      status: "submitted",
    });
    const active = await store.listActive();
    assert.equal(active[0].replayRef.refId, "user-turn_ref");
    assert.equal(active[0].replayRef.textSummary, null);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("active turn store removes terminal turns when collect result is marked", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "active-turn-store-terminal-"));
  try {
    const store = createActiveTurnStore({ filePath: path.join(tempRoot, "active-turns.json") });
    await store.upsert({
      threadId: "thread_1",
      turnId: "turn_1",
      ownerType: "processing-job",
      ownerId: "job_1",
      currentAttemptId: "attempt_1",
      stageName: "content.model",
      replayRef: { type: "text", text: "analyze" },
      status: "running",
    });
    await store.markStatus({ turnId: "turn_1", status: "canceled", result: { status: "canceled" } });
    assert.deepEqual(await store.listActive(), []);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("active turn store exposes raw active bindings for runtime reconciliation", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "active-turn-store-raw-"));
  try {
    const store = createActiveTurnStore({ filePath: path.join(tempRoot, "active-turns.json") });
    await store.upsert({
      threadId: "thread_1",
      turnId: "turn_raw",
      ownerType: "agent-chat",
      ownerId: "conversation_1",
      currentAttemptId: "turn_raw",
      stageName: "agentChat.turn.submit",
      replayRef: { type: "agent-chat-message", refId: "user-turn_raw" },
      status: "submitted",
    });
    const raw = await store.listActiveBindings();
    assert.equal(raw.length, 1);
    assert.equal(raw[0].turnId, "turn_raw");
    assert.equal(raw[0].replayRef.refId, "user-turn_raw");
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
