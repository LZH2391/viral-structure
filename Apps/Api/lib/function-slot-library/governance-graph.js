function buildFunctionSlotGovernanceGraph(governance, { libraryItems = [] } = {}) {
  if (!governance?.governanceId) throw new Error("function slot governance graph missing governanceId");

  const nodes = [];
  const edges = [];
  const governanceId = governance.governanceId;
  const rootId = graphId("governance", governanceId);
  const sampleGovernanceSummary = buildSampleGovernanceSummary(governance, libraryItems);
  const atomPatternArchetypeIds = buildAtomPatternArchetypeIndex(governance.atomArchetypes ?? [], governance.atomPatterns ?? []);
  const atomVariantArchetypeIds = buildAtomVariantArchetypeIndex(governance.atomPatterns ?? [], atomPatternArchetypeIds);
  const slotAtomVariantIds = buildSlotAtomVariantIndex(libraryItems);
  const slotSubtypeAtomVariantIds = buildSlotSubtypeAtomVariantIndex(governance.slotSubtypes ?? [], slotAtomVariantIds);

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
    const subtypeId = normalizeGraphText(subtype.id);
    const sourceAtomVariantIds = slotSubtypeAtomVariantIds.get(subtypeId) ?? [];
    pushGovernanceNode(nodes, "slotSubtype", "slot", sourceAtomVariantIds.length ? { ...subtype, sourceAtomVariantIds } : subtype);
    if (subtype.archetypeId) pushEdge(edges, nodeId("slotArchetype", subtype.archetypeId), nodeId("slotSubtype", subtype.id), "archetype_to_subtype", "subtype");
  }

  for (const archetype of governance.atomArchetypes ?? []) {
    pushGovernanceNode(nodes, "atomArchetype", groupForAtomLayer(archetype.atomLayer), archetype);
  }
  for (const pattern of governance.atomPatterns ?? []) {
    pushGovernanceNode(nodes, "atomPattern", groupForAtomLayer(pattern.atomLayer), pattern);
    const patternId = normalizeGraphText(pattern.id);
    const parentArchetypeIds = atomPatternArchetypeIds.get(patternId) ?? [];
    for (const parentArchetypeId of parentArchetypeIds) {
      pushEdge(edges, nodeId("atomArchetype", parentArchetypeId), nodeId("atomPattern", pattern.id), "atom_archetype_to_pattern", "pattern");
    }
    for (const subtypeId of pattern.forSlotSubtypeIds ?? []) {
      for (const parentArchetypeId of parentArchetypeIds) pushEdge(edges, nodeId("slotSubtype", subtypeId), nodeId("atomArchetype", parentArchetypeId), "subtype_to_atom_archetype", "archetype");
    }
  }
  pushSubtypeAtomArchetypeEdgesFromSlotVariants(edges, governance.slotSubtypes ?? [], slotAtomVariantIds, atomVariantArchetypeIds);

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
    for (const subtypeId of bundle.slotSubtypeIds ?? []) {
      pushEdge(edges, nodeId("implementationBundle", bundle.id), nodeId("slotSubtype", subtypeId), "bundle_to_subtype", "slot");
    }
    for (const patternId of [...(bundle.scriptPatternIds ?? []), ...(bundle.rhythmPatternIds ?? []), ...(bundle.packagingPatternIds ?? [])]) {
      pushEdge(edges, nodeId("implementationBundle", bundle.id), nodeId("atomPattern", patternId), "bundle_to_atom_pattern", "atom");
    }
  }

  pushSourceSamplesFromSnapshot(nodes, edges, rootId, governance.sourceSnapshot ?? []);
  pushSourceSampleSlotSubtypeEdges(edges, governance.slotSubtypes ?? [], governance.sourceVariants ?? []);
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
      atomizedSampleCount: sampleGovernanceSummary.atomizedSampleCount,
      governedSampleCount: sampleGovernanceSummary.governedSampleCount,
      ungovernedSampleCount: sampleGovernanceSummary.ungovernedSampleCount,
      ungovernedSamples: sampleGovernanceSummary.ungovernedSamples,
      validationOk: Boolean(governance.coverage?.validationOk),
      conceptCount: (governance.slotFamilies ?? []).length + (governance.slotArchetypes ?? []).length + (governance.slotSubtypes ?? []).length,
    },
  };
}

