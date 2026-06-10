const {
  test,
  assert,
  once,
  createServer,
  makeRequest,
  closeServer,
} = require("./server-test.helpers");

test("active turn retry new thread releases agent chat lease when start returns failure", async () => {
  const calls = [];
  const server = createServer({
    activeTurnRuntime: {
      getByBindingId: async (bindingId) => ({
        bindingId,
        threadId: "thread_old",
        turnId: "turn_1",
        ownerType: "agent-chat",
        ownerId: "conversation_1",
        leaseId: "lease_old",
        threadPoolOwnerId: "owner_old",
        replayRef: { type: "agent-chat-message", sourceTurnId: "turn_1", messageId: "user-turn_1" },
      }),
      cancel: async (payload) => {
        calls.push({ type: "cancel", payload });
        return { status: "canceled", threadId: payload.threadId, turnId: payload.turnId };
      },
      start: async (payload) => {
        calls.push({ type: "start", payload });
        return { ok: false, error: "appserver_turn_start_failed", message: "start returned failed" };
      },
    },
    agentConversationStore: {
      get: async () => ({
        conversationId: "conversation_1",
        source: "threadpool-role",
        role: "script-segment-analyzer",
        latestTurnId: "turn_1",
        threadId: "thread_old",
        messages: [{ id: "user-turn_1", turnId: "turn_1", role: "user", text: "retry me" }],
      }),
      bindThread: async (payload) => calls.push({ type: "bindThread", payload }),
      recordUserTurn: async (payload) => calls.push({ type: "recordUser", payload }),
    },
    threadPool: {
      ensureRoleReady: async () => ({ ok: true, status: { workspaceRoot: "C:/workspace", skillPath: "skill.md" } }),
      acquireLease: async (payload) => {
        calls.push({ type: "acquire", payload });
        return { lease_id: "lease_new", thread_id: "thread_new" };
      },
      releaseLease: async (payload) => calls.push({ type: "release", payload }),
    },
    staticWorkbench: { handle: () => false },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "POST", "/api/active-turns/binding_chat/retry", { mode: "new_thread" });
    assert.equal(response.statusCode, 502);
    assert.deepEqual(calls.map((call) => call.type), ["cancel", "release", "acquire", "start", "release"]);
    assert.equal(calls[4].payload.leaseId, "lease_new");
  } finally {
    await closeServer(server);
  }
});

test("active turn retry route does not replay agent chat when cancel observes completed turn", async () => {
  const calls = [];
  const server = createServer({
    activeTurnRuntime: {
      getByBindingId: async (bindingId) => ({
        bindingId,
        threadId: "thread_1",
        turnId: "turn_1",
        ownerType: "agent-chat",
        ownerId: "conversation_1",
        replayRef: { type: "agent-chat-message", sourceTurnId: "turn_1", messageId: "user-turn_1" },
      }),
      cancel: async (payload) => {
        calls.push({ type: "cancel", payload });
        return { status: "completed", threadId: payload.threadId, turnId: payload.turnId, ownerResult: { status: "completed" } };
      },
      start: async (payload) => {
        calls.push({ type: "start", payload });
        return { status: "submitted", threadId: payload.threadId, turnId: "turn_retry" };
      },
    },
    agentConversationStore: {
      get: async () => ({
        conversationId: "conversation_1",
        latestTurnId: "turn_1",
        threadId: "thread_1",
        messages: [{ id: "user-turn_1", turnId: "turn_1", role: "user", text: "retry me" }],
      }),
      recordUserTurn: async (payload) => calls.push({ type: "recordUser", payload }),
    },
    staticWorkbench: { handle: () => false },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "POST", "/api/active-turns/binding_chat/retry", {});
    assert.equal(response.statusCode, 409);
    assert.equal(response.body.error, "active_turn_retry_source_not_canceled");
    assert.deepEqual(calls.map((call) => call.type), ["cancel"]);
  } finally {
    await closeServer(server);
  }
});

