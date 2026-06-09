const { createTraceContext } = require("../../../../Core/Workspace/sample-video-contracts");
const { createTraceIds } = require("../../../../Infrastructure/Observability/trace");
const { sendJson, notFound } = require("./utils");
const { handleStoryboardPrepAutoRun } = require("./storyboard-prep-route");
const { readJsonBody } = require("../observability/ui-debug-events");
const { buildFunctionSlotLibraryGraph } = require("../function-slot-library/graph");
const { buildFunctionSlotGovernanceGraph } = require("../function-slot-library/governance-graph");

async function handleFunctionSlotRoute(req, res, url, handlers = {}) {
  if (req.method === "GET" && /^\/api\/function-slot-projection\/artifacts\/[^/]+$/.test(url.pathname)) { await handleFunctionSlotProjectionArtifact(res, decodeURIComponent(url.pathname.split("/").at(-1)), handlers); return true; }
  if (req.method === "DELETE" && /^\/api\/function-slot-projection\/artifacts\/[^/]+$/.test(url.pathname)) { await handleFunctionSlotProjectionDelete(res, decodeURIComponent(url.pathname.split("/").at(-1)), handlers); return true; }
  if (req.method === "GET" && url.pathname.startsWith("/api/function-slot-projection/")) { await handleFunctionSlotProjectionQuery(res, url, handlers); return true; }
  if (req.method === "GET" && url.pathname === "/api/function-slot-library") { await handleFunctionSlotLibraryList(res, handlers); return true; }
  if (req.method === "GET" && url.pathname === "/api/function-slot-library/replacement-candidates") { await handleFunctionSlotReplacementCandidates(res, url, handlers); return true; }
  if (req.method === "GET" && url.pathname === "/api/function-slot-library/governance/graph") { await handleFunctionSlotGovernanceGraph(res, handlers); return true; }
  if (req.method === "GET" && url.pathname === "/api/function-slot-library/governance/scheduler-state") { await handleFunctionSlotGovernanceSchedulerState(res, handlers); return true; }
  if (req.method === "POST" && url.pathname === "/api/function-slot-library/governance/run") { await handleFunctionSlotGovernanceRun(req, res, handlers); return true; }
  if (req.method === "GET" && url.pathname === "/api/function-slot-restructure/plan-trace/records") { await handlePlanTraceRecords(res, url, handlers); return true; }
  if (req.method === "GET" && /^\/api\/function-slot-restructure\/plan-trace\/records\/[^/]+\/graph$/.test(url.pathname)) { await handlePlanTraceRecordGraph(res, decodeURIComponent(url.pathname.split("/").at(-2)), handlers); return true; }
  if (req.method === "POST" && url.pathname === "/api/function-slot-restructure/plan-trace/preview") { await handlePlanTracePreview(req, res, handlers); return true; }
  if (req.method === "GET" && url.pathname === "/api/function-slot-restructure/confirmed-plan-trace/graph") { await handleConfirmedPlanTraceGraph(res, handlers); return true; }
  if (req.method === "POST" && url.pathname === "/api/function-slot-restructure/confirmed-plan-trace/register") { await handleConfirmedPlanTraceRegister(req, res, handlers); return true; }
  if (req.method === "GET" && url.pathname === "/api/function-slot-governance/plan-overlays") { await handleFunctionSlotGovernancePlanOverlays(res); return true; }
  if (req.method === "POST" && url.pathname === "/api/function-slot-library/builder/refresh") { await handleFunctionSlotLibraryBuilderRefresh(req, res, handlers); return true; }
  if (req.method === "GET" && /^\/api\/function-slot-library\/[^/]+\/graph$/.test(url.pathname)) { await handleFunctionSlotLibraryGraph(res, decodeURIComponent(url.pathname.split("/").at(-2)), handlers); return true; }
  if (req.method === "POST" && /^\/api\/function-slot-library\/[^/]+\/project$/.test(url.pathname)) { await handleFunctionSlotLibraryProject(res, decodeURIComponent(url.pathname.split("/").at(-2)), handlers); return true; }
  if (req.method === "DELETE" && /^\/api\/function-slot-library\/[^/]+$/.test(url.pathname)) { await handleFunctionSlotLibraryDelete(res, decodeURIComponent(url.pathname.split("/").at(-1)), handlers); return true; }
  if (req.method === "POST" && /^\/api\/function-slot-workflow\/[^/]+\/run$/.test(url.pathname)) { await handleFunctionSlotWorkflowPlaceholder(req, res, decodeURIComponent(url.pathname.split("/").at(-2)), handlers); return true; }
  if (req.method === "POST" && url.pathname === "/api/function-slot-workflow/storyboard-prep/auto-run") { await handleStoryboardPrepAutoRun(req, res, handlers); return true; }
  if (req.method === "POST" && /^\/api\/sample-videos\/[^/]+\/function-slot-projection$/.test(url.pathname)) { await handleFunctionSlotProjectionProjectSample(res, decodeURIComponent(url.pathname.split("/").at(-2)), url, handlers); return true; }
  if (req.method === "POST" && /^\/api\/sample-videos\/[^/]+\/function-slot-library\/export$/.test(url.pathname)) { await handleFunctionSlotLibraryExport(res, decodeURIComponent(url.pathname.split("/").at(-3)), url, handlers); return true; }
  if (req.method === "POST" && /^\/api\/sample-videos\/[^/]+\/function-slot-atomization\/manual-boundary-edit$/.test(url.pathname)) { await handleFunctionSlotAtomizationManualBoundaryEdit(req, res, decodeURIComponent(url.pathname.split("/").at(-3)), handlers); return true; }
  return false;
}

