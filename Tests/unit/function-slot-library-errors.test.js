const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { createServer } = require("../../Apps/Api/server");
const { closeServer, createTempLibraryService, makeRequest } = require("./function-slot-library.helpers");

test("function slot library API returns safe 404 payloads for missing source and item", async () => {
  const server = createServer({
    functionSlotLibraryService: {
      exportSampleArtifact: async () => null,
      listLibraryItems: async () => [],
      projectLibraryArtifact: async () => null,
      readLibraryArtifact: async () => null,
      deleteLibraryItem: async () => null,
    },
    staticWorkbench: { handle: () => false },
    logger: {
      writeStageLog: async () => undefined,
      writeDebugSnapshot: async () => ({ uri: "/runtime/snapshot.json" }),
    },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const exported = await makeRequest(server, "POST", "/api/sample-videos/missing/function-slot-library/export");
    const graph = await makeRequest(server, "GET", "/api/function-slot-library/missing/graph");
    const projected = await makeRequest(server, "POST", "/api/function-slot-library/missing/project");

    assert.equal(exported.statusCode, 404);
    assert.equal(exported.body.code, "function_slot_library_source_missing");
    assert.equal(graph.statusCode, 404);
    assert.equal(projected.statusCode, 404);
  } finally {
    await closeServer(server);
  }
});

test("function slot library API returns 400 for invalid export mode", async () => {
  const server = createServer({
    functionSlotLibraryService: {
      exportSampleArtifact: async () => {
        const error = new Error("mode 只支持 replace 或 skip-existing");
        error.statusCode = 400;
        error.code = "function_slot_library_invalid_mode";
        throw error;
      },
      listLibraryItems: async () => [],
      projectLibraryArtifact: async () => null,
      deleteLibraryItem: async () => null,
    },
    staticWorkbench: { handle: () => false },
    logger: {
      writeStageLog: async () => undefined,
      writeDebugSnapshot: async () => ({ uri: "/runtime/snapshot.json" }),
    },
    recordApiRequestFailure: async () => ({
      traceContext: { traceId: "trace_invalid_mode" },
      snapshot: { uri: "/runtime/debug-snapshots/invalid-mode.json" },
      errorSummary: { stageName: "api.request.handle" },
    }),
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  try {
    const response = await makeRequest(server, "POST", "/api/sample-videos/sample_library/function-slot-library/export?mode=oops");
    assert.equal(response.statusCode, 400);
    assert.equal(response.body.code, "function_slot_library_invalid_mode");
  } finally {
    await closeServer(server);
  }
});

test("function slot library service rejects invalid export mode", async () => {
  const { service } = await createTempLibraryService();
  await assert.rejects(
    service.exportSampleArtifact("sample_library", { mode: "oops" }),
    /mode 只支持 replace 或 skip-existing/,
  );
});
