const COMMAND_RESULT_SCHEMA_VERSION = "platform_command_result.v1";

function createCommandDispatcher({
  workflowRunStore = null,
  jobStore = null,
  fullAnalysisWorkflowService = null,
  materialRecognitionWorkflowService = null,
  moduleRegistry = null,
  shotBoundaryService = null,
  activeTurnRuntime = null,
  rootDir = null,
  agentConversationStore = null,
} = {}) {
  async function execute(request = {}) {
    const command = normalizeText(request.command);
    if (command === "workflow.stage.rerun") return rerunWorkflowStage(request);
    if (command === "sample.full_analysis.refresh") return refreshSampleFullAnalysis(request);
    if (command === "job.cache.resolve") return resolveJobCache(request);
    if (command === "agent.turn.stop") return stopActiveTurn(request);
    if (command === "conversation.archive") return archiveConversation(request);
    throw commandError("platform_command_unsupported", "platform command 暂不支持", 400, false, { command });
  }

  async function rerunWorkflowStage(request) {
    const target = normalizeTarget(request.target);
    const stageKey = normalizeText(request.options?.stageKey);
    if (target.resourceKind !== "workflowRun" || !target.resourceId) {
      throw commandError("platform_command_target_invalid", "workflow.stage.rerun 需要 workflowRun target", 400, false, { target });
    }
    if (!stageKey) {
      throw commandError("platform_command_input_invalid", "workflow.stage.rerun 需要 options.stageKey", 400, false, { target });
    }
    const storedRun = workflowRunStore?.getRun?.(target.resourceId) ?? null;
    if (!storedRun) {
      throw commandError("workflow_run_not_found", "未找到 workflow run", 404, false, { target });
    }
    const service = storedRun.workflowKey === "material-recognition"
      ? materialRecognitionWorkflowService
      : fullAnalysisWorkflowService;
    if (!service?.rerunStage) {
      throw commandError("workflow_service_unavailable", "workflow service 不可用", 503, true, { workflowKey: storedRun.workflowKey ?? null });
    }
    const run = await service.rerunStage({ workflowRunId: target.resourceId, stageKey });
    if (!run) {
      throw commandError("workflow_run_not_found", "未找到 workflow run", 404, false, { target });
    }
    const stage = Array.isArray(run.stages) ? run.stages.find((item) => item.key === stageKey) : null;
    return {
      schemaVersion: COMMAND_RESULT_SCHEMA_VERSION,
      ok: true,
      command: "workflow.stage.rerun",
      target,
      status: run.status ?? null,
      runId: run.runId ?? null,
      traceId: run.traceId ?? null,
      stageId: stage?.stageId ?? null,
      artifactId: stage?.artifactId ?? null,
      parentArtifactId: stage?.parentArtifactId ?? null,
      resourceRefs: [target],
      errorSummary: null,
    };
  }

  async function refreshSampleFullAnalysis(request) {
    const target = normalizeTarget(request.target);
    if (target.resourceKind !== "sample" || !target.resourceId) {
      throw commandError("platform_command_target_invalid", "sample.full_analysis.refresh 需要 sample target", 400, false, { target });
    }
    if (!fullAnalysisWorkflowService?.startFromSample) {
      throw commandError("workflow_service_unavailable", "workflow service 不可用", 503, true, { target });
    }
    const run = await fullAnalysisWorkflowService.startFromSample({ sampleVideoId: target.resourceId });
    return commandResult({
      command: "sample.full_analysis.refresh",
      target,
      status: run.status ?? null,
      runId: run.runId ?? null,
      traceId: run.traceId ?? null,
      stageId: latestStageId(run),
      artifactId: latestStageArtifactId(run),
      parentArtifactId: null,
      resourceRefs: [
        target,
        { resourceKind: "workflowRun", resourceId: run.workflowRunId ?? null },
      ],
    });
  }

  async function archiveConversation(request) {
    const target = normalizeTarget(request.target);
    if (target.resourceKind !== "conversation" || !target.resourceId) {
      throw commandError("platform_command_target_invalid", "conversation.archive 需要 conversation target", 400, false, { target });
    }
    if (!agentConversationStore?.archive) {
      throw commandError("conversation_store_unavailable", "conversation store 不可用", 503, true, { target });
    }
    const expectedRevision = request.expectedRevision ?? request.options?.expectedRevision ?? null;
    const conversation = await agentConversationStore.archive(target.resourceId, { expectedRevision });
    if (!conversation) {
      throw commandError("conversation_not_found", "未找到 conversation", 404, false, { target });
    }
    return {
      schemaVersion: COMMAND_RESULT_SCHEMA_VERSION,
      ok: true,
      command: "conversation.archive",
      target,
      status: conversation.status ?? null,
      runId: conversation.runId ?? null,
      traceId: conversation.traceId ?? null,
      stageId: conversation.stageId ?? null,
      artifactId: conversation.confirmedPlan?.displayArtifact?.artifactId ?? conversation.confirmedPlan?.storyboardArtifact?.artifactId ?? null,
      parentArtifactId: null,
      resourceRefs: [target],
      errorSummary: null,
    };
  }

  async function resolveJobCache(request) {
    const target = normalizeTarget(request.target);
    const decision = normalizeText(request.options?.decision);
    if (target.resourceKind !== "job" || !target.resourceId) {
      throw commandError("platform_command_target_invalid", "job.cache.resolve 需要 job target", 400, false, { target });
    }
    if (!["reuse", "refresh"].includes(decision)) {
      throw commandError("platform_command_input_invalid", "job.cache.resolve 需要 options.decision 为 reuse 或 refresh", 400, false, { target, decision });
    }
    const job = jobStore?.getJob?.(target.resourceId) ?? null;
    if (!job) {
      throw commandError("job_not_found", "未找到 job", 404, false, { target });
    }
    const cacheKind = job.cachePrompt?.cacheKind ?? inferCacheKindFromJob(job);
    let result = null;
    if (moduleRegistry?.resolveModuleCacheDecision) {
      result = await moduleRegistry.resolveModuleCacheDecision({ cacheKind, jobId: target.resourceId, decision });
    }
    if (!result && shotBoundaryService?.resolveCacheDecision) {
      result = await shotBoundaryService.resolveCacheDecision({ jobId: target.resourceId, decision });
    }
    if (!result) {
      throw commandError("job_cache_resolver_unavailable", "job cache decision resolver 不可用", 503, true, { target, cacheKind });
    }
    const nextJob = result.jobId ? result : jobStore?.getJob?.(target.resourceId) ?? result;
    await advanceWorkflowRunsForJob(target.resourceId);
    return commandResult({
      command: "job.cache.resolve",
      target,
      status: nextJob.status ?? result.status ?? null,
      runId: nextJob.runId ?? result.runId ?? null,
      traceId: nextJob.traceId ?? result.traceId ?? null,
      stageId: nextJob.stageId ?? result.stageId ?? null,
      artifactId: nextJob.artifactId ?? result.artifactId ?? null,
      parentArtifactId: nextJob.parentArtifactId ?? result.parentArtifactId ?? null,
      resourceRefs: [target],
    });
  }

  async function advanceWorkflowRunsForJob(jobId) {
    const runs = typeof workflowRunStore?.listRuns === "function" ? workflowRunStore.listRuns() : [];
    const matched = runs.filter((run) => runHasChildJob(run, jobId));
    for (const run of matched) {
      const service = run.workflowKey === "material-recognition"
        ? materialRecognitionWorkflowService
        : fullAnalysisWorkflowService;
      await service?.advance?.(run.workflowRunId)?.catch?.(() => undefined);
    }
  }

  async function stopActiveTurn(request) {
    const target = normalizeTarget(request.target);
    if (target.resourceKind !== "activeTurn" || !target.resourceId) {
      throw commandError("platform_command_target_invalid", "agent.turn.stop 需要 activeTurn target", 400, false, { target });
    }
    if (!activeTurnRuntime?.getByBindingId || !activeTurnRuntime?.cancel) {
      throw commandError("active_turn_runtime_unavailable", "active turn runtime 不可用", 503, true, { target });
    }
    const binding = await activeTurnRuntime.getByBindingId(target.resourceId) ?? await activeTurnRuntime.getByTurnId?.(target.resourceId) ?? null;
    if (!binding) {
      throw commandError("active_turn_not_found", "未找到 active turn", 404, false, { target });
    }
    if (request.options?.turnId && String(request.options.turnId) !== String(binding.turnId)) {
      throw commandError("active_turn_mismatch", "active turn 与 turnId 不匹配", 409, false, { target, turnId: binding.turnId });
    }
    const result = await activeTurnRuntime.cancel({
      workspaceRoot: request.options?.workspaceRoot ?? binding.workspaceRoot ?? rootDir,
      threadId: binding.threadId,
      turnId: binding.turnId,
      timeoutSeconds: 30,
      traceContext: {
        runId: binding.runId ?? `platform_active_turn_stop_${Date.now()}`,
        traceId: binding.traceId ?? `trace_platform_active_turn_stop_${Date.now()}`,
        stageId: binding.stageId ?? `stage_platform_active_turn_stop_${Date.now()}`,
      },
    });
    return commandResult({
      command: "agent.turn.stop",
      target: { resourceKind: "activeTurn", resourceId: binding.bindingId ?? target.resourceId },
      status: result.status ?? "canceled",
      runId: binding.runId ?? null,
      traceId: binding.traceId ?? null,
      stageId: binding.stageId ?? null,
      artifactId: binding.artifactId ?? null,
      parentArtifactId: binding.parentArtifactId ?? null,
      resourceRefs: [{ resourceKind: "activeTurn", resourceId: binding.bindingId ?? target.resourceId }],
    });
  }

  return {
    schemaVersion: COMMAND_RESULT_SCHEMA_VERSION,
    execute,
  };
}

