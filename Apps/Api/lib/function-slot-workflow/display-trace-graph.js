const path = require("path");
const { readGovernanceFileIfExists } = require("../function-slot-library/governance-store");

const TRACE_GRAPH_PROJECTION_VERSION = "confirmed_plan_trace_projection.v14";
const PLAN_COLORS = ["#6ea8fe", "#8ce99a", "#ffd43b", "#ff8787", "#b197fc", "#66d9e8", "#ffa94d", "#f783ac"];

async function buildAndWriteTraceGraph({ rootDir, index, now, readJsonIfExists, writeJson, traceGraphRelativePath, governanceRelativePath }) {
  const nodes = [];
  const edges = [];
  const plans = Array.isArray(index.plans) ? index.plans : [];
  const governance = await readGovernanceFileIfExists(path.join(rootDir, governanceRelativePath));
  const sourceIndex = buildGovernanceSourceIndex(governance);
  for (let indexPosition = 0; indexPosition < plans.length; indexPosition += 1) {
    const plan = plans[indexPosition];
    const fullDisplayPath = path.resolve(rootDir, plan.displayJsonPath);
    const stored = await readJsonIfExists(fullDisplayPath);
    if (!stored?.display) continue;
    const color = PLAN_COLORS[indexPosition % PLAN_COLORS.length];
    projectDisplayToTraceGraph({ nodes, edges, plan, display: stored.display, color, sourceIndex });
  }
  const graph = {
    schemaVersion: "confirmed_plan_trace_graph.v1",
    projectionVersion: TRACE_GRAPH_PROJECTION_VERSION,
    artifactId: "confirmed-plan-trace",
    governanceId: null,
    sampleVideoId: null,
    traceId: null,
    updatedAt: now(),
    nodes,
    edges,
    summary: {
      planCount: nodes.filter((node) => node.type === "confirmedPlan").length,
      slotCount: nodes.filter((node) => node.type === "slotSubtype").length,
      atomCount: nodes.filter((node) => node.type === "sourceVariant").length,
      bindingCount: 0,
      ruleCount: 0,
      conceptCount: nodes.filter((node) => node.type === "sourceVariant" || node.type === "sourceSample" || node.type === "slotSubtype").length,
      scriptSegmentCount: 0,
      rhythmSectionCount: 0,
      packagingBlockCount: 0,
    },
  };
  await writeJson(path.join(rootDir, traceGraphRelativePath), graph);
  return graph;
}

function projectDisplayToTraceGraph({ nodes, edges, plan, display, color, sourceIndex }) {
  const planRootId = traceId(plan.planId, "plan");
  const aliasMap = extractSourceAliasMap(display);
  const atomSourceRows = extractAtomSourceRows(display, aliasMap, sourceIndex);
  pushGraphNode(nodes, {
    id: planRootId,
    type: "confirmedPlan",
    label: plan.planId,
    group: "plan",
    data: {
      planId: plan.planId,
      color,
      confirmationId: plan.confirmationId ?? null,
      sourceTurnId: plan.sourceTurnId ?? null,
      sourceRestructurePath: plan.sourceRestructurePath ?? null,
      displayJsonPath: plan.displayJsonPath ?? null,
      updatedAt: plan.updatedAt ?? null,
      evidence: pickPlanSummary(display),
    },
  });

  for (let slotIndex = 0; slotIndex < asArray(display.slotChain).length; slotIndex += 1) {
    const slot = asArray(display.slotChain)[slotIndex];
    const slotId = firstText(slot.slotSubtype, slot.slotSubtypeId, slot.subtypeId, slot.id);
    const slotNode = pushSlotSubtypeTrace(nodes, edges, plan.planId, planRootId, { subtypeId: slotId, sourceIndex, slotEvidence: slot, color, slotOrder: slotIndex + 1 });
    for (const atomVariantId of uniqueStrings(atomSourceRows[slotIndex]?.atomVariantIds ?? [])) {
      pushAtomTrace(nodes, edges, plan.planId, slotNode, atomVariantId, aliasMap, sourceIndex);
    }
  }
  const orderedSlotIds = asArray(display.slotChain)
    .map((slot) => firstText(slot.slotSubtype, slot.slotSubtypeId, slot.subtypeId, slot.id))
    .filter(Boolean)
    .map((slotId) => traceId(plan.planId, "slotSubtype", slotId));
  for (let slotIndex = 0; slotIndex < orderedSlotIds.length - 1; slotIndex += 1) {
    pushGraphEdge(edges, plan.planId, orderedSlotIds[slotIndex], orderedSlotIds[slotIndex + 1], "plan_slot_next", "next");
  }
}
function pickPlanSummary(display) {
  return {
    targetAssumption: display.targetAssumption ?? null,
    slotCount: asArray(display.slotChain).length,
    atomCount: asArray(display.atoms).length,
    scriptSegmentCount: asArray(display.scriptSegments).length,
    rhythmSectionCount: asArray(display.rhythmCurve).length,
    packagingBlockCount: asArray(display.packagingProof).length,
  };
}

