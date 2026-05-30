const fs = require("fs/promises");
const path = require("path");
const { randomUUID } = require("crypto");
const { normalizeDisplayForOverlay } = require("./display-overlay-adapter");

const STAGE_NAME = "function.slot.restructure_display.materialize";
const INDEX_RELATIVE_PATH = path.join("Artifacts", "FunctionSlotRestructure", "_index", "confirmed-plan-displays.json");
const OVERLAY_RELATIVE_PATH = path.join("Artifacts", "FunctionSlotRestructure", "_projections", "governance-plan-overlays.json");
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
    traceContext,
  } = {}) {
    const startedAt = Date.now();
    const artifactId = `artifact_${randomUUID()}`;
    const inputSummary = {
      sourceTurnId: sourceTurnId ?? null,
      parentArtifactId: parentArtifactId ?? null,
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
        traceContext,
      });
      const index = await upsertDisplayIndex(displayArtifact);
      const overlay = await buildAndWriteOverlays(index);
      const outputSummary = {
        artifactId,
        planId,
        displayJsonPath: safeRelativePath(displayArtifact.displayJsonPath),
        indexPath: INDEX_RELATIVE_PATH.replaceAll(path.sep, "/"),
        overlayPath: OVERLAY_RELATIVE_PATH.replaceAll(path.sep, "/"),
        planCount: overlay.plans.length,
        projectedNodeCount: overlay.projectedNodes.length,
        projectedEdgeCount: overlay.projectedEdges.length,
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
        overlayPath: path.join(rootDir, OVERLAY_RELATIVE_PATH),
        overlay,
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

  async function readOverlays() {
    const overlayPath = path.join(rootDir, OVERLAY_RELATIVE_PATH);
    const overlay = await readJsonIfExists(overlayPath);
    if (overlay) return overlay;
    return emptyOverlay();
  }

  async function writeDisplayJson({ displayJson, planId, restructureFinalPath, sourceTurnId, artifactId, parentArtifactId, traceContext }) {
    const displayJsonPath = path.join(rootDir, "Artifacts", "FunctionSlotRestructure", planId, "restructure.display.json");
    const enriched = {
      schemaVersion: displayJson.schemaVersion ?? "restructure_display.v1",
      planId,
      artifactId,
      parentArtifactId: parentArtifactId ?? null,
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

  async function buildAndWriteOverlays(index) {
    const overlays = [];
    const allNodes = [];
    const allEdges = [];
    const reviewFlags = [];
    const usage = new Map();
    const plans = Array.isArray(index.plans) ? index.plans : [];
    for (let indexPosition = 0; indexPosition < plans.length; indexPosition += 1) {
      const plan = plans[indexPosition];
      const fullDisplayPath = path.resolve(rootDir, plan.displayJsonPath);
      const stored = await readJsonIfExists(fullDisplayPath);
      if (!stored?.display) continue;
      const color = PLAN_COLORS[indexPosition % PLAN_COLORS.length];
      const projection = projectDisplayToOverlay({ plan, display: stored.display, color });
      overlays.push({
        planId: plan.planId,
        color,
        sourceRestructurePath: plan.sourceRestructurePath ?? null,
        displayJsonPath: plan.displayJsonPath,
        updatedAt: plan.updatedAt ?? null,
        nodeCount: projection.nodes.length,
        edgeCount: projection.edges.length,
      });
      allNodes.push(...projection.nodes);
      allEdges.push(...projection.edges);
      reviewFlags.push(...projection.reviewFlags);
      for (const node of projection.nodes) {
        const key = node.governanceNodeId ?? node.id;
        if (!usage.has(key)) usage.set(key, new Set());
        usage.get(key).add(plan.planId);
      }
    }
    const sharedUsage = {};
    for (const [nodeId, planSet] of usage.entries()) {
      const planIds = Array.from(planSet);
      if (planIds.length > 1) sharedUsage[nodeId] = planIds;
    }
    const overlay = {
      schemaVersion: "governance_plan_overlays.v1",
      baseGraphId: "semantic-governance.v1",
      updatedAt: now(),
      plans: overlays,
      projectedNodes: allNodes,
      projectedEdges: allEdges,
      sharedUsage,
      reviewFlags,
      summary: {
        planCount: overlays.length,
        projectedNodeCount: allNodes.length,
        projectedEdgeCount: allEdges.length,
        sharedNodeCount: Object.keys(sharedUsage).length,
        reviewFlagCount: reviewFlags.length,
      },
    };
    await writeJson(path.join(rootDir, OVERLAY_RELATIVE_PATH), overlay);
    return overlay;
  }

  function projectDisplayToOverlay({ plan, display, color }) {
    const nodes = [];
    const edges = [];
    const reviewFlags = [];
    const planRootId = overlayId(plan.planId, "plan");
    pushOverlayNode(nodes, {
      id: planRootId,
      planId: plan.planId,
      type: "confirmedPlan",
      label: plan.planId,
      color,
      governanceNodeId: null,
      evidence: pickPlanSummary(display),
    });
    for (const slot of asArray(display.slotChain)) {
      const slotId = firstText(slot.slotSubtype, slot.slotSubtypeId, slot.subtypeId, slot.id);
      const archetypeId = firstText(slot.slotArchetype, slot.slotArchetypeId, slot.archetypeId);
      const slotNodeId = slotId ? `slotSubtype:${sanitizeGraphId(slotId)}` : overlayId(plan.planId, "slot", stableLabel(slot));
      pushOverlayNode(nodes, {
        id: overlayId(plan.planId, "slot", slotId ?? stableLabel(slot)),
        planId: plan.planId,
        type: "projectedSlot",
        label: firstText(slot.name, slot.label, slotId, "slot"),
        color,
        governanceNodeId: slotId ? slotNodeId : null,
        evidence: slot,
      });
      pushOverlayEdge(edges, plan.planId, planRootId, overlayId(plan.planId, "slot", slotId ?? stableLabel(slot)), "plan_uses_slot");
      if (archetypeId) {
        const archetypeNode = overlayId(plan.planId, "archetype", archetypeId);
        pushOverlayNode(nodes, {
          id: archetypeNode,
          planId: plan.planId,
          type: "projectedArchetype",
          label: archetypeId,
          color,
          governanceNodeId: `slotArchetype:${sanitizeGraphId(archetypeId)}`,
          evidence: { archetypeId, slotSubtype: slotId },
        });
        pushOverlayEdge(edges, plan.planId, archetypeNode, overlayId(plan.planId, "slot", slotId ?? stableLabel(slot)), "archetype_to_projected_slot");
      }
      if (isNeedReview(slot)) reviewFlags.push({ planId: plan.planId, nodeId: slotNodeId, reason: "slotChain needReview", evidence: slot });
    }
    projectSections({ nodes, edges, reviewFlags, plan, display, color, key: "scriptSegments", type: "projectedScript", edgeType: "slot_to_script" });
    projectSections({ nodes, edges, reviewFlags, plan, display, color, key: "rhythmCurve", type: "projectedRhythm", edgeType: "slot_to_rhythm" });
    projectSections({ nodes, edges, reviewFlags, plan, display, color, key: "packagingProof", type: "projectedPackaging", edgeType: "slot_to_packaging" });
    for (const atom of asArray(display.atoms)) {
      const atomId = firstText(atom.atomId, atom.id, atom.patternId);
      const atomLayer = firstText(atom.atomLayer, atom.layer, atom.type);
      const node = overlayId(plan.planId, "atom", atomId ?? stableLabel(atom));
      pushOverlayNode(nodes, {
        id: node,
        planId: plan.planId,
        type: "projectedAtom",
        label: firstText(atom.name, atom.label, atomId, "atom"),
        color,
        governanceNodeId: atomId ? `atomPattern:${sanitizeGraphId(atomId)}` : null,
        evidence: atom,
      });
      const slotRef = firstText(atom.slotSubtype, atom.slotSubtypeId, atom.slotId);
      if (slotRef) pushOverlayEdge(edges, plan.planId, overlayId(plan.planId, "slot", slotRef), node, `slot_to_${atomLayer || "atom"}`);
      else pushOverlayEdge(edges, plan.planId, planRootId, node, "plan_uses_atom");
      if (isNeedReview(atom)) reviewFlags.push({ planId: plan.planId, nodeId: atomId, reason: "atom needReview", evidence: atom });
    }
    return { nodes, edges, reviewFlags };
  }

  function projectSections({ nodes, edges, reviewFlags, plan, display, color, key, type, edgeType }) {
    for (const section of asArray(display[key])) {
      const sectionId = firstText(section.id, section.segmentId, section.sectionId, section.blockId, section.name, section.title);
      const node = overlayId(plan.planId, key, sectionId ?? stableLabel(section));
      pushOverlayNode(nodes, {
        id: node,
        planId: plan.planId,
        type,
        label: firstText(section.name, section.title, section.label, sectionId, key),
        color,
        governanceNodeId: null,
        evidence: section,
      });
      const slotRef = firstText(section.slotSubtype, section.slotSubtypeId, section.slotId);
      if (slotRef) pushOverlayEdge(edges, plan.planId, overlayId(plan.planId, "slot", slotRef), node, edgeType);
      else pushOverlayEdge(edges, plan.planId, overlayId(plan.planId, "plan"), node, `plan_to_${key}`);
      if (isNeedReview(section)) reviewFlags.push({ planId: plan.planId, nodeId: node, reason: `${key} needReview`, evidence: section });
    }
  }

  return { materializeFromTurn, readOverlays };
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

function pushOverlayNode(nodes, node) {
  if (nodes.some((existing) => existing.id === node.id)) return;
  nodes.push(node);
}

function pushOverlayEdge(edges, planId, source, target, type) {
  if (!source || !target || source === target) return;
  edges.push({
    id: overlayId(planId, "edge", type, source, target, String(edges.length + 1)),
    planId,
    source,
    target,
    type,
  });
}

function emptyOverlay() {
  return {
    schemaVersion: "governance_plan_overlays.v1",
    baseGraphId: "semantic-governance.v1",
    updatedAt: null,
    plans: [],
    projectedNodes: [],
    projectedEdges: [],
    sharedUsage: {},
    reviewFlags: [],
    summary: {
      planCount: 0,
      projectedNodeCount: 0,
      projectedEdgeCount: 0,
      sharedNodeCount: 0,
      reviewFlagCount: 0,
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
    const text = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
    if (text) return text;
  }
  return null;
}

function isNeedReview(value) {
  return value?.needReview === true || value?.reviewStatus === "needReview" || value?.status === "needReview";
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

function overlayId(...parts) {
  return parts.map((part) => sanitizeGraphId(part)).join(":");
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
