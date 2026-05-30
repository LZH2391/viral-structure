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

test("confirmed plan trace graph shows used source variants but hides source examples", () => {
  const { buildVisibleGraph, reverseTracePath } = loadTsModule("Apps/Workbench/src/components/function-slot-graph/graphUtils.ts");
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
  assert.ok(visible.nodes.some((node) => node.type === "sourceVariant"));
  assert.equal(visible.edges.some((edge) => edge.type === "traced_to_source_sample"), false);
  assert.ok(visible.edges.some((edge) => edge.type === "traced_to_source_variant"));
  const path = reverseTracePath("plan_a:variant:sample_1:F001", visible.edges);
  assert.ok(path.nodes.has("plan_a:plan"));
  assert.ok(path.nodes.has("plan_a:slot:unmapped"));
  assert.ok(path.edges.has("edge:slot"));
  assert.ok(path.edges.has("edge:variant"));
});

test("confirmed plan trace positions grow outward by provenance depth", () => {
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
      { id: "plan:root", type: "confirmedPlan", label: "plan", group: "plan", data: {} },
      { id: "family:f1", type: "slotFamily", label: "family", group: "slot", data: {} },
      { id: "archetype:a1", type: "slotArchetype", label: "archetype", group: "slot", data: {} },
      { id: "subtype:s1", type: "slotSubtype", label: "subtype", group: "slot", data: {} },
      { id: "atomArchetype:aa1", type: "atomArchetype", label: "atom archetype", group: "script", data: {} },
      { id: "atomPattern:ap1", type: "atomPattern", label: "atom pattern", group: "script", data: {} },
      { id: "variant:v1", type: "sourceVariant", label: "source label", group: "sourceVariant", data: { label: "source label" } },
    ],
    edges: [
      { id: "e1", source: "plan:root", target: "family:f1", type: "plan_uses_slot_family" },
      { id: "e2", source: "family:f1", target: "archetype:a1", type: "family_to_archetype" },
      { id: "e3", source: "archetype:a1", target: "subtype:s1", type: "archetype_to_subtype" },
      { id: "e4", source: "subtype:s1", target: "atomArchetype:aa1", type: "subtype_to_atom_archetype" },
      { id: "e5", source: "atomArchetype:aa1", target: "atomPattern:ap1", type: "atom_archetype_to_pattern" },
      { id: "e6", source: "atomPattern:ap1", target: "variant:v1", type: "traced_to_source_variant" },
    ],
    summary: { planCount: 1, slotCount: 1, atomCount: 1, bindingCount: 0, conceptCount: 5 },
  };

  const visible = buildVisibleGraph(graph, filters);
  const byId = new Map(visible.nodes.map((node) => [node.id, node]));
  const root = byId.get("plan:root");
  const distance = (id) => {
    const node = byId.get(id);
    return Math.hypot(node.x - root.x, node.y - root.y);
  };

  assert.ok(distance("family:f1") < distance("archetype:a1"));
  assert.ok(distance("archetype:a1") < distance("subtype:s1"));
  assert.ok(distance("subtype:s1") < distance("atomArchetype:aa1"));
  assert.ok(distance("atomArchetype:aa1") < distance("atomPattern:ap1"));
  assert.ok(distance("atomPattern:ap1") < distance("variant:v1"));
});

test("governance radial layout keeps root centered and keeps first layer inside its sector", () => {
  const { buildVisibleGraph, CENTER } = loadTsModule("Apps/Workbench/src/components/function-slot-graph/graphUtils.ts");
  const filters = {
    slot: true,
    atom: true,
    binding: false,
    rule: false,
    bundle: false,
    unmapped: false,
  };
  const families = ["f1", "f2", "f3", "f4"].map((id) => ({ id: `family:${id}`, type: "slotFamily", label: id, group: "slot", data: {} }));
  const graph = {
    schemaVersion: "function_slot_governance_graph.v1",
    artifactId: "governance-test",
    nodes: [
      { id: "governance:root", type: "governanceRoot", label: "Governance", group: "governance", data: {} },
      ...families,
    ],
    edges: families.map((family, index) => ({ id: `edge:${index}`, source: "governance:root", target: family.id, type: "governance_contains_family" })),
    summary: { slotCount: 4, atomCount: 0, bindingCount: 0, conceptCount: 4 },
  };

  const visible = buildVisibleGraph(graph, filters, null, "force");
  const root = visible.nodes.find((node) => node.id === "governance:root");
  const familyNodes = visible.nodes.filter((node) => node.type === "slotFamily");

  assert.equal(root.x, CENTER.x);
  assert.equal(root.y, CENTER.y);
  assert.equal(familyNodes.length, 4);
  assert.ok(familyNodes.every((node) => node.layoutAngleMin < -2.5));
  assert.ok(familyNodes.every((node) => node.layoutAngleMax < -1));
  assert.ok(familyNodes.every((node) => node.layoutRadiusMin < distanceFromRoot(node, root)));
  assert.ok(familyNodes.every((node) => node.layoutRadiusMax > distanceFromRoot(node, root)));
});

function distanceFromRoot(node, root) {
  return Math.hypot(node.x - root.x, (node.y - root.y) / (node.layoutYScale ?? 1));
}

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
        forceLink: () => ({ id: () => ({ distance: () => ({ strength: () => ({}) }) }) }),
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
