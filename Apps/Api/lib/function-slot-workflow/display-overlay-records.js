const fs = require("fs/promises");
const path = require("path");
const { transformRestructureFinalFile } = require("../../../../Infrastructure/FunctionSlotRestructureDisplay/markdown-transformer");
const { resolveStoryboardPlanVersions } = require("../agent-chat/storyboard-version-resolver");
const { normalizeDisplayForOverlay } = require("./display-overlay-adapter");
const { buildTraceGraphFromPlans, emptyTraceGraph } = require("./display-trace-graph");
const {
  asArray,
  displayRecordTitle,
  fileMtimeMs,
  inferPlanSetIdFromPath,
  inferRestructureFinalPathFromDisplayPath,
  normalizeRelativePath,
  normalizeText,
  pathExists,
  readJsonIfExists,
  resolveInsideRoot,
  resolveOptionalInsideRoot,
  safeRelative,
  safeSlug,
  validateRestructureDisplayJson,
} = require("./display-overlay-utils");

const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;

function createDisplayOverlayRecords({ rootDir, now, governanceRelativePath }) {
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

  async function collectPlanTraceRecords() {
    const baseDir = path.join(rootDir, "Artifacts", "FunctionSlotRestructure");
    const legacyIndex = await readJsonIfExists(path.join(rootDir, "Artifacts", "FunctionSlotRestructure", "_index", "confirmed-plan-displays.json"));
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
      governanceRelativePath,
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
    listPlanTraceRecords,
    previewPlanTraceGraph,
    readPlanTraceRecordGraph,
  };
}

module.exports = {
  createDisplayOverlayRecords,
};
