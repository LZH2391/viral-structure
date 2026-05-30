function buildFunctionSlotGovernanceGraph(governance) {
  if (!governance?.governanceId) throw new Error("function slot governance graph missing governanceId");

  const nodes = [];
  const edges = [];
  const governanceId = governance.governanceId;
  const rootId = graphId("governance", governanceId);

  pushNode(nodes, {
    id: rootId,
    type: "governanceRoot",
    label: "Semantic Governance",
    group: "governance",
    data: {
      governanceId,
      schemaVersion: governance.schemaVersion ?? null,
      createdAt: governance.createdAt ?? null,
      support: {
        variantCount: governance.coverage?.slotVariantCount ?? null,
        sampleCount: governance.coverage?.sampleCount ?? null,
      },
    },
  });

  for (const family of governance.slotFamilies ?? []) {
    pushGovernanceNode(nodes, "slotFamily", "slot", family);
    pushEdge(edges, rootId, nodeId("slotFamily", family.id), "governance_contains_family", "family");
  }
  for (const archetype of governance.slotArchetypes ?? []) {
    pushGovernanceNode(nodes, "slotArchetype", "slot", archetype);
    if (archetype.familyId) pushEdge(edges, nodeId("slotFamily", archetype.familyId), nodeId("slotArchetype", archetype.id), "family_to_archetype", "archetype");
  }
  for (const subtype of governance.slotSubtypes ?? []) {
    pushGovernanceNode(nodes, "slotSubtype", "slot", subtype);
    if (subtype.archetypeId) pushEdge(edges, nodeId("slotArchetype", subtype.archetypeId), nodeId("slotSubtype", subtype.id), "archetype_to_subtype", "subtype");
  }

  for (const archetype of governance.atomArchetypes ?? []) {
    pushGovernanceNode(nodes, "atomArchetype", groupForAtomLayer(archetype.atomLayer), archetype);
  }
  for (const pattern of governance.atomPatterns ?? []) {
    pushGovernanceNode(nodes, "atomPattern", groupForAtomLayer(pattern.atomLayer), pattern);
    for (const subtypeId of pattern.forSlotSubtypeIds ?? []) {
      const layerId = pushAtomLayerNode(nodes, subtypeId, pattern.atomLayer);
      pushEdge(edges, nodeId("slotSubtype", subtypeId), layerId, "subtype_to_atom_layer", groupForAtomLayer(pattern.atomLayer));
      pushEdge(edges, layerId, nodeId("atomPattern", pattern.id), "atom_layer_to_pattern", "pattern");
    }
  }

  for (const principle of governance.bindingPrinciples ?? []) {
    pushGovernanceNode(nodes, "bindingPrinciple", "binding", principle);
    for (const patternId of principle.sourcePatternIds ?? []) {
      pushEdge(edges, nodeId("bindingPrinciple", principle.id), nodeId("atomPattern", patternId), "binding_principle_to_pattern", "binding");
    }
  }
  for (const pattern of governance.bindingPatterns ?? []) {
    pushGovernanceNode(nodes, "bindingPattern", "binding", pattern);
  }

  for (const policy of governance.recompositionPolicies ?? []) {
    pushGovernanceNode(nodes, "recompositionPolicy", "policy", policy);
    for (const ruleId of policy.sourceRulePatternIds ?? []) {
      pushEdge(edges, nodeId("recompositionPolicy", policy.id), nodeId("rulePattern", ruleId), "policy_to_rule_pattern", "rule");
    }
  }
  for (const pattern of governance.rulePatterns ?? []) {
    pushGovernanceNode(nodes, "rulePattern", "rule", pattern);
  }

  for (const bundle of governance.implementationBundles ?? []) {
    pushGovernanceNode(nodes, "implementationBundle", "bundle", bundle);
    pushEdge(edges, rootId, nodeId("implementationBundle", bundle.id), "governance_contains_bundle", "bundle");
    for (const subtypeId of bundle.slotSubtypeIds ?? []) {
      pushEdge(edges, nodeId("implementationBundle", bundle.id), nodeId("slotSubtype", subtypeId), "bundle_to_subtype", "slot");
    }
    for (const patternId of [...(bundle.scriptPatternIds ?? []), ...(bundle.rhythmPatternIds ?? []), ...(bundle.packagingPatternIds ?? [])]) {
      pushEdge(edges, nodeId("implementationBundle", bundle.id), nodeId("atomPattern", patternId), "bundle_to_atom_pattern", "atom");
    }
  }

  pushSourceVariantEdges(nodes, edges, governance.sourceVariants ?? []);

  pushUnmapped(nodes, edges, rootId, governance.unmappedAtomVariants ?? [], "atom");
  pushUnmapped(nodes, edges, rootId, governance.unmappedBindingVariants ?? [], "binding");
  pushUnmapped(nodes, edges, rootId, governance.unmappedRuleVariants ?? [], "rule");

  return {
    schemaVersion: "function_slot_governance_graph.v1",
    artifactId: governanceId,
    governanceId,
    traceId: null,
    nodes,
    edges: edges.filter((edge) => nodes.some((node) => node.id === edge.source) && nodes.some((node) => node.id === edge.target)),
    summary: {
      slotCount: governance.coverage?.slotVariantCount ?? 0,
      atomCount: governance.coverage?.atomVariantCount ?? 0,
      bindingCount: governance.coverage?.bindingCount ?? 0,
      ruleCount: governance.coverage?.ruleCount ?? 0,
      sampleCount: governance.coverage?.sampleCount ?? 0,
      unmappedAtomCount: (governance.unmappedAtomVariants ?? []).length,
      unmappedBindingCount: (governance.unmappedBindingVariants ?? []).length,
      unmappedRuleCount: (governance.unmappedRuleVariants ?? []).length,
      validationOk: Boolean(governance.coverage?.validationOk),
      conceptCount: (governance.slotFamilies ?? []).length + (governance.slotArchetypes ?? []).length + (governance.slotSubtypes ?? []).length,
    },
  };
}

