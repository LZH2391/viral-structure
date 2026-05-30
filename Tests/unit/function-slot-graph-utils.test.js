const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

test("governance overlay hides unmapped projected fallback nodes", () => {
  const { buildVisibleGraph } = loadTsModule("Apps/Workbench/src/components/function-slot-graph/graphUtils.ts");
  const filters = {
    slot: true,
    atom: true,
    binding: true,
    rule: true,
    bundle: true,
    unmapped: true,
    needReview: true,
    candidate: true,
    reviewed: true,
    stable: true,
  };
  const graph = {
    schemaVersion: "function_slot_governance_graph.v1",
    artifactId: "governance_test",
    nodes: [
      { id: "governance:test", type: "governanceRoot", label: "Governance", group: "governance", data: {} },
      { id: "slotSubtype:SUB_mapped", type: "slotSubtype", label: "已映射槽位", group: "slot", data: { id: "SUB_mapped", reviewStatus: "reviewed" } },
    ],
    edges: [{ id: "edge:root:slot", source: "governance:test", target: "slotSubtype:SUB_mapped", type: "governance_contains_subtype" }],
    summary: { slotCount: 1, atomCount: 0, bindingCount: 0, conceptCount: 1 },
  };
  const overlay = {
    schemaVersion: "governance_plan_overlays.v1",
    baseGraphId: "semantic-governance.v1",
    plans: [{ planId: "plan_a", color: "#6ea8fe" }],
    projectedNodes: [
      { id: "plan_a:plan", planId: "plan_a", type: "confirmedPlan", label: "plan_a", color: "#6ea8fe", governanceNodeId: null },
      { id: "plan_a:slot:SUB_mapped", planId: "plan_a", type: "projectedSlot", label: "已映射", color: "#6ea8fe", governanceNodeId: "slotSubtype:SUB_mapped" },
      { id: "plan_a:slot:unmapped", planId: "plan_a", type: "projectedSlot", label: "{\"value\":\"不该显示\"}", color: "#6ea8fe", governanceNodeId: null },
    ],
    projectedEdges: [
      { id: "plan_a:edge:mapped", planId: "plan_a", source: "plan_a:plan", target: "plan_a:slot:SUB_mapped", type: "plan_uses_slot" },
      { id: "plan_a:edge:unmapped", planId: "plan_a", source: "plan_a:plan", target: "plan_a:slot:unmapped", type: "plan_uses_slot" },
    ],
    sharedUsage: {},
    reviewFlags: [],
    summary: { planCount: 1, projectedNodeCount: 3, projectedEdgeCount: 2, sharedNodeCount: 0, reviewFlagCount: 0 },
  };

  const visible = buildVisibleGraph(graph, filters, null, overlay);

  assert.ok(visible.nodes.some((node) => node.type === "confirmedPlan"));
  assert.ok(visible.nodes.some((node) => node.id === "slotSubtype:SUB_mapped" && node.data.overlayUsageCount === 1));
  assert.equal(visible.nodes.some((node) => node.type === "projectedSlot"), false);
  assert.equal(visible.nodes.some((node) => String(node.label).includes("{\"value\"")), false);
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
