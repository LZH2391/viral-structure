const test = require("node:test");
const assert = require("node:assert/strict");
const { buildFunctionSlotGovernanceGraph } = require("../../Apps/Api/lib/function-slot-library/governance-graph");
const { buildGovernance, hasGovernanceStatusFields } = require("./function-slot-library.helpers");

test("function slot governance graph builder maps relationships and evidence gaps", () => {
  const graph = buildFunctionSlotGovernanceGraph(buildGovernance());

  assert.ok(graph.nodes.some((node) => node.type === "implementationBundle"));
  assert.ok(graph.nodes.some((node) => node.type === "sourceVariant"));
  assert.equal(graph.nodes.some((node) => node.type === "needReviewItem"), false);
  assert.equal(graph.nodes.some((node) => hasGovernanceStatusFields(node.data)), false);
  assert.equal(Object.prototype.hasOwnProperty.call(graph.summary, "needReviewCount"), false);
  assert.ok(graph.edges.some((edge) => edge.type === "bundle_to_atom_pattern"));
  assert.deepEqual([...new Set(graph.edges.filter((edge) => edge.source === graph.nodes.find((node) => node.type === "governanceRoot")?.id).map((edge) => edge.type))], ["governance_contains_family"]);
});

test("function slot governance graph builder enriches source samples with source video names", () => {
  const graph = buildFunctionSlotGovernanceGraph({
    ...buildGovernance(),
    sourceSnapshot: [{ artifactId: "artifact_a", sampleVideoId: "sample_a", traceId: "trace_a", contentHash: "hash_a" }],
  }, {
    libraryItems: [{ artifactId: "artifact_a", sampleVideoId: "sample_a", sourceVideoName: "demo-source-video.mp4", traceId: "trace_a", contentHash: "hash_a" }],
  });
  const sampleNode = graph.nodes.find((node) => node.id === "sourceSample:sample_a");

  assert.equal(sampleNode?.label, "demo-source-video");
  assert.equal(sampleNode?.data.sourceVideoName, "demo-source-video");
  assert.equal(sampleNode?.data.sourceAlias, "demo-source-video");
});

test("function slot governance graph builder derives subtype to atom archetype links through patterns", () => {
  const graph = buildFunctionSlotGovernanceGraph({
    ...buildGovernance(),
    slotSubtypes: [
      { id: "SUB_a", archetypeId: "ARCH_hook", name: "A" },
      { id: "SUB_b", archetypeId: "ARCH_hook", name: "B" },
    ],
    atomArchetypes: [{ id: "ATOM_ARCH_script", name: "script", atomLayer: "script" }],
    atomPatterns: [
      { id: "SCRIPT_pattern_a", name: "script A", atomLayer: "script", parentAtomArchetype: "ATOM_ARCH_script", forSlotSubtypeIds: ["SUB_a"], sourceVariantIds: [] },
      { id: "SCRIPT_pattern_a_alt", name: "script A alt", atomLayer: "script", parentAtomArchetype: "ATOM_ARCH_script", forSlotSubtypeIds: ["SUB_a"], sourceVariantIds: [] },
      { id: "SCRIPT_pattern_b", name: "script B", atomLayer: "script", parentAtomArchetype: "ATOM_ARCH_script", forSlotSubtypeIds: ["SUB_b"], sourceVariantIds: [] },
    ],
  });
  const subtypeToArchetypeEdges = graph.edges.filter((edge) => edge.type === "subtype_to_atom_archetype");

  assert.equal(graph.nodes.some((node) => node.type === "atomLayer"), false);
  assert.equal(graph.edges.some((edge) => edge.type.includes("atom_layer")), false);
  assert.equal(subtypeToArchetypeEdges.filter((edge) => edge.source === "slotSubtype:SUB_a" && edge.target === "atomArchetype:ATOM_ARCH_script").length, 1);
  assert.equal(subtypeToArchetypeEdges.filter((edge) => edge.source === "slotSubtype:SUB_b" && edge.target === "atomArchetype:ATOM_ARCH_script").length, 1);
  assert.equal(graph.edges.some((edge) => edge.source.startsWith("slotSubtype:") && edge.target.startsWith("atomPattern:")), false);
  assert.ok(graph.edges.some((edge) => edge.source === "atomArchetype:ATOM_ARCH_script" && edge.target === "atomPattern:SCRIPT_pattern_a" && edge.type === "atom_archetype_to_pattern"));
  assert.ok(graph.edges.some((edge) => edge.source === "atomArchetype:ATOM_ARCH_script" && edge.target === "atomPattern:SCRIPT_pattern_b" && edge.type === "atom_archetype_to_pattern"));
});

