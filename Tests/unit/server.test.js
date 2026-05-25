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
