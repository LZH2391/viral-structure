const { createTraceIds } = require("../../../../Infrastructure/Observability/trace");
const { readJsonBody } = require("../observability/ui-debug-events");
const { sendJson, notFound } = require("./utils");

async function handleConfirmedPlanTraceGraph(res, handlers = {}) {
  const traceService = handlers.restructureDisplayOverlayService;
  if (!traceService?.readConfirmedPlanTraceGraph) {
    return sendJson(res, 503, {
      error: "confirmed_plan_trace_unavailable",
      code: "confirmed_plan_trace_unavailable",
      message: "确定方案溯源图服务不可用",
    });
  }
  return sendJson(res, 200, await traceService.readConfirmedPlanTraceGraph());
}

async function handlePlanTraceRecords(res, url, handlers = {}) {
  const traceService = handlers.restructureDisplayOverlayService;
  if (!traceService?.listPlanTraceRecords) {
    return sendJson(res, 503, {
      error: "plan_trace_records_unavailable",
      code: "plan_trace_records_unavailable",
      message: "方案溯源记录服务不可用",
    });
  }
  return sendJson(res, 200, await traceService.listPlanTraceRecords({ bucket: url.searchParams.get("bucket") }));
}

async function handlePlanTraceRecordGraph(res, recordId, handlers = {}) {
  const traceService = handlers.restructureDisplayOverlayService;
  if (!traceService?.readPlanTraceRecordGraph) {
    return sendJson(res, 503, {
      error: "plan_trace_record_graph_unavailable",
      code: "plan_trace_record_graph_unavailable",
      message: "方案溯源图服务不可用",
    });
  }
  const graph = await traceService.readPlanTraceRecordGraph(recordId);
  if (!graph) return notFound(res);
  return sendJson(res, 200, graph);
}

async function handlePlanTracePreview(req, res, handlers = {}) {
  const body = await (handlers.readJsonBodyImpl ?? readJsonBody)(req).catch(() => ({}));
  const traceService = handlers.restructureDisplayOverlayService;
  if (!traceService?.previewPlanTraceGraph) {
    return sendJson(res, 503, {
      error: "plan_trace_preview_unavailable",
      code: "plan_trace_preview_unavailable",
      message: "方案溯源预览服务不可用",
    });
  }
  const result = await traceService.previewPlanTraceGraph({
    restructureFinalPath: body.restructureFinalPath,
    displayJsonPath: body.displayJsonPath,
    sourceTurnId: body.sourceTurnId,
    parentArtifactId: body.parentArtifactId,
    confirmationId: body.confirmationId,
  });
  return sendJson(res, result.ok ? 200 : 422, result);
}

async function handleConfirmedPlanTraceRegister(req, res, handlers = {}) {
  const body = await (handlers.readJsonBodyImpl ?? readJsonBody)(req).catch(() => ({}));
  const traceService = handlers.restructureDisplayOverlayService;
  if (!traceService?.registerDisplayJson) {
    return sendJson(res, 503, {
      error: "confirmed_plan_trace_register_unavailable",
      code: "confirmed_plan_trace_register_unavailable",
      message: "确定方案溯源登记服务不可用",
    });
  }
  const traceContext = createTraceIds();
  const result = await traceService.registerDisplayJson({
    displayJsonPath: body.displayJsonPath,
    restructureFinalPath: body.restructureFinalPath,
    sourceTurnId: body.sourceTurnId,
    parentArtifactId: body.parentArtifactId,
    confirmationId: body.confirmationId,
    traceContext,
  });
  return sendJson(res, result.ok ? 200 : 422, {
    ...result,
    traceId: traceContext.traceId,
    runId: traceContext.runId,
    stageId: traceContext.stageId,
  });
}

async function handleFunctionSlotGovernancePlanOverlays(res) {
  return sendJson(res, 410, {
    error: "governance_plan_overlay_removed",
    code: "governance_plan_overlay_removed",
    message: "治理图方案投影已解耦，请使用 /api/function-slot-restructure/confirmed-plan-trace/graph",
  });
}

module.exports = {
  handleConfirmedPlanTraceGraph,
  handlePlanTraceRecords,
  handlePlanTraceRecordGraph,
  handlePlanTracePreview,
  handleConfirmedPlanTraceRegister,
  handleFunctionSlotGovernancePlanOverlays,
};
