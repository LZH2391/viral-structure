const test = require("node:test");
const assert = require("node:assert/strict");
const { createResourceCatalog, RESOURCE_CATALOG_SCHEMA_VERSION } = require("../../Apps/Api/lib/platform/resource-catalog");

test("resource catalog lists public resource kinds with source metadata", () => {
  const catalog = createResourceCatalog();
  const entries = catalog.list();
  const byKind = new Map(entries.map((entry) => [entry.resourceKind, entry]));

  assert.equal(catalog.schemaVersion, RESOURCE_CATALOG_SCHEMA_VERSION);
  assert.equal(byKind.has("sample"), true);
  assert.equal(byKind.has("artifact"), true);
  assert.equal(byKind.has("workflowRun"), true);
  assert.equal(byKind.has("projection"), false);
  assert.deepEqual(byKind.get("sample").idFields, ["sampleVideoId"]);
  assert.equal(byKind.get("sample").sourceOfTruth, "Runtime/Artifacts/<sampleVideoId>/artifact.json");
  assert.equal(byKind.get("artifact").supportsLineage, true);
});

test("resource catalog can include internal resource kinds explicitly", () => {
  const catalog = createResourceCatalog();
  const publicKinds = catalog.list().map((entry) => entry.resourceKind);
  const internalKinds = catalog.list({ includeInternal: true }).map((entry) => entry.resourceKind);

  assert.equal(publicKinds.includes("projection"), false);
  assert.equal(internalKinds.includes("projection"), true);
  assert.equal(catalog.get("projection", { includeInternal: false }), null);
  assert.equal(catalog.get("projection").resourceKind, "projection");
});