test("active turn retry route can create a new thread for processing job replay and update owner run", async () => {
  const calls = [];
  const jobs = new Map([["job_1", {
    jobId: "job_1",
    status: "failed",
    stage: "shot.boundary.turn_started",
    progress: 80,
    activeTurnReplay: { inputs: [{ type: "text", text: "retry job", text_elements: [] }] },
    agentRun: {
      threadId: "thread_old",
      turnId: "turn_old",
      currentAttemptId: "attempt_old",
      leaseId: "lease_old",
      skillPath: "skill.md",
      status: "canceled",
    },
  }]]);
  const server = createServer({
    appServer: {
      startThread: async (payload) => {
        calls.push({ type: "startThread", payload });
        return { threadId: "thread_new" };
      },
    },
    activeTurnRuntime: {
      getByBindingId: async (bindingId) => ({
        bindingId,
        threadId: "thread_old",
        turnId: "turn_old",
        ownerType: "processing-job",
        ownerId: "job_1",
        currentAttemptId: "attempt_old",
        stageName: "shot.boundary.turn_started",
        leaseId: "lease_old",
        threadPoolOwnerId: "owner_old",
        replayRef: { type: "processing-job-input", refId: "job_1", sourceTurnId: "turn_old" },
      }),
      cancel: async (payload) => {
        calls.push({ type: "cancel", payload });
        return { status: "canceled", threadId: payload.threadId, turnId: payload.turnId };
      },
      start: async (payload) => {
        calls.push({ type: "start", payload });
        return { status: "submitted", threadId: payload.threadId, turnId: "turn_new" };
      },
    },
    jobStore: {
      getJob: (jobId) => jobs.get(jobId) ?? null,
      updateJob: (jobId, patch) => {
        calls.push({ type: "updateJob", jobId, patch });
        const next = { ...(jobs.get(jobId) ?? {}), ...patch };
        jobs.set(jobId, next);
        return next;
      },
    },
    threadPool: {
      releaseLease: async (payload) => calls.push({ type: "release", payload }),
    },
    staticWorkbench: { handle: () => false },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "POST", "/api/active-turns/binding_job/retry", { mode: "new_thread" });
    assert.equal(response.statusCode, 202);
    assert.equal(response.body.action, "retry_new_thread");
    assert.equal(response.body.threadId, "thread_new");
    assert.equal(response.body.previousThreadId, "thread_old");
    assert.deepEqual(calls.map((call) => call.type), ["cancel", "release", "startThread", "start", "updateJob"]);
    assert.equal(calls[1].payload.leaseId, "lease_old");
    assert.equal(calls[3].payload.inputs[0].text, "retry job");
    assert.equal(jobs.get("job_1").status, "processing");
    assert.equal(jobs.get("job_1").agentRun.threadId, "thread_new");
    assert.equal(jobs.get("job_1").agentRun.turnId, "turn_new");
    assert.equal(jobs.get("job_1").agentRun.retrySourceTurnId, "turn_old");
  } finally {
    await closeServer(server);
  }
});

test("active turn processing-job retry rejects threadpool lease without lease id", async () => {
  const calls = [];
  const jobs = new Map([["job_1", {
    jobId: "job_1",
    status: "failed",
    stage: "shot.boundary.turn_started",
    progress: 80,
    activeTurnReplay: { inputs: [{ type: "text", text: "retry job", text_elements: [] }] },
    agentRun: {
      threadId: "thread_old",
      turnId: "turn_old",
      currentAttemptId: "attempt_old",
      status: "canceled",
    },
  }]]);
  const server = createServer({
    activeTurnRuntime: {
      getByBindingId: async (bindingId) => ({
        bindingId,
        threadId: "thread_old",
        turnId: "turn_old",
        ownerType: "processing-job",
        ownerId: "job_1",
        currentAttemptId: "attempt_old",
        stageName: "shot.boundary.turn_started",
        replayRef: { type: "processing-job-input", refId: "job_1", sourceTurnId: "turn_old" },
      }),
      cancel: async (payload) => {
        calls.push({ type: "cancel", payload });
        return { status: "canceled", threadId: payload.threadId, turnId: payload.turnId };
      },
      start: async (payload) => {
        calls.push({ type: "start", payload });
        return { status: "submitted", threadId: payload.threadId, turnId: "turn_new" };
      },
    },
    jobStore: {
      getJob: (jobId) => jobs.get(jobId) ?? null,
      updateJob: (jobId, patch) => {
        calls.push({ type: "updateJob", jobId, patch });
        jobs.set(jobId, { ...jobs.get(jobId), ...patch });
      },
    },
    threadPool: {
      ensureRoleReady: async () => ({ ok: true, status: { workspaceRoot: "C:/workspace" } }),
      acquireLease: async (payload) => {
        calls.push({ type: "acquire", payload });
        return { ok: true, thread_id: "thread_new" };
      },
      releaseLease: async (payload) => calls.push({ type: "release", payload }),
    },
    staticWorkbench: { handle: () => false },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "POST", "/api/active-turns/binding_job/retry", { mode: "new_thread", role: "script-segment-analyzer" });
    assert.equal(response.statusCode, 503);
    assert.equal(response.body.error, "active_turn_retry_threadpool_lease_failed");
    assert.deepEqual(calls.map((call) => call.type), ["cancel", "acquire"]);
    assert.equal(jobs.get("job_1").status, "failed");
  } finally {
    await closeServer(server);
  }
});