function pushGraphNode(nodes, node) {
  if (nodes.some((existing) => existing.id === node.id)) return;
  nodes.push(node);
}

function upsertGraphNode(nodes, node, merge) {
  const index = nodes.findIndex((existing) => existing.id === node.id);
  if (index < 0) {
    nodes.push(node);
    return;
  }
  nodes[index] = merge(nodes[index]);
}

function pushGraphEdge(edges, planId, source, target, type, label = null) {
  if (!source || !target || source === target) return;
  edges.push({
    id: traceId(planId, "edge", type, source, target, String(edges.length + 1)),
    source,
    target,
    type,
    label,
  });
}

function pushAtomTrace(nodes, edges, planId, slotNodeId, atomVariantId, aliasMap, sourceIndex) {
  const parsed = parseVariantId(atomVariantId);
  if (!parsed.sampleId || !parsed.variantKey || !isAtomVariantKind(parsed.variantKind)) return null;
  pushSourceVariantTrace(nodes, edges, planId, slotNodeId, atomVariantId, aliasMap, sourceIndex);
  return null;
}

function pushSlotSubtypeTrace(nodes, edges, planId, planRootId, { subtypeId, sourceIndex, slotEvidence, color, slotOrder }) {
  const slotNode = subtypeId ? traceId(planId, "slotSubtype", subtypeId) : planRootId;
  if (subtypeId) {
    pushGraphNode(nodes, {
      id: traceId(planId, "slotSubtype", subtypeId),
      type: "slotSubtype",
      label: governanceName(sourceIndex, subtypeId, subtypeId),
      group: "slot",
      data: {
        ...governanceNodeData(sourceIndex, planId, subtypeId, "subtype"),
        color,
        slotOrder,
        usedSlotEvidence: stripReviewFields(slotEvidence),
      },
    });
    pushGraphEdge(edges, planId, planRootId, slotNode, "plan_uses_slot_subtype", "uses slot subtype");
  }
  return slotNode;
}

function governanceNodeData(sourceIndex, planId, governanceId, semanticLevel) {
  const item = sourceIndex.get(`${governanceId}::item`) ?? {};
  const governanceType = semanticLevel === "family" ? "slotFamily" : semanticLevel === "archetype" ? "slotArchetype" : semanticLevel === "subtype" ? "slotSubtype" : semanticLevel;
  return {
    planId,
    governanceId,
    governanceNodeId: `${governanceType}:${sanitizeGraphId(governanceId)}`,
    semanticLevel,
    name: governanceName(sourceIndex, governanceId, governanceId),
    sourceVariantIds: sourceIndex.get(governanceId) ?? [],
    familyId: firstText(item.familyId),
    archetypeId: firstText(item.archetypeId),
  };
}

function pushLegacyAtomTrace(nodes, edges, planId, slotNodeId, atomVariantId, aliasMap, sourceIndex) {
  const parsed = parseVariantId(atomVariantId);
  if (!parsed.sampleId || !parsed.variantKey) return null;
  const atomNodeId = traceId(planId, "atom", atomVariantId);
  const atomPatternIds = uniqueStrings(sourceIndex.get(atomVariantId) ?? []);
  pushGraphNode(nodes, {
    id: atomNodeId,
    type: "tracedAtom",
    label: variantDisplayLabel(aliasMap, atomVariantId),
    group: atomGroup(parsed.variantKey),
    data: {
      planId,
      sampleId: parsed.sampleId,
      sourceAlias: aliasForSample(aliasMap, parsed.sampleId),
      variantId: atomVariantId,
      layer: parsed.variantKind,
      patternIds: atomPatternIds,
      atomHierarchy: {
        variant: atomVariantId,
        patterns: atomPatternIds,
      },
      governanceNodeId: atomPatternIds[0] ? `atomPattern:${sanitizeGraphId(atomPatternIds[0])}` : null,
    },
  });
  pushGraphEdge(edges, planId, slotNodeId, atomNodeId, "slot_uses_atom", parsed.variantKind ?? "atom");
  return atomNodeId;
}