function buildSampleGovernanceSummary(governance, libraryItems) {
  const items = Array.isArray(libraryItems) ? libraryItems : [];
  const snapshots = Array.isArray(governance?.sourceSnapshot) ? governance.sourceSnapshot : [];
  const byArtifactId = new Map();
  const bySampleId = new Map();
  for (const snapshot of snapshots) {
    const normalized = normalizeSampleIdentity(snapshot);
    if (normalized.artifactId) byArtifactId.set(normalized.artifactId, normalized);
    if (normalized.sampleVideoId) bySampleId.set(normalized.sampleVideoId, normalized);
  }

  let governedSampleCount = 0;
  const ungovernedSamples = [];
  for (const item of items) {
    const identity = normalizeSampleIdentity(item);
    const snapshot = (identity.artifactId ? byArtifactId.get(identity.artifactId) : null)
      ?? (identity.sampleVideoId ? bySampleId.get(identity.sampleVideoId) : null);
    if (!snapshot) {
      ungovernedSamples.push({ ...identity, reason: "missing_from_source_snapshot" });
      continue;
    }
    if (identity.contentHash && snapshot.contentHash && identity.contentHash !== snapshot.contentHash) {
      ungovernedSamples.push({ ...identity, reason: "content_hash_mismatch" });
      continue;
    }
    governedSampleCount += 1;
  }

  return {
    atomizedSampleCount: items.length,
    governedSampleCount,
    ungovernedSampleCount: ungovernedSamples.length,
    ungovernedSamples,
  };
}

function normalizeSampleIdentity(value) {
  return {
    sampleVideoId: normalizeGraphText(value?.sampleVideoId ?? value?.sampleId),
    artifactId: normalizeGraphText(value?.artifactId),
    traceId: normalizeGraphText(value?.traceId),
    contentHash: normalizeGraphText(value?.contentHash),
  };
}

function buildAtomPatternArchetypeIndex(atomArchetypes, atomPatterns) {
  const index = new Map();
  for (const pattern of atomPatterns) {
    const patternId = normalizeGraphText(pattern?.id);
    const parentId = normalizeGraphText(pattern?.parentAtomArchetype);
    if (patternId && parentId) addMapSetValue(index, patternId, parentId);
  }
  for (const archetype of atomArchetypes) {
    const archetypeId = normalizeGraphText(archetype?.id);
    if (!archetypeId) continue;
    for (const patternId of normalizeTextArray(archetype?.sourcePatternIds)) addMapSetValue(index, patternId, archetypeId);
  }
  return index;
}

function buildAtomVariantArchetypeIndex(atomPatterns, atomPatternArchetypeIds) {
  const index = new Map();
  for (const pattern of atomPatterns) {
    const patternId = normalizeGraphText(pattern?.id);
    const parentArchetypeIds = atomPatternArchetypeIds.get(patternId) ?? [];
    if (!parentArchetypeIds.length) continue;
    for (const variantId of normalizeTextArray(pattern?.sourceVariantIds)) {
      for (const archetypeId of parentArchetypeIds) addMapSetValue(index, variantId, archetypeId);
    }
  }
  return index;
}

function buildSlotAtomVariantIndex(libraryItems) {
  const index = new Map();
  for (const item of Array.isArray(libraryItems) ? libraryItems : []) {
    const analysis = item?.functionSlotAtomizationAnalysis ?? item;
    const sampleId = normalizeGraphText(analysis?.sampleVideoId ?? item?.sampleVideoId ?? item?.sampleId);
    if (!sampleId) continue;
    for (const slot of Array.isArray(analysis?.slotMap?.slots) ? analysis.slotMap.slots : []) {
      const slotId = normalizeGraphText(slot?.slotId ?? slot?.id);
      if (!slotId) continue;
      const slotVariantId = sourceVariantId(sampleId, slotId);
      for (const atomVariantId of atomVariantIdsForSlot(sampleId, slot)) addMapSetValue(index, slotVariantId, atomVariantId);
    }
  }
  return index;
}

function buildSlotSubtypeAtomVariantIndex(slotSubtypes, slotAtomVariantIds) {
  const index = new Map();
  for (const subtype of slotSubtypes) {
    const subtypeId = normalizeGraphText(subtype?.id);
    if (!subtypeId) continue;
    for (const slotVariantId of normalizeTextArray(subtype?.sourceVariantIds)) {
      for (const atomVariantId of slotAtomVariantIds.get(slotVariantId) ?? []) {
        addMapSetValue(index, subtypeId, atomVariantId);
      }
    }
  }
  return index;
}

function atomVariantIdsForSlot(sampleId, slot) {
  const variants = [];
  for (const atomId of normalizeTextArray(slot?.scriptAtomIds)) variants.push(atomVariantId(sampleId, "script", atomId));
  for (const atomId of normalizeTextArray(slot?.rhythmAtomIds)) variants.push(atomVariantId(sampleId, "rhythm", atomId));
  for (const atomId of normalizeTextArray(slot?.packagingAtomIds)) variants.push(atomVariantId(sampleId, "packaging", atomId));
  return variants.filter(Boolean);
}