test("function slot governance graph builder derives subtype to atom archetype links from slot atom variants", () => {
  const graph = buildFunctionSlotGovernanceGraph({
    ...buildGovernance(),
    slotSubtypes: [
      { id: "SUB_a", archetypeId: "ARCH_hook", name: "A", sourceVariantIds: ["sample_a::F001"] },
      { id: "SUB_b", archetypeId: "ARCH_hook", name: "B", sourceVariantIds: ["sample_a::F002"] },
    ],
    atomArchetypes: [{ id: "ATOM_ARCH_script", name: "script", atomLayer: "script", sourcePatternIds: ["SCRIPT_pattern_a"] }],
    atomPatterns: [
      { id: "SCRIPT_pattern_a", name: "script A", atomLayer: "script", forSlotSubtypeIds: [], sourceVariantIds: ["sample_a::script::S001"] },
    ],
  }, {
    libraryItems: [{
      sampleVideoId: "sample_a",
      functionSlotAtomizationAnalysis: {
        sampleVideoId: "sample_a",
        slotMap: {
          slots: [
            { slotId: "F001", scriptAtomIds: ["S001"], rhythmAtomIds: [], packagingAtomIds: [] },
            { slotId: "F002", scriptAtomIds: ["S002"], rhythmAtomIds: [], packagingAtomIds: [] },
          ],
        },
      },
    }],
  });

  assert.ok(graph.edges.some((edge) => edge.source === "slotSubtype:SUB_a" && edge.target === "atomArchetype:ATOM_ARCH_script" && edge.type === "subtype_to_atom_archetype"));
  assert.equal(graph.edges.some((edge) => edge.source === "slotSubtype:SUB_b" && edge.target === "atomArchetype:ATOM_ARCH_script"), false);
  assert.deepEqual(graph.nodes.find((node) => node.id === "slotSubtype:SUB_a")?.data.sourceAtomVariantIds, ["sample_a::script::S001"]);
  assert.deepEqual(graph.nodes.find((node) => node.id === "slotSubtype:SUB_b")?.data.sourceAtomVariantIds, ["sample_a::script::S002"]);
  assert.ok(graph.edges.some((edge) => edge.source === "atomArchetype:ATOM_ARCH_script" && edge.target === "atomPattern:SCRIPT_pattern_a" && edge.type === "atom_archetype_to_pattern"));
});

test("function slot governance graph builder links source samples to slot subtypes through slot variants only", () => {
  const graph = buildFunctionSlotGovernanceGraph({
    ...buildGovernance(),
    slotSubtypes: [
      { id: "SUB_a", archetypeId: "ARCH_hook", name: "A", sourceVariantIds: ["sample_a::F001"] },
      { id: "SUB_b", archetypeId: "ARCH_hook", name: "B", sourceVariantIds: ["sample_b::F002"] },
      { id: "SUB_atom_only", archetypeId: "ARCH_hook", name: "Atom only", sourceVariantIds: ["sample_a::script::S001"] },
    ],
    sourceVariants: [
      { variantId: "sample_a::F001", sampleId: "sample_a", kind: "slot", sourceId: "F001", label: "slot A" },
      { variantId: "sample_b::F002", sampleId: "sample_b", kind: "slot", sourceId: "F002", label: "slot B" },
      { variantId: "sample_a::script::S001", sampleId: "sample_a", kind: "script", sourceId: "S001", label: "script atom" },
    ],
    sourceSnapshot: [
      { sampleVideoId: "sample_a" },
      { sampleVideoId: "sample_b" },
    ],
  });
  const evidenceEdges = graph.edges.filter((edge) => edge.type === "source_sample_slot_variant_to_subtype");

  assert.ok(evidenceEdges.some((edge) => edge.source === "sourceSample:sample_a" && edge.target === "slotSubtype:SUB_a"));
  assert.ok(evidenceEdges.some((edge) => edge.source === "sourceSample:sample_b" && edge.target === "slotSubtype:SUB_b"));
  assert.equal(evidenceEdges.some((edge) => edge.target === "slotSubtype:SUB_atom_only"), false);
});

