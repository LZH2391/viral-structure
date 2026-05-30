const fs = require("fs/promises");
const path = require("path");
const { randomUUID } = require("crypto");
const { normalizeDisplayForOverlay } = require("./display-overlay-adapter");

const STAGE_NAME = "function.slot.restructure_display.materialize";
const INDEX_RELATIVE_PATH = path.join("Artifacts", "FunctionSlotRestructure", "_index", "confirmed-plan-displays.json");
const TRACE_GRAPH_RELATIVE_PATH = path.join("Artifacts", "FunctionSlotRestructure", "_projections", "confirmed-plan-trace.graph.json");
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
    if (traceGraph) return traceGraph;
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
    for (let indexPosition = 0; indexPosition < plans.length; indexPosition += 1) {
      const plan = plans[indexPosition];
      const fullDisplayPath = path.resolve(rootDir, plan.displayJsonPath);
      const stored = await readJsonIfExists(fullDisplayPath);
      if (!stored?.display) continue;
      const color = PLAN_COLORS[indexPosition % PLAN_COLORS.length];
      projectDisplayToTraceGraph({ nodes, edges, plan, display: stored.display, color });
    }
    const graph = {
      schemaVersion: "confirmed_plan_trace_graph.v1",
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
        atomCount: nodes.filter((node) => node.type === "tracedAtom").length,
        bindingCount: 0,
        ruleCount: 0,
        conceptCount: nodes.filter((node) => node.type === "sourceReference").length,
        scriptSegmentCount: nodes.filter((node) => node.type === "tracedScript").length,
        rhythmSectionCount: nodes.filter((node) => node.type === "tracedRhythm").length,
        packagingBlockCount: nodes.filter((node) => node.type === "tracedPackaging").length,
      },
    };
    await writeJson(path.join(rootDir, TRACE_GRAPH_RELATIVE_PATH), graph);
    return graph;
  }

  function projectDisplayToTraceGraph({ nodes, edges, plan, display, color }) {
    const planRootId = traceId(plan.planId, "plan");
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
    pushSourceReference(nodes, edges, plan.planId, planRootId, "restructure", plan.sourceRestructurePath, "source_restructure_path", { path: plan.sourceRestructurePath ?? null });
    pushSourceReference(nodes, edges, plan.planId, planRootId, "display", plan.displayJsonPath, "source_display_json", { path: plan.displayJsonPath ?? null });

    for (const slot of asArray(display.slotChain)) {
      const slotId = firstText(slot.slotSubtype, slot.slotSubtypeId, slot.subtypeId, slot.id);
      const archetypeId = firstText(slot.slotArchetype, slot.slotArchetypeId, slot.archetypeId);
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
          archetypeGovernanceNodeId: archetypeId ? `slotArchetype:${sanitizeGraphId(archetypeId)}` : null,
          evidence: stripReviewFields(slot),
        },
      });
      pushGraphEdge(edges, plan.planId, planRootId, node, "plan_uses_slot", "uses slot");
      pushSourceReference(nodes, edges, plan.planId, node, "governance", slotId ? `slotSubtype:${slotId}` : null, "traced_to_governance_ref", { governanceNodeId: slotId ? `slotSubtype:${sanitizeGraphId(slotId)}` : null });
      pushSourceReference(nodes, edges, plan.planId, node, "governance", archetypeId ? `slotArchetype:${archetypeId}` : null, "traced_to_governance_ref", { governanceNodeId: archetypeId ? `slotArchetype:${sanitizeGraphId(archetypeId)}` : null });
    }
    projectSections({ nodes, edges, plan, display, color, key: "scriptSegments", type: "tracedScript", group: "script", edgeType: "slot_to_script" });
    projectSections({ nodes, edges, plan, display, color, key: "rhythmCurve", type: "tracedRhythm", group: "rhythm", edgeType: "slot_to_rhythm" });
    projectSections({ nodes, edges, plan, display, color, key: "packagingProof", type: "tracedPackaging", group: "packaging", edgeType: "slot_to_packaging" });
    for (const atom of asArray(display.atoms)) {
      const atomId = firstText(atom.atomId, atom.id, atom.patternId);
      const atomLayer = firstText(atom.atomLayer, atom.layer, atom.type);
      const node = traceId(plan.planId, "atom", atomId ?? stableLabel(atom));
      pushGraphNode(nodes, {
        id: node,
        type: "tracedAtom",
        label: firstText(atom.name, atom.label, atomId, "atom"),
        group: groupForAtomLayer(atomLayer),
        data: {
          planId: plan.planId,
          color,
          governanceNodeId: atomId ? `atomPattern:${sanitizeGraphId(atomId)}` : null,
          evidence: stripReviewFields(atom),
        },
      });
      const slotRef = firstText(atom.slotSubtype, atom.slotSubtypeId, atom.slotId);
      if (slotRef) pushGraphEdge(edges, plan.planId, traceId(plan.planId, "slot", slotRef), node, `slot_to_${atomLayer || "atom"}`, atomLayer || "atom");
      else pushGraphEdge(edges, plan.planId, planRootId, node, "plan_uses_atom", "uses atom");
      pushSourceReference(nodes, edges, plan.planId, node, "governance", atomId ? `atomPattern:${atomId}` : null, "traced_to_governance_ref", { governanceNodeId: atomId ? `atomPattern:${sanitizeGraphId(atomId)}` : null });
    }
  }

  function projectSections({ nodes, edges, plan, display, color, key, type, group, edgeType }) {
    for (const section of asArray(display[key])) {
      const sectionId = firstText(section.id, section.segmentId, section.sectionId, section.blockId, section.name, section.title);
      const node = traceId(plan.planId, key, sectionId ?? stableLabel(section));
      pushGraphNode(nodes, {
        id: node,
        type,
        label: firstText(section.name, section.title, section.label, sectionId, key),
        group,
        data: {
          planId: plan.planId,
          color,
          governanceNodeId: null,
          evidence: stripReviewFields(section),
        },
      });
      const slotRef = firstText(section.slotSubtype, section.slotSubtypeId, section.slotId);
      if (slotRef) pushGraphEdge(edges, plan.planId, traceId(plan.planId, "slot", slotRef), node, edgeType, edgeType);
      else pushGraphEdge(edges, plan.planId, traceId(plan.planId, "plan"), node, `plan_to_${key}`, key);
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

function pushSourceReference(nodes, edges, planId, ownerId, sourceKind, label, edgeType, data = {}) {
  const sourceLabel = firstText(label);
  if (!sourceLabel) return;
  const nodeId = traceId(planId, "source", sourceKind, sourceLabel);
  pushGraphNode(nodes, {
    id: nodeId,
    type: "sourceReference",
    label: sourceLabel,
    group: "sourceVariant",
    data: {
      planId,
      sourceKind,
      ...data,
    },
  });
  pushGraphEdge(edges, planId, ownerId, nodeId, edgeType, sourceKind);
}

function emptyTraceGraph() {
  return {
    schemaVersion: "confirmed_plan_trace_graph.v1",
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

function groupForAtomLayer(layer) {
  if (layer === "script") return "script";
  if (layer === "rhythm") return "rhythm";
  if (layer === "packaging") return "packaging";
  return "script";
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
