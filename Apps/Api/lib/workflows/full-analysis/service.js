const { randomUUID } = require("crypto");
const { createTraceContext } = require("../../../../../Core/Workspace/sample-video-contracts");
const { createTraceIds, nextStage } = require("../../../../../Infrastructure/Observability/trace");
const { loadCurrentSampleArtifact } = require("../../stores/artifact-reader");
const { createWorkflowCancellation } = require("./service-cancellation");
const { buildWorkflowContext } = require("./service-context");
const { FULL_ANALYSIS_WORKFLOW_DESCRIPTOR } = require("./descriptor");
const { createWorkflowLogger } = require("./logging");
const { createWorkflowRunControl } = require("./service-run-control");
const { createUploadRerunBuilder } = require("./service-upload-rerun");
const {
  artifactRefForStage,
  buildAggregateSummary,
  buildModuleDependencies,
  createStageState,
  downstreamStageKeys,
  findModuleStage,
  findStage,
  hasStage, hasTerminalRunWithRunningChildren, hasRunningChildren, latestWorkflowRun,
  normalizeError,
  publicRun,
  resetStageForRun,
  resolveWorkflowStages,
  summarizeStageInput,
  unique,
  updateStage,
} = require("./runtime-helpers");

const TERMINAL_JOB_STATUSES = new Set(["processed", "failed"]);
const CACHE_WAITING_STATUS = "cache_waiting";
function createWorkflowService({
  workflowRunStore,
  service,
  shotBoundaryService,
  moduleRegistry,
  jobStore,
  logger,
  store,
  artifactIndex,
  threadPool = null,
  activeTurnRuntime = null,
  loadSampleArtifact = loadCurrentSampleArtifact,
  pollIntervalMs = 2000,
  workflowDescriptor = FULL_ANALYSIS_WORKFLOW_DESCRIPTOR,
  buildOptions = (fields) => ({
    enableFunctionSlotAtomization: fields.enableFunctionSlotAtomization !== "false",
  }),
}) {
  const timers = new Map();
  const workflowKey = workflowDescriptor.workflowId;
  const workflowVersion = workflowDescriptor.version;
  const stageDefinitions = resolveWorkflowStages(workflowDescriptor, moduleRegistry);
  const moduleStages = stageDefinitions.filter((stage) => stage.kind === "module");
  const structureAnalysisKeys = workflowDescriptor.parallelGroups["structure-analysis"] ?? [];
  const rerunnableStageKeys = new Set(workflowDescriptor.nodes.filter((node) => node.rerunnable).map((node) => node.key));
  const blockingStageKeys = new Set(stageDefinitions.filter((stage) => stage.blocking).map((stage) => stage.key));
  const advanceLocks = new Map();
  const workflowLogger = createWorkflowLogger({ logger });
  const uploadRerunBuilder = createUploadRerunBuilder({ store, readArtifact });
  const cancellation = createWorkflowCancellation({
    workflowRunStore,
    jobStore,
    logger,
    workflowLogger,
    activeTurnRuntime,
    threadPool,
    workflowKey,
    cacheWaitingStatus: CACHE_WAITING_STATUS,
  });
  const runControl = createWorkflowRunControl({
    workflowRunStore,
    workflowLogger,
    workflowKey,
    workflowDescriptor,
    stageDefinitions,
    rerunnableStageKeys,
    startStage,
    advanceUnlocked,
    scheduleAdvance,
    buildUploadRerunInputForSample: uploadRerunBuilder.buildUploadRerunInputForSample,
  });

  async function start({ workspaceId, file, fields = {} }) {
    const traceContext = createTraceContext(createTraceIds());
    const workflowRunId = `workflow_${randomUUID()}`;
    const now = new Date().toISOString();
    const cacheDecision = fields.cacheDecision === "refresh" ? "refresh" : "ask";
    const run = workflowRunStore.createRun({
      workflowRunId,
      workflowKey,
      workflowVersion,
      cacheDecision,
      options: buildOptions(fields),
      context: buildWorkflowContext(fields),
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
    await workflowLogger.logWorkflowEvent(traceContext, "stage.start", "workflow.run", null, null, {
      workflowRunId,
      workflowKey,
      workflowVersion,
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

  async function startFromSample({ sampleVideoId }) {
    return start(await uploadRerunBuilder.buildUploadRerunInputForSample(sampleVideoId));
  }

  function get(workflowRunId) {
    const run = workflowRunStore.getRun(workflowRunId);
    return run ? publicRun(run) : null;
  }

  function getLatest() {
    const latest = latestWorkflowRun(workflowRunStore, workflowKey);
    return latest ? publicRun(latest) : null;
  }

  function getLatestBySampleVideoId(sampleVideoId) {
    const latest = sampleVideoId ? latestWorkflowRun(workflowRunStore, workflowKey, sampleVideoId) : null;
    return latest ? publicRun(latest) : null;
  }

  async function rerunStage({ workflowRunId, stageKey }) {
    return runWithWorkflowLock(workflowRunId, () => runControl.rerunStageUnlocked({ workflowRunId, stageKey }));
  }

  async function cancelRun({ workflowRunId, reason = "user_requested" } = {}) {
    return runWithWorkflowLock(workflowRunId, () => cancellation.cancelRunUnlocked({ workflowRunId, reason }));
  }

  async function resumeRun({ workflowRunId } = {}) {
    return runWithWorkflowLock(workflowRunId, () => runControl.resumeRunUnlocked({ workflowRunId }));
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
    await workflowLogger.logWorkflowEvent(stageContext, "stage.start", stage.stageName, stage.artifactId, stage.parentArtifactId, summarizeStageInput(stageKey, input));
    try {
      const result = await executeStage(workflowRunId, stageKey, input);
      if (result?.terminal) {
        await markStageProcessed(workflowRunId, stageKey, result, stageContext, startedAt);
        if (result.sampleVideoId) {
          workflowRunStore.updateRun(workflowRunId, (current) => ({
            sampleVideoId: result.sampleVideoId ?? current.sampleVideoId ?? null,
          }));
        }
        scheduleAdvance(workflowRunId);
        return result;
      }
      workflowRunStore.updateRun(workflowRunId, (current) => ({
        stages: updateStage(current.stages, stageKey, (currentStage) => ({
          ...currentStage,
          childJobId: requireChildJobId(result, stageKey),
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

  function requireChildJobId(result, stageKey) {
    if (result?.processingJobId) return result.processingJobId;
    const error = new Error(result?.message ?? "workflow 子任务启动未返回 processingJobId");
    error.code = result?.error ?? result?.code ?? "workflow_child_job_start_invalid";
    error.stageName = stageKey;
    error.retryable = true;
    throw error;
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
      if (stageKey === "functionSlotAtomization" && run.options?.enableFunctionSlotAtomization === false) {
        return {
          terminal: true,
          sampleVideoId: run.sampleVideoId,
          artifactId: null,
          outputSummary: { skipped: true, reason: "disabled" },
        };
      }
      return moduleRegistry.startModule({
        moduleId: moduleStage.moduleId,
        sampleVideoId: run.sampleVideoId,
        body: {
          cacheDecision: input.cacheDecision ?? run.cacheDecision ?? "ask",
          dependencies: buildModuleDependencies(stageKey, artifact),
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

  function runWithWorkflowLock(workflowRunId, operation) {
    const previous = advanceLocks.get(workflowRunId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(operation);
    advanceLocks.set(workflowRunId, next);
    next.finally(() => {
      if (advanceLocks.get(workflowRunId) === next) advanceLocks.delete(workflowRunId);
    }).catch(() => undefined);
    return next;
  }

  function advance(workflowRunId) {
    return runWithWorkflowLock(workflowRunId, () => advanceUnlocked(workflowRunId));
  }

  async function advanceUnlocked(workflowRunId) {
    const run = workflowRunStore.getRun(workflowRunId);
    if (!run) return;
    if (!["running", "partial_failed", CACHE_WAITING_STATUS].includes(run.status) && !hasTerminalRunWithRunningChildren(run, jobStore, CACHE_WAITING_STATUS)) return;
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
      if (!isSameAwaitedStage(workflowRunId, stage)) continue;
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
        resetProcessedDownstreamStages(workflowRunId, stage.key);
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
    if (changed || hasRunningChildren(workflowRunStore.getRun(workflowRunId), CACHE_WAITING_STATUS)) scheduleAdvance(workflowRunId);
  }

  async function maybeStartNext(run) {
    let latest = run;
    let started = true;
    while (started) {
      started = false;
      for (const stage of latest.stages) {
        if (stage.status !== "pending" || !stageDependenciesReady(latest, stage)) continue;
        const input = stage.key === "aggregate" ? {} : { cacheDecision: latest.cacheDecision ?? "ask" };
        await startStage(latest.workflowRunId, stage.key, input, {
          runId: latest.runId,
          traceId: latest.traceId,
          stageId: `stage_${randomUUID()}`,
        });
        latest = workflowRunStore.getRun(latest.workflowRunId);
        started = true;
        if (stage.parallelGroup) continue;
        break;
      }
    }
  }

  function isSameAwaitedStage(workflowRunId, stage) {
    const current = findStage(workflowRunStore.getRun(workflowRunId), stage.key);
    return current.childJobId === stage.childJobId && ["running", "pending", CACHE_WAITING_STATUS].includes(current.status);
  }

  function stageDependenciesReady(run, stage) {
    const dependencies = Array.isArray(stage.after) ? stage.after : [];
    if (!dependencies.length) return false;
    return dependencies.every((dependency) => dependencyReady(run, dependency));
  }

  function dependencyReady(run, dependency) {
    const group = workflowDescriptor.parallelGroups[dependency];
    if (Array.isArray(group)) {
      return group.every((stageKey) => ["processed", "failed"].includes(findStage(run, stageKey).status));
    }
    return findStage(run, dependency).status === "processed";
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
    await workflowLogger.logWorkflowEvent(traceContext, "stage.end", stage.stageName, stage.artifactId, stage.parentArtifactId, null, outputSummary, Date.now() - startedAt);
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
    await workflowLogger.logWorkflowEvent(traceContext, "stage.fail", stage.stageName, stage.artifactId, stage.parentArtifactId, null, stage.outputSummary ?? null, Date.now() - startedAt, errorSummary);
  }

  async function finalizeIfReady(run) {
    if (!run || !["running", "partial_failed", CACHE_WAITING_STATUS].includes(run.status)) return;
    const aggregate = findStage(run, "aggregate");
    const blockingFailed = Array.from(blockingStageKeys).some((key) => findStage(run, key).status === "failed");
    if (blockingFailed) {
      const completed = workflowRunStore.updateRun(run.workflowRunId, { status: "failed", completedAt: new Date().toISOString(), currentStageKeys: [] });
      await workflowLogger.logWorkflowRunClosed(completed, "stage.fail");
      return;
    }
    if (aggregate.status !== "processed") return;
    const optionalStageKeys = [...structureAnalysisKeys, ...(hasStage(run, "functionSlotAtomization") ? ["functionSlotAtomization"] : [])];
    const anyFailed = optionalStageKeys.some((key) => findStage(run, key).status === "failed");
    const completed = workflowRunStore.updateRun(run.workflowRunId, {
      status: anyFailed ? "partial_failed" : "processed",
      currentStageKeys: [],
      completedAt: new Date().toISOString(),
    });
    await workflowLogger.logWorkflowRunClosed(completed, "stage.end");
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

  function resetProcessedDownstreamStages(workflowRunId, stageKey) {
    const resetKeys = downstreamStageKeys(stageDefinitions, stageKey, workflowDescriptor.parallelGroups);
    if (!resetKeys.length) return;
    workflowRunStore.updateRun(workflowRunId, (current) => ({
      stages: current.stages.map((stage) => resetKeys.includes(stage.key) && stage.status === "processed"
        ? resetStageForRun(stage)
        : stage),
    }));
  }

  async function readArtifact(sampleVideoId) {
    if (!sampleVideoId) return null;
    return loadSampleArtifact({ sampleVideoId, store, artifactIndex });
  }

  return { start, startFromSample, get, getLatest, getLatestBySampleVideoId, rerunStage, cancelRun, resumeRun, advance };
}

module.exports = {
  WORKFLOW_KEY: FULL_ANALYSIS_WORKFLOW_DESCRIPTOR.workflowId,
  WORKFLOW_VERSION: FULL_ANALYSIS_WORKFLOW_DESCRIPTOR.version,
  FULL_ANALYSIS_WORKFLOW_DESCRIPTOR,
  createWorkflowService,
  createFullAnalysisWorkflowService: createWorkflowService,
};