test("active turn retry route does not replay when cancel observes completed turn", async () => {
  const calls = [];
  const jobs = new Map([["job_1", {
    jobId: "job_1",
    status: "processing",
    stage: "shot.boundary.turn_started",
    progress: 80,
    activeTurnReplay: { inputs: [{ type: "text", text: "retry job", text_elements: [] }] },
    agentRun: {
      threadId: "thread_old",
      turnId: "turn_old",
      currentAttemptId: "attempt_old",
      status: "collecting",
    },
  }]]);
  const server = createServer({
    activeTurnRuntime: {
      getByBindingId: async (bindingId) => ({
        bindingId,
        threadId: "thread_old",
        turnId: "turn_old",
        ownerType: "processing-job",
        ownerId: "job_1",
        currentAttemptId: "attempt_old",
        stageName: "shot.boundary.turn_started",
        replayRef: { type: "processing-job-input", refId: "job_1", sourceTurnId: "turn_old" },
      }),
      cancel: async (payload) => {
        calls.push({ type: "cancel", payload });
        return { status: "completed", threadId: payload.threadId, turnId: payload.turnId, ownerResult: { status: "completed" } };
      },
      start: async (payload) => {
        calls.push({ type: "start", payload });
        return { status: "submitted", threadId: payload.threadId, turnId: "turn_new" };
      },
    },
    jobStore: {
      getJob: (jobId) => jobs.get(jobId) ?? null,
      updateJob: (jobId, patch) => {
        calls.push({ type: "updateJob", jobId, patch });
        const next = { ...(jobs.get(jobId) ?? {}), ...patch };
        jobs.set(jobId, next);
        return next;
      },
    },
    staticWorkbench: { handle: () => false },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "POST", "/api/active-turns/binding_job/retry", {});
    assert.equal(response.statusCode, 409);
    assert.equal(response.body.error, "active_turn_retry_source_not_canceled");
    assert.deepEqual(calls.map((call) => call.type), ["cancel"]);
    assert.equal(jobs.get("job_1").status, "processing");
    assert.equal(jobs.get("job_1").agentRun.turnId, "turn_old");
  } finally {
    await closeServer(server);
  }
});

