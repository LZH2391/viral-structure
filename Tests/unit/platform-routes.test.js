const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const http = require("node:http");
const { server: defaultServer, createServer } = require("../../Apps/Api/server");

test.after(() => {
  if (defaultServer.listening) defaultServer.close();
});

test("platform catalog route returns public resource catalog", async () => {
  const server = createServer({
    staticWorkbench: { handle: () => false },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "/api/platform/v1/catalog");
    const kinds = response.body.resources.map((entry) => entry.resourceKind);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.schemaVersion, "platform_catalog_response.v1");
    assert.equal(response.body.catalogVersion, "platform_resource_catalog.v1");
    assert.equal(kinds.includes("sample"), true);
    assert.equal(kinds.includes("artifact"), true);
    assert.equal(kinds.includes("projection"), false);
  } finally {
    await closeServer(server);
  }
});

test("platform commands route dispatches command body", async () => {
  const calls = [];
  const server = createServer({
    commandDispatcher: {
      execute: async (body) => {
        calls.push(body);
        return {
          schemaVersion: "platform_command_result.v1",
          ok: true,
          command: body.command,
          target: body.target,
          status: "running",
          runId: "run_1",
          traceId: "trace_1",
          stageId: "stage_1",
          artifactId: null,
          parentArtifactId: null,
          resourceRefs: [body.target],
          errorSummary: null,
        };
      },
    },
    staticWorkbench: { handle: () => false },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const body = {
      command: "workflow.stage.rerun",
      target: { resourceKind: "workflowRun", resourceId: "workflow_1" },
      options: { stageKey: "scriptSegment" },
    };
    const response = await makeJsonRequest(server, "POST", "/api/platform/v1/commands", body);

    assert.equal(response.statusCode, 202);
    assert.equal(response.body.command, "workflow.stage.rerun");
    assert.deepEqual(calls, [body]);
  } finally {
    await closeServer(server);
  }
});

test("platform commands route returns structured command errors", async () => {
  const server = createServer({
    commandDispatcher: {
      execute: async () => {
        const error = new Error("不支持");
        error.code = "platform_command_unsupported";
        error.statusCode = 400;
        error.retryable = false;
        throw error;
      },
    },
    recordApiRequestFailure: async () => ({
      traceContext: { traceId: "trace_command_error" },
      snapshot: { uri: "/runtime/DebugSnapshots/command-error.json" },
      errorSummary: { stageName: "api.request.handle" },
    }),
    staticWorkbench: { handle: () => false },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeJsonRequest(server, "POST", "/api/platform/v1/commands", {
      command: "job.cache.resolve",
      target: { resourceKind: "job", resourceId: "job_1" },
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.body.code, "platform_command_unsupported");
    assert.equal(response.body.traceId, "trace_command_error");
    assert.equal(response.body.retryable, false);
  } finally {
    await closeServer(server);
  }
});

test("platform resources route lists resources by kind", async () => {
  const server = createServer({
    resourceResolver: {
      list: async ({ resourceKind }) => ({
        schemaVersion: "platform_resource_list.v1",
        resourceKind,
        resources: [{ schemaVersion: "platform_resource_summary.v1", resourceKind, resourceId: "sample_1" }],
      }),
    },
    staticWorkbench: { handle: () => false },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "/api/platform/v1/resources?kind=sample");

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.resourceKind, "sample");
    assert.equal(response.body.resources[0].resourceId, "sample_1");
  } finally {
    await closeServer(server);
  }
});

test("platform resources route reads one resource", async () => {
  const server = createServer({
    resourceResolver: {
      read: async ({ resourceKind, resourceId }) => ({
        schemaVersion: "platform_resource_summary.v1",
        resourceKind,
        resourceId,
        label: "sample.mp4",
        status: "processed",
        source: { sourceOfTruth: "Runtime/Artifacts/sample_1/artifact.json", indexSource: "Infrastructure/ArtifactIndex" },
      }),
    },
    staticWorkbench: { handle: () => false },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "/api/platform/v1/resources/sample/sample_1");

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.resourceKind, "sample");
    assert.equal(response.body.resourceId, "sample_1");
    assert.equal(response.body.label, "sample.mp4");
  } finally {
    await closeServer(server);
  }
});

test("platform resources route returns structured 404 for missing resources", async () => {
  const server = createServer({
    resourceResolver: {
      list: async () => null,
      read: async () => null,
    },
    staticWorkbench: { handle: () => false },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const missingKind = await makeRequest(server, "/api/platform/v1/resources?kind=unknown");
    const missingResource = await makeRequest(server, "/api/platform/v1/resources/sample/sample_missing");

    assert.equal(missingKind.statusCode, 404);
    assert.equal(missingKind.body.code, "resource_kind_not_found");
    assert.equal(missingResource.statusCode, 404);
    assert.equal(missingResource.body.code, "resource_not_found");
  } finally {
    await closeServer(server);
  }
});

test("platform catalog route includes internal resources only when requested", async () => {
  const server = createServer({
    staticWorkbench: { handle: () => false },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "/api/platform/v1/catalog?includeInternal=true");
    const projection = response.body.resources.find((entry) => entry.resourceKind === "projection");

    assert.equal(response.statusCode, 200);
    assert.ok(projection);
    assert.equal(projection.sourceOfTruth, "Runtime/Projection/*");
  } finally {
    await closeServer(server);
  }
});

test("platform artifact route returns artifact resolution", async () => {
  const server = createServer({
    artifactResolver: {
      resolve: async ({ artifactId, sampleVideoId }) => ({
        schemaVersion: "artifact_resolution.v1",
        artifactId,
        artifactType: "normalized-video",
        stageName: "sample.artifact.written",
        parentArtifactId: "artifact_parent",
        sampleVideoId,
        runId: "run_1",
        traceId: "trace_1",
        stageId: "stage_1",
        uri: "/runtime/sample.mp4",
        mediaKind: "video",
        exists: true,
        readable: true,
        summary: { summary: "标准化视频" },
        source: { sourceOfTruth: "Runtime/Artifacts/sample_1/artifact.json", indexSource: "Infrastructure/ArtifactIndex" },
      }),
    },
    staticWorkbench: { handle: () => false },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "/api/platform/v1/artifacts/artifact_norm?sampleVideoId=sample_1");

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.artifactId, "artifact_norm");
    assert.equal(response.body.sampleVideoId, "sample_1");
    assert.equal(response.body.uri, "/runtime/sample.mp4");
  } finally {
    await closeServer(server);
  }
});

test("platform artifact route returns structured 404 for missing artifact", async () => {
  const server = createServer({
    artifactResolver: {
      resolve: async ({ artifactId }) => ({
        schemaVersion: "artifact_resolution.v1",
        artifactId,
        artifactType: null,
        stageName: null,
        parentArtifactId: null,
        sampleVideoId: null,
        runId: null,
        traceId: null,
        stageId: null,
        uri: null,
        mediaKind: "unknown",
        exists: false,
        readable: false,
        summary: null,
        source: { sourceOfTruth: null, indexSource: null },
      }),
    },
    staticWorkbench: { handle: () => false },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "/api/platform/v1/artifacts/artifact_missing");

    assert.equal(response.statusCode, 404);
    assert.equal(response.body.schemaVersion, "platform_error.v1");
    assert.equal(response.body.code, "artifact_not_found");
    assert.equal(response.body.retryable, false);
    assert.equal(response.body.traceId, null);
    assert.equal(response.body.debugSnapshotUri, null);
    assert.equal(response.body.details.resolution.exists, false);
  } finally {
    await closeServer(server);
  }
});

test("platform trace route returns safe trace detail", async () => {
  const server = createServer({
    traceResolver: {
      read: async ({ traceId }) => ({
        schemaVersion: "platform_trace_detail.v1",
        traceId,
        status: "failed",
        updatedAt: "2026-06-01T00:00:00.000Z",
        latestEvent: "stage.fail",
        latestStageName: "script.segment.analyze",
        runId: "run_1",
        stageId: "stage_1",
        artifactId: "artifact_1",
        parentArtifactId: "artifact_parent",
        logUri: "/runtime/DebugSnapshots/trace_1.log.jsonl",
        errorSummary: { code: "failed", message: "失败", stageName: "script.segment.analyze", retryable: true, debugSnapshotUri: "/runtime/DebugSnapshots/snapshot_1.json" },
        eventCount: 2,
        stages: [],
        source: { sourceOfTruth: "Runtime/DebugSnapshots/<traceId>.log.jsonl", indexSource: "Apps/Api/lib/observability/debug-traces.js" },
      }),
    },
    staticWorkbench: { handle: () => false },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "/api/platform/v1/traces/trace_1");

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.schemaVersion, "platform_trace_detail.v1");
    assert.equal(response.body.traceId, "trace_1");
    assert.equal(response.body.status, "failed");
    assert.equal(response.body.logUri, "/runtime/DebugSnapshots/trace_1.log.jsonl");
  } finally {
    await closeServer(server);
  }
});

