const path = require("path");
const { randomUUID } = require("crypto");
const { createTraceContext, SAMPLE_STATUS } = require("../../../../Core/Workspace/sample-video-contracts");
const { createTraceIds, nextStage } = require("../../../../Infrastructure/Observability/trace");
const defaultContactSheetGenerator = require("../../../../Infrastructure/MediaProcessing/contact-sheet-generator");
const { createAppServerBridge } = require("../gateways/appserver/bridge");
const { createThreadPoolProxy } = require("../gateways/threadpool/proxy");
const { createExecutorRegistry } = require("../executors/registry");
const { loadRoleProfileByRole } = require("../gateways/threadpool/role-profile-loader");
const { attachAnalysis, loadSampleArtifact } = require("./artifact-store");
const { runShotBoundaryCacheLookup, reuseShotBoundaryCachedAnalysis } = require("./cache-flow");
const {
  badRequestError,
  buildInitFingerprint,
  buildTransformPromptTemplate,
  round,
  normalizeEnableReview,
  reviewMode,
  resolveRawVideoPath,
} = require("./service-options");
const { createShotBoundaryServiceRuntime } = require("./service-runtime");
const {
  finalizeLease,
  cleanupLease,
  acquireLeaseWithRetry,
} = require("./threadpool-runner");
const {
  isShotStage: isShotStageImpl,
  isInterruptedPreAgentJob: isInterruptedPreAgentJobImpl,
  buildAgentRun: buildAgentRunImpl,
  createRecoveredContext: createRecoveredContextImpl,
  isRetryableCollectError,
} = require("./agent-run");
const {
  markCacheWaiting: markCacheWaitingImpl,
  resolveExistingFileHash: resolveExistingFileHashImpl,
} = require("./cache");
const { buildCachePrompt } = require("./cache-prompt");
const { writeCompletedAnalysis } = require("./result-writer");
const { buildAgentActivityFromTurnResult } = require("../observability/agent-turn-timeline");
const {
  ROLE,
  SKILL_PATH,
  buildCacheReuseAnalysis,
  buildFailedArtifact,
  buildProcessedAnalysis,
  buildTurnInputs,
  renderAnalyzeTurnInputs,
  cacheParams,
  legacyCacheParams,
  splitPredecessorCacheParams,
  evaluateCacheEligibility,
  prepareInput,
  resolveSkillHash,
  safeError,
  sanitizeDebugPayload,
  contentHash,
} = require("../shot-boundary-analysis");
const { codedError } = require("../shot-boundary-analysis/shared");
const {
  REVIEW_ROLE,
  REVIEW_SKILL_PATH,
  prepareShotSheets,
  renderTransformTurnInputs,
  renderRepairTurnInputs,
  renderVisualSummaryTurnInputs,
  validateTransformResult,
  summarizeTransformResult,
  validateVisualSummaryResult,
  applyVisualSummaryResult,
  summarizeVisualSummaryResult,
} = require("../shot-boundary-review");

const STAGES = {
  inputPrepared: "shot.input_prepare",
  cacheLookup: "shot.cache_lookup",
  cacheReuse: "shot.cache_reuse",
  threadAcquired: "shot.raw_video_analyze.thread_start",
  turnStarted: "shot.raw_video_analyze.submit",
  turnCollected: "shot.raw_video_analyze.collect",
  reviewThreadAcquired: "shot.boundary_transform.thread_acquire",
  reviewStarted: "shot.boundary_transform.submit",
  reviewCollected: "shot.boundary_transform.collect",
  reviewValidated: "shot.boundary_transform.validate",
  reviewRepairStarted: "shot.boundary_transform.repair_submit",
  reviewRepairCollected: "shot.boundary_transform.repair_collect",
  reviewRepairValidated: "shot.boundary_transform.repair_validate",
  reviewSheetsPrepared: "shot.boundary_transform.sheets",
  visualSummaryStarted: "shot.boundary_visual_summary.submit",
  visualSummaryCollected: "shot.boundary_visual_summary.collect",
  visualSummaryValidated: "shot.boundary_visual_summary.validate",
  resultWritten: "shot.boundary_merge",
};
const POLL_INTERVAL_MS = 2000;
const ORPHAN_TTL_MS = 60 * 60 * 1000;
const THREADPOOL_ACQUIRE_MAX_ATTEMPTS = 3;
const THREADPOOL_ACQUIRE_BACKOFF_MS = [500, 1000];
const SUMMARY_COLLECT_MAX_ATTEMPTS = 60 * 60 * 1000 / POLL_INTERVAL_MS;
const REVIEW_COLLECT_MAX_ATTEMPTS = 60 * 60 * 1000 / POLL_INTERVAL_MS;
const RAW_ANALYZER_ROLE = "shot-boundary-raw-analyzer";
const DEFAULT_RAW_ANALYSIS_WORKSPACE_ROOT = process.env.SHOT_RAW_ANALYSIS_WORKSPACE_ROOT || "C:\\Users\\Administrator\\Documents\\Codex";
const VIDEO_SHOT_SKILL_PATH = process.env.SHOT_VIDEO_SKILL_PATH || path.join(DEFAULT_RAW_ANALYSIS_WORKSPACE_ROOT, ".agents", "skills", "video-shot", "SKILL.md");