async function handleFunctionSlotProjectionQuery(res, url, handlers = {}) {
  const service = handlers.functionSlotProjectionService;
  const resource = url.pathname.split("/").at(-1);
  const filters = Object.fromEntries(url.searchParams.entries());
  if (resource === "slots") return sendJson(res, 200, { items: await service.querySlots(filters) });
  if (resource === "atoms") return sendJson(res, 200, { items: await service.queryAtoms(filters) });
  if (resource === "bindings") return sendJson(res, 200, { items: await service.queryBindings(filters) });
  if (resource === "rules") return sendJson(res, 200, { items: await service.queryRules(filters) });
  return notFound(res);
}

async function handleFunctionSlotProjectionArtifact(res, artifactId, handlers = {}) {
  const service = handlers.functionSlotProjectionService;
  const summary = await service.getArtifactProjectionSummary(artifactId);
  if (!summary) return notFound(res);
  return sendJson(res, 200, { exists: true, ...summary });
}

async function handleFunctionSlotProjectionProjectSample(res, sampleVideoId, url, handlers = {}) {
  const service = handlers.functionSlotProjectionService;
  const mode = url.searchParams.get("mode") === "skip-existing" ? "skip-existing" : "replace";
  const summary = await service.projectSampleCurrentArtifact(sampleVideoId, { mode });
  if (!summary) {
    return sendJson(res, 404, {
      error: "function_slot_projection_source_missing",
      code: "function_slot_projection_source_missing",
      message: "样例不存在或没有功能槽位原子化 artifact",
    });
  }
  return sendJson(res, 200, summary);
}

async function handleFunctionSlotProjectionDelete(res, artifactId, handlers = {}) {
  const service = handlers.functionSlotProjectionService;
  const summary = await service.deleteArtifactProjection(artifactId);
  if (!summary) return notFound(res);
  return sendJson(res, 200, { deleted: true, ...summary });
}

