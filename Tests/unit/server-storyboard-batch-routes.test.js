const {
  test,
  assert,
  once,
  fsPromises,
  os,
  path,
  createServer,
  makeRequest,
  makeMultipartFilesRequest,
  closeServer,
  exists,
  sampleShotDesignFinalMarkdown,
} = require("./server-test.helpers");

test("function slot auto-run enqueues deterministic storyboard pipeline", async () => {
  const rootDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "bd-auto-run-active-turn-"));
  const calls = [];
  const server = createServer({
    rootDir,
    staticWorkbench: { handle: () => false },
    logger: {
      writeStageLog: async () => undefined,
      writeDebugSnapshot: async () => ({ uri: "/runtime/debug-snapshots/snapshot.json" }),
    },
    shotStoryboardAutoPipelineService: {
      enqueue: async (payload) => {
        calls.push(payload);
        return {
          ok: true,
          processingJobId: "job_auto",
          sampleVideoId: payload.sampleVideoId,
          traceId: "trace_auto",
          runId: "run_auto",
          stageId: "stage_auto",
          artifactId: "artifact_auto",
          parentArtifactId: payload.parentArtifactId,
          status: "processing",
          role: "shot-storyboard-prep",
          message: "pipeline started",
        };
      },
    },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "POST", "/api/function-slot-workflow/storyboard-prep/auto-run", {
      sampleVideoId: "sample_auto",
      restructureFinalPath: "Artifacts/FunctionSlotRestructure/demo/restructure.final.md",
      parentArtifactId: "artifact_parent",
      confirmationId: "confirm_1",
    });
    assert.equal(response.statusCode, 202);
    assert.equal(response.body.processingJobId, "job_auto");
    assert.equal(response.body.artifactId, "artifact_auto");
    assert.equal(response.body.status, "processing");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].sampleVideoId, "sample_auto");
    assert.equal(calls[0].restructureFinalPath, "Artifacts/FunctionSlotRestructure/demo/restructure.final.md");
    assert.equal(calls[0].parentArtifactId, "artifact_parent");
    assert.equal(calls[0].confirmationId, "confirm_1");
  } finally {
    await closeServer(server);
  }
});

test("function slot auto-run rejects artifact-only source before pipeline enqueue", async () => {
  const rootDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "bd-auto-run-thread-mismatch-"));
  const calls = [];
  const server = createServer({
    rootDir,
    staticWorkbench: { handle: () => false },
    logger: {
      writeStageLog: async () => undefined,
      writeDebugSnapshot: async () => ({ uri: "/runtime/debug-snapshots/auto-run-thread-mismatch.json" }),
    },
    shotStoryboardAutoPipelineService: {
      enqueue: async (payload) => {
        calls.push(payload);
        throw new Error("pipeline should not start without restructureFinalPath");
      },
    },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "POST", "/api/function-slot-workflow/storyboard-prep/auto-run", {
      sampleVideoId: "sample_auto",
      restructureArtifactId: "artifact_restructure",
      parentArtifactId: "artifact_parent",
      confirmationId: "confirm_1",
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.body.code, "storyboard_prep_restructure_required");
    assert.deepEqual(calls, []);
  } finally {
    await closeServer(server);
  }
});

