const path = require("path");
const { randomUUID } = require("crypto");
const { createTraceContext, SAMPLE_STATUS } = require("../../../Core/Workspace/sample-video-contracts");
const { createTraceIds, nextStage } = require("../../../Infrastructure/Observability/trace");
const defaultContactSheetGenerator = require("../../../Infrastructure/MediaProcessing/contact-sheet-generator");
const { createAppServerBridge } = require("./appserver-bridge");
const { createThreadPoolProxy } = require("./threadpool-proxy");
const { loadRoleProfileByRole } = require("./role-profile-loader");
const { appendShotBoundaryHistory } = require("./shot-boundary/history");
const { createShotBoundaryServiceRuntime } = require("./shot-boundary/service-runtime");
const {
  finalizeLease,
  cleanupLease,
  acquireLeaseWithRetry,
} = require("./shot-boundary/threadpool-runner");
const {
  isShotStage: isShotStageImpl,
  isInterruptedPreAgentJob: isInterruptedPreAgentJobImpl,
  buildAgentRun: buildAgentRunImpl,
  createRecoveredContext: createRecoveredContextImpl,
  isRetryableCollectError,
} = require("./shot-boundary/agent-run");
const {
  findCachedArtifact: findCachedArtifactImpl,
  runCacheLookup: runCacheLookupImpl,
  resolveCachedPrompt: resolveCachedPromptImpl,
  markCacheWaiting: markCacheWaitingImpl,
  resolveExistingFileHash: resolveExistingFileHashImpl,
  reuseCachedAnalysis: reuseCachedAnalysisImpl,
} = require("./shot-boundary/cache");
const { buildCachePrompt } = require("./shot-boundary/cache-prompt");
const { writeCompletedAnalysis } = require("./shot-boundary/result-writer");
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
  codedError,
  evaluateCacheEligibility,
  prepareInput,
  resolveSkillHash,
  safeError,
  sanitizeDebugPayload,
  contentHash,
} = require("./shot-boundary-analysis");
const {
  REVIEW_ROLE,
  REVIEW_SKILL_PATH,
  prepareShotSheets,
  renderTransformTurnInputs,
  renderVisualSummaryTurnInputs,
  validateTransformResult,
  summarizeTransformResult,
  validateVisualSummaryResult,
  applyVisualSummaryResult,
  summarizeVisualSummaryResult,
} = require("./shot-boundary-review");

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
  reviewSheetsPrepared: "shot.boundary_transform.sheets",
  visualSummaryStarted: "shot.boundary_visual_summary.submit",
  visualSummaryCollected: "shot.boundary_visual_summary.collect",
  visualSummaryValidated: "shot.boundary_visual_summary.validate",
  resultWritten: "shot.boundary_merge",
};
const POLL_INTERVAL_MS = 2000;
const ORPHAN_TTL_MS = 30 * 60 * 1000;
const THREADPOOL_ACQUIRE_MAX_ATTEMPTS = 3;
const THREADPOOL_ACQUIRE_BACKOFF_MS = [500, 1000];
const SUMMARY_COLLECT_MAX_ATTEMPTS = 90;
const REVIEW_COLLECT_MAX_ATTEMPTS = 90;
const WORKSPACE_ROOT = path.resolve(__dirname, "..", "..", "..");
const VIDEO_SHOT_SKILL_PATH = path.join(WORKSPACE_ROOT, ".agents", "skills", "video-shot", "SKILL.md");
const DEFAULT_RAW_ANALYSIS_WORKSPACE_ROOT = process.env.SHOT_RAW_ANALYSIS_WORKSPACE_ROOT || "C:\\Users\\Administrator\\Documents\\Codex";

