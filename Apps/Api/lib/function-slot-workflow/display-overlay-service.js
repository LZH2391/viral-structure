const fs = require("fs/promises");
const path = require("path");
const { randomUUID } = require("crypto");
const { transformRestructureFinalFile } = require("../../../../Infrastructure/FunctionSlotRestructureDisplay/markdown-transformer");
const { resolveStoryboardPlanVersions } = require("../agent-chat/storyboard-version-resolver");
const { normalizeDisplayForOverlay } = require("./display-overlay-adapter");
const { TRACE_GRAPH_PROJECTION_VERSION, buildAndWriteTraceGraph, buildTraceGraphFromPlans, emptyTraceGraph } = require("./display-trace-graph");

const STAGE_NAME = "function.slot.restructure_display.materialize";
const INDEX_RELATIVE_PATH = path.join("Artifacts", "FunctionSlotRestructure", "_index", "confirmed-plan-displays.json");
const TRACE_GRAPH_RELATIVE_PATH = path.join("Artifacts", "FunctionSlotRestructure", "_projections", "confirmed-plan-trace.graph.json");
const GOVERNANCE_RELATIVE_PATH = path.join("Artifacts", "FunctionSlotLibrary", "_governance", "semantic-governance.v1.json");
const REQUIRED_KEYS = ["targetAssumption", "slotChain", "atoms", "scriptSegments", "rhythmCurve", "packagingProof"];
const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;

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
      const traceGraph = await buildAndWriteTraceGraph({ rootDir, index, now, readJsonIfExists, writeJson, traceGraphRelativePath: TRACE_GRAPH_RELATIVE_PATH, governanceRelativePath: GOVERNANCE_RELATIVE_PATH });
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

  async function registerDisplayJson({
    displayJsonPath,
    restructureFinalPath,
    sourceTurnId = null,
    parentArtifactId = null,
    confirmationId = null,
    traceContext,
  } = {}) {
    const startedAt = Date.now();
    const artifactId = `artifact_${randomUUID()}`;
    const inputSummary = {
      displayJsonPath: safeRelativePath(displayJsonPath),
      restructureFinalPath: safeRelativePath(restructureFinalPath),
      sourceTurnId: sourceTurnId ?? null,
      parentArtifactId: parentArtifactId ?? null,
      confirmationId: confirmationId ?? null,
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
      const absoluteDisplayJsonPath = resolveInsideRoot(displayJsonPath, rootDir);
      const stored = await readJsonIfExists(absoluteDisplayJsonPath);
      const rawDisplayJson = stored?.display ?? stored;
      const displayJson = normalizeDisplayForOverlay(rawDisplayJson);
      validateRestructureDisplayJson(displayJson);
      const sourceRestructurePath = normalizeRelativePath(restructureFinalPath)
        ?? normalizeRelativePath(stored?.sourceRestructurePath)
        ?? normalizeRelativePath(displayJson?.source?.restructureFinalPath)
        ?? inferRestructureFinalPathFromDisplayPath(displayJsonPath);
      const planId = inferPlanId({ restructureFinalPath: sourceRestructurePath, displayJson });
      const displayArtifact = await writeDisplayJson({
        displayJson,
        planId,
        restructureFinalPath: sourceRestructurePath,
        sourceTurnId: sourceTurnId ?? stored?.sourceTurnId ?? null,
        artifactId,
        parentArtifactId,
        confirmationId: confirmationId ?? stored?.confirmationId ?? null,
        traceContext,
      });
      const index = await upsertDisplayIndex(displayArtifact);
      const traceGraph = await buildAndWriteTraceGraph({ rootDir, index, now, readJsonIfExists, writeJson, traceGraphRelativePath: TRACE_GRAPH_RELATIVE_PATH, governanceRelativePath: GOVERNANCE_RELATIVE_PATH });
      const outputSummary = {
        artifactId,
        planId,
        displayJsonPath: safeRelativePath(displayArtifact.displayJsonPath),
        sourceRestructurePath,
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
        code: error.code ?? "restructure_display_register_failed",
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
    if (index?.plans?.length) return buildAndWriteTraceGraph({ rootDir, index, now, readJsonIfExists, writeJson, traceGraphRelativePath: TRACE_GRAPH_RELATIVE_PATH, governanceRelativePath: GOVERNANCE_RELATIVE_PATH });
    return emptyTraceGraph();
  }

  async function listPlanTraceRecords({ bucket = "recent" } = {}) {
    const records = await collectPlanTraceRecords();
    const cutoff = Date.now() - RECENT_WINDOW_MS;
    const normalizedBucket = bucket === "history" ? "history" : "recent";
    const filtered = records.filter((record) => {
      const updatedAtMs = Date.parse(record.updatedAt ?? "");
      const isRecent = Number.isFinite(updatedAtMs) && updatedAtMs >= cutoff;
      return normalizedBucket === "history" ? !isRecent : isRecent;
    });
    return {
      schemaVersion: "plan_trace_records.v1",
      bucket: normalizedBucket,
      generatedAt: now(),
      recentWindowHours: 24,
      records: filtered,
    };
  }

  async function readPlanTraceRecordGraph(recordId) {
    const records = await collectPlanTraceRecords();
    const record = records.find((item) => item.recordId === recordId);
    if (!record) return null;
    return buildRecordGraph(record);
  }

  async function previewPlanTraceGraph({ restructureFinalPath, displayJsonPath, sourceTurnId = null, parentArtifactId = null, confirmationId = null } = {}) {
    const record = await buildRecordFromInput({
      restructureFinalPath: normalizeRelativePath(restructureFinalPath) ?? inferRestructureFinalPathFromDisplayPath(displayJsonPath),
      displayJsonPath: normalizeRelativePath(displayJsonPath),
      sourceTurnId,
      parentArtifactId,
      confirmationId,
      status: "draft",
    });
    if (!record) return {
      schemaVersion: "plan_trace_preview.v1",
      ok: false,
      record: null,
      graph: emptyTraceGraph(),
      message: "未找到可预览的方案溯源输入",
    };
    return {
      schemaVersion: "plan_trace_preview.v1",
      ok: true,
      record,
      graph: await buildRecordGraph(record, { artifactId: `plan-trace-preview:${record.recordId}` }),
    };
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

  async function collectPlanTraceRecords() {
    const baseDir = path.join(rootDir, "Artifacts", "FunctionSlotRestructure");
    const legacyIndex = await readJsonIfExists(path.join(rootDir, INDEX_RELATIVE_PATH));
    const legacyByPlanId = new Map(asArray(legacyIndex?.plans).map((plan) => [normalizeText(plan.planId), plan]));
    let entries = [];
    try {
      entries = await fs.readdir(baseDir, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return [];
      throw error;
    }
    const records = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith("_")) continue;
      const planDir = path.join(baseDir, entry.name);
      const restructureFinalPath = path.join(planDir, "restructure.final.md");
      if (!await pathExists(restructureFinalPath)) continue;
      const record = await buildRecordFromInput({
        restructureFinalPath: safeRelative(rootDir, restructureFinalPath),
        planSetId: entry.name,
        legacyPlan: legacyByPlanId.get(entry.name) ?? null,
        status: legacyByPlanId.has(entry.name) ? "confirmed" : "draft",
      });
      if (record) records.push(record);
    }
    return records.sort((left, right) => String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")));
  }

  async function buildRecordFromInput({
    restructureFinalPath,
    displayJsonPath = null,
    planSetId = null,
    legacyPlan = null,
    sourceTurnId = null,
    parentArtifactId = null,
    confirmationId = null,
    status = "draft",
  } = {}) {
    const absoluteRestructurePath = resolveInsideRoot(restructureFinalPath, rootDir);
    if (!absoluteRestructurePath || !await pathExists(absoluteRestructurePath)) return null;
    const inferredPlanSetId = planSetId ?? inferPlanSetIdFromPath(absoluteRestructurePath);
    const planVersions = await resolveStoryboardPlanVersions({
      rootDir,
      restructureFinalPath: safeRelative(rootDir, absoluteRestructurePath),
    });
    const isMultiVersion = planVersions.mode === "multi_version" && planVersions.versions.length > 1;
    const variants = [];
    for (const version of planVersions.versions) {
      const versionRestructurePath = resolveInsideRoot(version.restructureFinalPath, rootDir);
      if (!versionRestructurePath) continue;
      const versionDisplayPath = isMultiVersion
        ? path.join(path.dirname(versionRestructurePath), "restructure.display.json")
        : resolveOptionalInsideRoot(displayJsonPath, rootDir) ?? path.join(path.dirname(versionRestructurePath), "restructure.display.json");
      const displayExists = await pathExists(versionDisplayPath);
      variants.push({
        versionId: version.versionId ?? "default",
        versionName: version.versionName ?? version.versionId ?? "默认方案",
        sourceRestructurePath: safeRelative(rootDir, versionRestructurePath),
        displayJsonPath: displayExists ? safeRelative(rootDir, versionDisplayPath) : null,
        artifactId: legacyPlan?.artifactId ?? null,
        traceId: legacyPlan?.traceId ?? null,
        runId: legacyPlan?.runId ?? null,
        stageId: legacyPlan?.stageId ?? null,
      });
    }
    if (!variants.length) return null;
    const statTimes = [];
    statTimes.push(await fileMtimeMs(absoluteRestructurePath));
    for (const variant of variants) {
      statTimes.push(await fileMtimeMs(resolveInsideRoot(variant.sourceRestructurePath, rootDir)));
      if (variant.displayJsonPath) statTimes.push(await fileMtimeMs(resolveInsideRoot(variant.displayJsonPath, rootDir)));
    }
    const finiteTimes = statTimes.filter((value) => Number.isFinite(value));
    const updatedAtMs = finiteTimes.length ? Math.max(...finiteTimes) : Date.now();
    const recordId = safeSlug(inferredPlanSetId);
    return {
      schemaVersion: "plan_trace_record.v1",
      recordId,
      planSetId: inferredPlanSetId,
      title: displayRecordTitle(inferredPlanSetId, variants),
      mode: isMultiVersion ? "multiVersion" : "single",
      status,
      sourceTurnId: sourceTurnId ?? legacyPlan?.sourceTurnId ?? null,
      parentArtifactId: parentArtifactId ?? legacyPlan?.parentArtifactId ?? null,
      confirmationId: confirmationId ?? legacyPlan?.confirmationId ?? null,
      createdAt: new Date(updatedAtMs).toISOString(),
      updatedAt: new Date(updatedAtMs).toISOString(),
      variants,
    };
  }

  async function buildRecordGraph(record, { artifactId = null } = {}) {
    const plans = record.variants.map((variant) => ({
      planId: record.mode === "multiVersion" ? `${record.planSetId}--${variant.versionId}` : record.planSetId,
      label: variant.versionName,
      versionId: variant.versionId,
      versionName: variant.versionName,
      planSetId: record.planSetId,
      recordId: record.recordId,
      mode: record.mode,
      artifactId: variant.artifactId,
      parentArtifactId: record.parentArtifactId,
      confirmationId: record.confirmationId,
      sourceTurnId: record.sourceTurnId,
      sourceRestructurePath: variant.sourceRestructurePath,
      displayJsonPath: variant.displayJsonPath,
      traceId: variant.traceId,
      runId: variant.runId,
      stageId: variant.stageId,
      updatedAt: record.updatedAt,
    }));
    return buildTraceGraphFromPlans({
      rootDir,
      plans,
      now,
      readJsonIfExists,
      governanceRelativePath: GOVERNANCE_RELATIVE_PATH,
      artifactId: artifactId ?? `plan-trace-record:${record.recordId}`,
      readDisplayForPlan: async (plan) => readDisplayForTracePlan(plan),
    });
  }

  async function readDisplayForTracePlan(plan) {
    if (plan.displayJsonPath) {
      const stored = await readJsonIfExists(resolveInsideRoot(plan.displayJsonPath, rootDir));
      const display = normalizeDisplayForOverlay(stored?.display ?? stored);
      validateRestructureDisplayJson(display);
      return { display };
    }
    const restructurePath = resolveInsideRoot(plan.sourceRestructurePath, rootDir);
    if (!restructurePath) return null;
    const display = normalizeDisplayForOverlay(await transformRestructureFinalFile({
      inputPath: restructurePath,
      outputPath: null,
      restructureArtifactId: plan.artifactId ?? null,
    }));
    validateRestructureDisplayJson(display);
    return { display };
  }

  return {
    materializeFromTurn,
    registerDisplayJson,
    readConfirmedPlanTraceGraph,
    listPlanTraceRecords,
    readPlanTraceRecordGraph,
    previewPlanTraceGraph,
  };
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

function normalizeText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function safeSlug(value) {
  return String(value ?? "confirmed-plan").trim().replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "") || "confirmed-plan";
}

function normalizeRelativePath(filePath) {
  const text = String(filePath ?? "").trim();
  if (!text) return null;
  return text.replaceAll("\\", "/").replace(/^[A-Za-z]:\//, "");
}

function inferPlanSetIdFromPath(filePath) {
  const normalized = normalizeRelativePath(filePath);
  const parts = normalized.split(/[\\/]+/).filter(Boolean);
  const marker = parts.findIndex((part) => part === "FunctionSlotRestructure");
  return marker >= 0 && parts[marker + 1] ? safeSlug(parts[marker + 1]) : safeSlug(path.basename(path.dirname(filePath)));
}

function displayRecordTitle(planSetId, variants) {
  if (variants.length > 1) return `${planSetId} (${variants.length} 版本)`;
  return variants[0]?.versionName && variants[0].versionName !== "默认方案" ? variants[0].versionName : planSetId;
}

function inferRestructureFinalPathFromDisplayPath(displayJsonPath) {
  const normalized = normalizeRelativePath(displayJsonPath);
  if (!normalized) return null;
  return normalized.replace(/(^|\/)restructure\.display\.json$/i, "$1restructure.final.md");
}

function resolveInsideRoot(filePath, rootDir) {
  const relativePath = normalizeRelativePath(filePath);
  if (!relativePath) throw codedError("display_json_path_required", "displayJsonPath 不能为空");
  const resolved = path.resolve(rootDir, relativePath);
  const root = path.resolve(rootDir);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw codedError("display_json_path_outside_workspace", "displayJsonPath 必须位于工作区内");
  }
  return resolved;
}

function resolveOptionalInsideRoot(filePath, rootDir) {
  return normalizeRelativePath(filePath) ? resolveInsideRoot(filePath, rootDir) : null;
}

function safeRelative(rootDir, filePath) {
  return filePath ? path.relative(rootDir, path.resolve(filePath)).replaceAll(path.sep, "/") : null;
}

async function pathExists(filePath) {
  if (!filePath) return false;
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function fileMtimeMs(filePath) {
  if (!filePath) return Number.NaN;
  try {
    return (await fs.stat(filePath)).mtimeMs;
  } catch {
    return Number.NaN;
  }
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
