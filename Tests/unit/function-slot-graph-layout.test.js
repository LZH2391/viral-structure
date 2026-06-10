const test = require("node:test");
const assert = require("node:assert/strict");
const {
  allFilters,
  angularDistance,
  distanceFromRoot,
  loadTsModule,
} = require("./function-slot-graph-utils.helpers");

test("governance radial layout keeps root centered and keeps first layer inside its sector", () => {
  const { buildVisibleGraph, CENTER } = loadTsModule("Apps/Workbench/src/components/function-slot-graph/graphUtils.ts");
  const filters = { ...allFilters(), binding: false, rule: false, bundle: false, unmapped: false };
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
  assert.ok(familyNodes.every((node) => node.layoutRadiusMin < distanceFromRoot(node, root)));
  assert.ok(familyNodes.every((node) => node.layoutRadiusMax > distanceFromRoot(node, root)));
});

test("governance radial layout compresses hidden layer rings and keeps source samples prominent", () => {
  const { buildVisibleGraph, CENTER, nodeRadius } = loadTsModule("Apps/Workbench/src/components/function-slot-graph/graphUtils.ts");
  const filters = { ...allFilters(), slotArchetype: false, atomArchetype: false };
  const graph = {
    schemaVersion: "function_slot_governance_graph.v1",
    artifactId: "governance-test",
    nodes: [
      { id: "governance:root", type: "governanceRoot", label: "Governance", group: "governance", data: {} },
      { id: "family:f1", type: "slotFamily", label: "family", group: "slot", data: {} },
      { id: "archetype:a1", type: "slotArchetype", label: "arch", group: "slot", data: {} },
      { id: "subtype:s1", type: "slotSubtype", label: "subtype", group: "slot", data: { id: "s1", sourceAtomVariantIds: ["sample_a::script::S001"] } },
      { id: "atomArchetype:aa1", type: "atomArchetype", label: "atom arch", group: "script", data: {} },
      { id: "atomPattern:p1", type: "atomPattern", label: "pattern", group: "script", data: { sourceVariantIds: ["sample_a::script::S001"] } },
      { id: "sourceVariant:v1", type: "sourceVariant", label: "variant", group: "sourceVariant", data: {} },
      { id: "sourceSample:sample_a", type: "sourceSample", label: "sample", group: "sourceSample", data: { sampleVideoId: "sample_a" } },
    ],
    edges: [
      { id: "e1", source: "governance:root", target: "family:f1", type: "governance_contains_family" },
      { id: "e2", source: "family:f1", target: "archetype:a1", type: "family_to_archetype" },
      { id: "e3", source: "archetype:a1", target: "subtype:s1", type: "archetype_to_subtype" },
      { id: "e6", source: "atomArchetype:aa1", target: "atomPattern:p1", type: "atom_archetype_to_pattern" },
      { id: "e7", source: "atomPattern:p1", target: "sourceVariant:v1", type: "pattern_to_source_variant" },
      { id: "e8", source: "sourceVariant:v1", target: "sourceSample:sample_a", type: "source_variant_to_sample" },
    ],
    summary: { slotCount: 1, atomCount: 1, bindingCount: 0, conceptCount: 8 },
  };

  const visible = buildVisibleGraph(graph, filters, null, "force");
  const byId = new Map(visible.nodes.map((node) => [node.id, node]));
  const radiusFromCenter = (id) => {
    const node = byId.get(id);
    return Math.hypot(node.x - CENTER.x, (node.y - CENTER.y) / (node.layoutYScale ?? 1));
  };

  assert.equal(byId.has("archetype:a1"), false);
  assert.equal(byId.get("governance:root").layoutLevel, 0);
  assert.equal(byId.get("family:f1").layoutLevel, 1);
  assert.equal(byId.get("subtype:s1").layoutLevel, 2);
  assert.equal(byId.get("atomPattern:p1").layoutLevel, 3);
  assert.equal(byId.get("sourceVariant:v1").layoutLevel, 4);
  assert.equal(byId.get("sourceSample:sample_a").layoutLevel, 5);
  assert.ok(radiusFromCenter("family:f1") < radiusFromCenter("subtype:s1"));
  assert.ok(radiusFromCenter("subtype:s1") < radiusFromCenter("atomPattern:p1"));
  assert.equal(nodeRadius(byId.get("sourceSample:sample_a")), nodeRadius(byId.get("governance:root")));
});

