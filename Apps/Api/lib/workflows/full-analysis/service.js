const { randomUUID } = require("crypto");
const { createTraceContext } = require("../../../../../Core/Workspace/sample-video-contracts");
const { createTraceIds, nextStage } = require("../../../../../Infrastructure/Observability/trace");
const { loadCurrentSampleArtifact } = require("../../stores/artifact-reader");
const { FULL_ANALYSIS_WORKFLOW_DESCRIPTOR } = require("./descriptor");

const WORKFLOW_KEY = FULL_ANALYSIS_WORKFLOW_DESCRIPTOR.workflowId;
const WORKFLOW_VERSION = FULL_ANALYSIS_WORKFLOW_DESCRIPTOR.version;
const TERMINAL_JOB_STATUSES = new Set(["processed", "failed"]);
const CACHE_WAITING_STATUS = "cache_waiting";

function createFullAnalysisWorkflowService({
  workflowRunStore,
  service,
  shotBoundaryService,
  moduleRegistry,
  jobStore,
  logger,
  store,
  artifactIndex,
  loadSampleArtifact = loadCurrentSampleArtifact,
  pollIntervalMs = 2000,
}) {
  const timers = new Map();
  const workflowDescriptor = FULL_ANALYSIS_WORKFLOW_DESCRIPTOR;
  const stageDefinitions = resolveWorkflowStages(workflowDescriptor, moduleRegistry);
  const moduleStages = stageDefinitions.filter((stage) => stage.kind === "module");
  const structureAnalysisKeys = workflowDescriptor.parallelGroups["structure-analysis"] ?? [];
  const rerunnableStageKeys = new Set(workflowDescriptor.nodes.filter((node) => node.rerunnable).map((node) => node.key));
  const blockingStageKeys = new Set(stageDefinitions.filter((stage) => stage.blocking).map((stage) => stage.key));

  async function start({ workspaceId, file, fields = {} }) {
    const traceContext = createTraceContext(createTraceIds());
    const workflowRunId = `workflow_${randomUUID()}`;
    const now = new Date().toISOString();
    const cacheDecision = fields.cacheDecision === "refresh" ? "refresh" : "ask";
    const run = workflowRunStore.createRun({
      workflowRunId,
      workflowKey: WORKFLOW_KEY,
      workflowVersion: WORKFLOW_VERSION,
      cacheDecision,
      status: "running",
      traceId: traceContext.traceId,
      runId: traceContext.runId,
      sampleVideoId: null,
      currentStageKeys: ["upload"],
      stages: stageDefinitions.map((definition) => createStageState(definition)),
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      errorSummary: null,
    });
    await logWorkflowEvent(traceContext, "stage.start", "workflow.run", null, null, {
      workflowRunId,
      workflowKey: WORKFLOW_KEY,
      workflowVersion: WORKFLOW_VERSION,
    });
    await startStage(workflowRunId, "upload", {
      workspaceId,
      file,
      fields: {
        ...fields,
        cacheDecision,
      },
    }, traceContext);
    return publicRun(workflowRunStore.getRun(workflowRunId) ?? run);
  }

  function get(workflowRunId) {
    const run = workflowRunStore.getRun(workflowRunId);
    return run ? publicRun(run) : null;
  }

  function getLatest() {
    const runs = typeof workflowRunStore.listRuns === "function" ? workflowRunStore.listRuns() : [];
    const latest = runs
      .filter((run) => run?.workflowKey === WORKFLOW_KEY)
      .sort((a, b) => workflowRunTime(b) - workflowRunTime(a))[0];
    return latest ? publicRun(latest) : null;
  }

  async function rerunStage({ workflowRunId, stageKey }) {
    const run = workflowRunStore.getRun(workflowRunId);
    if (!run) return null;
    if (!rerunnableStageKeys.has(stageKey)) {
      const error = new Error("该步骤暂不支持重跑");
      error.statusCode = 400;
      error.code = "workflow_stage_rerun_unsupported";
      error.retryable = false;
      throw error;
    }
    if (!run.sampleVideoId) {
      const error = new Error("样例视频尚未生成，不能重跑后续步骤");
      error.statusCode = 400;
      error.code = "workflow_stage_not_ready";
      error.retryable = true;
      throw error;
    }
    const traceContext = { runId: run.runId, traceId: run.traceId, stageId: `stage_${randomUUID()}` };
    workflowRunStore.updateRun(workflowRunId, (current) => ({
      status: "running",
      currentStageKeys: [stageKey],
      stages: updateStage(current.stages, stageKey, (stage) => ({
        ...resetStageForRun(stage),
        attemptNo: stage.attemptNo + 1,
      })),
      completedAt: null,
      errorSummary: null,
    }));
    await startStage(workflowRunId, stageKey, { cacheDecision: "refresh" }, traceContext);
    scheduleAdvance(workflowRunId);
    return publicRun(workflowRunStore.getRun(workflowRunId));
  }

  async function startStage(workflowRunId, stageKey, input, traceContext) {
    const run = workflowRunStore.getRun(workflowRunId);
    if (!run) return null;
    const stage = findStage(run, stageKey);
    const stageContext = nextStage(traceContext);
    const startedAt = Date.now();
    workflowRunStore.updateRun(workflowRunId, (current) => ({
      currentStageKeys: unique([...(current.currentStageKeys ?? []), stageKey]),
      stages: updateStage(current.stages, stageKey, (currentStage) => ({
        ...currentStage,
        status: "running",
        stageId: stageContext.stageId,
        startedAt: new Date(startedAt).toISOString(),
        completedAt: null,
        errorSummary: null,
      })),
    }));
    await logWorkflowEvent(stageContext, "stage.start", stage.stageName, stage.artifactId, stage.parentArtifactId, summarizeStageInput(stageKey, input));
    try {
      const result = await executeStage(workflowRunId, stageKey, input);
      if (result?.terminal) {
        await markStageProcessed(workflowRunId, stageKey, result, stageContext, startedAt);
        scheduleAdvance(workflowRunId);
        return result;
      }
      workflowRunStore.updateRun(workflowRunId, (current) => ({
        stages: updateStage(current.stages, stageKey, (currentStage) => ({
          ...currentStage,
          childJobId: result.processingJobId,
          childTraceId: result.traceId ?? null,
          sampleVideoId: result.sampleVideoId ?? current.sampleVideoId ?? null,
          status: "running",
        })),
        sampleVideoId: result.sampleVideoId ?? current.sampleVideoId ?? null,
      }));
      scheduleAdvance(workflowRunId);
      return result;
    } catch (error) {
      await markStageFailed(workflowRunId, stageKey, error, stageContext, startedAt);
      throw error;
    }
  }

  async function executeStage(workflowRunId, stageKey, input) {
    const run = workflowRunStore.getRun(workflowRunId);
    if (!run) return null;
    if (stageKey === "upload") {
      const result = await service.enqueueUpload({
        workspaceId: input.workspaceId,
        file: input.file,
        fields: input.fields,
      });
      if (result.cacheHit && result.cachedItem?.sampleVideoId) {
        return {
          terminal: true,
          sampleVideoId: result.cachedItem.sampleVideoId,
          artifactId: result.cachedItem.artifactId ?? null,
          outputSummary: { cacheHit: true, sampleVideoId: result.cachedItem.sampleVideoId },
        };
      }
      return result;
    }
    if (stageKey === "shotBoundary") {
      return moduleRegistry.startModule({
        moduleId: "shot-boundary",
        sampleVideoId: run.sampleVideoId,
        body: {
          analysisFps: Number(input.analysisFps ?? 10),
          cacheDecision: input.cacheDecision ?? run.cacheDecision ?? "ask",
          enableReview: input.enableReview ?? true,
        },
      });
    }
    const moduleStage = findModuleStage(moduleStages, stageKey);
    if (moduleStage) {
      const artifact = await readArtifact(run.sampleVideoId);
      return moduleRegistry.startModule({
        moduleId: moduleStage.moduleId,
        sampleVideoId: run.sampleVideoId,
        body: {
          cacheDecision: input.cacheDecision ?? run.cacheDecision ?? "ask",
          dependencies: {
            shotBoundaryArtifactId: artifact?.shotBoundaryAnalysis?.artifactId ?? null,
          },
        },
      });
    }
    if (stageKey === "aggregate") {
      const artifact = await readArtifact(run.sampleVideoId);
      return {
        terminal: true,
        sampleVideoId: run.sampleVideoId,
        artifactId: artifact?.sampleVideo?.artifactId ?? null,
        outputSummary: buildAggregateSummary(artifact),
      };
    }
    const error = new Error("未知 workflow 步骤");
    error.code = "workflow_stage_unknown";
    error.statusCode = 400;
    error.retryable = false;
    throw error;
  }

  async function advance(workflowRunId) {
    const run = workflowRunStore.getRun(workflowRunId);
    if (!run || !["running", "partial_failed", CACHE_WAITING_STATUS].includes(run.status)) return;
    let changed = false;
    for (const stage of run.stages) {
      if (!stage.childJobId || !["running", "pending", CACHE_WAITING_STATUS].includes(stage.status)) continue;
      const job = jobStore.getJob(stage.childJobId);
      if (!job) continue;
      if (job.status === CACHE_WAITING_STATUS) {
        markStageCacheWaiting(workflowRunId, stage.key, job);
        changed = true;
        continue;
      }
      if (stage.status === CACHE_WAITING_STATUS && ["pending", "processing"].includes(job.status)) {
        markStageRunningFromJob(workflowRunId, stage.key, job);
        changed = true;
        continue;
      }
      if (!TERMINAL_JOB_STATUSES.has(job.status)) continue;
      const artifact = job.status === "processed" ? await readArtifact(job.sampleVideoId) : null;
      const artifactRef = artifactRefForStage(stage, artifact);
      if (job.status === "processed") {
        const traceContext = { runId: run.runId, traceId: run.traceId, stageId: stage.stageId ?? `stage_${randomUUID()}` };
        await markStageProcessed(workflowRunId, stage.key, {
          terminal: true,
          sampleVideoId: job.sampleVideoId,
          artifactId: artifactRef?.artifactId ?? null,
          parentArtifactId: artifactRef?.parentArtifactId ?? null,
          outputSummary: {
            childJobId: job.jobId,
            childTraceId: job.traceId,
            artifactId: artifactRef?.artifactId ?? null,
          },
        }, traceContext, Date.parse(stage.startedAt ?? new Date().toISOString()));
      } else {
        await markStageFailed(workflowRunId, stage.key, job.errorSummary ?? new Error("步骤执行失败"), {
          runId: run.runId,
          traceId: run.traceId,
          stageId: stage.stageId ?? `stage_${randomUUID()}`,
        }, Date.parse(stage.startedAt ?? new Date().toISOString()));
      }
      changed = true;
    }
    const latest = workflowRunStore.getRun(workflowRunId);
    if (!latest) return;
    await maybeStartNext(latest);
    const afterStart = workflowRunStore.getRun(workflowRunId);
    await finalizeIfReady(afterStart);
    if (changed || hasRunningChildren(workflowRunStore.getRun(workflowRunId))) scheduleAdvance(workflowRunId);
  }

  async function maybeStartNext(run) {
    const upload = findStage(run, "upload");
    const shot = findStage(run, "shotBoundary");
    const cacheDecision = run.cacheDecision ?? "ask";
    if (upload.status === "processed" && shot.status === "pending") {
      await startStage(run.workflowRunId, "shotBoundary", { cacheDecision }, {
        runId: run.runId,
        traceId: run.traceId,
        stageId: `stage_${randomUUID()}`,
      });
      return;
    }
    if (shot.status === "processed") {
      const pending = structureAnalysisKeys.filter((key) => findStage(run, key).status === "pending");
      await Promise.all(pending.map((key) => startStage(run.workflowRunId, key, { cacheDecision }, {
        runId: run.runId,
        traceId: run.traceId,
        stageId: `stage_${randomUUID()}`,
      })));
    }
    const latest = workflowRunStore.getRun(run.workflowRunId);
    if (!latest) return;
    const analysesDone = structureAnalysisKeys.every((key) => ["processed", "failed"].includes(findStage(latest, key).status));
    const aggregate = findStage(latest, "aggregate");
    if (analysesDone && aggregate.status === "pending") {
      await startStage(latest.workflowRunId, "aggregate", {}, {
        runId: latest.runId,
        traceId: latest.traceId,
        stageId: `stage_${randomUUID()}`,
      });
    }
  }

  function markStageCacheWaiting(workflowRunId, stageKey, job) {
    workflowRunStore.updateRun(workflowRunId, (current) => ({
      status: CACHE_WAITING_STATUS,
      currentStageKeys: unique([...(current.currentStageKeys ?? []).filter((key) => key !== stageKey), stageKey]),
      stages: updateStage(current.stages, stageKey, (stage) => ({
        ...stage,
        status: CACHE_WAITING_STATUS,
        childJobId: job.jobId ?? stage.childJobId ?? null,
        childTraceId: job.traceId ?? stage.childTraceId ?? null,
        sampleVideoId: job.sampleVideoId ?? stage.sampleVideoId ?? current.sampleVideoId ?? null,
        outputSummary: {
          ...(stage.outputSummary ?? {}),
          childJobId: job.jobId ?? null,
          childTraceId: job.traceId ?? null,
          cacheKind: job.cachePrompt?.cacheKind ?? null,
          cacheWaiting: true,
        },
      })),
    }));
  }

  function markStageRunningFromJob(workflowRunId, stageKey, job) {
    workflowRunStore.updateRun(workflowRunId, (current) => ({
      status: "running",
      currentStageKeys: unique([...(current.currentStageKeys ?? []).filter((key) => key !== stageKey), stageKey]),
      stages: updateStage(current.stages, stageKey, (stage) => ({
        ...stage,
        status: "running",
        childJobId: job.jobId ?? stage.childJobId ?? null,
        childTraceId: job.traceId ?? stage.childTraceId ?? null,
        sampleVideoId: job.sampleVideoId ?? stage.sampleVideoId ?? current.sampleVideoId ?? null,
        outputSummary: stage.outputSummary?.cacheWaiting
          ? { ...stage.outputSummary, cacheWaiting: false }
          : stage.outputSummary,
      })),
    }));
  }

  async function markStageProcessed(workflowRunId, stageKey, result, traceContext, startedAt = Date.now()) {
    const outputSummary = result.outputSummary ?? { sampleVideoId: result.sampleVideoId ?? null, artifactId: result.artifactId ?? null };
    workflowRunStore.updateRun(workflowRunId, (current) => ({
      sampleVideoId: result.sampleVideoId ?? current.sampleVideoId ?? null,
      currentStageKeys: (current.currentStageKeys ?? []).filter((key) => key !== stageKey),
      stages: updateStage(current.stages, stageKey, (stage) => ({
        ...stage,
        status: "processed",
        artifactId: result.artifactId ?? stage.artifactId ?? null,
        parentArtifactId: result.parentArtifactId ?? stage.parentArtifactId ?? null,
        outputSummary,
        completedAt: new Date().toISOString(),
        errorSummary: null,
      })),
    }));
    const stage = findStage(workflowRunStore.getRun(workflowRunId), stageKey);
    await logWorkflowEvent(traceContext, "stage.end", stage.stageName, stage.artifactId, stage.parentArtifactId, null, outputSummary, Date.now() - startedAt);
  }

  async function markStageFailed(workflowRunId, stageKey, error, traceContext, startedAt = Date.now()) {
    const safe = normalizeError(error, stageKey);
    const stage = findStage(workflowRunStore.getRun(workflowRunId), stageKey);
    const snapshot = await logger.writeDebugSnapshot({
      traceContext,
      stageName: stage.stageName,
      artifactId: stage.artifactId,
      parentArtifactId: stage.parentArtifactId,
      reason: safe.code,
      inputSummary: null,
      outputSummary: stage.outputSummary ?? null,
      debugPayload: {
        message: safe.message,
        childJobId: stage.childJobId ?? null,
        childTraceId: stage.childTraceId ?? null,
      },
    });
    const errorSummary = { ...safe, debugSnapshotUri: snapshot.uri };
    workflowRunStore.updateRun(workflowRunId, (current) => ({
      status: blockingStageKeys.has(stageKey) ? "failed" : "partial_failed",
      currentStageKeys: (current.currentStageKeys ?? []).filter((key) => key !== stageKey),
      stages: updateStage(current.stages, stageKey, (currentStage) => ({
        ...currentStage,
        status: "failed",
        completedAt: new Date().toISOString(),
        errorSummary,
      })),
      errorSummary,
    }));
    await logWorkflowEvent(traceContext, "stage.fail", stage.stageName, stage.artifactId, stage.parentArtifactId, null, stage.outputSummary ?? null, Date.now() - startedAt, errorSummary);
  }

  async function finalizeIfReady(run) {
    if (!run || !["running", "partial_failed", CACHE_WAITING_STATUS].includes(run.status)) return;
    const aggregate = findStage(run, "aggregate");
    const blockingFailed = Array.from(blockingStageKeys).some((key) => findStage(run, key).status === "failed");
    if (blockingFailed) {
      const completed = workflowRunStore.updateRun(run.workflowRunId, { status: "failed", completedAt: new Date().toISOString(), currentStageKeys: [] });
      await logWorkflowRunClosed(completed, "stage.fail");
      return;
    }
    if (aggregate.status !== "processed") return;
    const anyFailed = structureAnalysisKeys.some((key) => findStage(run, key).status === "failed");
    const completed = workflowRunStore.updateRun(run.workflowRunId, {
      status: anyFailed ? "partial_failed" : "processed",
      currentStageKeys: [],
      completedAt: new Date().toISOString(),
    });
    await logWorkflowRunClosed(completed, "stage.end");
  }

  function scheduleAdvance(workflowRunId, delayMs = pollIntervalMs) {
    if (timers.has(workflowRunId)) return;
    const timer = setTimeout(() => {
      timers.delete(workflowRunId);
      advance(workflowRunId).catch(() => undefined);
    }, delayMs);
    timer.unref?.();
    timers.set(workflowRunId, timer);
  }

  async function readArtifact(sampleVideoId) {
    if (!sampleVideoId) return null;
    return loadSampleArtifact({ sampleVideoId, store, artifactIndex });
  }

  async function logWorkflowEvent(traceContext, event, stageName, artifactId, parentArtifactId, inputSummary, outputSummary, durationMs, errorSummary) {
    await logger.writeStageLog({
      traceContext,
      event,
      stageName,
      artifactId: artifactId ?? null,
      parentArtifactId: parentArtifactId ?? null,
      inputSummary: inputSummary ?? null,
      outputSummary: outputSummary ?? null,
      durationMs: durationMs ?? null,
      errorSummary: errorSummary ?? null,
    });
  }

  async function logWorkflowRunClosed(run, event) {
    if (!run) return;
    const traceContext = { runId: run.runId, traceId: run.traceId, stageId: `stage_${randomUUID()}` };
    const outputSummary = {
      workflowRunId: run.workflowRunId,
      status: run.status,
      sampleVideoId: run.sampleVideoId ?? null,
      processedStageCount: run.stages.filter((stage) => stage.status === "processed").length,
      failedStageCount: run.stages.filter((stage) => stage.status === "failed").length,
    };
    await logWorkflowEvent(traceContext, event, "workflow.run", null, null, null, outputSummary, null, event === "stage.fail" ? run.errorSummary ?? null : null);
  }

  return { start, get, getLatest, rerunStage, advance };
}