async function handleFunctionSlotLibraryExport(res, sampleVideoId, url, handlers = {}) {
  const service = handlers.functionSlotLibraryService;
  const requestedMode = url.searchParams.get("mode");
  const mode = requestedMode ?? "replace";
  const result = await service.exportSampleArtifact(sampleVideoId, { mode });
  if (!result) {
    return sendJson(res, 404, {
      error: "function_slot_library_source_missing",
      code: "function_slot_library_source_missing",
      message: "样例不存在或没有功能槽位原子化 artifact",
    });
  }
  return sendJson(res, 200, result);
}

async function handleFunctionSlotLibraryList(res, handlers = {}) {
  const service = handlers.functionSlotLibraryService;
  return sendJson(res, 200, { items: await service.listLibraryItems() });
}

async function handleFunctionSlotReplacementCandidates(res, url, handlers = {}) {
  const service = handlers.functionSlotReplacementCandidateService;
  if (!service?.listCandidates) {
    return sendJson(res, 503, {
      error: "function_slot_replacement_candidates_unavailable",
      code: "function_slot_replacement_candidates_unavailable",
      message: "FunctionSlotLibrary replacement candidate 服务不可用",
    });
  }
  const result = await service.listCandidates({
    kind: url.searchParams.get("kind"),
    atomKind: url.searchParams.get("atomKind"),
    slotSubtypeId: url.searchParams.get("slotSubtypeId"),
    q: url.searchParams.get("q"),
    limit: url.searchParams.get("limit"),
  });
  return sendJson(res, 200, result);
}

async function handleFunctionSlotLibraryBuilderRefresh(req, res, handlers = {}) {
  const body = await (handlers.readJsonBodyImpl ?? readJsonBody)(req).catch(() => ({}));
  const service = handlers.functionSlotLibraryBuilderService;
  if (!service?.refresh) {
    return sendJson(res, 503, {
      error: "function_slot_library_builder_unavailable",
      code: "function_slot_library_builder_unavailable",
      message: "FunctionSlotLibrary builder 服务不可用",
    });
  }
  const result = await service.refresh({
    mode: body.mode === "replace" ? "replace" : "skip-existing",
    updateGovernance: body.updateGovernance !== false,
  });
  return sendJson(res, 200, result);
}

async function handleFunctionSlotGovernanceRun(req, res, handlers = {}) {
  const body = await (handlers.readJsonBodyImpl ?? readJsonBody)(req).catch(() => ({}));
  const service = handlers.functionSlotGovernanceService;
  if (!service?.enqueue) {
    return sendJson(res, 503, {
      error: "function_slot_governance_unavailable",
      code: "function_slot_governance_unavailable",
      message: "FunctionSlotLibrary 语义治理服务不可用",
    });
  }
  const result = await service.enqueue({
    refreshEvidence: body.refreshEvidence !== false,
  });
  return sendJson(res, 202, result);
}

async function handleFunctionSlotGovernanceSchedulerState(res, handlers = {}) {
  const scheduler = handlers.semanticGovernanceScheduler;
  if (!scheduler?.getState) {
    return sendJson(res, 503, {
      error: "function_slot_governance_scheduler_unavailable",
      code: "function_slot_governance_scheduler_unavailable",
      message: "FunctionSlotLibrary 自动语义治理调度服务不可用",
    });
  }
  return sendJson(res, 200, scheduler.getState());
}