test("governance column layout leaves enough vertical room for source samples", () => {
  const { buildVisibleGraph, nodeRadius } = loadTsModule("Apps/Workbench/src/components/function-slot-graph/graphUtils.ts");
  const samples = Array.from({ length: 6 }, (_, index) => ({
    id: `sourceSample:sample_${index + 1}`,
    type: "sourceSample",
    label: `sample_${index + 1}`,
    group: "sourceSample",
    data: { sampleVideoId: `sample_${index + 1}` },
  }));
  const graph = {
    schemaVersion: "function_slot_governance_graph.v1",
    artifactId: "governance-test",
    nodes: [
      { id: "governance:root", type: "governanceRoot", label: "Governance", group: "governance", data: {} },
      ...samples,
    ],
    edges: samples.map((sample, index) => ({ id: `e${index}`, source: "governance:root", target: sample.id, type: "governance_contains_source_sample" })),
    summary: { slotCount: 0, atomCount: 0, bindingCount: 0, conceptCount: 6 },
  };

  const visible = buildVisibleGraph(graph, allFilters(), null, "columns");
  const sampleNodes = visible.nodes.filter((node) => node.type === "sourceSample").sort((left, right) => left.y - right.y);
  const minSpacing = nodeRadius(sampleNodes[0]) * 2 + 12;

  assert.equal(sampleNodes.length, samples.length);
  for (let index = 1; index < sampleNodes.length; index += 1) {
    assert.ok(sampleNodes[index].y - sampleNodes[index - 1].y >= minSpacing);
  }
});

test("governance label specs follow visible layout levels from inner to outer", () => {
  const { governanceLabelSpec } = loadTsModule("Apps/Workbench/src/components/function-slot-graph/graphVisualStyles.ts");
  const root = governanceLabelSpec({ type: "governanceRoot", layoutLevel: 0 });
  const inner = governanceLabelSpec({ type: "slotFamily", layoutLevel: 1 });
  const middle = governanceLabelSpec({ type: "atomPattern", layoutLevel: 3 });
  const outer = governanceLabelSpec({ type: "sourceSample", layoutLevel: 5 });

  assert.ok(root.fontSize > inner.fontSize);
  assert.ok(inner.fontSize > middle.fontSize);
  assert.ok(middle.fontSize > outer.fontSize);
  assert.ok(root.start < inner.start);
  assert.ok(inner.start < middle.start);
  assert.ok(middle.start < outer.start);
  assert.equal(outer.min, 0);
});

test("focused slot sequence edges stay brighter than unselected arrows", () => {
  const { resolveGraphEdgeStyle } = loadTsModule("Apps/Workbench/src/components/function-slot-graph/graphVisualStyles.ts");
  const source = { id: "source", type: "slotSubtype", group: "slot", data: {}, x: 0, y: 0 };
  const target = { id: "target", type: "slotSubtype", group: "slot", data: {}, x: 100, y: 0 };
  const edge = { id: "edge", source: "source", target: "target", type: "plan_slot_next" };

  const unselected = resolveGraphEdgeStyle(edge, source, target, "planTrace", false, false);
  const focused = resolveGraphEdgeStyle(edge, source, target, "planTrace", true, false);
  const muted = resolveGraphEdgeStyle(edge, source, target, "planTrace", false, true);

  assert.ok(focused.arrowAlpha > unselected.arrowAlpha);
  assert.ok(unselected.arrowAlpha > muted.arrowAlpha);
  assert.ok(unselected.arrowAlpha < 0.4);
  assert.equal(focused.arrowColor, unselected.arrowColor);
  assert.equal(focused.width, 3);
});

test("muted graph nodes stay more visible than muted edges", () => {
  const { resolveGraphEdgeStyle, resolveGraphNodeStyle } = loadTsModule("Apps/Workbench/src/components/function-slot-graph/graphVisualStyles.ts");
  const source = { id: "source", type: "slotSubtype", group: "slot", data: {}, x: 0, y: 0 };
  const target = { id: "target", type: "atomPattern", group: "script", data: {}, x: 100, y: 0 };
  const edge = { id: "edge", source: "source", target: "target", type: "subtype_to_atom_pattern" };

  const mutedEdge = resolveGraphEdgeStyle(edge, source, target, "governance", false, true);
  const mutedNode = resolveGraphNodeStyle(target, "governance", false, false, false, false, false);
  const focusMutedNode = resolveGraphNodeStyle(target, "governance", false, false, false, false, true);

  assert.ok(mutedNode.groupAlpha > mutedEdge.alpha);
  assert.ok(focusMutedNode.groupAlpha > mutedEdge.alpha);
});

