const {
  test,
  assert,
  once,
  path,
  createServer,
  makeRequest,
  makeMultipartRequest,
  closeServer,
} = require("./server-test.helpers");

test("function slot governance route enqueues semantic governance job", async () => {
  const calls = [];
  const server = createServer({
    functionSlotGovernanceService: {
      enqueue: async (payload) => {
        calls.push(payload);
        return {
          processingJobId: "job_governance",
          sampleVideoId: "function-slot-library",
          traceId: "trace_governance",
          runId: "run_governance",
          stageId: "stage_governance",
          artifactId: "artifact_governance",
          parentArtifactId: null,
          status: "submitted",
          message: "FunctionSlotLibrary 语义治理任务已提交。",
        };
      },
    },
    staticWorkbench: { handle: () => false },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "POST", "/api/function-slot-library/governance/run", {
      refreshEvidence: false,
    });
    assert.equal(response.statusCode, 202);
    assert.equal(response.body.status, "submitted");
    assert.equal(response.body.traceId, "trace_governance");
    assert.deepEqual(calls, [{ refreshEvidence: false }]);
  } finally {
    await closeServer(server);
  }
});

test("function slot governance scheduler state route returns safe status summary", async () => {
  const server = createServer({
    functionSlotGovernanceService: {
      enqueue: async () => ({ processingJobId: "job_unused", status: "submitted" }),
    },
    semanticGovernanceScheduler: {
      getState: () => ({
        schemaVersion: "function_slot_governance_scheduler.v1",
        status: "scheduled",
        quietWindowMs: 10000,
        scheduledAt: "2026-06-10T00:00:00.000Z",
        processingJobId: null,
        traceId: null,
        lastEvidenceHash: "hash_a",
        lastGovernedEvidenceHash: "hash_prev",
        dirtySince: null,
        lastRunCompletedAt: null,
        message: "结构分析队列已完成，等待自动语义治理。",
      }),
    },
    staticWorkbench: { handle: () => false },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "GET", "/api/function-slot-library/governance/scheduler-state");
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.schemaVersion, "function_slot_governance_scheduler.v1");
    assert.equal(response.body.status, "scheduled");
    assert.equal(response.body.message, "结构分析队列已完成，等待自动语义治理。");
    assert.equal(Object.hasOwn(response.body, "rootDir"), false);
    assert.equal(Object.hasOwn(response.body, "stack"), false);
  } finally {
    await closeServer(server);
  }
});

test("full analysis workflow routes create, read, and rerun runs", async () => {
  const calls = [];
  const fakeRun = { workflowRunId: "workflow_1", workflowKey: "full-analysis", workflowVersion: "full-analysis.v1", status: "running", traceId: "trace_workflow", runId: "run_workflow", sampleVideoId: "sample_1", currentStageKeys: ["upload"], stages: [] };
  const server = createServer({
    fullAnalysisWorkflowService: {
      start: async (payload) => {
        calls.push({ type: "start", workspaceId: payload.workspaceId, fileName: payload.file.filename });
        return fakeRun;
      },
      get: (workflowRunId) => workflowRunId === "workflow_1" ? fakeRun : null,
      getLatest: () => fakeRun,
      getLatestBySampleVideoId: (sampleVideoId) => sampleVideoId === "sample_1" ? fakeRun : null,
      rerunStage: async (payload) => {
        calls.push({ type: "rerun", ...payload });
        return { ...fakeRun, currentStageKeys: [payload.stageKey] };
      },
      cancelRun: async (payload) => {
        calls.push({ type: "cancel", ...payload });
        return { ...fakeRun, status: "canceled", currentStageKeys: [] };
      },
      resumeRun: async (payload) => {
        calls.push({ type: "resume", ...payload });
        return { ...fakeRun, status: "running", currentStageKeys: ["scriptSegment"] };
      },
    },
    staticWorkbench: { handle: () => false },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const boundary = "----codex-boundary";
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="workspaceId"\r\n\r\ndefault-workspace\r\n`, "utf8"),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="sample.mp4"\r\nContent-Type: video/mp4\r\n\r\nvideo\r\n`, "utf8"),
      Buffer.from(`--${boundary}--\r\n`, "utf8"),
    ]);
    const address = server.address();
    const created = await new Promise((resolve, reject) => {
      const request = require("node:http").request({
        agent: false,
        method: "POST",
        host: "127.0.0.1",
        port: address.port,
        path: "/api/workflows/full-analysis/runs",
        headers: {
          connection: "close",
          "content-type": `multipart/form-data; boundary=${boundary}`,
          "content-length": body.length,
        },
      }, (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => resolve({ statusCode: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) }));
      });
      request.on("error", reject);
      request.end(body);
    });
    assert.equal(created.statusCode, 202);
    assert.equal(created.body.workflowRunId, "workflow_1");

    const read = await makeRequest(server, "GET", "/api/workflows/runs/workflow_1");
    assert.equal(read.statusCode, 200);
    assert.equal(read.body.traceId, "trace_workflow");

    const latest = await makeRequest(server, "GET", "/api/workflows/full-analysis/latest");
    assert.equal(latest.statusCode, 200);
    assert.equal(latest.body.workflowRunId, "workflow_1");

    const latestForSample = await makeRequest(server, "GET", "/api/sample-videos/sample_1/workflows/full-analysis/latest");
    assert.equal(latestForSample.statusCode, 200);
    assert.equal(latestForSample.body.workflowRunId, "workflow_1");

    const missingForSample = await makeRequest(server, "GET", "/api/sample-videos/sample_missing/workflows/full-analysis/latest");
    assert.equal(missingForSample.statusCode, 404);

    const rerun = await makeRequest(server, "POST", "/api/workflows/runs/workflow_1/stages/scriptSegment/rerun");
    assert.equal(rerun.statusCode, 202);
    const canceled = await makeRequest(server, "POST", "/api/workflows/runs/workflow_1/cancel", { reason: "user_requested" });
    assert.equal(canceled.statusCode, 202);
    assert.equal(canceled.body.status, "canceled");
    const resumed = await makeRequest(server, "POST", "/api/workflows/runs/workflow_1/resume");
    assert.equal(resumed.statusCode, 202);
    assert.equal(resumed.body.currentStageKeys[0], "scriptSegment");
    assert.deepEqual(calls, [
      { type: "start", workspaceId: "default-workspace", fileName: "sample.mp4" },
      { type: "rerun", workflowRunId: "workflow_1", stageKey: "scriptSegment" },
      { type: "cancel", workflowRunId: "workflow_1", reason: "user_requested" },
      { type: "resume", workflowRunId: "workflow_1" },
    ]);
  } finally {
    await closeServer(server);
  }
});