async function startFunctionSlotAutoRunTurn({ handlers, role, stageName, sampleVideoId, parentArtifactId, body }) {
  const traceContext = createTraceContext(createTraceIds());
  const startedAt = Date.now();
  const job = handlers.jobStore?.createJob?.({ sampleVideoId, traceId: traceContext.traceId });
  const inputSummary = {
    role,
    sampleVideoId,
    parentArtifactId,
    restructureArtifactId: normalizeOptionalText(body.restructureArtifactId),
    restructureFinalPath: normalizeOptionalText(body.restructureFinalPath),
    confirmationId: normalizeOptionalText(body.confirmationId),
    trigger: "restructure-confirmed",
  };
  await handlers.logger.writeStageLog({
    traceContext,
    stageName,
    event: "stage.start",
    parentArtifactId,
    inputSummary,
  });
  let acquiredLease = null;
  let acquiredOwnerId = null;
  try {
    const readiness = await handlers.threadPool.ensureRoleReady(role);
    if (!readiness?.ok) throw codedWorkflowError(readiness?.error ?? "threadpool_role_unavailable", readiness?.message ?? "ThreadPool role 暂不可用", readiness);
    const ownerId = `${role}:${traceContext.traceId}`;
    acquiredOwnerId = ownerId;
    const lease = await handlers.threadPool.acquireLease({ role, ownerId });
    acquiredLease = lease;
    const threadId = lease.thread_id ?? lease.threadId ?? null;
    if (!threadId) throw codedWorkflowError("threadpool_lease_missing_thread", "ThreadPool lease 未返回 threadId", { leaseStatus: lease.status ?? null });
    const workspaceRoot = readiness.status?.workspaceRoot ?? handlers.rootDir;
    const skillPath = readiness.status?.skillPath ?? null;
    const turnInputs = buildFunctionSlotAutoRunInputs({ role, body: { ...body, sampleVideoId, parentArtifactId } });
    const activeTurnBinding = {
      ownerType: "processing-job",
      ownerId: job?.jobId ?? ownerId,
      currentAttemptId: job?.jobId ? `${job.jobId}:${traceContext.stageId}` : `${ownerId}:${traceContext.stageId}`,
      stageName,
      traceId: traceContext.traceId,
      runId: traceContext.runId,
      stageId: traceContext.stageId,
      artifactId: job?.jobId ?? null,
      parentArtifactId,
      leaseId: lease.lease_id ?? lease.leaseId ?? null,
      threadPoolOwnerId: ownerId,
      replayRef: {
        type: "processing-job-input",
        refId: job?.jobId ?? ownerId,
      },
    };
    const started = typeof handlers.activeTurnRuntime?.start === "function"
      ? await handlers.activeTurnRuntime.start({
          workspaceRoot,
          threadId,
          skillPath,
          inputs: turnInputs,
          timeoutSeconds: 240,
          binding: activeTurnBinding,
          enforceThreadId: true,
        })
      : await handlers.appServer.startTurnWithInputs({
          workspaceRoot,
          threadId,
          skillPath,
          inputs: turnInputs,
          timeoutSeconds: 240,
        });
    assertExpectedAutoRunThread(started, threadId);
    const artifactId = job?.jobId ?? started.turnId ?? started.turn?.id ?? null;
    const result = {
      ok: true,
      sampleVideoId,
      traceId: traceContext.traceId,
      runId: traceContext.runId,
      stageId: traceContext.stageId,
      artifactId,
      parentArtifactId,
      confirmationId: normalizeOptionalText(body.confirmationId),
      status: started.status ?? "submitted",
      role,
      threadId: started.threadId ?? threadId,
      turnId: artifactId,
      leaseId: lease.lease_id ?? lease.leaseId ?? null,
      ownerId,
      workspaceRoot,
      message: `${role} 已提交真实 ThreadPool turn。`,
    };
    await handlers.logger.writeStageLog({
      traceContext,
      stageName,
      event: "stage.end",
      artifactId,
      parentArtifactId,
      outputSummary: {
        role,
        status: result.status,
        threadId: result.threadId,
        turnId: result.turnId,
        leaseId: result.leaseId,
      },
      durationMs: Date.now() - startedAt,
    });
    if (job?.jobId) {
      handlers.jobStore.updateJob(job.jobId, {
        stage: stageName,
        status: "processing",
        progress: 15,
        runId: traceContext.runId,
        stageId: traceContext.stageId,
        artifactId,
        parentArtifactId,
        agentRun: {
          role,
          threadId: result.threadId,
          turnId: result.turnId,
          currentAttemptId: `${job.jobId}:${traceContext.stageId}`,
          leaseId: result.leaseId,
          ownerId,
          confirmationId: result.confirmationId,
          status: "turn_submitted",
          startedAt: new Date().toISOString(),
        },
        activeTurnReplay: {
          type: "function-slot-auto-run-input",
          inputs: turnInputs,
          sourceTurnId: result.turnId,
          createdAt: new Date().toISOString(),
        },
      });
      result.processingJobId = job.jobId;
    }
    return result;
  } catch (error) {
    await releaseAutoRunLeaseOnFailure({ handlers, lease: acquiredLease, ownerId: acquiredOwnerId });
    const safeError = {
      code: error?.code ?? "function_slot_auto_run_failed",
      message: safePreview(error instanceof Error ? error.message : "自动触发失败", 240),
      stageName,
      retryable: error?.statusCode ? error.statusCode >= 500 : true,
      debugSnapshotUri: null,
    };
    const snapshot = await handlers.logger.writeDebugSnapshot({
      traceContext,
      stageName,
      parentArtifactId,
      reason: safeError.code,
      inputSummary,
      debugPayload: {
        code: safeError.code,
        message: safeError.message,
        detail: summarizeErrorDebugPayload(error?.debugPayload ?? error?.payload ?? null),
      },
    });
    safeError.debugSnapshotUri = snapshot.uri;
    await handlers.logger.writeStageLog({
      traceContext,
      stageName,
      event: "stage.fail",
      parentArtifactId,
      errorSummary: safeError,
      durationMs: Date.now() - startedAt,
    });
    error.code = safeError.code;
    error.statusCode = error.statusCode ?? 503;
    error.debugSnapshotUri = snapshot.uri;
    throw error;
  }
}