function atomVariantId(sampleId, layer, atomId) {
  if (!atomId) return null;
  if (String(atomId).includes("::")) return normalizeGraphText(atomId);
  return sourceVariantId(sampleId, layer, atomId);
}

function sourceVariantId(...parts) {
  const normalizedParts = parts.map((part) => normalizeGraphText(part)).filter(Boolean);
  return normalizedParts.length === parts.length ? normalizedParts.join("::") : null;
}

function pushSubtypeAtomArchetypeEdgesFromSlotVariants(edges, slotSubtypes, slotAtomVariantIds, atomVariantArchetypeIds) {
  for (const subtype of slotSubtypes) {
    const subtypeId = normalizeGraphText(subtype?.id);
    if (!subtypeId) continue;
    for (const slotVariantId of normalizeTextArray(subtype?.sourceVariantIds)) {
      for (const atomVariantId of slotAtomVariantIds.get(slotVariantId) ?? []) {
        for (const archetypeId of atomVariantArchetypeIds.get(atomVariantId) ?? []) {
          pushEdge(edges, nodeId("slotSubtype", subtypeId), nodeId("atomArchetype", archetypeId), "subtype_to_atom_archetype", "archetype");
        }
      }
    }
  }
}

function pushSourceSampleSlotSubtypeEdges(edges, slotSubtypes, sourceVariants) {
  const slotVariantSamples = buildSlotVariantSampleIndex(sourceVariants);
  for (const subtype of slotSubtypes) {
    const subtypeId = normalizeGraphText(subtype?.id);
    if (!subtypeId) continue;
    for (const slotVariantId of normalizeTextArray(subtype?.sourceVariantIds)) {
      const sampleId = slotVariantSamples.get(slotVariantId) ?? sampleIdFromSlotVariantId(slotVariantId);
      if (!sampleId) continue;
      pushEdge(edges, graphId("sourceSample", sampleId), nodeId("slotSubtype", subtypeId), "source_sample_slot_variant_to_subtype", "slot variant evidence");
    }
  }
}

function buildSlotVariantSampleIndex(sourceVariants) {
  const index = new Map();
  if (!Array.isArray(sourceVariants)) return index;
  for (const variant of sourceVariants) {
    const variantId = normalizeGraphText(variant?.variantId);
    const kind = normalizeGraphText(variant?.kind);
    const sampleId = normalizeGraphText(variant?.sampleId);
    if (variantId && kind === "slot" && sampleId) index.set(variantId, sampleId);
  }
  return index;
}

function sampleIdFromSlotVariantId(slotVariantId) {
  const parts = normalizeGraphText(slotVariantId)?.split("::") ?? [];
  return parts.length === 2 ? normalizeGraphText(parts[0]) : null;
}

function addMapSetValue(map, key, value) {
  if (!key || !value) return;
  const current = map.get(key) ?? [];
  if (current.includes(value)) return;
  map.set(key, [...current, value]);
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

function pushSourceSamplesFromSnapshot(nodes, edges, rootId, sourceSnapshot) {
  if (!Array.isArray(sourceSnapshot)) return;
  for (const sample of sourceSnapshot) {
    const sampleId = normalizeGraphText(sample?.sampleVideoId ?? sample?.sampleId);
    if (!sampleId) continue;
    const sampleNodeId = graphId("sourceSample", sampleId);
    pushNode(nodes, {
      id: sampleNodeId,
      type: "sourceSample",
      label: sampleId,
      group: "sourceSample",
      data: {
        sampleVideoId: sampleId,
        sampleId,
        artifactId: normalizeGraphText(sample?.artifactId),
        traceId: normalizeGraphText(sample?.traceId),
        contentHash: normalizeGraphText(sample?.contentHash),
        counts: sample?.counts && typeof sample.counts === "object" ? sample.counts : null,
      },
    });
    pushEdge(edges, rootId, sampleNodeId, "governance_contains_source_sample", "sample");
  }
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
  }
}

function groupForAtomLayer(layer) {
  if (layer === "script") return "script";
  if (layer === "rhythm") return "rhythm";
  if (layer === "packaging") return "packaging";
  return "atom";
}

function pushNode(nodes, node) {
  if (!node.id || nodes.some((existing) => existing.id === node.id)) return;
  nodes.push(node);
}

function pushEdge(edges, source, target, type, label) {
  if (!source || !target) return;
  if (edges.some((edge) => edge.source === source && edge.target === target && edge.type === type)) return;
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