function createShotBoundaryService({
  rootDir,
  store,
  logger,
  jobStore,
  artifactIndex,
  threadPool = createThreadPoolProxy(),
  appServer = createAppServerBridge(),
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
    sampleStatus: SAMPLE_STATUS,
    stages: STAGES,
    nextStage,
    safeError,
    sanitizeDebugPayload,
    buildFailedArtifact,
    attachAnalysis,
    isShotStage,
    isInterruptedPreAgentJob,
    codedError,
  });

  async function enqueue({ sampleVideoId, analysisFps = 10, cacheDecision = "ask", enableReview = true }) {
    await store.ensureRuntimeDirs();
    const sampleArtifact = await loadSampleArtifact(sampleVideoId);
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
      roleProfile: null,
      reviewRoleProfile: await loadRoleProfileByRole(REVIEW_ROLE),
      initFingerprint: null,
      promptTemplate: null,
      reviewPromptTemplate: null,
      reviewSkillHash: await resolveSkillHash(REVIEW_SKILL_PATH),
      job,
    };
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
    const sampleArtifact = await loadSampleArtifact(job.sampleVideoId);
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
      roleProfile: null,
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

      const rawVideoPath = resolveRawVideoPath(context.sampleArtifact, store.runtimeRoot);
      context.inputMode = "raw_video_path_text";
      context.rawVideoPathInfo = {
        resolved: true,
        basename: path.basename(rawVideoPath),
      };
      const leaseAcquisition = await runStage(context, STAGES.threadAcquired, 60, {
        artifactId: context.artifactId,
        parentArtifactId: prepared.sourceArtifactId,
        inputSummary: { inputMode: "raw_video_path_text", videoBasename: path.basename(rawVideoPath), durationSeconds: prepared.durationSeconds, pathResolved: true },
        action: () => appServer.startThread({
          workspaceRoot: rawWorkspaceRoot,
          timeoutSeconds: 240,
        }),
        outputSummary: (result) => ({
          role: "raw_video_analyze",
          leaseId: null,
          threadId: result.threadId,
          status: result.status,
        }),
      });
      const rawThread = { thread_id: leaseAcquisition.threadId, lease_id: null };
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
      const turn = await runStage(context, STAGES.turnStarted, 80, {
        artifactId: context.artifactId,
        parentArtifactId: prepared.sourceArtifactId,
        inputSummary: { role: ROLE, threadId: rawThread.thread_id, leaseId: null, inputMode: "raw_video_path_text", videoBasename: path.basename(rawVideoPath), durationSeconds: prepared.durationSeconds, pathResolved: true },
        action: () => appServer.startTurnWithInputs({
          workspaceRoot: rawWorkspaceRoot,
          threadId: rawThread.thread_id,
          inputs: rawTurnInputs,
          skillPath: context.skillPath,
          timeoutSeconds: 240,
        }),
        outputSummary: (result) => ({
          role: "raw_video_analyze",
          threadId: result.threadId,
          turnId: result.turnId,
          status: result.status,
          inputMode: "raw_video_path_text",
        }),
      });
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
      const sampleArtifact = await loadSampleArtifact(agentRun.sampleVideoId);
      const context = createRecoveredContext({ job, agentRun, sampleArtifact, skillPath: SKILL_PATH });
      context.roleProfile = null;
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
        const turn = await runStage(context, STAGES.turnCollected, 88, {
          artifactId: agentRun.artifactId,
          parentArtifactId: agentRun.parentArtifactId,
          inputSummary: { role: ROLE, threadId: agentRun.threadId, turnId: agentRun.turnId, sheetCount: agentRun.contactSheets?.length ?? 0 },
          action: () => appServer.collectTurnResult({
            workspaceRoot: rawWorkspaceRoot,
            threadId: agentRun.threadId,
            turnId: agentRun.turnId,
            timeoutSeconds: 60,
          }),
          outputSummary: (result) => ({
            role: "raw_video_analyze",
            threadId: result.threadId,
            turnId: result.turnId,
            status: result.status,
            profileVersion: null,
            promptTemplateId: null,
            promptTemplateVersion: null,
            promptTemplateHash: null,
          }),
        });
        updateActiveThreadMessage(context, turn.threadId, turn.turnId, turn.activeThreadMessage ?? null, turn.status, {
          role: "raw_video_analyze",
          fallbackMessage: "正在分析镜头边界",
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
        await writeCompletedAnalysis({
          context,
          agentRun,
          turn,
          runStage,
          stages: STAGES,
          prepareInput,
          store,
          buildProcessedAnalysis,
          attachAnalysis,
          artifactIndex,
          resolveExistingFileHash: (sampleVideoId) => resolveExistingFileHashImpl(sampleVideoId, artifactIndex),
          loadSampleArtifact,
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
            renderVisualSummaryTurnInputs,
            validateTransformResult,
            summarizeTransformResult,
            validateVisualSummaryResult,
            applyVisualSummaryResult,
            summarizeVisualSummaryResult,
            acquireLeaseWithRetry,
          },
          codedError,
          role: "raw_video_analyze",
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
    return serviceRuntime.recoverActiveAgentRuns({
      role: ROLE,
      collectAgentRun,
      loadSampleArtifact,
    });
  }

  async function loadSampleArtifact(sampleVideoId) {
    return store.readJson(path.join(store.sampleDir(sampleVideoId), "artifact.json"));
  }

  async function attachAnalysis(sampleVideoId, analysis, traceMeta = {}) {
    const artifactPath = path.join(store.sampleDir(sampleVideoId), "artifact.json");
    const artifact = await store.readJson(artifactPath);
    artifact.shotBoundaryAnalysis = analysis;
    artifact.shotBoundaryAnalysisHistory = appendShotBoundaryHistory(artifact.shotBoundaryAnalysisHistory, analysis, {
      traceId: traceMeta.traceId ?? artifact.trace?.traceId ?? null,
      sourceTraceId: traceMeta.sourceTraceId ?? artifact.trace?.traceId ?? null,
    });
    await store.writeJson(artifactPath, artifact);
    return artifact;
  }

  async function runCacheLookupLocal(context, prepared, contactSheets) {
    const cacheContext = {
      ...context,
      roleProfile: context.reviewRoleProfile ?? context.roleProfile,
      skillHash: context.reviewSkillHash ?? context.skillHash,
    };
    return runCacheLookupImpl({
      context: cacheContext,
        prepared,
        contactSheets,
        runStage: serviceRuntime.runStage,
        stageName: STAGES.cacheLookup,
        findCached: () => findCachedArtifactImpl({
        context: cacheContext,
        prepared,
        contactSheets,
        artifactIndex,
        stageName: STAGES.resultWritten,
        cacheParams,
        compatibleCacheParams: [
          { mode: "split_predecessor", build: splitPredecessorCacheParams },
          { mode: "legacy_promptless", build: legacyCacheParams },
        ],
        evaluateCacheEligibility,
        resolveExistingFileHash: (sampleVideoId) => resolveExistingFileHashImpl(sampleVideoId, artifactIndex),
      }),
    });
  }

  async function reuseCachedAnalysisLocal(context, cachePrompt) {
    await reuseCachedAnalysisImpl({
      context,
      cachePrompt,
      runStage: serviceRuntime.runStage,
      stageName: STAGES.cacheReuse,
      resolvePrompt: () => resolveCachedPromptImpl({ cachePrompt, artifactIndex, evaluateCacheEligibility, codedError }),
      buildCacheReuseAnalysis,
      attachAnalysis,
    });
    jobStore.updateJob(context.job.jobId, { stage: SAMPLE_STATUS.processed, status: SAMPLE_STATUS.processed, progress: 100, cachePrompt: null, errorSummary: null, activeThreadMessage: null });
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
      role: "raw_video_analyze",
      skillPath: null,
      roleProfile: null,
      promptTemplate: null,
      initFingerprint: null,
    });
  }

  function createRecoveredContext(args) {
    return createRecoveredContextImpl(args);
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

  function updateActiveThreadMessage(context, threadId, turnId, message, status, options = {}) {
    const normalized = buildActiveThreadMessage(threadId, turnId, message, status, options);
    if (normalized || !isPendingTurnStatus(status)) {
      jobStore.updateJob(context.job.jobId, { activeThreadMessage: normalized });
    }
    return normalized;
  }

  function failAgentRun(context, error) {
    return serviceRuntime.failAgentRun(context, error);
  }

  function markRetryableCollectFailure(context, error) {
    return serviceRuntime.markRetryableCollectFailure(context, error);
  }

  return { enqueue, resolveCacheDecision, prepareInput, buildTurnInputs, collectAgentRun, recoverActiveAgentRuns };
}