function buildFunctionSlotAutoRunInputs({ role, body }) {
  const title = "请基于已确认的重组方案执行 Shot Storyboard Prep，并在生成 prompt 后继续触发 image-generation 故事板生图。";
  const payload = {
    trigger: "restructure-confirmed",
    restructureFinalPath: body.restructureFinalPath ?? null,
    restructureArtifactId: body.restructureArtifactId ?? null,
    parentArtifactId: body.parentArtifactId ?? null,
    confirmationId: body.confirmationId ?? null,
    sampleVideoId: body.sampleVideoId ?? null,
    runImageGeneration: body.runImageGeneration !== false,
  };
  return [{
    type: "text",
    text: `${title}\n\n输入摘要：\n${JSON.stringify(payload, null, 2)}`,
    text_elements: [],
  }];
}

function codedWorkflowError(code, message, debugPayload = null, statusCode = null) {
  const error = new Error(message);
  error.code = code;
  error.debugPayload = debugPayload;
  if (statusCode) error.statusCode = statusCode;
  return error;
}

function assertExpectedAutoRunThread(result, expectedThreadId) {
  const actualThreadId = normalizeOptionalText(result?.threadId ?? result?.thread?.id);
  const expected = normalizeOptionalText(expectedThreadId);
  if (!actualThreadId || !expected || actualThreadId === expected) return;
  throw codedWorkflowError("appserver_turn_start_thread_mismatch", "AppServer turn/start 返回了非目标 thread", {
    expectedThreadId: expected,
    actualThreadId,
    turnId: result?.turnId ?? result?.turn?.id ?? null,
    status: result?.status ?? null,
  }, 502);
}

async function releaseAutoRunLeaseOnFailure({ handlers, lease, ownerId }) {
  const leaseId = lease?.lease_id ?? lease?.leaseId ?? null;
  if (!leaseId || !ownerId || typeof handlers.threadPool?.releaseLease !== "function") return null;
  return handlers.threadPool.releaseLease({ leaseId, ownerId }).catch(() => null);
}

function normalizeOptionalText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeOptionalText).filter(Boolean);
}

function safePreview(value, limit = 240) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length <= limit ? text : `${text.slice(0, limit)}...`;
}

function summarizeErrorDebugPayload(value) {
  if (!value) return null;
  try {
    return safePreview(JSON.stringify(value), 500);
  } catch {
    return safePreview(value, 500);
  }
}