test("governance force layout bundles atoms and samples near visible parents", () => {
  const { buildVisibleGraph, CENTER } = loadTsModule("Apps/Workbench/src/components/function-slot-graph/graphUtils.ts");
  const filters = { ...allFilters(), atomArchetype: false };
  const graph = {
    schemaVersion: "function_slot_governance_graph.v1",
    artifactId: "governance-test",
    nodes: [
      { id: "governance:root", type: "governanceRoot", label: "Governance", group: "governance", data: {} },
      { id: "subtype:a", type: "slotSubtype", label: "A", group: "slot", data: { id: "a", sourceAtomVariantIds: ["sample_a::script::S001"] } },
      { id: "subtype:b", type: "slotSubtype", label: "B", group: "slot", data: { id: "b", sourceAtomVariantIds: ["sample_b::script::S002"] } },
      { id: "arch:a", type: "atomArchetype", label: "arch A", group: "script", data: {} },
      { id: "arch:b", type: "atomArchetype", label: "arch B", group: "script", data: {} },
      { id: "pattern:a", type: "atomPattern", label: "pattern A", group: "script", data: { sourceVariantIds: ["sample_a::script::S001"] } },
      { id: "pattern:b", type: "atomPattern", label: "pattern B", group: "script", data: { sourceVariantIds: ["sample_b::script::S002"] } },
      { id: "variant:a", type: "sourceVariant", label: "variant A", group: "sourceVariant", data: {} },
      { id: "variant:b", type: "sourceVariant", label: "variant B", group: "sourceVariant", data: {} },
      { id: "sample:a", type: "sourceSample", label: "sample A", group: "sourceSample", data: { sampleVideoId: "sample_a" } },
      { id: "sample:b", type: "sourceSample", label: "sample B", group: "sourceSample", data: { sampleVideoId: "sample_b" } },
    ],
    edges: [
      { id: "e-root-a", source: "governance:root", target: "subtype:a", type: "governance_contains_subtype" },
      { id: "e-root-b", source: "governance:root", target: "subtype:b", type: "governance_contains_subtype" },
      { id: "e-a-pattern", source: "arch:a", target: "pattern:a", type: "atom_archetype_to_pattern" },
      { id: "e-b-pattern", source: "arch:b", target: "pattern:b", type: "atom_archetype_to_pattern" },
      { id: "e-a-variant", source: "pattern:a", target: "variant:a", type: "pattern_to_source_variant" },
      { id: "e-b-variant", source: "pattern:b", target: "variant:b", type: "pattern_to_source_variant" },
      { id: "e-a-sample", source: "variant:a", target: "sample:a", type: "source_variant_to_sample" },
      { id: "e-b-sample", source: "variant:b", target: "sample:b", type: "source_variant_to_sample" },
    ],
    summary: { slotCount: 2, atomCount: 2, bindingCount: 0, conceptCount: 12 },
  };

  const visible = buildVisibleGraph(graph, filters, null, "force");
  const byId = new Map(visible.nodes.map((node) => [node.id, node]));
  const angle = (id) => {
    const node = byId.get(id);
    return Math.atan2((node.y - CENTER.y) / (node.layoutYScale ?? 1), node.x - CENTER.x);
  };

  assert.ok(angularDistance(angle("pattern:a"), angle("subtype:a")) < angularDistance(angle("pattern:a"), angle("subtype:b")));
  assert.ok(angularDistance(angle("pattern:b"), angle("subtype:b")) < angularDistance(angle("pattern:b"), angle("subtype:a")));
  assert.ok(angularDistance(angle("sample:a"), angle("variant:a")) < angularDistance(angle("sample:a"), angle("variant:b")));
  assert.ok(angularDistance(angle("sample:b"), angle("variant:b")) < angularDistance(angle("sample:b"), angle("variant:a")));
});

test("governance layout anchors hidden-archetype pattern links by atom variant evidence", () => {
  const { buildVisibleGraph, CENTER } = loadTsModule("Apps/Workbench/src/components/function-slot-graph/graphUtils.ts");
  const filters = { ...allFilters(), atomArchetype: false, sourceVariant: false };
  const graph = {
    schemaVersion: "function_slot_governance_graph.v1",
    artifactId: "governance-test",
    nodes: [
      { id: "governance:root", type: "governanceRoot", label: "Governance", group: "governance", data: {} },
      { id: "subtype:a", type: "slotSubtype", label: "A", group: "slot", data: { id: "a", sourceAtomVariantIds: ["sample_a::script::S001"] } },
      { id: "subtype:b", type: "slotSubtype", label: "B", group: "slot", data: { id: "b", sourceAtomVariantIds: ["sample_b::script::S002"] } },
      { id: "arch:shared", type: "atomArchetype", label: "shared arch", group: "script", data: {} },
      { id: "pattern:a", type: "atomPattern", label: "pattern A", group: "script", data: { sourceVariantIds: ["sample_a::script::S001"] } },
    ],
    edges: [
      { id: "e-root-a", source: "governance:root", target: "subtype:a", type: "governance_contains_subtype" },
      { id: "e-root-b", source: "governance:root", target: "subtype:b", type: "governance_contains_subtype" },
      { id: "e-pattern", source: "arch:shared", target: "pattern:a", type: "atom_archetype_to_pattern" },
    ],
    summary: { slotCount: 2, atomCount: 1, bindingCount: 0, conceptCount: 7 },
  };

  const visible = buildVisibleGraph(graph, filters, null, "force");
  const byId = new Map(visible.nodes.map((node) => [node.id, node]));
  const angle = (id) => {
    const node = byId.get(id);
    return Math.atan2((node.y - CENTER.y) / (node.layoutYScale ?? 1), node.x - CENTER.x);
  };

  assert.ok(visible.edges.some((edge) => edge.source === "subtype:a" && edge.target === "pattern:a" && edge.type === "subtype_to_atom_pattern"));
  assert.equal(visible.edges.some((edge) => edge.source === "subtype:b" && edge.target === "pattern:a"), false);
  assert.ok(angularDistance(angle("pattern:a"), angle("subtype:a")) < angularDistance(angle("pattern:a"), angle("subtype:b")));
});