test("function slot governance graph builder shows source snapshot samples without requiring atom patterns", () => {
  const governance = {
    ...buildGovernance(),
    coverage: { ...buildGovernance().coverage, sampleCount: 2 },
    sourceSnapshot: [
      {
        artifactId: "artifact_a",
        sampleVideoId: "sample_a",
        traceId: "trace_a",
        contentHash: "hash_a",
        counts: { slotCount: 1, atomCount: 1, bindingCount: 0, ruleCount: 0, templateCount: 0 },
      },
      {
        artifactId: "artifact_unpatterned",
        sampleVideoId: "sample_unpatterned",
        traceId: "trace_unpatterned",
        contentHash: "hash_unpatterned",
        counts: { slotCount: 1, atomCount: 3, bindingCount: 1, ruleCount: 1, templateCount: 1 },
      },
    ],
  };
  const graph = buildFunctionSlotGovernanceGraph(governance);
  const samples = graph.nodes.filter((node) => node.type === "sourceSample");
  const root = graph.nodes.find((node) => node.type === "governanceRoot");

  assert.ok(samples.some((node) => node.data.sampleVideoId === "sample_unpatterned"));
  assert.ok(graph.edges.some((edge) => edge.source === root.id && edge.target === "sourceSample:sample_unpatterned" && edge.type === "governance_contains_source_sample"));
  assert.ok(graph.edges.some((edge) => edge.type === "source_variant_to_sample"));
});

test("function slot governance graph builder tracks atomized samples missing semantic governance", () => {
  const graph = buildFunctionSlotGovernanceGraph({
    ...buildGovernance(),
    sourceSnapshot: [{ artifactId: "artifact_a", sampleVideoId: "sample_a", traceId: "trace_a", contentHash: "hash_a" }],
  }, {
    libraryItems: [
      { artifactId: "artifact_a", sampleVideoId: "sample_a", traceId: "trace_a", contentHash: "hash_a" },
      { artifactId: "artifact_stale", sampleVideoId: "sample_stale", traceId: "trace_stale", contentHash: "hash_new" },
      { artifactId: "artifact_missing", sampleVideoId: "sample_missing", traceId: "trace_missing", contentHash: "hash_missing" },
    ],
  });

  assert.equal(graph.summary.atomizedSampleCount, 3);
  assert.equal(graph.summary.governedSampleCount, 1);
  assert.equal(graph.summary.ungovernedSampleCount, 2);
  assert.deepEqual(graph.summary.ungovernedSamples.map((item) => item.reason), ["missing_from_source_snapshot", "missing_from_source_snapshot"]);

  const staleGraph = buildFunctionSlotGovernanceGraph({
    ...buildGovernance(),
    sourceSnapshot: [{ artifactId: "artifact_stale", sampleVideoId: "sample_stale", traceId: "trace_stale", contentHash: "hash_old" }],
  }, {
    libraryItems: [{ artifactId: "artifact_stale", sampleVideoId: "sample_stale", traceId: "trace_stale", contentHash: "hash_new" }],
  });

  assert.equal(staleGraph.summary.ungovernedSampleCount, 1);
  assert.equal(staleGraph.summary.ungovernedSamples[0].reason, "content_hash_mismatch");
});

test("function slot governance graph builder normalizes value-object ids and labels", () => {
  const graph = buildFunctionSlotGovernanceGraph({
    ...buildGovernance(),
    slotFamilies: [{
      id: { value: "FAM_value_object" },
      name: { value: "对象值 family" },
    }],
    slotArchetypes: [{ id: "ARCH_value_object", familyId: "FAM_value_object", name: "对象值 archetype" }],
    slotSubtypes: [{ id: "SUB_value_object", archetypeId: "ARCH_value_object", name: "对象值 subtype" }],
    atomArchetypes: [],
    atomPatterns: [{ id: "SCRIPT_value_object", name: "对象值 pattern", atomLayer: "script", forSlotSubtypeIds: ["SUB_value_object"], sourceVariantIds: [{ value: "sample_value::script::S001" }] }],
    bindingPrinciples: [],
    bindingPatterns: [],
    recompositionPolicies: [],
    rulePatterns: [],
    implementationBundles: [],
    sourceVariants: [{ variantId: "sample_value::script::S001", sampleId: "sample_value", kind: "script", sourceId: "S001", label: "对象值来源槽" }],
    unmappedAtomVariants: [{ variantId: { value: "sample_value::A001" }, reason: "single_sample" }],
    unmappedBindingVariants: [],
    unmappedRuleVariants: [],
  });

  assert.ok(graph.nodes.some((node) => node.id === "slotFamily:FAM_value_object" && node.label === "对象值 family"));
  assert.ok(graph.nodes.some((node) => node.type === "sourceVariant" && node.label === "对象值来源槽"));
  assert.ok(graph.nodes.some((node) => node.type === "sourceSample" && node.data.sampleVideoId === "sample_value"));
  assert.ok(graph.nodes.some((node) => node.type === "unmappedVariant" && node.label === "sample_value::A001"));
  assert.equal(graph.nodes.some((node) => JSON.stringify(node).includes("{\"value\"")), false);
});