async function handleFunctionSlotLibraryProject(res, artifactId, handlers = {}) {
  const service = handlers.functionSlotLibraryService;
  const result = await service.projectLibraryArtifact(artifactId);
  if (!result) return notFound(res);
  return sendJson(res, 200, result);
}

async function handleFunctionSlotLibraryGraph(res, artifactId, handlers = {}) {
  const service = handlers.functionSlotLibraryService;
  const libraryArtifact = await service.readLibraryArtifact(artifactId);
  if (!libraryArtifact) return notFound(res);
  return sendJson(res, 200, buildFunctionSlotLibraryGraph(libraryArtifact));
}

async function handleFunctionSlotGovernanceGraph(res, handlers = {}) {
  const service = handlers.functionSlotLibraryService;
  const [governance, libraryItems] = await Promise.all([
    service.readSemanticGovernance(),
    typeof service.listLibraryItems === "function" ? service.listLibraryItems() : [],
  ]);
  if (!governance) return notFound(res);
  const libraryArtifacts = typeof service.readLibraryArtifact === "function"
    ? await Promise.all(libraryItems.map((item) => service.readLibraryArtifact(item.artifactId).catch(() => null)))
    : [];
  const graphLibraryItems = libraryItems.map((item, index) => ({ ...item, ...(libraryArtifacts[index] ?? {}) }));
  return sendJson(res, 200, buildFunctionSlotGovernanceGraph(governance, { libraryItems: graphLibraryItems }));
}

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

async function handleFunctionSlotLibraryDelete(res, artifactId, handlers = {}) {
  const service = handlers.functionSlotLibraryService;
  const result = await service.deleteLibraryItem(artifactId);
  if (!result) return notFound(res);
  return sendJson(res, 200, result);
}

async function handleFunctionSlotWorkflowPlaceholder(req, res, workflowKey, handlers = {}) {
  const body = await (handlers.readJsonBodyImpl ?? readJsonBody)(req).catch(() => ({}));
  const moduleId = resolveFunctionSlotWorkflowModuleId(workflowKey);
  if (!moduleId) {
    return sendJson(res, 404, {
      error: "function_slot_workflow_placeholder_not_found",
      code: "function_slot_workflow_placeholder_not_found",
      message: "未知功能槽位工作流占位入口",
    });
  }
  const result = await (handlers.moduleRegistry).startModule({
    moduleId,
    sampleVideoId: body.sampleVideoId ?? "function-slot-workflow",
    body,
  });
  return sendJson(res, 202, result);
}

function resolveFunctionSlotWorkflowModuleId(workflowKey) {
  if (workflowKey === "semantic-governance") return "function-slot-semantic-governance";
  if (workflowKey === "restructure") return "function-slot-restructure";
  if (workflowKey === "shot-storyboard-prep") return "shot-storyboard-prep";
  return null;
}

async function handleFunctionSlotAtomizationManualBoundaryEdit(req, res, sampleVideoId, handlers = {}) {
  const body = await (handlers.readJsonBodyImpl ?? readJsonBody)(req);
  const service = handlers.functionSlotAtomizationManualEditService;
  if (!service?.applyBoundaryManualEdit) {
    return sendJson(res, 503, {
      error: "function_slot_atomization_manual_edit_unavailable",
      code: "function_slot_atomization_manual_edit_unavailable",
      message: "功能槽位原子化手动修正服务不可用",
    });
  }
  const result = await service.applyBoundaryManualEdit({
    sampleVideoId,
    editedJsonText: body.editedJsonText ?? body.jsonText ?? null,
    editedJson: body.editedJson ?? null,
    expectedArtifactId: body.expectedArtifactId ?? null,
    sourceBoundaryReviewArtifactId: body.sourceBoundaryReviewArtifactId ?? null,
  });
  return sendJson(res, 200, result);
}


module.exports = { handleFunctionSlotRoute };
