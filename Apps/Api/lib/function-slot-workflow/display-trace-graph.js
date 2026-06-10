const path = require("path");
const { readGovernanceFileIfExists } = require("../function-slot-library/governance-store");
const {
  aliasForSample,
  asArray,
  atomGroup,
  buildGovernanceSourceIndex,
  extractAtomSourceRows,
  extractDisplayAtoms,
  extractDisplaySlotChain,
  extractSlotSubtypeId,
  extractSourceAliasMap,
  firstText,
  governanceName,
  isAtomVariantKind,
  normalizeTextArray,
  parseVariantId,
  shortSampleLabel,
  uniqueStrings,
  variantDisplayLabel,
} = require("./display-trace-extractors");

const TRACE_GRAPH_PROJECTION_VERSION = "confirmed_plan_trace_projection.v15";
const PLAN_COLORS = ["#6ea8fe", "#8ce99a", "#ffd43b", "#ff8787", "#b197fc", "#66d9e8", "#ffa94d", "#f783ac"];

async function buildAndWriteTraceGraph({ rootDir, index, now, readJsonIfExists, writeJson, traceGraphRelativePath, governanceRelativePath }) {
  const graph = await buildTraceGraphFromPlans({
    rootDir,
    plans: Array.isArray(index.plans) ? index.plans : [],
    now,
    readJsonIfExists,
    governanceRelativePath,
  });
  await writeJson(path.join(rootDir, traceGraphRelativePath), graph);
  return graph;
}

async function buildTraceGraphFromPlans({ rootDir, plans, now, readJsonIfExists, governanceRelativePath, readDisplayForPlan = null, artifactId = "confirmed-plan-trace" }) {
  const nodes = [];
  const edges = [];
  const governance = await readGovernanceFileIfExists(path.join(rootDir, governanceRelativePath));
  const sourceIndex = buildGovernanceSourceIndex(governance);
  for (let indexPosition = 0; indexPosition < plans.length; indexPosition += 1) {
    const plan = plans[indexPosition];
    const stored = readDisplayForPlan
      ? await readDisplayForPlan(plan)
      : await readJsonIfExists(path.resolve(rootDir, plan.displayJsonPath));
    const display = stored?.display ?? stored;
    if (!display) continue;
    const color = PLAN_COLORS[indexPosition % PLAN_COLORS.length];
    projectDisplayToTraceGraph({ nodes, edges, plan, display, color, sourceIndex });
  }
  const graph = {
    schemaVersion: "confirmed_plan_trace_graph.v1",
    projectionVersion: TRACE_GRAPH_PROJECTION_VERSION,
    artifactId,
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
  return graph;
}

function projectDisplayToTraceGraph({ nodes, edges, plan, display, color, sourceIndex }) {
  const planRootId = traceId(plan.planId, "plan");
  const aliasMap = extractSourceAliasMap(display);
  const atomSourceRows = extractAtomSourceRows(display, aliasMap, sourceIndex);
  const slotChain = extractDisplaySlotChain(display);
  pushGraphNode(nodes, {
    id: planRootId,
    type: "confirmedPlan",
    label: plan.versionName ?? plan.label ?? plan.planId,
    group: "plan",
    data: {
      planId: plan.planId,
      planSetId: plan.planSetId ?? null,
      recordId: plan.recordId ?? null,
      versionId: plan.versionId ?? null,
      versionName: plan.versionName ?? null,
      mode: plan.mode ?? null,
      color,
      confirmationId: plan.confirmationId ?? null,
      sourceTurnId: plan.sourceTurnId ?? null,
      sourceRestructurePath: plan.sourceRestructurePath ?? null,
      displayJsonPath: plan.displayJsonPath ?? null,
      updatedAt: plan.updatedAt ?? null,
      evidence: pickPlanSummary(display, slotChain),
    },
  });

  for (let slotIndex = 0; slotIndex < slotChain.length; slotIndex += 1) {
    const slot = slotChain[slotIndex];
    const slotId = extractSlotSubtypeId(slot);
    const slotNode = pushSlotSubtypeTrace(nodes, edges, plan.planId, planRootId, { subtypeId: slotId, sourceIndex, slotEvidence: slot, color, slotOrder: slotIndex + 1 });
    const atomRow = atomSourceRows.bySlotId.get(slotId) ?? atomSourceRows.rows[slotIndex];
    for (const atomVariantId of uniqueStrings(atomRow?.atomVariantIds ?? [])) {
      pushAtomTrace(nodes, edges, plan.planId, slotNode, atomVariantId, aliasMap, sourceIndex);
    }
  }
  const orderedSlotIds = slotChain
    .map((slot) => extractSlotSubtypeId(slot))
    .filter(Boolean)
    .map((slotId) => traceId(plan.planId, "slotSubtype", slotId));
  for (let slotIndex = 0; slotIndex < orderedSlotIds.length - 1; slotIndex += 1) {
    pushGraphEdge(edges, plan.planId, orderedSlotIds[slotIndex], orderedSlotIds[slotIndex + 1], "plan_slot_next", "next");
  }
}
function pickPlanSummary(display, slotChain = extractDisplaySlotChain(display)) {
  return {
    targetAssumption: display.targetAssumption ?? null,
    slotCount: slotChain.length,
    atomCount: extractDisplayAtoms(display).length,
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
  const sampleNodeId = traceId("sourceSample", parsed.sampleId);
  upsertGraphNode(nodes, {
    id: sampleNodeId,
    type: "sourceSample",
    label: aliasForSample(aliasMap, parsed.sampleId) ? `${aliasForSample(aliasMap, parsed.sampleId)} ${shortSampleLabel(parsed.sampleId)}` : shortSampleLabel(parsed.sampleId),
    group: "sourceSample",
    data: {
      planIds: [planId],
      sampleVideoId: parsed.sampleId,
      sampleId: parsed.sampleId,
      sourceAlias: aliasForSample(aliasMap, parsed.sampleId),
    },
  }, (existing) => ({
    ...existing,
    data: {
      ...existing.data,
      planIds: uniqueStrings([...(asArray(existing.data?.planIds)), planId]),
      sourceAlias: firstText(existing.data?.sourceAlias, aliasForSample(aliasMap, parsed.sampleId)),
    },
  }));
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
  buildTraceGraphFromPlans,
  emptyTraceGraph,
};