function commandResult({ command, target, status, runId, traceId, stageId, artifactId, parentArtifactId, resourceRefs }) {
  return {
    schemaVersion: COMMAND_RESULT_SCHEMA_VERSION,
    ok: true,
    command,
    target,
    status: status ?? null,
    runId: runId ?? null,
    traceId: traceId ?? null,
    stageId: stageId ?? null,
    artifactId: artifactId ?? null,
    parentArtifactId: parentArtifactId ?? null,
    resourceRefs: Array.isArray(resourceRefs) ? resourceRefs : [target],
    errorSummary: null,
  };
}

function inferCacheKindFromJob(job) {
  const stage = String(job?.stage ?? "");
  if (stage.startsWith("shot.") || stage.startsWith("shot_boundary") || job?.cachePrompt?.cachedItem?.tags?.includes("切镜")) return "shot_boundary";
  return null;
}

function runHasChildJob(run, jobId) {
  if (!jobId || !Array.isArray(run?.stages)) return false;
  return run.stages.some((stage) => stage?.childJobId === jobId);
}

function latestStageArtifactId(run) {
  return [...(run?.stages ?? [])].reverse().find((stage) => normalizeText(stage?.artifactId))?.artifactId ?? null;
}

function latestStageId(run) {
  return [...(run?.stages ?? [])].reverse().find((stage) => normalizeText(stage?.stageId))?.stageId ?? null;
}

function normalizeTarget(target) {
  return {
    resourceKind: normalizeText(target?.resourceKind),
    resourceId: normalizeText(target?.resourceId),
  };
}

function commandError(code, message, statusCode = 400, retryable = false, debugPayload = null) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  error.retryable = retryable;
  error.debugPayload = debugPayload;
  return error;
}

function normalizeText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

module.exports = {
  COMMAND_RESULT_SCHEMA_VERSION,
  createCommandDispatcher,
  commandError,
};
