const {
  test,
  assert,
  once,
  createServer,
  makeRequest,
  closeServer,
} = require("./server-test.helpers");

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

test("cache-decision infers legacy shot boundary cache jobs", async () => {
  const calls = [];
  const server = createServer({
    jobStore: {
      getJob: () => ({
        jobId: "job_shot",
        status: "cache_waiting",
        stage: "shot.cache_lookup",
        cachePrompt: {
          cachedItem: { tags: ["切镜"] },
        },
      }),
    },
    shotBoundaryService: {
      resolveCacheDecision: async (payload) => {
        calls.push(payload);
        return { jobId: payload.jobId, status: "processed", sampleVideoId: "sample_1", stage: "processed", progress: 100, traceId: "trace_shot" };
      },
    },
    staticWorkbench: { handle: () => false },
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "POST", "/api/processing-jobs/job_shot/cache-decision", { decision: "reuse" });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.stage, "processed");
    assert.deepEqual(calls[0], { jobId: "job_shot", decision: "reuse" });
  } finally {
    await closeServer(server);
  }
});
