const fs = require("fs/promises");
const path = require("path");
const { randomUUID } = require("crypto");
const { normalizeDisplayForOverlay } = require("./display-overlay-adapter");

const STAGE_NAME = "function.slot.restructure_display.materialize";
const INDEX_RELATIVE_PATH = path.join("Artifacts", "FunctionSlotRestructure", "_index", "confirmed-plan-displays.json");
const TRACE_GRAPH_RELATIVE_PATH = path.join("Artifacts", "FunctionSlotRestructure", "_projections", "confirmed-plan-trace.graph.json");
const TRACE_GRAPH_PROJECTION_VERSION = "confirmed_plan_trace_projection.v5";
const GOVERNANCE_RELATIVE_PATH = path.join("Artifacts", "FunctionSlotLibrary", "_governance", "semantic-governance.v1.json");
const REQUIRED_KEYS = ["targetAssumption", "slotChain", "atoms", "scriptSegments", "rhythmCurve", "packagingProof"];
const PLAN_COLORS = ["#6ea8fe", "#8ce99a", "#ffd43b", "#ff8787", "#b197fc", "#66d9e8", "#ffa94d", "#f783ac"];

function createRestructureDisplayOverlayService({ rootDir, logger, now = () => new Date().toISOString() } = {}) {
  if (!rootDir) throw new Error("rootDir is required");
  if (!logger) throw new Error("logger is required");

  async function materializeFromTurn({
    finalMessage,
    restructureFinalPath,
    sourceTurnId,
    parentArtifactId,
    confirmationId,
    traceContext,
  } = {}) {
    const startedAt = Date.now();
    const artifactId = `artifact_${randomUUID()}`;
    const inputSummary = {
      sourceTurnId: sourceTurnId ?? null,
      parentArtifactId: parentArtifactId ?? null,
      confirmationId: confirmationId ?? null,
      restructureFinalPath: safeRelativePath(restructureFinalPath),
      finalMessageChars: finalMessage ? String(finalMessage).length : 0,
    };
    await logger.writeStageLog({
      traceContext,
      stageName: STAGE_NAME,
      event: "stage.start",
      artifactId,
      parentArtifactId,
      inputSummary,
    });
    try {
      const displayJson = normalizeDisplayForOverlay(parseDisplayTransformerFinalMessage(finalMessage));
      validateRestructureDisplayJson(displayJson);
      const planId = inferPlanId({ restructureFinalPath, displayJson });
      const displayArtifact = await writeDisplayJson({
        displayJson,
        planId,
        restructureFinalPath,
        sourceTurnId,
        artifactId,
        parentArtifactId,
        confirmationId,
        traceContext,
      });
      const index = await upsertDisplayIndex(displayArtifact);
      const traceGraph = await buildAndWriteTraceGraph(index);
      const outputSummary = {
        artifactId,
        planId,
        confirmationId: confirmationId ?? null,
        displayJsonPath: safeRelativePath(displayArtifact.displayJsonPath),
        indexPath: INDEX_RELATIVE_PATH.replaceAll(path.sep, "/"),
        traceGraphPath: TRACE_GRAPH_RELATIVE_PATH.replaceAll(path.sep, "/"),
        planCount: traceGraph.summary.planCount,
        nodeCount: traceGraph.nodes.length,
        edgeCount: traceGraph.edges.length,
      };
      await logger.writeStageLog({
        traceContext,
        stageName: STAGE_NAME,
        event: "stage.end",
        artifactId,
        parentArtifactId,
        outputSummary,
        durationMs: Date.now() - startedAt,
      });
      return {
        ok: true,
        artifactId,
        planId,
        displayJsonPath: displayArtifact.displayJsonPath,
        indexPath: path.join(rootDir, INDEX_RELATIVE_PATH),
        traceGraphPath: path.join(rootDir, TRACE_GRAPH_RELATIVE_PATH),
        traceGraph,
      };
    } catch (error) {
      const errorSummary = {
        code: error.code ?? "restructure_display_materialize_failed",
        message: safePreview(error.message),
        retryable: true,
      };
      const snapshot = await logger.writeDebugSnapshot({
        traceContext,
        stageName: STAGE_NAME,
        artifactId,
        parentArtifactId,
        reason: errorSummary.code,
        inputSummary,
        outputSummary: null,
        debugPayload: {
          message: errorSummary.message,
          validationErrors: error.validationErrors ?? null,
          finalMessagePreview: safePreview(finalMessage, 1200),
        },
      });
      await logger.writeStageLog({
        traceContext,
        stageName: STAGE_NAME,
        event: "stage.fail",
        artifactId,
        parentArtifactId,
        errorSummary: { ...errorSummary, debugSnapshotUri: snapshot.uri },
        durationMs: Date.now() - startedAt,
      });
      return {
        ok: false,
        artifactId,
        error: errorSummary.code,
        message: errorSummary.message,
        debugSnapshotUri: snapshot.uri,
      };
    }
  }

  async function readConfirmedPlanTraceGraph() {
    const traceGraphPath = path.join(rootDir, TRACE_GRAPH_RELATIVE_PATH);
    const traceGraph = await readJsonIfExists(traceGraphPath);
    const index = await readJsonIfExists(path.join(rootDir, INDEX_RELATIVE_PATH));
    if (traceGraph?.projectionVersion === TRACE_GRAPH_PROJECTION_VERSION) return traceGraph;
    if (index?.plans?.length) return buildAndWriteTraceGraph(index);
    return emptyTraceGraph();
  }

  async function writeDisplayJson({ displayJson, planId, restructureFinalPath, sourceTurnId, artifactId, parentArtifactId, confirmationId, traceContext }) {
    const displayJsonPath = path.join(rootDir, "Artifacts", "FunctionSlotRestructure", planId, "restructure.display.json");
    const enriched = {
      schemaVersion: displayJson.schemaVersion ?? "restructure_display.v1",
      planId,
      artifactId,
      parentArtifactId: parentArtifactId ?? null,
      confirmationId: confirmationId ?? null,
      sourceTurnId: sourceTurnId ?? null,
      sourceRestructurePath: normalizeRelativePath(restructureFinalPath),
      runId: traceContext.runId,
      traceId: traceContext.traceId,
      stageId: traceContext.stageId,
      stageName: STAGE_NAME,
      updatedAt: now(),
      display: displayJson,
    };
    await writeJson(displayJsonPath, enriched);
    return {
      planId,
      artifactId,
      parentArtifactId: parentArtifactId ?? null,
      confirmationId: confirmationId ?? null,
      sourceTurnId: sourceTurnId ?? null,
      sourceRestructurePath: normalizeRelativePath(restructureFinalPath),
      displayJsonPath,
      updatedAt: enriched.updatedAt,
      runId: traceContext.runId,
      traceId: traceContext.traceId,
      stageId: traceContext.stageId,
    };
  }

  async function upsertDisplayIndex(entry) {
    const indexPath = path.join(rootDir, INDEX_RELATIVE_PATH);
    const current = await readJsonIfExists(indexPath) ?? { schemaVersion: "confirmed_plan_displays.v1", updatedAt: null, plans: [] };
    const plans = Array.isArray(current.plans) ? current.plans.filter((plan) => plan.planId !== entry.planId) : [];
    plans.push({
      planId: entry.planId,
      artifactId: entry.artifactId,
      parentArtifactId: entry.parentArtifactId,
      confirmationId: entry.confirmationId ?? null,
      sourceTurnId: entry.sourceTurnId,
      sourceRestructurePath: entry.sourceRestructurePath,
      displayJsonPath: path.relative(rootDir, entry.displayJsonPath).replaceAll(path.sep, "/"),
      traceId: entry.traceId,
      runId: entry.runId,
      stageId: entry.stageId,
      updatedAt: entry.updatedAt,
    });
    const next = {
      schemaVersion: "confirmed_plan_displays.v1",
      updatedAt: now(),
      plans: plans.sort((left, right) => String(left.planId).localeCompare(String(right.planId))),
    };
    await writeJson(indexPath, next);
    return next;
  }

  async function buildAndWriteTraceGraph(index) {
    const nodes = [];
    const edges = [];
    const plans = Array.isArray(index.plans) ? index.plans : [];
    const governance = await readJsonIfExists(path.join(rootDir, GOVERNANCE_RELATIVE_PATH));
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
        slotCount: nodes.filter((node) => node.type === "tracedSlot").length,
        atomCount: nodes.filter((node) => node.type === "atomPattern").length,
        bindingCount: 0,
        ruleCount: 0,
        conceptCount: nodes.filter((node) => node.type === "sourceExample" || node.type === "slotFamily" || node.type === "slotArchetype" || node.type === "slotSubtype").length,
        scriptSegmentCount: 0,
        rhythmSectionCount: 0,
        packagingBlockCount: 0,
      },
    };
    await writeJson(path.join(rootDir, TRACE_GRAPH_RELATIVE_PATH), graph);
    return graph;
  }

  function projectDisplayToTraceGraph({ nodes, edges, plan, display, color, sourceIndex }) {
    const planRootId = traceId(plan.planId, "plan");
    const aliasMap = extractSourceAliasMap(display);
    const atomSourceRows = extractAtomSourceRows(display, aliasMap);
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
      const archetypeId = firstText(slot.slotArchetype, slot.slotArchetypeId, slot.archetypeId, sourceIndex.get(`${slotId}::archetypeId`));
      const familyId = firstText(sourceIndex.get(`${slotId}::familyId`), sourceIndex.get(`${archetypeId}::familyId`));
      const node = traceId(plan.planId, "slot", slotId ?? stableLabel(slot));
      pushGraphNode(nodes, {
        id: node,
        type: "tracedSlot",
        label: firstText(slot.name, slot.label, slotId, "slot"),
        group: "slot",
        data: {
          planId: plan.planId,
          color,
          governanceNodeId: slotId ? `slotSubtype:${sanitizeGraphId(slotId)}` : null,
          familyGovernanceNodeId: familyId ? `slotFamily:${sanitizeGraphId(familyId)}` : null,
          archetypeGovernanceNodeId: archetypeId ? `slotArchetype:${sanitizeGraphId(archetypeId)}` : null,
          slotHierarchy: {
            family: familyId,
            archetype: archetypeId,
            subtype: slotId,
          },
          evidence: stripReviewFields(slot),
        },
      });
      pushGraphEdge(edges, plan.planId, planRootId, node, "plan_uses_slot", "uses slot");
      pushSlotGovernanceHierarchy(nodes, edges, plan.planId, node, { familyId, archetypeId, subtypeId: slotId, sourceIndex });
      const explicitSourceVariantIds = uniqueStrings(atomSourceRows[slotIndex]?.slotVariantIds ?? []);
      const fallbackSourceVariantIds = uniqueStrings([
        ...asArray(sourceIndex.get(slotId)),
        ...asArray(sourceIndex.get(archetypeId)),
      ]);
      const sourceVariantIds = explicitSourceVariantIds.length ? explicitSourceVariantIds : fallbackSourceVariantIds;
      for (const variantId of sourceVariantIds) {
        pushSourceVariantTrace(nodes, edges, plan.planId, node, variantId, aliasMap);
      }
      for (const atomVariantId of uniqueStrings(atomSourceRows[slotIndex]?.atomVariantIds ?? [])) {
        const atomNode = pushAtomTrace(nodes, edges, plan.planId, node, atomVariantId, aliasMap, sourceIndex);
        if (atomNode) pushSourceVariantTrace(nodes, edges, plan.planId, atomNode, atomVariantId, aliasMap);
      }
    }
  }

  return { materializeFromTurn, readConfirmedPlanTraceGraph };
}

