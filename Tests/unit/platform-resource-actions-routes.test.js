const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { server: defaultServer, createServer } = require("../../Apps/Api/server");
const { makeRequest, closeServer } = require("./platform-routes.helpers");

test.after(() => {
  if (defaultServer.listening) defaultServer.close();
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
