const test = require("node:test");
const assert = require("node:assert/strict");
const { createExecutorRegistry } = require("../../Apps/Api/lib/executor-registry");

test("executor registry resolves built-in executors and rejects missing kinds", async () => {
  const registry = createExecutorRegistry({});
  assert.ok(registry.getExecutor("local-service"));
  assert.ok(registry.getExecutor("threadpool-role"));
  assert.ok(registry.getExecutor("appserver-turn"));
  assert.equal(registry.getExecutor("missing"), null);
  await assert.rejects(
    () => registry.execute("missing", {}, {}),
    (error) => error.code === "executor_not_found" && error.retryable === false,
  );
});

test("appserver-turn executor runs start, submit and collect through traced stages", async () => {
  const calls = [];
  const stageLogs = [];
  const registry = createExecutorRegistry({
    appServer: {
      startThread: async (payload) => {
        calls.push({ type: "startThread", payload });
        return { threadId: "thread_1", status: "created" };
      },
      startTurnWithInputs: async (payload) => {
        calls.push({ type: "startTurn", payload });
        return { threadId: payload.threadId, turnId: "turn_1", status: "running" };
      },
      collectTurnResult: async (payload) => {
        calls.push({ type: "collectTurn", payload });
        return { threadId: payload.threadId, turnId: payload.turnId, status: "completed", finalMessage: "done" };
      },
    },
  });
  const context = {
    runStage: async (stageName, progress, options) => {
      stageLogs.push({ stageName, progress, inputSummary: options.inputSummary });
      return options.action();
    },
  };

  const started = await registry.execute("appserver-turn", {
    action: "start-thread",
    stageName: "agent.thread_start",
    progress: 10,
    workspaceRoot: "C:/workspace",
    inputSummary: { purpose: "test" },
  }, context);
  const submitted = await registry.execute("appserver-turn", {
    action: "submit-turn",
    stageName: "agent.submit",
    progress: 50,
    workspaceRoot: "C:/workspace",
    threadId: started.threadId,
    inputs: [{ type: "text", text: "hello" }],
    inputSummary: { role: "test" },
  }, context);
  const collected = await registry.execute("appserver-turn", {
    action: "collect-turn",
    stageName: "agent.collect",
    progress: 90,
    workspaceRoot: "C:/workspace",
    threadId: submitted.threadId,
    turnId: submitted.turnId,
    inputSummary: { role: "test" },
  }, context);

  assert.equal(collected.status, "completed");
  assert.equal(collected.finalMessage, "done");
  assert.deepEqual(stageLogs.map((entry) => entry.stageName), ["agent.thread_start", "agent.submit", "agent.collect"]);
  assert.deepEqual(calls.map((entry) => entry.type), ["startThread", "startTurn", "collectTurn"]);
});
