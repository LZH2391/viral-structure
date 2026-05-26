const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { server: defaultServer, createServer } = require("../../Apps/Api/server");

test.after(() => {
  if (defaultServer.listening) defaultServer.close();
});

function makeRequest(server, method, requestPath, body) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const request = require("node:http").request({
      agent: false,
      method,
      host: "127.0.0.1",
      port: address.port,
      path: requestPath,
      headers: {
        connection: "close",
        ...(body ? { "content-type": "application/json" } : {}),
      },
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        response.destroy();
        resolve({
          statusCode: response.statusCode,
          headers: response.headers,
          body: text ? JSON.parse(text) : null,
        });
      });
    });
    request.on("error", reject);
    if (body) request.write(JSON.stringify(body));
    request.end();
  });
}

function makeMultipartRequest(server, { path: requestPath, fields = {}, file }) {
  const boundary = `----test-${Date.now().toString(36)}`;
  const chunks = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`, "utf8"));
  }
  chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`, "utf8"));
  chunks.push(Buffer.from(file.content, "utf8"));
  chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`, "utf8"));
  const body = Buffer.concat(chunks);
  return new Promise((resolve, reject) => {
    const address = server.address();
    const request = require("node:http").request({
      agent: false,
      method: "POST",
      host: "127.0.0.1",
      port: address.port,
      path: requestPath,
      headers: {
        connection: "close",
        "content-type": `multipart/form-data; boundary=${boundary}`,
        "content-length": body.length,
      },
    }, (response) => {
      const responseChunks = [];
      response.on("data", (chunk) => responseChunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(responseChunks).toString("utf8");
        response.destroy();
        resolve({
          statusCode: response.statusCode,
          headers: response.headers,
          body: text ? JSON.parse(text) : null,
        });
      });
    });
    request.on("error", reject);
    request.end(body);
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.closeIdleConnections?.();
    server.closeAllConnections?.();
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

test("thread conversation forbidden path closes stage with stage.start and stage.end", async () => {
  const stageLogs = [];
  const server = createServer({
    logger: {
      writeStageLog: async (entry) => {
        stageLogs.push(entry);
        return entry;
      },
      writeDebugSnapshot: async () => ({ uri: "/runtime/debug-snapshots/snapshot.json" }),
    },
    threadPool: {
      findAllowedThread: async () => ({ ok: false, error: "thread_forbidden", message: "不允许读取该线程" }),
    },
    appServer: {
      readThread: async () => {
        throw new Error("should not read forbidden thread");
      },
    },
    staticWorkbench: { handle: () => false },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "GET", "/api/threadpool/threads/thread_123/conversation");
    assert.equal(response.statusCode, 403);
    assert.deepEqual(stageLogs.map((entry) => entry.event), ["stage.start", "stage.end"]);
    assert.equal(stageLogs[0].stageName, "threadPool.conversation.read");
    assert.equal(stageLogs[1].outputSummary.allowed, false);
    assert.equal(stageLogs[1].outputSummary.statusCode, 403);
    assert.equal(stageLogs[1].outputSummary.threadId, "thread_123");
  } finally {
    await closeServer(server);
  }
});

test("top-level request catch returns failure trace metadata for status errors", async () => {
  const server = createServer({
    logger: {
      writeStageLog: async () => undefined,
      writeDebugSnapshot: async () => ({ uri: "/runtime/debug-snapshots/unused.json" }),
    },
    readCapabilities: async () => {
      const error = new Error("能力读取失败");
      error.statusCode = 400;
      error.code = "capability_read_failed";
      throw error;
    },
    recordApiRequestFailure: async () => ({
      traceContext: { traceId: "trace_fallback_400" },
      snapshot: { uri: "/runtime/debug-snapshots/fallback-400.json" },
      errorSummary: { stageName: "api.request.handle" },
    }),
    staticWorkbench: { handle: () => false },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "GET", "/api/capabilities");
    assert.equal(response.statusCode, 400);
    assert.equal(response.body.code, "capability_read_failed");
    assert.equal(response.body.traceId, "trace_fallback_400");
    assert.equal(response.body.debugSnapshotUri, "/runtime/debug-snapshots/fallback-400.json");
    assert.equal(response.body.stageName, "api.request.handle");
  } finally {
    await closeServer(server);
  }
});

test("top-level request catch returns 500 payload with trace metadata", async () => {
  const server = createServer({
    logger: {
      writeStageLog: async () => undefined,
      writeDebugSnapshot: async () => ({ uri: "/runtime/debug-snapshots/unused.json" }),
    },
    readCapabilities: async () => {
      throw new Error("boom");
    },
    recordApiRequestFailure: async () => ({
      traceContext: { traceId: "trace_fallback_500" },
      snapshot: { uri: "/runtime/debug-snapshots/fallback-500.json" },
      errorSummary: { stageName: "api.request.handle" },
    }),
    staticWorkbench: { handle: () => false },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "GET", "/api/capabilities");
    assert.equal(response.statusCode, 500);
    assert.equal(response.body.code, "internal_error");
    assert.equal(response.body.traceId, "trace_fallback_500");
    assert.equal(response.body.debugSnapshotUri, "/runtime/debug-snapshots/fallback-500.json");
    assert.equal(response.body.stageName, "api.request.handle");
    assert.equal(response.body.retryable, true);
  } finally {
    await closeServer(server);
  }
});

test("analysis roles endpoint returns public descriptors only", async () => {
  const server = createServer({
    staticWorkbench: { handle: () => false },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "GET", "/api/analysis-roles");
    assert.equal(response.statusCode, 200);
    const role = response.body.roles.find((entry) => entry.analysisId === "script-segments");
    assert.equal(role.artifactKey, "scriptSegmentAnalysis");
    assert.equal(role.cacheKind, "script_segment");
    assert.equal(role.route, "/api/sample-videos/:sampleVideoId/analyses/script-segments");
    assert.equal(role.skillPath, undefined);
    assert.equal(role.createService, undefined);
    assert.equal(role.serviceKey, undefined);
    assert.equal(role.executorKind, undefined);
  } finally {
    await closeServer(server);
  }
});

test("modules endpoint returns public module descriptors only", async () => {
  const server = createServer({
    staticWorkbench: { handle: () => false },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "GET", "/api/modules");
    assert.equal(response.statusCode, 200);
    const sample = response.body.modules.find((entry) => entry.moduleId === "sample-ingest");
    const shot = response.body.modules.find((entry) => entry.moduleId === "shot-boundary");
    const module = response.body.modules.find((entry) => entry.moduleId === "script-segments");
    assert.equal(sample.moduleKind, "sample-ingest");
    assert.equal(sample.artifactKey, "sampleVideo");
    assert.equal(shot.moduleKind, "sample-understanding");
    assert.equal(shot.artifactKey, "shotBoundaryAnalysis");
    assert.equal(module.moduleKind, "structure-analysis");
    assert.equal(module.artifactKey, "scriptSegmentAnalysis");
    assert.equal(module.cacheKind, "script_segment");
    assert.equal(module.executorKind, "role-service");
    assert.equal(module.skillPath, undefined);
    assert.equal(module.createService, undefined);
    assert.equal(module.serviceKey, undefined);
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
      rerunStage: async (payload) => {
        calls.push({ type: "rerun", ...payload });
        return { ...fakeRun, currentStageKeys: [payload.stageKey] };
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

    const rerun = await makeRequest(server, "POST", "/api/workflows/runs/workflow_1/stages/scriptSegment/rerun");
    assert.equal(rerun.statusCode, 202);
    assert.deepEqual(calls, [
      { type: "start", workspaceId: "default-workspace", fileName: "sample.mp4" },
      { type: "rerun", workflowRunId: "workflow_1", stageKey: "scriptSegment" },
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

test("packaging structure route enqueues service with shot dependency", async () => {
  const calls = [];
  const server = createServer({
    packagingStructureService: {
      enqueue: async (payload) => {
        calls.push(payload);
        return { processingJobId: "job_packaging", sampleVideoId: payload.sampleVideoId, traceId: "trace_packaging" };
      },
    },
    staticWorkbench: { handle: () => false },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "POST", "/api/sample-videos/sample_1/packaging-structure", {
      cacheDecision: "refresh",
      dependencies: { shotBoundaryArtifactId: "artifact_shot_1" },
    });
    assert.equal(response.statusCode, 202);
    assert.equal(response.body.processingJobId, "job_packaging");
    assert.deepEqual(calls[0], {
      sampleVideoId: "sample_1",
      cacheDecision: "refresh",
      expectedShotBoundaryArtifactId: "artifact_shot_1",
    });
  } finally {
    await closeServer(server);
  }
});

test("generic analysis route enqueues registered service with shot dependency", async () => {
  const calls = [];
  const server = createServer({
    packagingStructureService: {
      enqueue: async (payload) => {
        calls.push(payload);
        return { processingJobId: "job_packaging", sampleVideoId: payload.sampleVideoId, traceId: "trace_packaging" };
      },
    },
    staticWorkbench: { handle: () => false },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "POST", "/api/sample-videos/sample_1/analyses/packaging-structure", {
      cacheDecision: "refresh",
      dependencies: { shotBoundaryArtifactId: "artifact_shot_1" },
    });
    assert.equal(response.statusCode, 202);
    assert.equal(response.body.processingJobId, "job_packaging");
    assert.deepEqual(calls[0], {
      sampleVideoId: "sample_1",
      cacheDecision: "refresh",
      expectedShotBoundaryArtifactId: "artifact_shot_1",
    });
  } finally {
    await closeServer(server);
  }
});

test("cache-decision dispatches packaging structure jobs", async () => {
  const calls = [];
  const server = createServer({
    jobStore: {
      getJob: () => ({ jobId: "job_packaging", status: "cache_waiting", cachePrompt: { cacheKind: "packaging_structure" } }),
    },
    packagingStructureService: {
      resolveCacheDecision: async (payload) => {
        calls.push(payload);
        return { jobId: payload.jobId, status: "processed", sampleVideoId: "sample_1", stage: "packaging_structure.cache_reuse", progress: 100, traceId: "trace_packaging" };
      },
    },
    staticWorkbench: { handle: () => false },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "POST", "/api/processing-jobs/job_packaging/cache-decision", { decision: "reuse" });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.stage, "packaging_structure.cache_reuse");
    assert.deepEqual(calls[0], { jobId: "job_packaging", decision: "reuse" });
  } finally {
    await closeServer(server);
  }
});