function pushSourceVariantTrace(nodes, edges, planId, ownerId, variantId, aliasMap, sourceIndex) {
  const parsed = parseVariantId(variantId);
  if (!parsed.sampleId || !isAtomVariantKind(parsed.variantKind)) return;
  const variantMeta = sourceIndex.get(`${variantId}::sourceVariant`) ?? {};
  const sourceLabel = firstText(variantMeta.label);
  const shortVariant = variantDisplayLabel(aliasMap, variantId);
  const sourceKind = firstText(variantMeta.kind, parsed.variantKind);
  const sourceId = firstText(variantMeta.sourceId, parsed.variantKey);
  const nodeId = traceId(planId, "sourceVariant", variantId);
  upsertGraphNode(nodes, {
    id: nodeId,
    type: "sourceVariant",
    label: sourceLabel ?? shortVariant,
    group: "sourceVariant",
    data: {
      planId,
      variantId,
      shortVariant,
      label: sourceLabel ?? shortVariant,
      labelMissing: !sourceLabel,
      sampleVideoId: parsed.sampleId,
      sampleId: parsed.sampleId,
      sourceAlias: aliasForSample(aliasMap, parsed.sampleId),
      kind: sourceKind,
      sourceId,
      layer: parsed.variantKind === "slot" ? null : parsed.variantKind,
    },
  }, (existing) => existing);
  pushGraphEdge(edges, planId, ownerId, nodeId, "traced_to_source_variant", parsed.variantKind ? `${parsed.variantKind} source` : "source variant");
  const sampleNodeId = traceId(planId, "sourceSample", parsed.sampleId);
  upsertGraphNode(nodes, {
    id: sampleNodeId,
    type: "sourceSample",
    label: aliasForSample(aliasMap, parsed.sampleId) ? `${aliasForSample(aliasMap, parsed.sampleId)} ${shortSampleLabel(parsed.sampleId)}` : shortSampleLabel(parsed.sampleId),
    group: "sourceSample",
    data: {
      planId,
      sampleVideoId: parsed.sampleId,
      sampleId: parsed.sampleId,
      sourceAlias: aliasForSample(aliasMap, parsed.sampleId),
    },
  }, (existing) => existing);
  pushGraphEdge(edges, planId, nodeId, sampleNodeId, "source_variant_to_sample", "sample");
}

function emptyTraceGraph() {
  return {
    schemaVersion: "confirmed_plan_trace_graph.v1",
    projectionVersion: TRACE_GRAPH_PROJECTION_VERSION,
    artifactId: "confirmed-plan-trace",
    governanceId: null,
    sampleVideoId: null,
    traceId: null,
    updatedAt: null,
    nodes: [],
    edges: [],
    summary: {
      planCount: 0,
      slotCount: 0,
      atomCount: 0,
      bindingCount: 0,
      ruleCount: 0,
      conceptCount: 0,
      scriptSegmentCount: 0,
      rhythmSectionCount: 0,
      packagingBlockCount: 0,
    },
  };
}
function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function firstText(...values) {
  for (const value of values) {
    if (value && typeof value === "object" && !Array.isArray(value) && "value" in value) {
      const nested = firstText(value.value);
      if (nested) return nested;
    }
    const text = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
    if (text) return text;
  }
  return null;
}
function buildGovernanceSourceIndex(governance) {
  const index = new Map();
  if (!governance || typeof governance !== "object") return index;
  for (const variant of asArray(governance.sourceVariants)) {
    const variantId = firstText(variant.variantId);
    if (!variantId) continue;
    index.set(`${variantId}::sourceVariant`, variant);
    index.set(`${variantId}::label`, firstText(variant.label, variantId));
  }
  for (const collectionName of ["slotFamilies", "slotArchetypes", "slotSubtypes", "atomArchetypes", "atomPatterns", "bindingPrinciples", "bindingPatterns", "rulePatterns", "recompositionPolicies", "implementationBundles", "templates"]) {
    for (const item of asArray(governance[collectionName])) {
      const id = firstText(item.id, item.governanceId, item.patternId);
      if (!id) continue;
      index.set(`${id}::item`, item);
      index.set(`${id}::name`, firstText(item.name, item.label, id));
      const variants = normalizeTextArray(item.sourceVariantIds);
      if (variants.length) index.set(id, variants);
      for (const variantId of variants) {
        const current = asArray(index.get(variantId));
        if (!current.includes(id)) index.set(variantId, [...current, id]);
      }
    }
  }
  for (const archetype of asArray(governance.slotArchetypes)) {
    const archetypeId = firstText(archetype.id, archetype.governanceId);
    const familyId = firstText(archetype.familyId);
    if (archetypeId && familyId) index.set(`${archetypeId}::familyId`, familyId);
  }
  for (const subtype of asArray(governance.slotSubtypes)) {
    const subtypeId = firstText(subtype.id, subtype.governanceId);
    const archetypeId = firstText(subtype.archetypeId);
    const familyId = archetypeId ? index.get(`${archetypeId}::familyId`) : null;
    if (subtypeId && archetypeId) index.set(`${subtypeId}::archetypeId`, archetypeId);
    if (subtypeId && familyId) index.set(`${subtypeId}::familyId`, familyId);
  }
  for (const pattern of asArray(governance.atomPatterns)) {
    const patternId = firstText(pattern.id, pattern.governanceId);
    const archetypeId = firstText(pattern.parentAtomArchetype);
    if (patternId && archetypeId) index.set(`${patternId}::atomArchetypeId`, archetypeId);
  }
  return index;
}

