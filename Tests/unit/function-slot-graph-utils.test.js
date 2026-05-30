const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

test("governance graph no longer merges confirmed plan projection overlays", () => {
  const { buildVisibleGraph } = loadTsModule("Apps/Workbench/src/components/function-slot-graph/graphUtils.ts");
  const filters = {
    slot: true,
    atom: true,
    binding: true,
    rule: true,
    bundle: true,
    unmapped: true,
  };
  const graph = {
    schemaVersion: "function_slot_governance_graph.v1",
    artifactId: "governance_test",
    nodes: [
      { id: "governance:test", type: "governanceRoot", label: "Governance", group: "governance", data: {} },
      { id: "slotSubtype:SUB_mapped", type: "slotSubtype", label: "已映射槽位", group: "slot", data: { id: "SUB_mapped" } },
    ],
    edges: [{ id: "edge:root:slot", source: "governance:test", target: "slotSubtype:SUB_mapped", type: "governance_contains_subtype" }],
    summary: { slotCount: 1, atomCount: 0, bindingCount: 0, conceptCount: 1 },
  };
  const visible = buildVisibleGraph(graph, filters);

  assert.equal(visible.nodes.some((node) => node.type === "confirmedPlan"), false);
  assert.equal(visible.nodes.some((node) => node.id === "slotSubtype:SUB_mapped" && node.data.overlayUsageCount === 1), false);
  assert.ok(visible.nodes.some((node) => node.id === "slotSubtype:SUB_mapped"));
});

test("confirmed plan trace graph hides source examples and variants", () => {
  const { buildVisibleGraph } = loadTsModule("Apps/Workbench/src/components/function-slot-graph/graphUtils.ts");
  const filters = {
    slot: true,
    atom: true,
    binding: true,
    rule: true,
    bundle: true,
    unmapped: true,
  };
  const graph = {
    schemaVersion: "confirmed_plan_trace_graph.v1",
    artifactId: "confirmed-plan-trace",
    nodes: [
      { id: "plan_a:plan", type: "confirmedPlan", label: "plan_a", group: "plan", data: { planId: "plan_a" } },
      { id: "plan_a:slot:unmapped", type: "tracedSlot", label: "方案槽位", group: "slot", data: { planId: "plan_a", governanceNodeId: null } },
      { id: "plan_a:sample:sample_1", type: "sourceExample", label: "A", group: "sourceExample", data: { planId: "plan_a", sampleId: "sample_1" } },
      { id: "plan_a:variant:sample_1:F001", type: "sourceVariant", label: "A::F001", group: "sourceVariant", data: { planId: "plan_a", sampleId: "sample_1", variantId: "sample_1::F001" } },
    ],
    edges: [
      { id: "edge:slot", source: "plan_a:plan", target: "plan_a:slot:unmapped", type: "plan_uses_slot" },
      { id: "edge:source", source: "plan_a:slot:unmapped", target: "plan_a:sample:sample_1", type: "traced_to_source_sample" },
      { id: "edge:variant", source: "plan_a:slot:unmapped", target: "plan_a:variant:sample_1:F001", type: "traced_to_source_variant" },
    ],
    summary: { planCount: 1, slotCount: 1, atomCount: 0, bindingCount: 0, conceptCount: 1 },
  };

  const visible = buildVisibleGraph(graph, filters);

  assert.ok(visible.nodes.some((node) => node.type === "confirmedPlan"));
  assert.ok(visible.nodes.some((node) => node.type === "tracedSlot" && String(node.label).includes("方案槽位")));
  assert.equal(visible.nodes.some((node) => node.type === "sourceExample"), false);
  assert.equal(visible.nodes.some((node) => node.type === "sourceVariant"), false);
  assert.equal(visible.edges.some((edge) => edge.type === "traced_to_source_sample"), false);
  assert.equal(visible.edges.some((edge) => edge.type === "traced_to_source_variant"), false);
});

function loadTsModule(relativePath) {
  const sourcePath = path.join(process.cwd(), relativePath);
  const source = fs.readFileSync(sourcePath, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} };
  const execute = new Function("module", "exports", "require", compiled);
  execute(module, module.exports, (specifier) => {
    if (specifier === "d3-force") {
      return {
        forceCenter: () => ({ strength: () => ({}) }),
        forceCollide: () => ({ radius: () => ({ strength: () => ({ iterations: () => ({}) }) }) }),
        forceLink: () => ({ id: () => ({ distance: () => ({}) }) }),
        forceManyBody: () => ({ strength: () => ({ distanceMin: () => ({ distanceMax: () => ({}) }) }) }),
        forceSimulation: () => ({ alpha: () => ({ alphaDecay: () => ({ velocityDecay: () => ({ force: () => ({ force: () => ({ force: () => ({ force: () => ({ force: () => ({}) }) }) }) }) }) }) }) }),
        forceX: () => ({ strength: () => ({}) }),
        forceY: () => ({ strength: () => ({}) }),
      };
    }
    return {};
  });
  return module.exports;
}