test("function slot auto-run rejects multi-version plan before enqueue when a shot design is missing", async () => {
  const rootDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "bd-auto-run-multi-missing-"));
  const planDir = path.join(rootDir, "Artifacts", "FunctionSlotRestructure", "multi-demo");
  await fsPromises.mkdir(path.join(planDir, "versions", "V1_click"), { recursive: true });
  await fsPromises.mkdir(path.join(planDir, "versions", "V2_conversion"), { recursive: true });
  await fsPromises.writeFile(path.join(planDir, "restructure.final.md"), [
    "| versionId | versionName | 文件 |",
    "|---|---|---|",
    "| `V1_click` | 高点击版 | [restructure.final.md](/C:/ByteDanceFullStack/Artifacts/FunctionSlotRestructure/multi-demo/versions/V1_click/restructure.final.md) |",
    "| `V2_conversion` | 高转化版 | [restructure.final.md](/C:/ByteDanceFullStack/Artifacts/FunctionSlotRestructure/multi-demo/versions/V2_conversion/restructure.final.md) |",
  ].join("\n"), "utf8");
  await fsPromises.writeFile(path.join(planDir, "versions", "V1_click", "restructure.final.md"), "# V1\n", "utf8");
  await fsPromises.writeFile(path.join(planDir, "versions", "V1_click", "shot-design.final.md"), sampleShotDesignFinalMarkdown(), "utf8");
  await fsPromises.writeFile(path.join(planDir, "versions", "V2_conversion", "restructure.final.md"), "# V2\n", "utf8");
  const calls = [];
  const server = createServer({
    rootDir,
    staticWorkbench: { handle: () => false },
    logger: {
      writeStageLog: async () => undefined,
      writeDebugSnapshot: async () => ({ uri: "/runtime/debug-snapshots/auto-run-multi-missing.json" }),
    },
    shotStoryboardAutoPipelineService: {
      enqueue: async (payload) => {
        calls.push(payload);
        return { ok: true };
      },
      enqueueVersionBatch: async (payload) => {
        calls.push(payload);
        return { ok: true };
      },
    },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "POST", "/api/function-slot-workflow/storyboard-prep/auto-run", {
      sampleVideoId: "sample_auto",
      restructureFinalPath: "Artifacts/FunctionSlotRestructure/multi-demo/restructure.final.md",
      parentArtifactId: "artifact_parent",
      confirmationId: "confirm_1",
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.body.code, "storyboard_prep_version_inputs_missing");
    assert.equal(response.body.missing.some((item) => item.versionId === "V2_conversion" && item.kind === "shotDesignFinalPath"), true);
    assert.deepEqual(calls, []);
  } finally {
    await closeServer(server);
    await fsPromises.rm(rootDir, { recursive: true, force: true });
  }
});

test("function slot auto-run enqueues multi-version batch when every shot design exists", async () => {
  const rootDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "bd-auto-run-multi-ready-"));
  const planDir = path.join(rootDir, "Artifacts", "FunctionSlotRestructure", "multi-demo");
  for (const versionId of ["V1_click", "V2_conversion"]) {
    await fsPromises.mkdir(path.join(planDir, "versions", versionId), { recursive: true });
    await fsPromises.writeFile(path.join(planDir, "versions", versionId, "restructure.final.md"), `# ${versionId}\n`, "utf8");
    await fsPromises.writeFile(path.join(planDir, "versions", versionId, "shot-design.final.md"), sampleShotDesignFinalMarkdown(), "utf8");
  }
  await fsPromises.writeFile(path.join(planDir, "restructure.final.md"), [
    "| versionId | versionName | 文件 |",
    "|---|---|---|",
    "| `V1_click` | 高点击版 | [restructure.final.md](/C:/ByteDanceFullStack/Artifacts/FunctionSlotRestructure/multi-demo/versions/V1_click/restructure.final.md) |",
    "| `V2_conversion` | 高转化版 | [restructure.final.md](/C:/ByteDanceFullStack/Artifacts/FunctionSlotRestructure/multi-demo/versions/V2_conversion/restructure.final.md) |",
  ].join("\n"), "utf8");
  const calls = [];
  const server = createServer({
    rootDir,
    staticWorkbench: { handle: () => false },
    logger: {
      writeStageLog: async () => undefined,
      writeDebugSnapshot: async () => ({ uri: "/runtime/debug-snapshots/auto-run-multi-ready.json" }),
    },
    shotStoryboardAutoPipelineService: {
      enqueue: async () => {
        throw new Error("single enqueue should not run");
      },
      enqueueVersionBatch: async (payload) => {
        calls.push(payload);
        return {
          ok: true,
          mode: "multi_version",
          processingJobId: "job_batch",
          sampleVideoId: payload.sampleVideoId,
          traceId: "trace_batch",
          runId: "run_batch",
          stageId: "stage_batch",
          artifactId: "artifact_batch",
          parentArtifactId: payload.parentArtifactId,
          status: "processing",
          defaultVersionId: payload.defaultVersionId,
          versions: payload.versions.map((version) => ({ ...version, status: "queued" })),
        };
      },
    },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "POST", "/api/function-slot-workflow/storyboard-prep/auto-run", {
      sampleVideoId: "sample_auto",
      restructureFinalPath: "Artifacts/FunctionSlotRestructure/multi-demo/restructure.final.md",
      parentArtifactId: "artifact_parent",
      confirmationId: "confirm_1",
    });
    assert.equal(response.statusCode, 202);
    assert.equal(response.body.mode, "multi_version");
    assert.equal(response.body.defaultVersionId, "V2_conversion");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].versionConcurrency, 2);
    assert.deepEqual(calls[0].versions.map((item) => item.versionId), ["V1_click", "V2_conversion"]);
    assert.equal(calls[0].versions[0].shotDesignFinalPath, "Artifacts/FunctionSlotRestructure/multi-demo/versions/V1_click/shot-design.final.md");
  } finally {
    await closeServer(server);
    await fsPromises.rm(rootDir, { recursive: true, force: true });
  }
});