function governanceName(sourceIndex, governanceId, fallback) {
  return firstText(sourceIndex.get(`${governanceId}::name`), fallback);
}

function layerDisplayName(layer) {
  if (layer === "script") return "脚本层";
  if (layer === "rhythm") return "节奏层";
  if (layer === "packaging") return "包装层";
  return firstText(layer, "Atom Layer");
}

function extractSourceAliasMap(display) {
  const map = new Map();
  const text = JSON.stringify(display ?? {});
  const regex = /([A-Z])\s*=\s*(sample_[A-Za-z0-9-]+)/g;
  for (const match of text.matchAll(regex)) map.set(match[1], match[2]);
  return map;
}

function extractAtomSourceRows(display, aliasMap, sourceIndex = new Map()) {
  const rows = [];
  for (const atom of asArray(display?.atoms)) {
    const atomVariantIds = [];
    let hasSlotAnchor = false;
    for (const value of Object.values(atom)) {
      const text = firstText(value);
      if (!text) continue;
      if (/(^|[`'\s])([A-Z])::F\d+/i.test(text)) hasSlotAnchor = true;
      for (const match of text.matchAll(/([A-Z])::(script|rhythm|packaging)::([A-Za-z0-9_-]+)/g)) {
        const sampleId = aliasMap.get(match[1]);
        const variantId = sampleId ? `${sampleId}::${match[2]}::${match[3]}` : null;
        if (variantId && isKnownSourceVariant(variantId, sourceIndex)) atomVariantIds.push(variantId);
      }
    }
    if (hasSlotAnchor || atomVariantIds.length) rows.push({ atomVariantIds });
  }
  return rows;
}

function isKnownSourceVariant(variantId, sourceIndex) {
  return Boolean(sourceIndex.get(`${variantId}::sourceVariant`) || asArray(sourceIndex.get(variantId)).length);
}

function parseVariantId(variantId) {
  const parts = String(variantId ?? "").split("::");
  return {
    sampleId: parts[0]?.startsWith("sample_") ? parts[0] : null,
    variantKind: parts.length > 2 ? parts[1] : "slot",
    variantKey: parts.slice(1).join("::"),
  };
}

function isAtomVariantKind(kind) {
  return kind === "script" || kind === "rhythm" || kind === "packaging";
}

function aliasForSample(aliasMap, sampleId) {
  for (const [alias, id] of aliasMap.entries()) {
    if (id === sampleId) return alias;
  }
  return null;
}

function shortSampleLabel(sampleId) {
  return String(sampleId ?? "").replace(/^sample_/, "sample ").slice(0, 18);
}

function variantDisplayLabel(aliasMap, variantId) {
  const parsed = parseVariantId(variantId);
  const alias = parsed.sampleId ? aliasForSample(aliasMap, parsed.sampleId) : null;
  return alias && parsed.variantKey ? `${alias}::${parsed.variantKey}` : String(variantId ?? "");
}

function normalizeTextArray(value) {
  return asArray(value).map((item) => firstText(item)).filter(Boolean);
}

function uniqueStrings(values) {
  return Array.from(new Set(asArray(values).map((value) => firstText(value)).filter(Boolean)));
}

function atomGroup(variantKey) {
  if (String(variantKey).startsWith("rhythm::")) return "rhythm";
  if (String(variantKey).startsWith("packaging::")) return "packaging";
  return "script";
}

function stableLabel(value) {
  try {
    return JSON.stringify(value).slice(0, 48);
  } catch {
    return "item";
  }
}

function safeSlug(value) {
  return String(value ?? "confirmed-plan").trim().replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "") || "confirmed-plan";
}

function sanitizeGraphId(value) {
  return String(value ?? "").replace(/[^A-Za-z0-9_.:-]/g, "_");
}

function traceId(...parts) {
  return parts.map((part) => sanitizeGraphId(part)).join(":");
}

function stripReviewFields(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const { needReview, reviewStatus, status, confidence, risk, riskLevel, adapterRisk, rejectedBecause, ...rest } = value;
  return rest;
}
module.exports = {
  TRACE_GRAPH_PROJECTION_VERSION,
  buildAndWriteTraceGraph,
  emptyTraceGraph,
};