function parseDisplayTransformerFinalMessage(finalMessage) {
  const text = String(finalMessage ?? "").trim();
  if (!text) throw codedError("display_final_message_empty", "展示转换 finalMessage 为空");
  const candidates = [];
  const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((match) => match[1].trim()).filter(Boolean);
  candidates.push(...fenced, text);
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) candidates.push(text.slice(first, last + 1));
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try next candidate
    }
  }
  throw codedError("display_final_message_json_parse_failed", "展示转换 finalMessage 未解析出合法 JSON");
}

function validateRestructureDisplayJson(value) {
  const errors = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) errors.push("root must be object");
  for (const key of REQUIRED_KEYS) {
    if (!(key in (value ?? {}))) errors.push(`missing ${key}`);
  }
  for (const key of ["slotChain", "atoms", "scriptSegments", "rhythmCurve", "packagingProof"]) {
    if (key in (value ?? {}) && !Array.isArray(value[key])) errors.push(`${key} must be array`);
  }
  if (errors.length) {
    const error = codedError("display_json_schema_invalid", "展示转换 JSON 校验失败");
    error.validationErrors = errors;
    throw error;
  }
  return true;
}

function inferPlanId({ restructureFinalPath, displayJson }) {
  const explicit = firstText(displayJson.planId, displayJson.briefSlug, displayJson.slug);
  if (explicit) return safeSlug(explicit);
  const normalized = normalizeRelativePath(restructureFinalPath);
  const parts = normalized.split(/[\\/]+/).filter(Boolean);
  const index = parts.findIndex((part) => part === "FunctionSlotRestructure");
  if (index >= 0 && parts[index + 1]) return safeSlug(parts[index + 1]);
  const parent = parts.at(-2);
  return safeSlug(parent || "confirmed-plan");
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
  if (!parsed.sampleId || !parsed.variantKey) return null;
  const layerNodeId = traceId(planId, "atomLayer", parsed.variantKind);
  const atomPatternIds = uniqueStrings(sourceIndex.get(atomVariantId) ?? []);
  pushGraphNode(nodes, {
    id: layerNodeId,
    type: "atomLayer",
    label: layerDisplayName(parsed.variantKind),
    group: atomGroup(parsed.variantKey),
    data: {
      planId,
      layer: parsed.variantKind,
    },
  });
  pushGraphEdge(edges, planId, slotNodeId, layerNodeId, "slot_uses_atom_layer", parsed.variantKind ?? "atom layer");
  if (!atomPatternIds.length) {
    pushSourceVariantTrace(nodes, edges, planId, layerNodeId, atomVariantId, aliasMap);
    return layerNodeId;
  }
  for (const patternId of atomPatternIds) {
    const patternNodeId = traceId(planId, "atomPattern", patternId);
    pushGraphNode(nodes, {
      id: patternNodeId,
      type: "atomPattern",
      label: governanceName(sourceIndex, patternId, patternId),
      group: atomGroup(parsed.variantKey),
      data: {
        planId,
        governanceId: patternId,
        layer: parsed.variantKind,
        sourceVariantIds: sourceIndex.get(patternId) ?? [],
      },
    });
    pushGraphEdge(edges, planId, layerNodeId, patternNodeId, "atom_layer_to_pattern", "pattern");
    pushSourceVariantTrace(nodes, edges, planId, patternNodeId, atomVariantId, aliasMap);
  }
  return layerNodeId;
}