test("full analysis batch routes create and read batch queue", async () => {
  const calls = [];
  const fakeBatch = {
    batchRunId: "batch_1",
    workflowKey: "full-analysis",
    status: "queued",
    workspaceId: "default-workspace",
    maxConcurrentRuns: 2,
    createdAt: "2026-05-30T00:00:00.000Z",
    updatedAt: "2026-05-30T00:00:00.000Z",
    completedAt: null,
    items: [],
  };
  let storedBatch = { ...fakeBatch };
  const server = createServer({
    fullAnalysisBatchQueue: {
      createBatch: ({ files, fields }) => {
        calls.push({ type: "create", fileNames: files.map((file) => file.filename), maxConcurrentRuns: fields.maxConcurrentRuns });
        storedBatch = { ...fakeBatch };
        return storedBatch;
      },
      advance: async (batchRunId) => calls.push({ type: "advance", batchRunId }),
      getBatch: (batchRunId) => batchRunId === "batch_1" ? storedBatch : null,
      getLatestBatch: () => {
        storedBatch = { ...storedBatch, restored: true };
        return storedBatch;
      },
      getLatestActiveBatch: () => {
        storedBatch = { ...storedBatch, status: "running", restored: true };
        return storedBatch;
      },
      retryItem: (batchRunId, queueItemId) => {
        calls.push({ type: "retry", batchRunId, queueItemId });
        storedBatch = { ...storedBatch, status: "running" };
        return storedBatch;
      },
      cancelItem: (batchRunId, queueItemId, reason) => {
        calls.push({ type: "cancel", batchRunId, queueItemId, reason });
        storedBatch = { ...storedBatch, status: "canceled" };
        return storedBatch;
      },
    },
    staticWorkbench: { handle: () => false },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const created = await makeMultipartFilesRequest(server, {
      path: "/api/workflows/full-analysis/batch-runs",
      fields: { workspaceId: "default-workspace", maxConcurrentRuns: "2" },
      files: [
        { name: "a.mp4", type: "video/mp4", content: "a" },
        { name: "b.mp4", type: "video/mp4", content: "b" },
      ],
    });
    assert.equal(created.statusCode, 202);
    assert.equal(created.body.batchRunId, "batch_1");

    const read = await makeRequest(server, "GET", "/api/workflows/full-analysis/batch-runs/batch_1");
    assert.equal(read.statusCode, 200);
    assert.equal(read.body.batchRunId, "batch_1");

    const latestActive = await makeRequest(server, "GET", "/api/workflows/full-analysis/batch-runs/latest?active=true");
    assert.equal(latestActive.statusCode, 200);
    assert.equal(latestActive.body.batchRunId, "batch_1");
    assert.equal(latestActive.body.status, "running");
    assert.equal(latestActive.body.restored, true);

    const latest = await makeRequest(server, "GET", "/api/workflows/full-analysis/batch-runs/latest");
    assert.equal(latest.statusCode, 200);
    assert.equal(latest.body.batchRunId, "batch_1");
    assert.equal(latest.body.restored, true);

    const retry = await makeRequest(server, "POST", "/api/workflows/full-analysis/batch-runs/batch_1/items/item_1/retry");
    assert.equal(retry.statusCode, 202);
    assert.equal(retry.body.batchRunId, "batch_1");
    const cancel = await makeRequest(server, "POST", "/api/workflows/full-analysis/batch-runs/batch_1/items/item_1/cancel", { reason: "user_requested" });
    assert.equal(cancel.statusCode, 202);
    assert.equal(cancel.body.status, "canceled");
    assert.deepEqual(calls, [
      { type: "create", fileNames: ["a.mp4", "b.mp4"], maxConcurrentRuns: "2" },
      { type: "advance", batchRunId: "batch_1" },
      { type: "advance", batchRunId: "batch_1" },
      { type: "advance", batchRunId: "batch_1" },
      { type: "retry", batchRunId: "batch_1", queueItemId: "item_1" },
      { type: "cancel", batchRunId: "batch_1", queueItemId: "item_1", reason: "user_requested" },
    ]);
  } finally {
    await closeServer(server);
  }
});

test("material recognition batch routes create and read material queue", async () => {
  const calls = [];
  const fakeBatch = {
    batchRunId: "batch_material_1",
    workflowKey: "material-recognition",
    status: "queued",
    workspaceId: "default-workspace",
    maxConcurrentRuns: 2,
    createdAt: "2026-05-30T00:00:00.000Z",
    updatedAt: "2026-05-30T00:00:00.000Z",
    completedAt: null,
    items: [],
  };
  let storedBatch = { ...fakeBatch };
  const server = createServer({
    materialRecognitionBatchQueue: {
      createBatch: ({ files, fields }) => {
        calls.push({ type: "create", fileNames: files.map((file) => file.filename), maxConcurrentRuns: fields.maxConcurrentRuns });
        storedBatch = { ...fakeBatch };
        return storedBatch;
      },
      advance: async (batchRunId) => calls.push({ type: "advance", batchRunId }),
      getBatch: (batchRunId) => batchRunId === "batch_material_1" ? storedBatch : null,
      getLatestBatch: () => {
        storedBatch = { ...storedBatch, restored: true };
        return storedBatch;
      },
      getLatestActiveBatch: () => {
        storedBatch = { ...storedBatch, status: "running", restored: true };
        return storedBatch;
      },
      retryItem: (batchRunId, queueItemId) => {
        calls.push({ type: "retry", batchRunId, queueItemId });
        storedBatch = { ...storedBatch, status: "running" };
        return storedBatch;
      },
      cancelItem: (batchRunId, queueItemId, reason) => {
        calls.push({ type: "cancel", batchRunId, queueItemId, reason });
        storedBatch = { ...storedBatch, status: "canceled" };
        return storedBatch;
      },
    },
    staticWorkbench: { handle: () => false },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const created = await makeMultipartFilesRequest(server, {
      path: "/api/workflows/material-recognition/batch-runs",
      fields: { workspaceId: "default-workspace", maxConcurrentRuns: "2" },
      files: [
        { name: "a.mp4", type: "video/mp4", content: "a" },
        { name: "b.mp4", type: "video/mp4", content: "b" },
      ],
    });
    assert.equal(created.statusCode, 202);
    assert.equal(created.body.batchRunId, "batch_material_1");
    assert.equal(created.body.workflowKey, "material-recognition");

    const read = await makeRequest(server, "GET", "/api/workflows/material-recognition/batch-runs/batch_material_1");
    assert.equal(read.statusCode, 200);
    assert.equal(read.body.batchRunId, "batch_material_1");

    const latestActive = await makeRequest(server, "GET", "/api/workflows/material-recognition/batch-runs/latest?active=true");
    assert.equal(latestActive.statusCode, 200);
    assert.equal(latestActive.body.status, "running");

    const retry = await makeRequest(server, "POST", "/api/workflows/material-recognition/batch-runs/batch_material_1/items/item_1/retry");
    assert.equal(retry.statusCode, 202);
    const cancel = await makeRequest(server, "POST", "/api/workflows/material-recognition/batch-runs/batch_material_1/items/item_1/cancel", { reason: "user_requested" });
    assert.equal(cancel.statusCode, 202);
    assert.equal(cancel.body.status, "canceled");
    assert.deepEqual(calls, [
      { type: "create", fileNames: ["a.mp4", "b.mp4"], maxConcurrentRuns: "2" },
      { type: "advance", batchRunId: "batch_material_1" },
      { type: "advance", batchRunId: "batch_material_1" },
      { type: "retry", batchRunId: "batch_material_1", queueItemId: "item_1" },
      { type: "cancel", batchRunId: "batch_material_1", queueItemId: "item_1", reason: "user_requested" },
    ]);
  } finally {
    await closeServer(server);
  }
});