function badRequestError(code, message) {
  const error = codedError(code, message, null, false);
  error.statusCode = 400;
  return error;
}

function buildInitFingerprint(context) {
  return contentHash(JSON.stringify({
    profileVersion: context.reviewRoleProfile?.profileVersion ?? null,
    initTemplateHash: context.reviewRoleProfile?.init?.templateHash ?? null,
    skillHash: context.reviewSkillHash ?? null,
    readyText: context.reviewRoleProfile?.init?.readyText ?? null,
  }));
}

function buildTransformPromptTemplate(roleProfile) {
  const prompt = roleProfile?.turnTemplates?.transform ?? {};
  return {
    promptTemplateId: "transform",
    promptTemplateVersion: prompt.templateVersion ?? null,
    promptTemplateHash: prompt.templateHash ?? null,
  };
}

function round(value) {
  return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null;
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

module.exports = { ROLE, SKILL_PATH, STAGES, createShotBoundaryService, prepareInput, buildTurnInputs, renderAnalyzeTurnInputs };

function normalizeEnableReview(value) {
  if (value === false || value === "false" || value === "0" || value === 0) return false;
  return true;
}

function reviewMode(context) {
  return context?.enableReview === false ? "unreviewed" : "reviewed";
}

function resolveRawVideoPath(sampleArtifact, runtimeRoot) {
  const originalUri = sampleArtifact?.sampleVideo?.original?.uri ?? null;
  const normalizedUri = sampleArtifact?.sampleVideo?.normalized?.uri ?? null;
  const targetUri = originalUri || normalizedUri;
  if (!targetUri) {
    throw codedError("shot_boundary_video_path_missing", "未找到可用于切镜的本地视频路径", {
      validation: {
        validatorCode: "shot_boundary_video_path_missing",
      },
    }, false);
  }
  const localPath = targetUri.startsWith("/runtime/")
    ? path.join(runtimeRoot, ...targetUri.slice("/runtime/".length).split("/"))
    : targetUri;
  if (!path.isAbsolute(localPath)) {
    throw codedError("shot_boundary_video_path_invalid", "切镜视频路径解析失败", {
      validation: {
        validatorCode: "shot_boundary_video_path_invalid",
      },
    }, false);
  }
  return localPath;
}
