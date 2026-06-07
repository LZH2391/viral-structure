const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

function allFilters() {
  return {
    slot: true,
    atom: true,
    binding: true,
    rule: true,
    bundle: true,
    unmapped: true,
    slotFamily: true,
    slotArchetype: true,
    slotSubtype: true,
    atomArchetype: true,
    atomPattern: true,
    sourceVariant: true,
  };
}

test("governance graph no longer merges confirmed plan projection overlays", () => {
  const { buildVisibleGraph } = loadTsModule("Apps/Workbench/src/components/function-slot-graph/graphUtils.ts");
  const filters = allFilters();
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

test("governance graph connects subtype-pattern links by atom variant evidence only when atom archetype is hidden", () => {
  const { buildVisibleGraph } = loadTsModule("Apps/Workbench/src/components/function-slot-graph/graphUtils.ts");
  const filters = { ...allFilters(), sourceVariant: false };
  const graph = {
    schemaVersion: "function_slot_governance_graph.v1",
    artifactId: "governance_test",
    nodes: [
      { id: "governance:test", type: "governanceRoot", label: "Governance", group: "governance", data: {} },
      { id: "slotSubtype:SUB_a", type: "slotSubtype", label: "Subtype A", group: "slot", data: { id: "SUB_a", sourceAtomVariantIds: ["sample_a::script::S001"] } },
      { id: "slotSubtype:SUB_b", type: "slotSubtype", label: "Subtype B", group: "slot", data: { id: "SUB_b", sourceAtomVariantIds: ["sample_a::script::S002"] } },
      { id: "atomArchetype:ARCH_script", type: "atomArchetype", label: "Script arch", group: "script", data: {} },
      { id: "atomPattern:PAT_a", type: "atomPattern", label: "Pattern A", group: "script", data: { sourceVariantIds: ["sample_a::script::S001"] } },
      { id: "atomPattern:PAT_b", type: "atomPattern", label: "Pattern B", group: "script", data: { sourceVariantIds: ["sample_a::script::S999"] } },
    ],
    edges: [
      { id: "edge:sub:arch", source: "slotSubtype:SUB_a", target: "atomArchetype:ARCH_script", type: "subtype_to_atom_archetype" },
      { id: "edge:arch:pattern", source: "atomArchetype:ARCH_script", target: "atomPattern:PAT_a", type: "atom_archetype_to_pattern" },
      { id: "edge:arch:pattern_b", source: "atomArchetype:ARCH_script", target: "atomPattern:PAT_b", type: "atom_archetype_to_pattern" },
      { id: "edge:stale:sub:pattern", source: "slotSubtype:SUB_b", target: "atomPattern:PAT_a", type: "subtype_to_atom_pattern" },
    ],
    summary: { slotCount: 1, atomCount: 1, bindingCount: 0, conceptCount: 3 },
  };

  const visibleWithArchetype = buildVisibleGraph(graph, filters);
  const visibleWithoutArchetype = buildVisibleGraph(graph, { ...filters, atomArchetype: false });

  assert.ok(visibleWithArchetype.edges.some((edge) => edge.source === "slotSubtype:SUB_a" && edge.target === "atomArchetype:ARCH_script" && edge.type === "subtype_to_atom_archetype"));
  assert.ok(visibleWithArchetype.edges.some((edge) => edge.source === "atomArchetype:ARCH_script" && edge.target === "atomPattern:PAT_a" && edge.type === "atom_archetype_to_pattern"));
  assert.equal(visibleWithArchetype.edges.some((edge) => edge.source === "slotSubtype:SUB_a" && edge.target === "atomPattern:PAT_a"), false);
  assert.ok(visibleWithoutArchetype.edges.some((edge) => edge.source === "slotSubtype:SUB_a" && edge.target === "atomPattern:PAT_a" && edge.type === "subtype_to_atom_pattern"));
  assert.equal(visibleWithoutArchetype.edges.some((edge) => edge.source === "slotSubtype:SUB_a" && edge.target === "atomPattern:PAT_b"), false);
  assert.equal(visibleWithoutArchetype.edges.some((edge) => edge.source === "slotSubtype:SUB_b" && edge.target === "atomPattern:PAT_a"), false);
});

test("governance graph hides legacy atom layer nodes from stale payloads", () => {
  const { buildVisibleGraph } = loadTsModule("Apps/Workbench/src/components/function-slot-graph/graphUtils.ts");
  const graph = {
    schemaVersion: "function_slot_governance_graph.v1",
    artifactId: "governance_test",
    nodes: [
      { id: "governance:test", type: "governanceRoot", label: "Governance", group: "governance", data: {} },
      { id: "slotSubtype:SUB_a", type: "slotSubtype", label: "Subtype A", group: "slot", data: { id: "SUB_a" } },
      { id: "atomLayer:script", type: "atomLayer", label: "脚本层", group: "script", data: { layer: "script" } },
      { id: "atomLayer:rhythm", type: "atomLayer", label: "节奏层", group: "rhythm", data: { layer: "rhythm" } },
      { id: "atomLayer:packaging", type: "atomLayer", label: "包装层", group: "packaging", data: { layer: "packaging" } },
      { id: "atomPattern:PAT_a", type: "atomPattern", label: "Pattern", group: "script", data: { forSlotSubtypeIds: ["SUB_a"] } },
    ],
    edges: [
      { id: "edge:sub:layer", source: "slotSubtype:SUB_a", target: "atomLayer:script", type: "subtype_to_atom_layer" },
      { id: "edge:layer:pattern", source: "atomLayer:script", target: "atomPattern:PAT_a", type: "atom_layer_to_pattern" },
    ],
    summary: { slotCount: 1, atomCount: 1, bindingCount: 0, conceptCount: 6 },
  };

  const visible = buildVisibleGraph(graph, allFilters());

  assert.equal(visible.nodes.some((node) => node.type === "atomLayer"), false);
  assert.equal(visible.nodes.some((node) => ["脚本层", "节奏层", "包装层"].includes(node.label)), false);
});

test("governance force layout keeps subtype to atom archetype links visible", () => {
  const { buildVisibleGraph } = loadTsModule("Apps/Workbench/src/components/function-slot-graph/graphUtils.ts");
  const graph = {
    schemaVersion: "function_slot_governance_graph.v1",
    artifactId: "governance_test",
    nodes: [
      { id: "governance:test", type: "governanceRoot", label: "Governance", group: "governance", data: {} },
      { id: "slotSubtype:SUB_a", type: "slotSubtype", label: "Subtype A", group: "slot", data: { id: "SUB_a" } },
      { id: "atomArchetype:ARCH_script", type: "atomArchetype", label: "Script arch", group: "script", data: {} },
    ],
    edges: [
      { id: "edge:sub:arch", source: "slotSubtype:SUB_a", target: "atomArchetype:ARCH_script", type: "subtype_to_atom_archetype" },
    ],
    summary: { slotCount: 1, atomCount: 1, bindingCount: 0, conceptCount: 3 },
  };

  const visible = buildVisibleGraph(graph, allFilters(), null, "force");

  assert.ok(visible.nodes.some((node) => node.id === "atomArchetype:ARCH_script"));
  assert.ok(visible.edges.some((edge) => edge.source === "slotSubtype:SUB_a" && edge.target === "atomArchetype:ARCH_script" && edge.type === "subtype_to_atom_archetype"));
});

test("governance graph does not project slot archetypes into atom patterns", () => {
  const { buildVisibleGraph } = loadTsModule("Apps/Workbench/src/components/function-slot-graph/graphUtils.ts");
  const filters = { ...allFilters(), slotSubtype: false, atomArchetype: false, sourceVariant: false };
  const graph = {
    schemaVersion: "function_slot_governance_graph.v1",
    artifactId: "governance_test",
    nodes: [
      { id: "governance:test", type: "governanceRoot", label: "Governance", group: "governance", data: {} },
      { id: "slotArchetype:ARCH_a", type: "slotArchetype", label: "Archetype A", group: "slot", data: { id: "ARCH_a" } },
      { id: "slotSubtype:SUB_a", type: "slotSubtype", label: "Subtype A", group: "slot", data: { id: "SUB_a" } },
      { id: "atomArchetype:ARCH_script", type: "atomArchetype", label: "Script arch", group: "script", data: {} },
      { id: "atomPattern:PAT_a", type: "atomPattern", label: "Pattern", group: "script", data: { forSlotSubtypeIds: ["SUB_a"] } },
    ],
    edges: [
      { id: "edge:slot:sub", source: "slotArchetype:ARCH_a", target: "slotSubtype:SUB_a", type: "archetype_to_subtype" },
      { id: "edge:sub:pattern", source: "slotSubtype:SUB_a", target: "atomPattern:PAT_a", type: "subtype_to_atom_pattern" },
      { id: "edge:arch:pattern", source: "atomArchetype:ARCH_script", target: "atomPattern:PAT_a", type: "atom_archetype_to_pattern" },
    ],
    summary: { slotCount: 1, atomCount: 1, bindingCount: 0, conceptCount: 4 },
  };

  const visible = buildVisibleGraph(graph, filters);

  assert.ok(visible.nodes.some((node) => node.id === "slotArchetype:ARCH_a"));
  assert.ok(visible.nodes.some((node) => node.id === "atomPattern:PAT_a"));
  assert.equal(visible.edges.some((edge) => edge.source === "slotArchetype:ARCH_a" && edge.target === "atomPattern:PAT_a"), false);
});

test("governance graph never shows governance to source sample direct edges", () => {
  const { buildVisibleGraph } = loadTsModule("Apps/Workbench/src/components/function-slot-graph/graphUtils.ts");
  const graph = {
    schemaVersion: "function_slot_governance_graph.v1",
    artifactId: "governance_test",
    nodes: [
      { id: "governance:test", type: "governanceRoot", label: "Governance", group: "governance", data: {} },
      { id: "sourceVariant:v1", type: "sourceVariant", label: "variant", group: "sourceVariant", data: { variantId: "sample_a::script::S001" } },
      { id: "sourceSample:sample_a", type: "sourceSample", label: "sample_a", group: "sourceSample", data: { sampleVideoId: "sample_a" } },
    ],
    edges: [
      { id: "edge:root:sample", source: "governance:test", target: "sourceSample:sample_a", type: "governance_contains_source_sample" },
      { id: "edge:root:variant", source: "governance:test", target: "sourceVariant:v1", type: "governance_contains_source_variant" },
      { id: "edge:variant:sample", source: "sourceVariant:v1", target: "sourceSample:sample_a", type: "source_variant_to_sample" },
    ],
    summary: { slotCount: 0, atomCount: 1, bindingCount: 0, conceptCount: 2 },
  };

  const visibleWithVariant = buildVisibleGraph(graph, allFilters());
  const visibleWithoutVariant = buildVisibleGraph(graph, { ...allFilters(), sourceVariant: false });

  assert.ok(visibleWithVariant.edges.some((edge) => edge.source === "sourceVariant:v1" && edge.target === "sourceSample:sample_a"));
  assert.equal(visibleWithVariant.edges.some((edge) => edge.source === "governance:test" && edge.target === "sourceSample:sample_a"), false);
  assert.equal(visibleWithoutVariant.edges.some((edge) => edge.source === "governance:test" && edge.target === "sourceSample:sample_a"), false);
});

test("governance graph projects source samples through hidden source variants", () => {
  const { buildVisibleGraph } = loadTsModule("Apps/Workbench/src/components/function-slot-graph/graphUtils.ts");
  const graph = {
    schemaVersion: "function_slot_governance_graph.v1",
    artifactId: "governance_test",
    nodes: [
      { id: "governance:test", type: "governanceRoot", label: "Governance", group: "governance", data: {} },
      { id: "atomPattern:PAT_a", type: "atomPattern", label: "Pattern", group: "script", data: { id: "PAT_a" } },
      { id: "sourceVariant:v1", type: "sourceVariant", label: "variant", group: "sourceVariant", data: { variantId: "sample_a::script::S001" } },
      { id: "sourceSample:sample_a", type: "sourceSample", label: "sample_a", group: "sourceSample", data: { sampleVideoId: "sample_a" } },
    ],
    edges: [
      { id: "edge:pattern:variant", source: "atomPattern:PAT_a", target: "sourceVariant:v1", type: "pattern_to_source_variant" },
      { id: "edge:variant:sample", source: "sourceVariant:v1", target: "sourceSample:sample_a", type: "source_variant_to_sample" },
    ],
    summary: { slotCount: 0, atomCount: 1, bindingCount: 0, conceptCount: 2 },
  };

  const visible = buildVisibleGraph(graph, { ...allFilters(), sourceVariant: false });

  assert.ok(visible.nodes.some((node) => node.id === "atomPattern:PAT_a"));
  assert.ok(visible.nodes.some((node) => node.id === "sourceSample:sample_a"));
  assert.ok(visible.edges.some((edge) => edge.source === "atomPattern:PAT_a" && edge.target === "sourceSample:sample_a" && edge.type === "projected_hierarchy"));
});

test("governance graph hides atom pattern candidate suffixes in display labels", () => {
  const { buildVisibleGraph, graphNodeDisplayLabel, nodeDetailRows } = loadTsModule("Apps/Workbench/src/components/function-slot-graph/graphUtils.ts");
  const filters = allFilters();
  const graph = {
    schemaVersion: "function_slot_governance_graph.v1",
    artifactId: "governance_test",
    nodes: [
      { id: "governance:test", type: "governanceRoot", label: "Governance", group: "governance", data: {} },
      { id: "atomPattern:PAT_a", type: "atomPattern", label: "内部细节证明包装 candidate pattern", group: "packaging", data: { id: "PAT_a" } },
      { id: "atomPattern:PAT_b", type: "atomPattern", label: "对象值 pattern", group: "script", data: { id: "PAT_b" } },
      { id: "slotArchetype:ARCH_a", type: "slotArchetype", label: "品质疑虑与感官证据原型 archetype", group: "slot", data: { id: "ARCH_a" } },
      { id: "atomArchetype:ARCH_b", type: "atomArchetype", label: "Proof bridge archety", group: "script", data: { id: "ARCH_b" } },
    ],
    edges: [],
    summary: { slotCount: 0, atomCount: 2, bindingCount: 0, conceptCount: 2 },
  };

  const visible = buildVisibleGraph(graph, filters);
  const pattern = visible.nodes.find((node) => node.id === "atomPattern:PAT_a");
  const shortPattern = visible.nodes.find((node) => node.id === "atomPattern:PAT_b");
  const slotArchetype = visible.nodes.find((node) => node.id === "slotArchetype:ARCH_a");
  const atomArchetype = visible.nodes.find((node) => node.id === "atomArchetype:ARCH_b");

  assert.equal(pattern.shortLabel, "内部细节证明包装");
  assert.equal(graphNodeDisplayLabel(pattern), "内部细节证明包装");
  assert.equal(nodeDetailRows(pattern).find(([label]) => label === "name")?.[1], "内部细节证明包装");
  assert.equal(shortPattern.shortLabel, "对象值");
  assert.equal(slotArchetype.shortLabel, "品质疑虑与感官证据原型");
  assert.equal(graphNodeDisplayLabel(slotArchetype), "品质疑虑与感官证据原型");
  assert.equal(atomArchetype.shortLabel, "Proof bridge");
  assert.equal(graphNodeDisplayLabel(atomArchetype), "Proof bridge");
});

test("confirmed plan trace graph shows plan to subtype to source variant to source sample", () => {
  const { buildVisibleGraph, reverseTracePath } = loadTsModule("Apps/Workbench/src/components/function-slot-graph/graphUtils.ts");
  const filters = allFilters();
  const graph = {
    schemaVersion: "confirmed_plan_trace_graph.v1",
    artifactId: "confirmed-plan-trace",
    nodes: [
      { id: "plan_a:plan", type: "confirmedPlan", label: "plan_a", group: "plan", data: { planId: "plan_a" } },
      { id: "slotSubtype:s1", type: "slotSubtype", label: "subtype", group: "slot", data: {} },
      { id: "plan_a:sample:sample_1", type: "sourceExample", label: "A", group: "sourceExample", data: { planId: "plan_a", sampleId: "sample_1" } },
      { id: "plan_a:variant:sample_1:F001", type: "sourceVariant", label: "A::F001", group: "sourceVariant", data: { planId: "plan_a", sampleId: "sample_1", variantId: "sample_1::F001" } },
      { id: "plan_a:sourceSample:sample_1", type: "sourceSample", label: "sample_1", group: "sourceSample", data: { planId: "plan_a", sampleVideoId: "sample_1" } },
    ],
    edges: [
      { id: "edge:subtype", source: "plan_a:plan", target: "slotSubtype:s1", type: "plan_uses_slot_subtype" },
      { id: "edge:source", source: "slotSubtype:s1", target: "plan_a:sample:sample_1", type: "traced_to_source_sample" },
      { id: "edge:variant", source: "slotSubtype:s1", target: "plan_a:variant:sample_1:F001", type: "traced_to_source_variant" },
      { id: "edge:sample", source: "plan_a:variant:sample_1:F001", target: "plan_a:sourceSample:sample_1", type: "source_variant_to_sample" },
    ],
    summary: { planCount: 1, slotCount: 1, atomCount: 0, bindingCount: 0, conceptCount: 1 },
  };

  const visible = buildVisibleGraph(graph, filters);

  assert.ok(visible.nodes.some((node) => node.type === "confirmedPlan"));
  assert.ok(visible.nodes.some((node) => node.type === "slotSubtype"));
  assert.equal(visible.nodes.some((node) => node.type === "sourceExample"), false);
  assert.ok(visible.nodes.some((node) => node.type === "sourceVariant"));
  assert.ok(visible.nodes.some((node) => node.type === "sourceSample"));
  assert.equal(visible.edges.some((edge) => edge.type === "traced_to_source_sample"), false);
  assert.ok(visible.edges.some((edge) => edge.type === "traced_to_source_variant"));
  assert.ok(visible.edges.some((edge) => edge.type === "source_variant_to_sample"));
  const path = reverseTracePath("plan_a:variant:sample_1:F001", visible.edges);
  assert.ok(path.nodes.has("plan_a:plan"));
  assert.ok(path.nodes.has("slotSubtype:s1"));
  assert.ok(path.edges.has("edge:subtype"));
  assert.ok(path.edges.has("edge:variant"));
});

test("terminal graph focus reaches governance root and nearest samples", () => {
  const { terminalShortestGraphFocus } = loadTsModule("Apps/Workbench/src/components/function-slot-graph/graphUtils.ts");
  const nodes = [
    { id: "root", type: "governanceRoot", label: "root", group: "governance", data: {} },
    { id: "family", type: "slotFamily", label: "family", group: "slot", data: {} },
    { id: "center", type: "slotSubtype", label: "center", group: "slot", data: { sourceAtomVariantIds: ["sample_a::script::S001", "sample_c::script::S004"] } },
    { id: "pattern", type: "atomPattern", label: "pattern", group: "script", data: { sourceVariantIds: ["sample_a::script::S001", "sample_c::script::S004"] } },
    { id: "variant", type: "sourceVariant", label: "variant", group: "sourceVariant", data: { variantId: "sample_a::script::S001" } },
    { id: "sample", type: "sourceSample", label: "sample", group: "sourceSample", data: { sampleVideoId: "sample_a" } },
    { id: "relatedVariant", type: "sourceVariant", label: "related variant", group: "sourceVariant", data: { variantId: "sample_c::script::S004" } },
    { id: "relatedSample", type: "sourceSample", label: "related sample", group: "sourceSample", data: { sampleVideoId: "sample_c" } },
    { id: "sampleChild", type: "sourceVariant", label: "sample child", group: "sourceVariant", data: { variantId: "sample_child::script::S001" } },
    { id: "longVariant", type: "sourceVariant", label: "long variant", group: "sourceVariant", data: { variantId: "sample_b::script::S002" } },
    { id: "longMid", type: "sourceVariant", label: "long mid", group: "sourceVariant", data: { variantId: "sample_b::script::S003" } },
    { id: "longSample", type: "sourceSample", label: "long sample", group: "sourceSample", data: { sampleVideoId: "sample_b" } },
    { id: "otherFamily", type: "slotFamily", label: "other family", group: "slot", data: {} },
  ];
  const edges = [
    { id: "edge:root:family", source: "root", target: "family", type: "governance_contains_family" },
    { id: "edge:family:center", source: "family", target: "center", type: "family_to_subtype" },
    { id: "edge:center:pattern", source: "center", target: "pattern", type: "subtype_to_atom_pattern" },
    { id: "edge:pattern:variant", source: "pattern", target: "variant", type: "pattern_to_source_variant" },
    { id: "edge:variant:sample", source: "variant", target: "sample", type: "source_variant_to_sample" },
    { id: "edge:pattern:relatedVariant", source: "pattern", target: "relatedVariant", type: "pattern_to_source_variant" },
    { id: "edge:relatedVariant:relatedSample", source: "relatedVariant", target: "relatedSample", type: "source_variant_to_sample" },
    { id: "edge:sample:center", source: "sample", target: "center", type: "source_sample_slot_variant_to_subtype" },
    { id: "edge:sample:child", source: "sample", target: "sampleChild", type: "sample_child_should_stop" },
    { id: "edge:pattern:longVariant", source: "pattern", target: "longVariant", type: "pattern_to_source_variant" },
    { id: "edge:longVariant:longMid", source: "longVariant", target: "longMid", type: "pattern_to_source_variant" },
    { id: "edge:longMid:longSample", source: "longMid", target: "longSample", type: "source_variant_to_sample" },
    { id: "edge:root:otherFamily", source: "root", target: "otherFamily", type: "governance_contains_family" },
  ];

  const path = terminalShortestGraphFocus("center", nodes, edges);

  assert.ok(path.nodes.has("center"));
  assert.ok(path.nodes.has("family"));
  assert.ok(path.nodes.has("root"));
  assert.ok(path.nodes.has("sample"));
  assert.ok(path.nodes.has("pattern"));
  assert.ok(path.nodes.has("variant"));
  assert.ok(path.nodes.has("relatedVariant"));
  assert.ok(path.nodes.has("relatedSample"));
  assert.equal(path.nodes.has("longVariant"), false);
  assert.equal(path.nodes.has("longMid"), false);
  assert.equal(path.nodes.has("longSample"), false);
  assert.equal(path.nodes.has("sampleChild"), false);
  assert.equal(path.nodes.has("otherFamily"), false);
  assert.ok(path.edges.has("edge:root:family"));
  assert.ok(path.edges.has("edge:family:center"));
  assert.ok(path.edges.has("edge:center:pattern"));
  assert.ok(path.edges.has("edge:pattern:variant"));
  assert.ok(path.edges.has("edge:variant:sample"));
  assert.ok(path.edges.has("edge:pattern:relatedVariant"));
  assert.ok(path.edges.has("edge:relatedVariant:relatedSample"));
  assert.equal(path.edges.has("edge:sample:center"), false);
  assert.equal(path.edges.has("edge:pattern:longVariant"), false);
  assert.equal(path.edges.has("edge:longVariant:longMid"), false);
  assert.equal(path.edges.has("edge:longMid:longSample"), false);
  assert.equal(path.edges.has("edge:sample:child"), false);
  assert.equal(path.edges.has("edge:root:otherFamily"), false);
  assert.ok(path.reversedEdges.has("edge:root:family"));
  assert.ok(path.reversedEdges.has("edge:family:center"));
});

test("terminal graph focus can traverse governance nodes to the governance root", () => {
  const { terminalShortestGraphFocus } = loadTsModule("Apps/Workbench/src/components/function-slot-graph/graphUtils.ts");
  const nodes = [
    { id: "root", type: "governanceRoot", label: "root", group: "governance", data: {} },
    { id: "pattern", type: "atomPattern", label: "pattern", group: "script", data: { sourceVariantIds: ["sample_a::script::S001"] } },
    { id: "variant", type: "sourceVariant", label: "variant", group: "sourceVariant", data: { variantId: "sample_a::script::S001" } },
    { id: "sample", type: "sourceSample", label: "sample", group: "sourceSample", data: { sampleVideoId: "sample_a" } },
    { id: "otherPattern", type: "atomPattern", label: "other pattern", group: "script", data: { sourceVariantIds: ["sample_b::script::S002"] } },
  ];
  const edges = [
    { id: "edge:root:pattern", source: "root", target: "pattern", type: "governance_contains_pattern" },
    { id: "edge:pattern:variant", source: "pattern", target: "variant", type: "pattern_to_source_variant" },
    { id: "edge:variant:sample", source: "variant", target: "sample", type: "source_variant_to_sample" },
    { id: "edge:root:otherPattern", source: "root", target: "otherPattern", type: "governance_contains_pattern" },
  ];

  const path = terminalShortestGraphFocus("variant", nodes, edges);

  assert.ok(path.nodes.has("variant"));
  assert.ok(path.nodes.has("pattern"));
  assert.ok(path.nodes.has("sample"));
  assert.ok(path.nodes.has("root"));
  assert.equal(path.nodes.has("otherPattern"), false);
  assert.ok(path.edges.has("edge:pattern:variant"));
  assert.ok(path.edges.has("edge:variant:sample"));
  assert.ok(path.edges.has("edge:root:pattern"));
  assert.equal(path.edges.has("edge:root:otherPattern"), false);
  assert.ok(path.reversedEdges.has("edge:root:pattern"));
  assert.ok(path.reversedEdges.has("edge:pattern:variant"));
});

test("terminal graph focus aggregates atom archetype pattern evidence without crossing unrelated branches", () => {
  const { terminalShortestGraphFocus } = loadTsModule("Apps/Workbench/src/components/function-slot-graph/graphUtils.ts");
  const nodes = [
    { id: "arch", type: "atomArchetype", label: "arch", group: "script", data: {} },
    { id: "pattern:a", type: "atomPattern", label: "pattern A", group: "script", data: { sourceVariantIds: ["sample_a::script::S001"] } },
    { id: "pattern:b", type: "atomPattern", label: "pattern B", group: "script", data: { sourceVariantIds: ["sample_a::script::S001", "sample_c::script::S004"] } },
    { id: "variant:a", type: "sourceVariant", label: "variant A", group: "sourceVariant", data: { variantId: "sample_a::script::S001" } },
    { id: "sample:a", type: "sourceSample", label: "sample A", group: "sourceSample", data: { sampleVideoId: "sample_a" } },
    { id: "variant:c", type: "sourceVariant", label: "variant C", group: "sourceVariant", data: { variantId: "sample_c::script::S004" } },
    { id: "sample:c", type: "sourceSample", label: "sample C", group: "sourceSample", data: { sampleVideoId: "sample_c" } },
    { id: "otherArch", type: "atomArchetype", label: "other arch", group: "script", data: {} },
    { id: "otherPattern", type: "atomPattern", label: "other pattern", group: "script", data: { sourceVariantIds: ["sample_b::script::S002"] } },
    { id: "variant:b", type: "sourceVariant", label: "variant B", group: "sourceVariant", data: { variantId: "sample_b::script::S002" } },
    { id: "sample:b", type: "sourceSample", label: "sample B", group: "sourceSample", data: { sampleVideoId: "sample_b" } },
  ];
  const edges = [
    { id: "edge:arch:patternA", source: "arch", target: "pattern:a", type: "atom_archetype_to_pattern" },
    { id: "edge:arch:patternB", source: "arch", target: "pattern:b", type: "atom_archetype_to_pattern" },
    { id: "edge:patternA:variantA", source: "pattern:a", target: "variant:a", type: "pattern_to_source_variant" },
    { id: "edge:patternB:variantA", source: "pattern:b", target: "variant:a", type: "pattern_to_source_variant" },
    { id: "edge:variantA:sampleA", source: "variant:a", target: "sample:a", type: "source_variant_to_sample" },
    { id: "edge:patternB:variantC", source: "pattern:b", target: "variant:c", type: "pattern_to_source_variant" },
    { id: "edge:variantC:sampleC", source: "variant:c", target: "sample:c", type: "source_variant_to_sample" },
    { id: "edge:otherArch:otherPattern", source: "otherArch", target: "otherPattern", type: "atom_archetype_to_pattern" },
    { id: "edge:otherPattern:variantB", source: "otherPattern", target: "variant:b", type: "pattern_to_source_variant" },
    { id: "edge:variantB:sampleB", source: "variant:b", target: "sample:b", type: "source_variant_to_sample" },
  ];

  const path = terminalShortestGraphFocus("arch", nodes, edges);

  assert.ok(path.nodes.has("arch"));
  assert.ok(path.nodes.has("pattern:a"));
  assert.ok(path.nodes.has("pattern:b"));
  assert.ok(path.nodes.has("variant:a"));
  assert.ok(path.nodes.has("sample:a"));
  assert.ok(path.nodes.has("variant:c"));
  assert.ok(path.nodes.has("sample:c"));
  assert.equal(path.nodes.has("otherArch"), false);
  assert.equal(path.nodes.has("otherPattern"), false);
  assert.equal(path.nodes.has("variant:b"), false);
  assert.equal(path.nodes.has("sample:b"), false);
  assert.ok(path.edges.has("edge:arch:patternA"));
  assert.ok(path.edges.has("edge:arch:patternB"));
  assert.ok(path.edges.has("edge:patternA:variantA"));
  assert.ok(path.edges.has("edge:patternB:variantA"));
  assert.ok(path.edges.has("edge:variantA:sampleA"));
  assert.ok(path.edges.has("edge:patternB:variantC"));
  assert.ok(path.edges.has("edge:variantC:sampleC"));
  assert.equal(path.edges.has("edge:otherArch:otherPattern"), false);
  assert.equal(path.edges.has("edge:otherPattern:variantB"), false);
  assert.equal(path.edges.has("edge:variantB:sampleB"), false);
});

test("terminal graph focus limits atom pattern slot paths to matching variant evidence", () => {
  const { terminalShortestGraphFocus } = loadTsModule("Apps/Workbench/src/components/function-slot-graph/graphUtils.ts");
  const nodes = [
    { id: "root", type: "governanceRoot", label: "root", group: "governance", data: {} },
    { id: "family:related", type: "slotFamily", label: "related family", group: "slot", data: {} },
    { id: "family:unrelated", type: "slotFamily", label: "unrelated family", group: "slot", data: {} },
    { id: "subtype:related", type: "slotSubtype", label: "related subtype", group: "slot", data: { sourceAtomVariantIds: ["sample_a::script::S001"] } },
    { id: "subtype:unrelated", type: "slotSubtype", label: "unrelated subtype", group: "slot", data: { sourceAtomVariantIds: ["sample_b::script::S002"] } },
    { id: "arch", type: "atomArchetype", label: "arch", group: "script", data: {} },
    { id: "pattern", type: "atomPattern", label: "pattern", group: "script", data: { sourceVariantIds: ["sample_a::script::S001"] } },
    { id: "variant", type: "sourceVariant", label: "variant", group: "sourceVariant", data: { variantId: "sample_a::script::S001" } },
    { id: "sample", type: "sourceSample", label: "sample", group: "sourceSample", data: { sampleVideoId: "sample_a" } },
  ];
  const edges = [
    { id: "edge:root:relatedFamily", source: "root", target: "family:related", type: "governance_contains_family" },
    { id: "edge:root:unrelatedFamily", source: "root", target: "family:unrelated", type: "governance_contains_family" },
    { id: "edge:relatedFamily:subtype", source: "family:related", target: "subtype:related", type: "family_to_subtype" },
    { id: "edge:unrelatedFamily:subtype", source: "family:unrelated", target: "subtype:unrelated", type: "family_to_subtype" },
    { id: "edge:relatedSubtype:arch", source: "subtype:related", target: "arch", type: "subtype_to_atom_archetype" },
    { id: "edge:unrelatedSubtype:arch", source: "subtype:unrelated", target: "arch", type: "subtype_to_atom_archetype" },
    { id: "edge:arch:pattern", source: "arch", target: "pattern", type: "atom_archetype_to_pattern" },
    { id: "edge:pattern:variant", source: "pattern", target: "variant", type: "pattern_to_source_variant" },
    { id: "edge:variant:sample", source: "variant", target: "sample", type: "source_variant_to_sample" },
  ];

  const path = terminalShortestGraphFocus("pattern", nodes, edges);

  assert.ok(path.nodes.has("pattern"));
  assert.ok(path.nodes.has("variant"));
  assert.ok(path.nodes.has("sample"));
  assert.ok(path.nodes.has("arch"));
  assert.ok(path.nodes.has("subtype:related"));
  assert.ok(path.nodes.has("family:related"));
  assert.ok(path.nodes.has("root"));
  assert.equal(path.nodes.has("subtype:unrelated"), false);
  assert.equal(path.nodes.has("family:unrelated"), false);
  assert.ok(path.edges.has("edge:arch:pattern"));
  assert.ok(path.edges.has("edge:relatedSubtype:arch"));
  assert.ok(path.edges.has("edge:relatedFamily:subtype"));
  assert.ok(path.edges.has("edge:root:relatedFamily"));
  assert.ok(path.edges.has("edge:pattern:variant"));
  assert.ok(path.edges.has("edge:variant:sample"));
  assert.equal(path.edges.has("edge:unrelatedSubtype:arch"), false);
  assert.equal(path.edges.has("edge:unrelatedFamily:subtype"), false);
  assert.equal(path.edges.has("edge:root:unrelatedFamily"), false);
});

test("confirmed plan trace positions keep source samples outside source variants", () => {
  const { buildVisibleGraph } = loadTsModule("Apps/Workbench/src/components/function-slot-graph/graphUtils.ts");
  const filters = allFilters();
  const graph = {
    schemaVersion: "confirmed_plan_trace_graph.v1",
    artifactId: "confirmed-plan-trace",
    nodes: [
      { id: "plan:root", type: "confirmedPlan", label: "plan", group: "plan", data: {} },
      { id: "subtype:s1", type: "slotSubtype", label: "subtype", group: "slot", data: {} },
      { id: "variant:v1", type: "sourceVariant", label: "source label", group: "sourceVariant", data: { label: "source label" } },
      { id: "sample:s1", type: "sourceSample", label: "sample", group: "sourceSample", data: { sampleVideoId: "sample_1" } },
    ],
    edges: [
      { id: "e1", source: "plan:root", target: "subtype:s1", type: "plan_uses_slot_subtype" },
      { id: "e2", source: "subtype:s1", target: "variant:v1", type: "traced_to_source_variant" },
      { id: "e3", source: "variant:v1", target: "sample:s1", type: "source_variant_to_sample" },
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

  assert.ok(distance("subtype:s1") < distance("variant:v1"));
  assert.ok(distance("variant:v1") < distance("sample:s1"));
});

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

function distanceFromRoot(node, root) {
  return Math.hypot(node.x - root.x, (node.y - root.y) / (node.layoutYScale ?? 1));
}

function angularDistance(left, right) {
  const diff = Math.abs(left - right) % (Math.PI * 2);
  return Math.min(diff, Math.PI * 2 - diff);
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