function pushSlotGovernanceHierarchy(nodes, edges, planId, slotNodeId, { familyId, archetypeId, subtypeId, sourceIndex }) {
  const firstSemanticNode = familyId ? traceId(planId, "slotFamily", familyId) : archetypeId ? traceId(planId, "slotArchetype", archetypeId) : subtypeId ? traceId(planId, "slotSubtype", subtypeId) : null;
  if (familyId) {
    pushGraphNode(nodes, {
      id: traceId(planId, "slotFamily", familyId),
      type: "slotFamily",
      label: governanceName(sourceIndex, familyId, familyId),
      group: "slot",
      data: governanceNodeData(sourceIndex, planId, familyId, "family"),
    });
  }
  if (archetypeId) {
    pushGraphNode(nodes, {
      id: traceId(planId, "slotArchetype", archetypeId),
      type: "slotArchetype",
      label: governanceName(sourceIndex, archetypeId, archetypeId),
      group: "slot",
      data: governanceNodeData(sourceIndex, planId, archetypeId, "archetype"),
    });
  }
  if (subtypeId) {
    pushGraphNode(nodes, {
      id: traceId(planId, "slotSubtype", subtypeId),
      type: "slotSubtype",
      label: governanceName(sourceIndex, subtypeId, subtypeId),
      group: "slot",
      data: governanceNodeData(sourceIndex, planId, subtypeId, "subtype"),
    });
  }
  if (firstSemanticNode) pushGraphEdge(edges, planId, slotNodeId, firstSemanticNode, "slot_traced_to_semantic", "semantic");
  if (familyId && archetypeId) pushGraphEdge(edges, planId, traceId(planId, "slotFamily", familyId), traceId(planId, "slotArchetype", archetypeId), "slot_family_to_archetype", "archetype");
  if (archetypeId && subtypeId) pushGraphEdge(edges, planId, traceId(planId, "slotArchetype", archetypeId), traceId(planId, "slotSubtype", subtypeId), "slot_archetype_to_subtype", "subtype");
}