function pushGovernanceNode(nodes, type, group, item) {
  const itemId = normalizeGraphText(item.id);
  if (!itemId) return;
  pushNode(nodes, {
    id: nodeId(type, itemId),
    type,
    label: normalizeGraphText(item.name) ?? itemId,
    group,
    data: {
      ...stripGovernanceStatusFields(item),
      id: itemId,
      name: normalizeGraphText(item.name) ?? null,
      sourceVariantIds: normalizeTextArray(item.sourceVariantIds),
    },
  });
}

function pushAtomLayerNode(nodes, subtypeId, layer) {
  const normalizedSubtypeId = normalizeGraphText(subtypeId);
  const atomLayer = groupForAtomLayer(layer);
  const id = nodeId("atomLayer", `${normalizedSubtypeId}:${atomLayer}`);
  pushNode(nodes, {
    id,
    type: "atomLayer",
    label: layerDisplayName(atomLayer),
    group: atomLayer,
    data: {
      subtypeId: normalizedSubtypeId,
      layer: atomLayer,
    },
  });
  return id;
}

function pushSourceVariantEdges(nodes, edges, sourceVariants) {
  const variantLabels = buildSourceVariantLabelMap(sourceVariants);
  const sourceVariantOwners = nodes.filter((node) => node.type === "atomPattern" && Array.isArray(node.data?.sourceVariantIds));
  for (const owner of sourceVariantOwners) {
    for (const variantId of owner.data.sourceVariantIds) {
      const normalizedVariantId = normalizeGraphText(variantId);
      if (!normalizedVariantId) continue;
      const sourceVariant = variantLabels.get(normalizedVariantId);
      const id = graphId("sourceVariant", normalizedVariantId);
      pushNode(nodes, {
        id,
        type: "sourceVariant",
        label: sourceVariant?.label ?? normalizedVariantId,
        group: "sourceVariant",
        data: {
          variantId: normalizedVariantId,
          label: sourceVariant?.label ?? null,
          sampleId: sourceVariant?.sampleId ?? null,
          kind: sourceVariant?.kind ?? null,
          sourceId: sourceVariant?.sourceId ?? null,
          labelMissing: !sourceVariant?.label,
        },
      });
      pushEdge(edges, owner.id, id, "pattern_to_source_variant", "evidence");
      if (sourceVariant?.sampleId) {
        const sampleId = sourceVariant.sampleId;
        const sampleNodeId = graphId("sourceSample", sampleId);
        pushNode(nodes, {
          id: sampleNodeId,
          type: "sourceSample",
          label: sampleId,
          group: "sourceSample",
          data: {
            sampleVideoId: sampleId,
            sampleId,
          },
        });
        pushEdge(edges, id, sampleNodeId, "source_variant_to_sample", "sample");
      }
    }
  }
}

function buildSourceVariantLabelMap(sourceVariants) {
  const labels = new Map();
  if (!Array.isArray(sourceVariants)) return labels;
  for (const variant of sourceVariants) {
    const variantId = normalizeGraphText(variant?.variantId);
    if (!variantId || labels.has(variantId)) continue;
    const label = normalizeGraphText(variant.label);
    labels.set(variantId, {
      label,
      sampleId: normalizeGraphText(variant.sampleId),
      kind: normalizeGraphText(variant.kind),
      sourceId: normalizeGraphText(variant.sourceId),
    });
  }
  return labels;
}

function pushUnmapped(nodes, edges, rootId, variants, variantKind) {
  for (const variant of variants) {
    const variantId = normalizeGraphText(variant.variantId);
    if (!variantId) continue;
    const id = `unmapped:${variantKind}:${variantId}`;
    pushNode(nodes, {
      id,
      type: "unmappedVariant",
      label: variantId,
      group: "unmapped",
      data: {
        ...stripGovernanceStatusFields(variant),
        variantId,
        variantKind,
      },
    });
    pushEdge(edges, rootId, id, "governance_contains_unmapped", "unmapped");
  }
}

function groupForAtomLayer(layer) {
  if (layer === "script") return "script";
  if (layer === "rhythm") return "rhythm";
  if (layer === "packaging") return "packaging";
  return "atom";
}

function layerDisplayName(layer) {
  if (layer === "script") return "脚本层";
  if (layer === "rhythm") return "节奏层";
  if (layer === "packaging") return "包装层";
  return "Atom Layer";
}

function pushNode(nodes, node) {
  if (!node.id || nodes.some((existing) => existing.id === node.id)) return;
  nodes.push(node);
}

function pushEdge(edges, source, target, type, label) {
  if (!source || !target) return;
  edges.push({
    id: graphId("edge", type, source, target, String(edges.length + 1)),
    source,
    target,
    type,
    label,
  });
}

function nodeId(type, id) {
  return graphId(type, id);
}

function graphId(...parts) {
  return parts.map((part) => String(normalizeGraphText(part) ?? "").replace(/[^A-Za-z0-9_.:-]/g, "_")).join(":");
}

function normalizeGraphText(value) {
  if (value && typeof value === "object" && !Array.isArray(value) && "value" in value) return normalizeGraphText(value.value);
  const text = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  return text || null;
}

function normalizeTextArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeGraphText).filter(Boolean);
}

function stripGovernanceStatusFields(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const { status, reviewStatus, maturityStatus, needReview, ...rest } = value;
  return rest;
}

module.exports = {
  buildFunctionSlotGovernanceGraph,
};