test("active turn retry new thread releases newly acquired lease when start fails", async () => {
  const calls = [];
  const jobs = new Map([["job_1", {
    jobId: "job_1",
    status: "failed",
    stage: "shot.boundary.turn_started",
    progress: 80,
    activeTurnReplay: { inputs: [{ type: "text", text: "retry job", text_elements: [] }] },
    agentRun: {
      threadId: "thread_old",
      turnId: "turn_old",
      currentAttemptId: "attempt_old",
      status: "canceled",
    },
  }]]);
  const server = createServer({
    activeTurnRuntime: {
      getByBindingId: async (bindingId) => ({
        bindingId,
        threadId: "thread_old",
        turnId: "turn_old",
        ownerType: "processing-job",
        ownerId: "job_1",
        currentAttemptId: "attempt_old",
        stageName: "shot.boundary.turn_started",
        replayRef: { type: "processing-job-input", refId: "job_1", sourceTurnId: "turn_old" },
      }),
      cancel: async (payload) => {
        calls.push({ type: "cancel", payload });
        return { status: "canceled", threadId: payload.threadId, turnId: payload.turnId };
      },
      start: async (payload) => {
        calls.push({ type: "start", payload });
        throw Object.assign(new Error("start failed"), { code: "appserver_turn_start_failed", statusCode: 502 });
      },
    },
    jobStore: {
      getJob: (jobId) => jobs.get(jobId) ?? null,
      updateJob: (jobId, patch) => {
        calls.push({ type: "updateJob", jobId, patch });
        jobs.set(jobId, { ...jobs.get(jobId), ...patch });
      },
    },
    threadPool: {
      ensureRoleReady: async () => ({ ok: true, status: { workspaceRoot: "C:/workspace" } }),
      acquireLease: async (payload) => {
        calls.push({ type: "acquire", payload });
        return { lease_id: "lease_new", thread_id: "thread_new" };
      },
      releaseLease: async (payload) => calls.push({ type: "release", payload }),
    },
    staticWorkbench: { handle: () => false },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "POST", "/api/active-turns/binding_job/retry", { mode: "new_thread", role: "script-segment-analyzer" });
    assert.equal(response.statusCode, 502);
    assert.deepEqual(calls.map((call) => call.type), ["cancel", "acquire", "start", "release"]);
    assert.equal(calls[3].payload.leaseId, "lease_new");
  } finally {
    await closeServer(server);
  }
});

test("active turn retry new thread releases newly acquired lease when start returns failure", async () => {
  const calls = [];
  const jobs = new Map([["job_1", {
    jobId: "job_1",
    status: "failed",
    stage: "shot.boundary.turn_started",
    progress: 80,
    activeTurnReplay: { inputs: [{ type: "text", text: "retry job", text_elements: [] }] },
    agentRun: {
      threadId: "thread_old",
      turnId: "turn_old",
      currentAttemptId: "attempt_old",
      status: "canceled",
    },
  }]]);
  const server = createServer({
    activeTurnRuntime: {
      getByBindingId: async (bindingId) => ({
        bindingId,
        threadId: "thread_old",
        turnId: "turn_old",
        ownerType: "processing-job",
        ownerId: "job_1",
        currentAttemptId: "attempt_old",
        stageName: "shot.boundary.turn_started",
        replayRef: { type: "processing-job-input", refId: "job_1", sourceTurnId: "turn_old" },
      }),
      cancel: async (payload) => {
        calls.push({ type: "cancel", payload });
        return { status: "canceled", threadId: payload.threadId, turnId: payload.turnId };
      },
      start: async (payload) => {
        calls.push({ type: "start", payload });
        return { ok: false, error: "appserver_turn_start_failed", message: "start returned failed" };
      },
    },
    jobStore: {
      getJob: (jobId) => jobs.get(jobId) ?? null,
      updateJob: (jobId, patch) => {
        calls.push({ type: "updateJob", jobId, patch });
        jobs.set(jobId, { ...jobs.get(jobId), ...patch });
      },
    },
    threadPool: {
      ensureRoleReady: async () => ({ ok: true, status: { workspaceRoot: "C:/workspace" } }),
      acquireLease: async (payload) => {
        calls.push({ type: "acquire", payload });
        return { lease_id: "lease_new", thread_id: "thread_new" };
      },
      releaseLease: async (payload) => calls.push({ type: "release", payload }),
    },
    staticWorkbench: { handle: () => false },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "POST", "/api/active-turns/binding_job/retry", { mode: "new_thread", role: "script-segment-analyzer" });
    assert.equal(response.statusCode, 502);
    assert.deepEqual(calls.map((call) => call.type), ["cancel", "acquire", "start", "release"]);
    assert.equal(calls[3].payload.leaseId, "lease_new");
    assert.equal(jobs.get("job_1").status, "failed");
    assert.equal(jobs.get("job_1").agentRun.turnId, "turn_old");
  } finally {
    await closeServer(server);
  }
});