test("platform trace route returns structured 404 for missing trace", async () => {
  const server = createServer({
    traceResolver: {
      read: async () => null,
    },
    staticWorkbench: { handle: () => false },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "/api/platform/v1/traces/trace_missing");

    assert.equal(response.statusCode, 404);
    assert.equal(response.body.schemaVersion, "platform_error.v1");
    assert.equal(response.body.code, "trace_not_found");
    assert.deepEqual(response.body.resource, { resourceKind: "trace", resourceId: "trace_missing" });
    assert.equal(response.body.retryable, false);
  } finally {
    await closeServer(server);
  }
});

test("platform runtime-state route returns normalized runtime state", async () => {
  const server = createServer({
    runtimeStateResolver: {
      resolve: async ({ resourceKind, resourceId }) => ({
        schemaVersion: "runtime_state.v1",
        resource: { resourceKind, resourceId },
        status: "running",
        rawStatus: "processing",
        progress: 42,
        currentStages: [],
        retryable: null,
        errorSummary: null,
      }),
    },
    staticWorkbench: { handle: () => false },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "/api/platform/v1/runtime-state/job/job_1");

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.resource.resourceKind, "job");
    assert.equal(response.body.resource.resourceId, "job_1");
    assert.equal(response.body.status, "running");
    assert.equal(response.body.rawStatus, "processing");
  } finally {
    await closeServer(server);
  }
});