test("material recognition workflow routes create, read, and rerun runs", async () => {
  const calls = [];
  const fakeRun = { workflowRunId: "workflow_material_1", workflowKey: "material-recognition", workflowVersion: "material-recognition.v1", status: "running", traceId: "trace_material", runId: "run_material", sampleVideoId: "sample_material", currentStageKeys: ["upload"], stages: [] };
  const runStore = {
    getRun: (workflowRunId) => workflowRunId === "workflow_material_1" ? fakeRun : null,
  };
  const server = createServer({
    workflowRunStore: runStore,
    materialRecognitionWorkflowService: {
      start: async (payload) => {
        calls.push({ type: "start", workspaceId: payload.workspaceId, fileName: payload.file.filename });
        return fakeRun;
      },
      get: (workflowRunId) => workflowRunId === "workflow_material_1" ? fakeRun : null,
      getLatest: () => fakeRun,
      getLatestBySampleVideoId: (sampleVideoId) => sampleVideoId === "sample_material" ? fakeRun : null,
      rerunStage: async (payload) => {
        calls.push({ type: "rerun", ...payload });
        return { ...fakeRun, currentStageKeys: [payload.stageKey] };
      },
    },
    fullAnalysisWorkflowService: {
      get: () => null,
      rerunStage: async () => {
        throw new Error("should route material-recognition rerun to material service");
      },
    },
    staticWorkbench: { handle: () => false },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const created = await makeMultipartRequest(server, {
      path: "/api/workflows/material-recognition/runs",
      fields: { workspaceId: "default-workspace" },
      file: { name: "material.mp4", type: "video/mp4", content: "video" },
    });
    assert.equal(created.statusCode, 202);
    assert.equal(created.body.workflowRunId, "workflow_material_1");

    const latest = await makeRequest(server, "GET", "/api/workflows/material-recognition/latest");
    assert.equal(latest.statusCode, 200);
    assert.equal(latest.body.workflowKey, "material-recognition");

    const latestForSample = await makeRequest(server, "GET", "/api/sample-videos/sample_material/workflows/material-recognition/latest");
    assert.equal(latestForSample.statusCode, 200);
    assert.equal(latestForSample.body.workflowRunId, "workflow_material_1");

    const read = await makeRequest(server, "GET", "/api/workflows/runs/workflow_material_1");
    assert.equal(read.statusCode, 200);
    assert.equal(read.body.traceId, "trace_material");

    const rerun = await makeRequest(server, "POST", "/api/workflows/runs/workflow_material_1/stages/userMaterialTagger/rerun");
    assert.equal(rerun.statusCode, 202);
    assert.deepEqual(calls, [
      { type: "start", workspaceId: "default-workspace", fileName: "material.mp4" },
      { type: "rerun", workflowRunId: "workflow_material_1", stageKey: "userMaterialTagger" },
    ]);
  } finally {
    await closeServer(server);
  }
});

test("full analysis cache check reports existing upload cache without starting workflow", async () => {
  const cachedItem = { sampleVideoId: "sample_cached", filename: "cached.mp4", tags: [], cacheAvailable: true };
  const calls = [];
  const server = createServer({
    artifactIndex: {
      findLatestByFileHash: async (fileHash) => {
        calls.push(fileHash);
        return cachedItem;
      },
    },
    fullAnalysisWorkflowService: {
      start: async () => {
        throw new Error("should not start workflow");
      },
    },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeMultipartRequest(server, {
      path: "/api/workflows/full-analysis/cache-check",
      fields: { workspaceId: "default-workspace" },
      file: { name: "cached.mp4", type: "video/mp4", content: "cached-video" },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.cacheHit, true);
    assert.equal(response.body.cachedItem.sampleVideoId, "sample_cached");
    assert.equal(calls.length, 1);
  } finally {
    server.close();
  }
});

test("agent chat compact route calls appserver and records a system message", async () => {
  const stageLogs = [];
  const systemMessages = [];
  const compactCalls = [];
  const server = createServer({
    logger: {
      writeStageLog: async (entry) => {
        stageLogs.push(entry);
      },
      writeDebugSnapshot: async () => ({ uri: "/runtime/debug-snapshots/snapshot.json" }),
    },
    agentConversationStore: {
      assertActive: async (conversationId, { expectedRevision } = {}) => {
        assert.equal(conversationId, "conversation_compact");
        assert.equal(expectedRevision, 7);
        return { conversationId, revision: 7, status: "active", threadId: "thread_compact" };
      },
      recordSystemMessage: async (payload) => {
        systemMessages.push(payload);
        return { conversationId: payload.conversationId, revision: 8 };
      },
    },
    appServer: {
      compactThread: async (payload) => {
        compactCalls.push(payload);
        return { ok: true, threadId: payload.threadId, status: "completed" };
      },
    },
    staticWorkbench: { handle: () => false },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "POST", "/api/agent-chat/threads/thread_compact/compact", {
      conversationId: "conversation_compact",
      expectedRevision: 7,
      workspaceRoot: "C:/workspace",
      contextUsage: { inputTokens: 820, modelContextWindow: 1000, contextThresholdTokens: 800, contextUsageRatio: 0.82, contextUsageState: "danger" },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.threadId, "thread_compact");
    assert.equal(response.body.compactCompleted, true);
    assert.equal(response.body.conversationRevision, 8);
    assert.equal(compactCalls[0].workspaceRoot, "C:/workspace");
    assert.equal(compactCalls[0].threadId, "thread_compact");
    assert.equal(systemMessages[0].text, "上下文已自动压缩");
    assert.equal(stageLogs[0].stageName, "agentChat.context.compact");
    assert.deepEqual(stageLogs.map((entry) => entry.event), ["stage.start", "stage.end"]);
    assert.equal(stageLogs[0].inputSummary.contextUsage.contextUsageState, "danger");
  } finally {
    await closeServer(server);
  }
});

test("agent chat compact route rejects conversation thread mismatch before appserver compact", async () => {
  const compactCalls = [];
  const server = createServer({
    logger: {
      writeStageLog: async () => undefined,
      writeDebugSnapshot: async () => ({ uri: "/runtime/debug-snapshots/compact-thread-mismatch.json" }),
    },
    agentConversationStore: {
      assertActive: async () => ({ conversationId: "conversation_compact", revision: 3, status: "active", threadId: "thread_current" }),
      recordSystemMessage: async () => {
        throw new Error("should not record compact system message");
      },
    },
    appServer: {
      compactThread: async (payload) => {
        compactCalls.push(payload);
        return { ok: true, threadId: payload.threadId, status: "completed" };
      },
    },
    staticWorkbench: { handle: () => false },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "POST", "/api/agent-chat/threads/thread_old/compact", {
      conversationId: "conversation_compact",
      expectedRevision: 3,
      workspaceRoot: "C:/workspace",
    });
    assert.equal(response.statusCode, 409);
    assert.equal(response.body.code, "agent_chat_compact_thread_mismatch");
    assert.deepEqual(compactCalls, []);
  } finally {
    await closeServer(server);
  }
});

test("agent chat compact route writes failure stage and snapshot", async () => {
  const stageLogs = [];
  const snapshots = [];
  const server = createServer({
    logger: {
      writeStageLog: async (entry) => {
        stageLogs.push(entry);
      },
      writeDebugSnapshot: async (entry) => {
        snapshots.push(entry);
        return { uri: "/runtime/debug-snapshots/compact-failed.json" };
      },
    },
    appServer: {
      compactThread: async () => {
        const error = new Error("compact failed");
        error.code = "appserver_thread_compact_failed";
        throw error;
      },
    },
    staticWorkbench: { handle: () => false },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "POST", "/api/agent-chat/threads/thread_compact/compact", {});
    assert.equal(response.statusCode, 503);
    assert.equal(response.body.code, "appserver_thread_compact_failed");
    assert.equal(response.body.debugSnapshotUri, "/runtime/debug-snapshots/compact-failed.json");
    assert.deepEqual(stageLogs.map((entry) => entry.event), ["stage.start", "stage.fail"]);
    assert.equal(snapshots[0].stageName, "agentChat.context.compact");
  } finally {
    await closeServer(server);
  }
});