function createStageState(definition) {
  return {
    ...definition,
    status: "pending",
    attemptNo: 1,
    stageId: null,
    childJobId: null,
    childTraceId: null,
    artifactId: null,
    parentArtifactId: null,
    sampleVideoId: null,
    inputSummary: null,
    outputSummary: null,
    errorSummary: null,
    startedAt: null,
    completedAt: null,
  };
}

function resetStageForRun(stage) {
  return {
    ...stage,
    status: "pending",
    stageId: null,
    childJobId: null,
    childTraceId: null,
    artifactId: null,
    parentArtifactId: null,
    inputSummary: null,
    outputSummary: null,
    errorSummary: null,
    startedAt: null,
    completedAt: null,
  };
}

function findStage(run, stageKey) {
  return run?.stages?.find((stage) => stage.key === stageKey) ?? createStageState({ key: stageKey, stageName: stageKey, label: stageKey, artifactKey: null });
}

function updateStage(stages, stageKey, update) {
  return stages.map((stage) => stage.key === stageKey ? update(stage) : stage);
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function summarizeStageInput(stageKey, input) {
  if (stageKey === "upload") {
    return {
      filename: input.file?.name ?? input.file?.filename ?? null,
      mimeType: input.file?.type ?? input.file?.mimeType ?? null,
      sizeBytes: input.file?.size ?? input.file?.buffer?.length ?? null,
      frameSampleRateFps: input.fields?.frameSampleRateFps ?? null,
      cacheDecision: input.fields?.cacheDecision ?? null,
    };
  }
  return { cacheDecision: input.cacheDecision ?? null };
}

function artifactRefForStage(stage, artifact) {
  if (!artifact) return null;
  return stage?.artifactKey ? artifact[stage.artifactKey] ?? null : null;
}

function buildAggregateSummary(artifact) {
  return {
    sampleVideoId: artifact?.sampleVideoId ?? null,
    shotCount: artifact?.shotBoundaryAnalysis?.shots?.length ?? 0,
    scriptSegmentCount: artifact?.scriptSegmentAnalysis?.segments?.length ?? 0,
    rhythmSectionCount: artifact?.rhythmStructureAnalysis?.sections?.length ?? 0,
    packagingBlockCount: artifact?.packagingStructureAnalysis?.packagingBlocks?.length ?? 0,
  };
}

function normalizeError(error, stageKey) {
  if (error?.code && error?.message) {
    return {
      code: error.code,
      message: String(error.message).slice(0, 240),
      stageName: stageKey,
      retryable: typeof error.retryable === "boolean" ? error.retryable : true,
    };
  }
  return {
    code: "workflow_stage_failed",
    message: error instanceof Error ? error.message.slice(0, 240) : "workflow 步骤失败",
    stageName: stageKey,
    retryable: true,
  };
}

function hasRunningChildren(run) {
  return Boolean(run?.stages?.some((stage) => stage.childJobId && ["pending", "running", CACHE_WAITING_STATUS].includes(stage.status)));
}

function workflowRunTime(run) {
  const timestamp = Date.parse(run?.updatedAt ?? run?.createdAt ?? "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function publicRun(run) {
  return {
    workflowRunId: run.workflowRunId,
    workflowKey: run.workflowKey,
    workflowVersion: run.workflowVersion,
    cacheDecision: run.cacheDecision ?? "ask",
    status: run.status,
    traceId: run.traceId,
    runId: run.runId,
    sampleVideoId: run.sampleVideoId,
    currentStageKeys: run.currentStageKeys ?? [],
    stages: run.stages,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    completedAt: run.completedAt ?? null,
    errorSummary: run.errorSummary ?? null,
  };
}

module.exports = {
  WORKFLOW_KEY,
  WORKFLOW_VERSION,
  FULL_ANALYSIS_WORKFLOW_DESCRIPTOR,
  createFullAnalysisWorkflowService,
};

function resolveWorkflowStages(workflowDescriptor, moduleRegistry) {
  return workflowDescriptor.nodes.map((node) => {
    if (node.kind === "module") {
      const module = moduleRegistry?.getByModuleId?.(node.moduleId);
      return {
        key: node.key,
        kind: node.kind,
        moduleId: node.moduleId,
        stageName: module?.ui?.stageId ?? node.stageName ?? node.key,
        label: module?.ui?.displayName ?? module?.ui?.label ?? node.label ?? node.key,
        artifactKey: module?.artifact?.key ?? node.artifactKey ?? null,
        after: node.after ?? [],
        parallelGroup: node.parallelGroup ?? null,
        blocking: Boolean(node.blocking),
      };
    }
    return {
      key: node.key,
      kind: node.kind,
      stageName: node.stageName ?? node.key,
      label: node.label ?? node.key,
      artifactKey: node.artifactKey ?? null,
      after: node.after ?? [],
      parallelGroup: node.parallelGroup ?? null,
      blocking: Boolean(node.blocking),
    };
  });
}

function findModuleStage(moduleStageDefinitions, stageKey) {
  return moduleStageDefinitions.find((stage) => stage.key === stageKey) ?? null;
}