function governanceNodeData(sourceIndex, planId, governanceId, semanticLevel) {
  const item = sourceIndex.get(`${governanceId}::item`) ?? {};
  return {
    planId,
    governanceId,
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

function pushSourceVariantTrace(nodes, edges, planId, ownerId, variantId, aliasMap) {
  const parsed = parseVariantId(variantId);
  if (!parsed.sampleId) return;
  const sampleLabel = aliasForSample(aliasMap, parsed.sampleId) ?? shortSampleLabel(parsed.sampleId);
  const sampleNodeId = traceId(planId, "sample", parsed.sampleId);
  upsertGraphNode(nodes, {
    id: sampleNodeId,
    type: "sourceExample",
    label: sampleLabel,
    group: "sourceExample",
    data: {
      planId,
      sampleVideoId: parsed.sampleId,
      sampleId: parsed.sampleId,
      sourceAlias: aliasForSample(aliasMap, parsed.sampleId),
      sourceVariantIds: [variantId],
    },
  }, (existing) => ({
    ...existing,
    data: {
      ...existing.data,
      sourceVariantIds: uniqueStrings([...(asArray(existing.data?.sourceVariantIds)), variantId]),
    },
  }));
  pushGraphEdge(edges, planId, ownerId, sampleNodeId, "traced_to_source_sample", parsed.variantKind ? `${parsed.variantKind} source` : "source sample");
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

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
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

function extractAtomSourceRows(display, aliasMap) {
  const rows = [];
  for (const atom of asArray(display?.atoms)) {
    const direct = firstText(atom.value, atom.atomId, atom.id);
    if (!direct || !/^[A-Z]::F\d+/i.test(direct)) continue;
    const slotVariantIds = [expandAliasVariant(direct, aliasMap)].filter(Boolean);
    const atomVariantIds = [];
    for (const value of Object.values(atom)) {
      const text = firstText(value);
      if (!text) continue;
      for (const match of text.matchAll(/([A-Z])::(script|rhythm|packaging)::([A-Za-z0-9_-]+)/g)) {
        const sampleId = aliasMap.get(match[1]);
        if (sampleId) atomVariantIds.push(`${sampleId}::${match[2]}::${match[3]}`);
      }
    }
    rows.push({ slotVariantIds, atomVariantIds });
  }
  return rows;
}

function expandAliasVariant(value, aliasMap) {
  const match = String(value ?? "").trim().match(/^([A-Z])::(.+)$/);
  if (!match) return null;
  const sampleId = aliasMap.get(match[1]);
  return sampleId ? `${sampleId}::${match[2]}` : null;
}

function parseVariantId(variantId) {
  const parts = String(variantId ?? "").split("::");
  return {
    sampleId: parts[0]?.startsWith("sample_") ? parts[0] : null,
    variantKind: parts.length > 2 ? parts[1] : "slot",
    variantKey: parts.slice(1).join("::"),
  };
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

function normalizeRelativePath(filePath) {
  const text = String(filePath ?? "").trim();
  if (!text) return null;
  return text.replaceAll("\\", "/").replace(/^[A-Za-z]:\//, "");
}

function safeRelativePath(filePath) {
  return normalizeRelativePath(filePath);
}

function safePreview(value, limit = 240) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length <= limit ? text : `${text.slice(0, limit)}...`;
}

module.exports = {
  REQUIRED_KEYS,
  STAGE_NAME,
  createRestructureDisplayOverlayService,
  parseDisplayTransformerFinalMessage,
  validateRestructureDisplayJson,
};