test("platform runtime-state route returns structured 404 for missing state", async () => {
  const server = createServer({
    runtimeStateResolver: {
      resolve: async () => null,
    },
    staticWorkbench: { handle: () => false },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "/api/platform/v1/runtime-state/job/job_missing");

    assert.equal(response.statusCode, 404);
    assert.equal(response.body.code, "runtime_state_not_found");
    assert.equal(response.body.resource.resourceKind, "job");
    assert.equal(response.body.retryable, false);
  } finally {
    await closeServer(server);
  }
});

test("platform resource actions route returns action declarations", async () => {
  const server = createServer({
    actionRegistry: {
      listActions: async ({ resourceKind, resourceId }) => ({
        schemaVersion: "platform_actions_response.v1",
        resource: { resourceKind, resourceId },
        actions: [{
          actionKey: "workflow.stage.rerun",
          label: "重跑工作流阶段",
          enabled: true,
          disabledReason: null,
          requiresConfirm: true,
          dangerLevel: "medium",
          inputSchema: null,
          effects: { createsRun: false, createsArtifact: true, mayInvalidateDownstream: true, affectedResourceRefs: [] },
        }],
      }),
    },
    staticWorkbench: { handle: () => false },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "/api/platform/v1/resources/workflowRun/workflow_1/actions");

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.resource.resourceKind, "workflowRun");
    assert.equal(response.body.actions[0].actionKey, "workflow.stage.rerun");
    assert.equal(response.body.actions[0].enabled, true);
  } finally {
    await closeServer(server);
  }
});

test("platform resource lineage route returns lineage graph", async () => {
  const server = createServer({
    lineageResolver: {
      resolve: async ({ resourceKind, resourceId }) => ({
        schemaVersion: "resource_lineage.v1",
        root: { resourceKind, resourceId },
        nodes: [{ schemaVersion: "platform_resource_summary.v1", resourceKind, resourceId }],
        edges: [],
      }),
    },
    staticWorkbench: { handle: () => false },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "/api/platform/v1/resources/sample/sample_1/lineage");

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.schemaVersion, "resource_lineage.v1");
    assert.deepEqual(response.body.root, { resourceKind: "sample", resourceId: "sample_1" });
  } finally {
    await closeServer(server);
  }
});

test("platform resource lineage route returns structured 404 when lineage is missing", async () => {
  const server = createServer({
    lineageResolver: {
      resolve: async () => null,
    },
    staticWorkbench: { handle: () => false },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "/api/platform/v1/resources/workflowRun/workflow_1/lineage");

    assert.equal(response.statusCode, 404);
    assert.equal(response.body.code, "resource_lineage_not_found");
    assert.equal(response.body.resource.resourceKind, "workflowRun");
  } finally {
    await closeServer(server);
  }
});

test("platform resource actions route returns structured 404 when actions are missing", async () => {
  const server = createServer({
    actionRegistry: {
      listActions: async () => null,
    },
    staticWorkbench: { handle: () => false },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "/api/platform/v1/resources/job/job_missing/actions");

    assert.equal(response.statusCode, 404);
    assert.equal(response.body.code, "resource_actions_not_found");
    assert.equal(response.body.resource.resourceKind, "job");
    assert.equal(response.body.retryable, false);
  } finally {
    await closeServer(server);
  }
});

function makeRequest(server, requestPath) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const request = http.request({
      agent: false,
      method: "GET",
      host: "127.0.0.1",
      port: address.port,
      path: requestPath,
      headers: {
        connection: "close",
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
    request.end();
  });
}

function makeJsonRequest(server, method, requestPath, body) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const text = JSON.stringify(body);
    const request = http.request({
      agent: false,
      method,
      host: "127.0.0.1",
      port: address.port,
      path: requestPath,
      headers: {
        connection: "close",
        "content-type": "application/json",
        "content-length": Buffer.byteLength(text),
      },
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const responseText = Buffer.concat(chunks).toString("utf8");
        response.destroy();
        resolve({
          statusCode: response.statusCode,
          headers: response.headers,
          body: responseText ? JSON.parse(responseText) : null,
        });
      });
    });
    request.on("error", reject);
    request.end(text);
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
