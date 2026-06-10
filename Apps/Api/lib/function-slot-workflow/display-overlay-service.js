const path = require("path");
const { randomUUID } = require("crypto");
const { createDisplayOverlayRecords } = require("./display-overlay-records");
const { normalizeDisplayForOverlay } = require("./display-overlay-adapter");
const { TRACE_GRAPH_PROJECTION_VERSION, buildAndWriteTraceGraph, emptyTraceGraph } = require("./display-trace-graph");
const {
  REQUIRED_KEYS,
  inferPlanId,
  inferRestructureFinalPathFromDisplayPath,
  normalizeRelativePath,
  parseDisplayTransformerFinalMessage,
  readJsonIfExists,
  resolveInsideRoot,
  safeRelative,
  safeRelativePath,
  safePreview,
  validateRestructureDisplayJson,
  writeJson,
} = require("./display-overlay-utils");

const STAGE_NAME = "function.slot.restructure_display.materialize";
const INDEX_RELATIVE_PATH = path.join("Artifacts", "FunctionSlotRestructure", "_index", "confirmed-plan-displays.json");
const TRACE_GRAPH_RELATIVE_PATH = path.join("Artifacts", "FunctionSlotRestructure", "_projections", "confirmed-plan-trace.graph.json");
const GOVERNANCE_RELATIVE_PATH = path.join("Artifacts", "FunctionSlotLibrary", "_governance", "semantic-governance.v1.json");

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

  const recordActions = createDisplayOverlayRecords({ rootDir, now, governanceRelativePath: GOVERNANCE_RELATIVE_PATH });

  return {
    materializeFromTurn,
    registerDisplayJson,
    readConfirmedPlanTraceGraph,
    listPlanTraceRecords: recordActions.listPlanTraceRecords,
    readPlanTraceRecordGraph: recordActions.readPlanTraceRecordGraph,
    previewPlanTraceGraph: recordActions.previewPlanTraceGraph,
  };
}

module.exports = {
  REQUIRED_KEYS,
  STAGE_NAME,
  createRestructureDisplayOverlayService,
  parseDisplayTransformerFinalMessage,
  validateRestructureDisplayJson,
};
