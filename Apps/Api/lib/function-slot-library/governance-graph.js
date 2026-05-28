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
      status: governance.status ?? null,
      reviewStatus: governance.reviewStatus ?? governance.status ?? null,
      maturityStatus: governance.maturityStatus ?? null,
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
    pushEdge(edges, rootId, nodeId("atomArchetype", archetype.id), "governance_contains_atom_archetype", "atom");
  }
  for (const pattern of governance.atomPatterns ?? []) {
    pushGovernanceNode(nodes, "atomPattern", groupForAtomLayer(pattern.atomLayer), pattern);
    if (pattern.parentAtomArchetype) pushEdge(edges, nodeId("atomArchetype", pattern.parentAtomArchetype), nodeId("atomPattern", pattern.id), "atom_archetype_to_pattern", "pattern");
    for (const subtypeId of pattern.forSlotSubtypeIds ?? []) {
      pushEdge(edges, nodeId("slotSubtype", subtypeId), nodeId("atomPattern", pattern.id), "subtype_to_atom_pattern", "atom pattern");
    }
  }

  for (const principle of governance.bindingPrinciples ?? []) {
    pushGovernanceNode(nodes, "bindingPrinciple", "binding", principle);
    pushEdge(edges, rootId, nodeId("bindingPrinciple", principle.id), "governance_contains_binding_principle", "binding");
    for (const patternId of principle.sourcePatternIds ?? []) {
      pushEdge(edges, nodeId("bindingPrinciple", principle.id), nodeId("bindingPattern", patternId), "principle_to_binding_pattern", "pattern");
    }
  }
  for (const pattern of governance.bindingPatterns ?? []) {
    pushGovernanceNode(nodes, "bindingPattern", "binding", pattern);
  }

  for (const policy of governance.recompositionPolicies ?? []) {
    pushGovernanceNode(nodes, "recompositionPolicy", "policy", policy);
    pushEdge(edges, rootId, nodeId("recompositionPolicy", policy.id), "governance_contains_policy", "policy");
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

  pushSourceVariantEdges(nodes, edges);

  pushUnmapped(nodes, edges, rootId, governance.unmappedAtomVariants ?? [], "atom");
  pushUnmapped(nodes, edges, rootId, governance.unmappedBindingVariants ?? [], "binding");
  pushUnmapped(nodes, edges, rootId, governance.unmappedRuleVariants ?? [], "rule");

  for (const item of governance.needReviewMap ?? []) {
    const id = `needReview:${item.variantId}`;
    pushNode(nodes, {
      id,
      type: "needReviewItem",
      label: item.variantId ?? "needReview",
      group: "needReview",
      data: {
        ...item,
        reviewStatus: "needReview",
        maturityStatus: "needReview",
      },
    });
    pushEdge(edges, rootId, id, "governance_contains_need_review", "needReview");
    for (const affectedNode of item.affectedNodes ?? []) {
      const target = resolveGovernanceNodeId(nodes, affectedNode);
      if (target) pushEdge(edges, id, target, "need_review_affects", "affects");
    }
  }

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
      needReviewCount: governance.coverage?.needReviewCount ?? (governance.needReviewMap ?? []).length,
      unmappedAtomCount: (governance.unmappedAtomVariants ?? []).length,
      unmappedBindingCount: (governance.unmappedBindingVariants ?? []).length,
      unmappedRuleCount: (governance.unmappedRuleVariants ?? []).length,
      validationOk: Boolean(governance.coverage?.validationOk),
      conceptCount: (governance.slotFamilies ?? []).length + (governance.slotArchetypes ?? []).length + (governance.slotSubtypes ?? []).length,
    },
  };
}

function pushGovernanceNode(nodes, type, group, item) {
  pushNode(nodes, {
    id: nodeId(type, item.id),
    type,
    label: item.name ?? item.id,
    group: hasNeedReview(item) ? "needReview" : group,
    data: {
      ...item,
      reviewStatus: item.reviewStatus ?? item.status ?? null,
      maturityStatus: item.maturityStatus ?? null,
    },
  });
}

function pushSourceVariantEdges(nodes, edges) {
  const sourceVariantOwners = nodes.filter((node) => Array.isArray(node.data?.sourceVariantIds));
  for (const owner of sourceVariantOwners) {
    for (const variantId of owner.data.sourceVariantIds) {
      const id = graphId("sourceVariant", variantId);
      pushNode(nodes, {
        id,
        type: "sourceVariant",
        label: String(variantId),
        group: "sourceVariant",
        data: {
          variantId,
          reviewStatus: "evidence",
          maturityStatus: "evidence",
        },
      });
      pushEdge(edges, owner.id, id, "pattern_to_source_variant", "evidence");
    }
  }
}

function pushUnmapped(nodes, edges, rootId, variants, variantKind) {
  for (const variant of variants) {
    const id = `unmapped:${variantKind}:${variant.variantId}`;
    pushNode(nodes, {
      id,
      type: "unmappedVariant",
      label: variant.variantId ?? `unmapped ${variantKind}`,
      group: "unmapped",
      data: {
        ...variant,
        variantKind,
        reviewStatus: "unmapped",
        maturityStatus: "unmapped",
      },
    });
    pushEdge(edges, rootId, id, "governance_contains_unmapped", "unmapped");
  }
}

function hasNeedReview(item) {
  return item?.needReview === true || item?.reviewStatus === "needReview" || item?.maturityStatus === "needReview";
}

function groupForAtomLayer(layer) {
  if (layer === "script") return "script";
  if (layer === "rhythm") return "rhythm";
  if (layer === "packaging") return "packaging";
  return "atom";
}

function resolveGovernanceNodeId(nodes, rawId) {
  return nodes.find((node) => String(node.data?.id ?? "") === rawId || node.id.endsWith(`:${rawId}`))?.id ?? null;
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
  return parts.map((part) => String(part).replace(/[^A-Za-z0-9_.:-]/g, "_")).join(":");
}

module.exports = {
  buildFunctionSlotGovernanceGraph,
};