function createShotBoundaryService({
  rootDir,
  store,
  logger,
  jobStore,
  artifactIndex,
  threadPool = createThreadPoolProxy(),
  appServer = createAppServerBridge(),
  executorRegistry = createExecutorRegistry({ appServer }),
  contactSheetGenerator = defaultContactSheetGenerator,
  skillPath = VIDEO_SHOT_SKILL_PATH,
  rawAnalysisWorkspaceRoot = DEFAULT_RAW_ANALYSIS_WORKSPACE_ROOT,
  pollIntervalMs = POLL_INTERVAL_MS,
  reviewPollIntervalMs = POLL_INTERVAL_MS,
  reviewCollectMaxAttempts = REVIEW_COLLECT_MAX_ATTEMPTS,
  orphanTtlMs = ORPHAN_TTL_MS,
} = {}) {
  const collectingJobs = new Map();
  const rawWorkspaceRoot = rawAnalysisWorkspaceRoot || rootDir;
  const serviceRuntime = createShotBoundaryServiceRuntime({
    logger,
    jobStore,
    threadPool,
    appServer,
    rawWorkspaceRoot,
    sampleStatus: SAMPLE_STATUS,
    stages: STAGES,
    nextStage,
    safeError,
    sanitizeDebugPayload,
    buildFailedArtifact,
    attachAnalysis: (sampleVideoId, analysis, traceMeta = {}) => attachAnalysis({ store, sampleVideoId, analysis, traceMeta }),
    isShotStage,
    isInterruptedPreAgentJob,
    codedError,
  });

  async function enqueue({ sampleVideoId, analysisFps = 10, cacheDecision = "ask", enableReview = true }) {
    await store.ensureRuntimeDirs();
    const sampleArtifact = await loadSampleArtifact(store, sampleVideoId);
    const traceContext = createTraceContext(createTraceIds());
    const artifactId = `artifact_${randomUUID()}`;
    const job = jobStore.createJob({ sampleVideoId, traceId: traceContext.traceId });
  const context = {
      sampleVideoId,
      analysisFps: Number(analysisFps || 10),
      cacheDecision,
      enableReview: normalizeEnableReview(enableReview),
      sampleArtifact,
      traceContext,
      artifactId,
      skillPath,
      skillHash: await resolveSkillHash(skillPath),
      roleProfile: await loadRoleProfileByRole(RAW_ANALYZER_ROLE),
      reviewRoleProfile: await loadRoleProfileByRole(REVIEW_ROLE),
      initFingerprint: null,
      promptTemplate: null,
      reviewPromptTemplate: null,
      reviewSkillHash: await resolveSkillHash(REVIEW_SKILL_PATH),
      job,
    };
    context.skillPath = context.roleProfile?.skillPath ?? context.skillPath;
    context.skillHash = await resolveSkillHash(context.skillPath);
    context.initFingerprint = buildInitFingerprint(context);
    context.promptTemplate = buildTransformPromptTemplate(context.reviewRoleProfile);
    runAnalysis(context).catch(() => undefined);
    return { processingJobId: job.jobId, sampleVideoId, traceId: traceContext.traceId };
  }

  async function resolveCacheDecision({ jobId, decision }) {
    const job = jobStore.getJob(jobId);
    if (!job || job.status !== SAMPLE_STATUS.cacheWaiting || !job.cachePrompt) {
      throw badRequestError("cache_decision_invalid_job", "只能对等待缓存选择的切镜任务执行该操作");
    }
    const sampleArtifact = await loadSampleArtifact(store, job.sampleVideoId);
    const context = {
      sampleVideoId: job.sampleVideoId,
      analysisFps: Number(job.cachePrompt.analysisFps ?? 10),
      cacheDecision: decision,
      enableReview: normalizeEnableReview(job.cachePrompt.enableReview ?? true),
      sampleArtifact,
      traceContext: {
        runId: job.traceId,
        traceId: job.traceId,
        stageId: `stage_cache_decision_${Date.now()}`,
      },
      artifactId: job.cachePrompt.artifactId ?? `artifact_${randomUUID()}`,
      skillPath: job.cachePrompt.skillPath ?? skillPath,
      skillHash: job.cachePrompt.skillHash ?? await resolveSkillHash(skillPath),
      roleProfile: await loadRoleProfileByRole(RAW_ANALYZER_ROLE),
      reviewRoleProfile: await loadRoleProfileByRole(REVIEW_ROLE),
      initFingerprint: job.cachePrompt.initFingerprint ?? null,
      promptTemplate: {
        promptTemplateId: job.cachePrompt.promptTemplateId ?? null,
        promptTemplateVersion: job.cachePrompt.promptTemplateVersion ?? null,
        promptTemplateHash: job.cachePrompt.promptTemplateHash ?? null,
      },
      reviewSkillHash: job.cachePrompt.reviewSkillHash ?? await resolveSkillHash(REVIEW_SKILL_PATH),
      job,
    };
    context.skillPath = context.roleProfile?.skillPath ?? context.skillPath;
    context.skillHash = await resolveSkillHash(context.skillPath);
    if (!context.promptTemplate.promptTemplateId) {
      context.promptTemplate = buildTransformPromptTemplate(context.reviewRoleProfile);
    }
    if (!context.initFingerprint) {
      context.initFingerprint = buildInitFingerprint(context);
    }
    if (decision === "reuse") {
      try {
        await reuseCachedAnalysis(context, job.cachePrompt);
      } catch (error) {
        await markFailed(context, error);
      }
      return jobStore.getJob(jobId);
    }
    if (decision === "refresh") {
      jobStore.updateJob(jobId, { cachePrompt: null, errorSummary: null, status: SAMPLE_STATUS.processing, stage: STAGES.cacheLookup, progress: 56 });
      runAnalysis({ ...context, cacheDecision: "refresh" }).catch(() => undefined);
      return jobStore.getJob(jobId);
    }
    throw badRequestError("cache_decision_invalid", "缓存选择无效，请选择复用或重新分析");
  }

  function scheduleCollect(jobId, delayMs = pollIntervalMs) {
    const timer = setTimeout(() => collectAgentRun(jobId).catch(() => undefined), delayMs);
    timer.unref?.();
  }

  async function runAnalysis(context) {
    let lease = null;
    try {
      const prepared = await runStage(context, STAGES.inputPrepared, 20, {
        artifactId: context.artifactId,
        parentArtifactId: context.sampleArtifact.sampleVideo.artifactId,
        inputSummary: { sampleVideoId: context.sampleVideoId, analysisFps: context.analysisFps },
        action: () => context.prepared ?? prepareInput(context.sampleArtifact, context.analysisFps, { runtimeRoot: store.runtimeRoot }),
        outputSummary: (input) => ({
          frameCount: input.frames.length,
          requestedFps: input.analysisSampling.requestedFps,
          selectedFrameCount: input.analysisSampling.selectedFrameCount,
          effectiveFps: input.analysisSampling.effectiveFps,
          selectionPolicy: input.analysisSampling.selectionPolicy,
          extractFps: round(input.extractSampling.actualFrameCount / input.durationSeconds),
          subtitleSegmentCount: input.subtitleContextSummary?.subtitleSegmentCount ?? 0,
          subtitleTextHash: input.subtitleContextSummary?.subtitleTextHash ?? null,
          subtitleTruncated: Boolean(input.subtitleContextSummary?.truncated),
        }),
      });
      context.prepared = prepared;
      if (!context.promptTemplate) context.promptTemplate = buildTransformPromptTemplate(context.reviewRoleProfile);

      const cached = await runCacheLookup(context, prepared, []);
      if (cached && context.cacheDecision === "ask") {
        markCacheWaiting(context, cached);
        return;
      }
      if (cached && context.cacheDecision === "reuse") {
        await reuseCachedAnalysis(context, buildCachePrompt(context, cached));
        return;
      }

      const rawVideoPath = resolveRawVideoPath(context.sampleArtifact, store.runtimeRoot, codedError);
      context.inputMode = "raw_video_path_text";
      context.rawVideoPathInfo = {
        resolved: true,
        basename: path.basename(rawVideoPath),
      };
      const rawWorkspaceRootForRole = context.roleProfile?.workspaceRoot ?? rawWorkspaceRoot;
      context.rawWorkspaceRoot = rawWorkspaceRootForRole;
      const leaseAcquisition = await runStage(context, STAGES.threadAcquired, 60, {
        stageName: STAGES.threadAcquired,
        artifactId: context.artifactId,
        parentArtifactId: prepared.sourceArtifactId,
        inputSummary: { role: RAW_ANALYZER_ROLE, inputMode: "raw_video_path_text", videoBasename: path.basename(rawVideoPath), durationSeconds: prepared.durationSeconds, pathResolved: true },
        action: () => acquireLeaseWithRetry(threadPool, {
          role: RAW_ANALYZER_ROLE,
          ownerId: context.traceContext.traceId,
          maxAttempts: THREADPOOL_ACQUIRE_MAX_ATTEMPTS,
          backoffMs: THREADPOOL_ACQUIRE_BACKOFF_MS,
          codedError,
        }),
        outputSummary: (result) => ({
          role: RAW_ANALYZER_ROLE,
          threadId: result.lease.thread_id,
          leaseId: result.lease.lease_id,
          attemptCount: result.attemptCount,
        }),
      });
      const rawThread = leaseAcquisition.lease;
      lease = rawThread;
      const rawTurnInputs = [{
        type: "text",
        text: [
          "请使用 Video-shot skill 执行原始视频切镜。",
          `视频路径：${rawVideoPath}`,
          "边界：只读该视频路径，只输出 raw 切镜自由文本；不查仓库、不调用其他技能、不看工作区项目实现。",
        ].join("\n"),
        text_elements: [],
      }];
      const turnExecution = await executorRegistry.execute("appserver-turn", {
        action: "submit-turn",
        stageName: STAGES.turnStarted,
        progress: 80,
        artifactId: context.artifactId,
        parentArtifactId: prepared.sourceArtifactId,
        inputSummary: { role: RAW_ANALYZER_ROLE, threadId: rawThread.thread_id, leaseId: rawThread.lease_id, inputMode: "raw_video_path_text", videoBasename: path.basename(rawVideoPath), durationSeconds: prepared.durationSeconds, pathResolved: true },
        workspaceRoot: rawWorkspaceRootForRole,
        threadId: rawThread.thread_id,
        inputs: rawTurnInputs,
        skillPath: context.skillPath,
        timeoutSeconds: 240,
        role: RAW_ANALYZER_ROLE,
        inputMode: "raw_video_path_text",
      }, { runStage: (stageName, progress, options) => runStage(context, stageName, progress, options) });
      const turn = turnExecution.result;
      const agentRun = buildAgentRun({ context, lease: rawThread, turn, prepared, contactSheets: [] });
      jobStore.updateJob(context.job.jobId, {
        agentRun,
        stage: STAGES.turnStarted,
        status: SAMPLE_STATUS.processing,
        progress: 80,
      });
      lease = null;
      scheduleCollect(context.job.jobId, 0);
    } catch (error) {
      if (lease?.thread_id && lease?.lease_id) {
        await cleanupLease(threadPool, lease, context.traceContext.traceId, "shot-boundary-analysis-failed");
      }
      await serviceRuntime.markFailed(context, error);
    }
  }

  async function collectAgentRun(jobId) {
    if (collectingJobs.has(jobId)) return collectingJobs.get(jobId);
    const task = (async () => {
      const job = jobStore.getJob(jobId);
      const agentRun = job?.agentRun;
      if (job?.status === SAMPLE_STATUS.processed || job?.status === SAMPLE_STATUS.failed) return { status: job.status };
      if (!job || !agentRun || !agentRun.threadId || !agentRun.turnId) return null;
      const sampleArtifact = await loadSampleArtifact(store, agentRun.sampleVideoId);
      const context = createRecoveredContext({ job, agentRun, sampleArtifact, skillPath: SKILL_PATH });
      context.roleProfile = agentRun.role === RAW_ANALYZER_ROLE ? await loadRoleProfileByRole(RAW_ANALYZER_ROLE) : null;
      context.reviewRoleProfile = await loadRoleProfileByRole(REVIEW_ROLE);
      context.promptTemplate = buildTransformPromptTemplate(context.reviewRoleProfile);
      context.reviewSkillHash = await resolveSkillHash(REVIEW_SKILL_PATH);
      if (Date.now() - Date.parse(agentRun.startedAt) > orphanTtlMs) {
        const error = codedError("shot_boundary_turn_orphaned", "切镜 Agent 长时间未完成，已清理遗留 lease");
        await failAgentRun(context, error);
        return { status: SAMPLE_STATUS.failed };
      }
      try {
          jobStore.updateJob(job.jobId, {
            agentRun: { ...agentRun, status: "collecting", updatedAt: new Date().toISOString() },
            stage: STAGES.turnCollected,
            status: SAMPLE_STATUS.processing,
            progress: 88,
          });
        const turnExecution = await executorRegistry.execute("appserver-turn", {
          action: "collect-turn",
          stageName: STAGES.turnCollected,
          progress: 88,
          artifactId: agentRun.artifactId,
          parentArtifactId: agentRun.parentArtifactId,
          inputSummary: { role: agentRun.role ?? ROLE, threadId: agentRun.threadId, leaseId: agentRun.leaseId ?? null, turnId: agentRun.turnId, sheetCount: agentRun.contactSheets?.length ?? 0 },
          workspaceRoot: context.roleProfile?.workspaceRoot ?? rawWorkspaceRoot,
          threadId: agentRun.threadId,
          turnId: agentRun.turnId,
          timeoutSeconds: 60,
          role: agentRun.role ?? ROLE,
        }, { runStage: (stageName, progress, options) => runStage(context, stageName, progress, options) });
        const turn = turnExecution.result;
        updateActiveThreadMessage(context, turn, {
          role: agentRun.role ?? ROLE,
        });
        if (turn.status !== "completed") {
          jobStore.updateJob(job.jobId, {
            agentRun: { ...agentRun, status: "collecting", updatedAt: new Date().toISOString() },
            stage: STAGES.turnCollected,
            status: SAMPLE_STATUS.processing,
            progress: 88,
            errorSummary: null,
          });
          scheduleCollect(job.jobId);
          return turn;
        }
        if (!String(turn.finalMessage ?? "").trim()) {
          throw codedError("shot_raw_video_analyze_empty_result", "原始切镜分析未返回有效结果", {
            turnId: turn.turnId,
            status: turn.status,
            validation: {
              validatorCode: "shot_raw_video_analyze_empty_result",
            },
          }, false);
        }
        if (agentRun.leaseId) {
          await finalizeLease(threadPool, agentRun);
          const releasedAgentRun = markAgentRunLeaseReleased(agentRun);
          jobStore.updateJob(context.job.jobId, { agentRun: releasedAgentRun });
          context.job.agentRun = releasedAgentRun;
        }
        await writeCompletedAnalysis({
          context,
          agentRun,
          turn,
          runStage,
          stages: STAGES,
          prepareInput,
          store,
          buildProcessedAnalysis,
          attachAnalysis: (sampleVideoId, analysis, traceMeta = {}) => attachAnalysis({ store, sampleVideoId, analysis, traceMeta }),
          artifactIndex,
          resolveExistingFileHash: (sampleVideoId) => resolveExistingFileHashImpl(sampleVideoId, artifactIndex),
          loadSampleArtifact: (sampleVideoId) => loadSampleArtifact(store, sampleVideoId),
          finalizeLease,
          threadPool,
          appServer,
          rootDir,
          reviewer: {
            role: REVIEW_ROLE,
            skillPath: REVIEW_SKILL_PATH,
            reviewPollIntervalMs,
            reviewCollectMaxAttempts,
            loadRoleProfileByRole,
            prepareShotSheets,
            contactSheetGenerator,
            renderTransformTurnInputs,
            renderRepairTurnInputs,
            renderVisualSummaryTurnInputs,
            validateTransformResult,
            summarizeTransformResult,
            validateVisualSummaryResult,
            applyVisualSummaryResult,
            summarizeVisualSummaryResult,
            acquireLeaseWithRetry,
          },
          codedError,
          role: agentRun.role ?? RAW_ANALYZER_ROLE,
          jobStore,
          sampleStatus: SAMPLE_STATUS,
          store,
          updateActiveThreadMessage: (threadId, turnId, message, status, options) => updateActiveThreadMessage(context, threadId, turnId, message, status, options),
        });
        return turn;
        } catch (error) {
          if (isRetryableCollectError(error)) {
            await markRetryableCollectFailure(context, error);
            scheduleCollect(job.jobId);
            return { status: "retrying" };
          }
          await failAgentRun(context, error);
          return { status: SAMPLE_STATUS.failed };
        }
      })();
    collectingJobs.set(jobId, task);
    try {
      return await task;
    } finally {
      collectingJobs.delete(jobId);
    }
  }

  async function recoverActiveAgentRuns() {
    const modern = await serviceRuntime.recoverActiveAgentRuns({
      role: RAW_ANALYZER_ROLE,
      collectAgentRun,
      loadSampleArtifact: (sampleVideoId) => loadSampleArtifact(store, sampleVideoId),
    });
    const legacy = await serviceRuntime.recoverActiveAgentRuns({
      role: ROLE,
      collectAgentRun,
      loadSampleArtifact: (sampleVideoId) => loadSampleArtifact(store, sampleVideoId),
    });
    return { recovered: modern.recovered + legacy.recovered, interrupted: modern.interrupted + legacy.interrupted };
  }

  async function interruptActiveAgentRuns(reason = "server-startup") {
    const modern = await serviceRuntime.interruptActiveAgentRuns({
      role: RAW_ANALYZER_ROLE,
      loadSampleArtifact: (sampleVideoId) => loadSampleArtifact(store, sampleVideoId),
      reason,
    });
    const legacy = await serviceRuntime.interruptActiveAgentRuns({
      role: ROLE,
      loadSampleArtifact: (sampleVideoId) => loadSampleArtifact(store, sampleVideoId),
      reason,
    });
    return { interruptedAgentRuns: modern.interruptedAgentRuns + legacy.interruptedAgentRuns, interrupted: modern.interrupted + legacy.interrupted };
  }

  async function runCacheLookupLocal(context, prepared, contactSheets) {
    return runShotBoundaryCacheLookup({
      context: { ...context, stages: STAGES },
      prepared,
      contactSheets,
      runStage: serviceRuntime.runStage,
      stageName: STAGES.cacheLookup,
      artifactIndex,
      cacheParams,
      splitPredecessorCacheParams,
      legacyCacheParams,
      evaluateCacheEligibility,
    });
  }

  async function reuseCachedAnalysisLocal(context, cachePrompt) {
    await reuseShotBoundaryCachedAnalysis({
      context,
      cachePrompt,
      runStage: serviceRuntime.runStage,
      stageName: STAGES.cacheReuse,
      artifactIndex,
      evaluateCacheEligibility,
      codedError,
      buildCacheReuseAnalysis,
      attachAnalysis: (sampleVideoId, analysis, traceMeta = {}) => attachAnalysis({ store, sampleVideoId, analysis, traceMeta }),
      jobStore,
      sampleStatus: SAMPLE_STATUS,
    });
  }

  async function runCacheLookup(context, prepared, contactSheets) {
    return runCacheLookupLocal(context, prepared, contactSheets);
  }

  async function reuseCachedAnalysis(context, cachePrompt) {
    return reuseCachedAnalysisLocal(context, cachePrompt);
  }

  function markCacheWaiting(context, cached) {
    return markCacheWaitingImpl({
      context,
      cached,
      jobStore,
      sampleStatus: SAMPLE_STATUS,
      stageName: STAGES.cacheLookup,
    });
  }

  function buildAgentRun(args) {
    return buildAgentRunImpl({
      ...args,
      role: RAW_ANALYZER_ROLE,
      skillPath: args.context.skillPath,
      roleProfile: args.context.roleProfile,
      promptTemplate: null,
      initFingerprint: null,
    });
  }

  function createRecoveredContext(args) {
    return createRecoveredContextImpl(args);
  }

  function markAgentRunLeaseReleased(agentRun) {
    const now = new Date().toISOString();
    return {
      ...agentRun,
      releasedLeaseId: agentRun.leaseId ?? agentRun.releasedLeaseId ?? null,
      leaseReleasedAt: now,
      leaseId: null,
      updatedAt: now,
    };
  }

  function isInterruptedPreAgentJob(job) {
    return isInterruptedPreAgentJobImpl(job, SAMPLE_STATUS, STAGES);
  }

  function isShotStage(stageName) {
    return isShotStageImpl(stageName, STAGES);
  }

  function runStage(context, stageName, progress, options) {
    return serviceRuntime.runStage(context, stageName, progress, options);
  }

  function markFailed(context, error) {
    return serviceRuntime.markFailed(context, error);
  }

  function updateActiveThreadMessage(context, turnOrThreadId, turnIdOrOptions, message, status, options = {}) {
    const turn = typeof turnOrThreadId === "object" && turnOrThreadId !== null
      ? turnOrThreadId
      : { threadId: turnOrThreadId, turnId: turnIdOrOptions, activeThreadMessage: message, status };
    const resolvedOptions = typeof turnOrThreadId === "object" && turnOrThreadId !== null ? (turnIdOrOptions ?? {}) : options;
    const normalized = buildActiveThreadMessage(turn.threadId, turn.turnId, turn.activeThreadMessage ?? null, turn.status, resolvedOptions);
    const agentActivity = buildAgentActivityFromTurnResult(turn);
    if (normalized || agentActivity || !isPendingTurnStatus(turn.status)) {
      jobStore.updateJob(context.job.jobId, { activeThreadMessage: normalized, agentActivity });
    }
    return normalized;
  }

  function failAgentRun(context, error) {
    return serviceRuntime.failAgentRun(context, error);
  }

  function markRetryableCollectFailure(context, error) {
    return serviceRuntime.markRetryableCollectFailure(context, error);
  }

  return { enqueue, resolveCacheDecision, prepareInput, buildTurnInputs, collectAgentRun, recoverActiveAgentRuns, interruptActiveAgentRuns };
}

function buildActiveThreadMessage(threadId, turnId, message, status, options = {}) {
  const normalized = String(message ?? "").trim() || String(options.fallbackMessage ?? "").trim();
  if (normalized || !isPendingTurnStatus(status)) {
    return normalized
      ? {
          threadId: threadId ?? null,
          turnId: turnId ?? null,
          role: options.role ?? "thread",
          text: normalized.length <= 1200 ? normalized : `${normalized.slice(0, 1200)}...`,
          createdAt: new Date().toISOString(),
        }
      : null;
  }
  return null;
}

function isPendingTurnStatus(status) {
  return ["created", "pending", "queued", "submitted", "running", "inprogress", "in_progress", "collecting"].includes(String(status ?? "").trim().toLowerCase());
}

module.exports = { ROLE, SKILL_PATH, RAW_ANALYZER_ROLE, STAGES, createShotBoundaryService, prepareInput, buildTurnInputs, renderAnalyzeTurnInputs };

// Static compatibility anchor for repo regex tests after service split:
// activeThreadMessage: null
