const fs = require("fs/promises");
const path = require("path");
const { randomUUID, createHash } = require("crypto");
const { createTraceContext, SAMPLE_STATUS } = require("../../../Core/Workspace/sample-video-contracts");
const { createTraceIds, nextStage } = require("../../../Infrastructure/Observability/trace");
const { createAppServerBridge } = require("./appserver-bridge");
const { createThreadPoolProxy } = require("./threadpool-proxy");

const ROLE = "shot-boundary-analyzer";
const SKILL_PATH = "C:\\ByteDanceFullStack\\.agents\\skills\\shot-boundary-analyzer\\SKILL.md";
const STAGES = {
  inputPrepared: "agent.shotBoundary.inputPrepared",
  threadAcquired: "agent.shotBoundary.threadAcquired",
  turnStarted: "agent.shotBoundary.turnStarted",
  turnCollected: "agent.shotBoundary.turnCollected",
  resultWritten: "agent.shotBoundary.resultWritten",
};
const POLL_INTERVAL_MS = 2000;
const ORPHAN_TTL_MS = 30 * 60 * 1000;
const MIN_SHOT_DURATION_SECONDS = 0.01;

function createShotBoundaryService({
  rootDir,
  store,
  logger,
  jobStore,
  artifactIndex,
  threadPool = createThreadPoolProxy(),
  appServer = createAppServerBridge(),
  skillPath = SKILL_PATH,
  pollIntervalMs = POLL_INTERVAL_MS,
  orphanTtlMs = ORPHAN_TTL_MS,
} = {}) {
  const collectingJobs = new Set();

  async function enqueue({ sampleVideoId, analysisFps = 1 }) {
    await store.ensureRuntimeDirs();
    const sampleArtifact = await loadSampleArtifact(sampleVideoId);
    const traceContext = createTraceContext(createTraceIds());
    const artifactId = `artifact_${randomUUID()}`;
    const job = jobStore.createJob({ sampleVideoId, traceId: traceContext.traceId });
    runAnalysis({ sampleVideoId, analysisFps: Number(analysisFps || 1), sampleArtifact, traceContext, artifactId, job }).catch(() => undefined);
    return { processingJobId: job.jobId, sampleVideoId, traceId: traceContext.traceId };
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
        action: () => prepareInput(context.sampleArtifact, context.analysisFps, { runtimeRoot: store.runtimeRoot }),
        outputSummary: (input) => ({
          frameCount: input.frames.length,
          stride: input.analysisSampling.stride,
          analysisFps: input.analysisSampling.fps,
          extractFps: round(input.extractSampling.actualFrameCount / input.durationSeconds),
        }),
      });
      const cached = await findCachedArtifact(context, prepared);
      if (cached) {
        await attachAnalysis(context.sampleVideoId, cached);
        jobStore.updateJob(context.job.jobId, { stage: SAMPLE_STATUS.processed, status: SAMPLE_STATUS.processed, progress: 100 });
        return;
      }
      lease = await runStage(context, STAGES.threadAcquired, 45, {
        artifactId: context.artifactId,
        parentArtifactId: context.sampleArtifact.sampleVideo.artifactId,
        inputSummary: { role: ROLE, frameCount: prepared.frames.length, stride: prepared.analysisSampling.stride },
        action: () => threadPool.acquireLease({ role: ROLE, ownerId: context.traceContext.traceId }),
        outputSummary: (result) => ({ role: ROLE, leaseId: result.lease_id, threadId: result.thread_id }),
      });
      const turn = await runStage(context, STAGES.turnStarted, 80, {
        artifactId: context.artifactId,
        parentArtifactId: context.sampleArtifact.sampleVideo.artifactId,
        inputSummary: { role: ROLE, threadId: lease.thread_id, leaseId: lease.lease_id, frameCount: prepared.frames.length },
        action: () => appServer.startTurnWithInputs({
          workspaceRoot: rootDir,
          threadId: lease.thread_id,
          skillPath,
          inputs: buildTurnInputs(prepared),
          timeoutSeconds: 240,
        }),
        outputSummary: (result) => ({ role: ROLE, threadId: result.threadId, turnId: result.turnId, status: result.status }),
      });
      const agentRun = buildAgentRun({ context, lease, turn, prepared });
      jobStore.updateJob(context.job.jobId, { agentRun, stage: STAGES.turnStarted, status: SAMPLE_STATUS.processing, progress: 80 });
      lease = null;
      scheduleCollect(context.job.jobId, 0);
    } catch (error) {
      if (lease?.thread_id) {
        await threadPool.discardThread({ threadId: lease.thread_id, reason: "shot-boundary-analysis-failed" }).catch(() => undefined);
      }
      await markFailed(context, error);
    }
  }

  async function collectAgentRun(jobId) {
    if (collectingJobs.has(jobId)) return { status: "collecting" };
    collectingJobs.add(jobId);
    try {
      const job = jobStore.getJob(jobId);
      const agentRun = job?.agentRun;
      if (job?.status === SAMPLE_STATUS.processed || job?.status === SAMPLE_STATUS.failed) return { status: job.status };
      if (!job || !agentRun || !agentRun.threadId || !agentRun.turnId) return null;
      const sampleArtifact = await loadSampleArtifact(agentRun.sampleVideoId);
      const context = createRecoveredContext({ job, agentRun, sampleArtifact });
      if (Date.now() - Date.parse(agentRun.startedAt) > orphanTtlMs) {
        const error = codedError("shot_boundary_turn_orphaned", "切镜 Agent 长时间未完成，已清理遗留 lease");
        await failAgentRun(context, error);
        return { status: SAMPLE_STATUS.failed };
      }
      const prepared = prepareInput(sampleArtifact, agentRun.analysisFps, { runtimeRoot: store.runtimeRoot });
      try {
        jobStore.updateJob(job.jobId, { agentRun: { ...agentRun, status: "collecting", updatedAt: new Date().toISOString() }, stage: STAGES.turnCollected, status: SAMPLE_STATUS.processing, progress: 88 });
        const turn = await runStage(context, STAGES.turnCollected, 88, {
          artifactId: agentRun.artifactId,
          parentArtifactId: agentRun.parentArtifactId,
          inputSummary: { role: ROLE, threadId: agentRun.threadId, turnId: agentRun.turnId, frameCount: prepared.frames.length },
          action: () => appServer.collectTurnResult({
            workspaceRoot: rootDir,
            threadId: agentRun.threadId,
            turnId: agentRun.turnId,
            timeoutSeconds: 60,
          }),
          outputSummary: (result) => ({ role: ROLE, threadId: result.threadId, turnId: result.turnId, status: result.status }),
        });
        if (turn.status !== "completed") {
          const updatedRun = { ...agentRun, status: "collecting", updatedAt: new Date().toISOString() };
          jobStore.updateJob(job.jobId, { agentRun: updatedRun, stage: STAGES.turnCollected, status: SAMPLE_STATUS.processing, progress: 88, errorSummary: null });
          scheduleCollect(job.jobId);
          return turn;
        }
        await writeCompletedAnalysis({ context, prepared, agentRun, turn });
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
    } finally {
      collectingJobs.delete(jobId);
    }
  }

  async function writeCompletedAnalysis({ context, prepared, agentRun, turn }) {
    await runStage(context, STAGES.resultWritten, 95, {
      artifactId: context.artifactId,
      parentArtifactId: prepared.sourceArtifactId ?? null,
      inputSummary: { turnId: turn.turnId, frameCount: prepared.frames.length, stride: prepared.analysisSampling.stride },
      action: async () => {
        const lease = { thread_id: agentRun.threadId, lease_id: agentRun.leaseId };
        const analysis = parseAgentResult(turn.finalMessage, prepared, context, lease, turn);
        await attachAnalysis(context.sampleVideoId, analysis);
        await artifactIndex.registerSampleArtifact({ artifact: await loadSampleArtifact(context.sampleVideoId), fileHash: await resolveExistingFileHash(context.sampleVideoId), traceId: context.traceContext.traceId });
        await finalizeLease(threadPool, agentRun);
        return analysis;
      },
      outputSummary: (result) => ({ status: result.status, shotCount: result.shots.length, artifactType: result.type }),
    });
    jobStore.updateJob(context.job.jobId, {
      agentRun: { ...agentRun, status: "completed", updatedAt: new Date().toISOString() },
      stage: SAMPLE_STATUS.processed,
      status: SAMPLE_STATUS.processed,
      progress: 100,
      errorSummary: null,
    });
  }

  async function failAgentRun(context, error) {
    const agentRun = context.job.agentRun;
    if (agentRun?.threadId) {
      await threadPool.discardThread({ threadId: agentRun.threadId, reason: "shot-boundary-analysis-failed" }).catch(() => undefined);
    }
    if (agentRun?.traceId && typeof threadPool.releaseOwnerLeases === "function") {
      await threadPool.releaseOwnerLeases(agentRun.traceId).catch(() => undefined);
    }
    await markFailed(context, error);
  }

  async function recoverActiveAgentRuns() {
    const jobs = typeof jobStore.listActiveAgentRuns === "function" ? jobStore.listActiveAgentRuns({ role: ROLE }) : [];
    await Promise.all(jobs.map((job) => collectAgentRun(job.jobId).catch(() => undefined)));
    return { recovered: jobs.length };
  }

  async function runStage(context, stageName, progress, options) {
    context.traceContext = nextStage(context.traceContext);
    const startedAt = Date.now();
    context.activeStage = { stageName, artifactId: options.artifactId ?? null, parentArtifactId: options.parentArtifactId ?? null, inputSummary: options.inputSummary ?? null, outputSummary: null, startedAt };
    jobStore.updateJob(context.job.jobId, { stage: stageName, status: SAMPLE_STATUS.processing, progress });
    await logger.writeStageLog({ traceContext: context.traceContext, stageName, event: "stage.start", artifactId: options.artifactId ?? null, parentArtifactId: options.parentArtifactId ?? null, inputSummary: options.inputSummary ?? null });
    const result = await options.action();
    const outputSummary = options.outputSummary ? options.outputSummary(result) : null;
    context.activeStage.outputSummary = outputSummary;
    await logger.writeStageLog({ traceContext: context.traceContext, stageName, event: "stage.end", artifactId: options.artifactId ?? null, parentArtifactId: options.parentArtifactId ?? null, outputSummary, durationMs: Date.now() - startedAt });
    context.activeStage = null;
    return result;
  }

  async function markFailed(context, error) {
    const agentRun = context.job?.agentRun ?? null;
    const activeStage = context.activeStage ?? { stageName: agentRun ? STAGES.turnCollected : STAGES.turnStarted, artifactId: context.artifactId, parentArtifactId: agentRun?.parentArtifactId ?? context.sampleArtifact?.sampleVideo?.artifactId ?? null, inputSummary: null, outputSummary: null, startedAt: Date.now() };
    const errorSummary = safeError(error, activeStage.stageName);
    const failedArtifact = buildFailedArtifact(context, errorSummary);
    await attachAnalysis(context.sampleVideoId, failedArtifact).catch(() => undefined);
    const snapshot = await logger.writeDebugSnapshot({
      traceContext: context.traceContext,
      stageName: activeStage.stageName,
      artifactId: activeStage.artifactId,
      parentArtifactId: activeStage.parentArtifactId,
      reason: errorSummary.code,
      inputSummary: activeStage.inputSummary,
      outputSummary: activeStage.outputSummary,
      debugPayload: sanitizeDebugPayload(error),
    });
    await logger.writeStageLog({
      traceContext: context.traceContext,
      stageName: activeStage.stageName,
      event: "stage.fail",
      artifactId: activeStage.artifactId,
      parentArtifactId: activeStage.parentArtifactId,
      outputSummary: activeStage.outputSummary,
      durationMs: activeStage.startedAt ? Date.now() - activeStage.startedAt : null,
      errorSummary: { ...errorSummary, debugSnapshotUri: snapshot.uri },
    });
    jobStore.updateJob(context.job.jobId, {
      agentRun: context.job.agentRun ? { ...context.job.agentRun, status: "failed", updatedAt: new Date().toISOString() } : context.job.agentRun,
      stage: activeStage.stageName,
      status: SAMPLE_STATUS.failed,
      progress: 100,
      errorSummary: { ...errorSummary, debugSnapshotUri: snapshot.uri },
    });
    context.activeStage = null;
  }

  async function markRetryableCollectFailure(context, error) {
    const agentRun = context.job.agentRun;
    const errorSummary = {
      code: error?.code ?? "appserver_turn_collect_retryable",
      message: error instanceof Error ? error.message : "AppServer turn 补查暂时失败",
      stageName: STAGES.turnCollected,
      retryable: true,
    };
    jobStore.updateJob(context.job.jobId, {
      agentRun: agentRun ? { ...agentRun, status: "collecting", updatedAt: new Date().toISOString() } : agentRun,
      stage: STAGES.turnCollected,
      status: SAMPLE_STATUS.processing,
      progress: 88,
      errorSummary,
    });
  }

  async function loadSampleArtifact(sampleVideoId) {
    const artifactPath = path.join(store.sampleDir(sampleVideoId), "artifact.json");
    return store.readJson(artifactPath);
  }

  async function attachAnalysis(sampleVideoId, analysis) {
    const artifactPath = path.join(store.sampleDir(sampleVideoId), "artifact.json");
    const artifact = await store.readJson(artifactPath);
    artifact.shotBoundaryAnalysis = analysis;
    await store.writeJson(artifactPath, artifact);
    return artifact;
  }

  async function findCachedArtifact(context, input) {
    const fileHash = await resolveExistingFileHash(context.sampleVideoId);
    if (!fileHash) return null;
    const cache = await artifactIndex.findCacheEntry({ fileHash, stageName: STAGES.resultWritten, params: cacheParams(input) });
    if (!cache?.sampleVideoId) return null;
    const artifact = await artifactIndex.loadItem(cache.sampleVideoId);
    return artifact?.shotBoundaryAnalysis ?? null;
  }

  async function resolveExistingFileHash(sampleVideoId) {
    const detail = await artifactIndex.getItem(sampleVideoId);
    return detail?.fileHash ?? `sampleVideoId:${sampleVideoId}`;
  }

  return { enqueue, prepareInput, collectAgentRun, recoverActiveAgentRuns };
}

function buildAgentRun({ context, lease, turn, prepared }) {
  const now = new Date().toISOString();
  return {
    provider: "codex-appserver",
    role: ROLE,
    leaseId: lease.lease_id,
    threadId: lease.thread_id,
    turnId: turn.turnId ?? null,
    traceId: context.traceContext.traceId,
    artifactId: context.artifactId,
    parentArtifactId: prepared.sourceArtifactId ?? null,
    sampleVideoId: context.sampleVideoId,
    analysisFps: context.analysisFps,
    status: "turn_submitted",
    preparedInputSummary: {
      frameCount: prepared.frames.length,
      stride: prepared.analysisSampling.stride,
      analysisFps: prepared.analysisSampling.fps,
    },
    startedAt: now,
    updatedAt: now,
  };
}

function createRecoveredContext({ job, agentRun, sampleArtifact }) {
  return {
    sampleVideoId: agentRun.sampleVideoId,
    analysisFps: agentRun.analysisFps,
    sampleArtifact,
    traceContext: {
      runId: agentRun.traceId,
      traceId: agentRun.traceId,
      stageId: `stage_recover_${Date.now()}`,
    },
    artifactId: agentRun.artifactId,
    job,
    activeStage: null,
  };
}

function isRetryableCollectError(error) {
  const code = String(error?.code ?? "");
  return ["appserver_bridge_failed", "appserver_bridge_timeout", "appserver_turn_collect_failed"].includes(code);
}

function prepareInput(artifact, analysisFps, { runtimeRoot = null } = {}) {
  const durationSeconds = Number(artifact.metadata?.durationSeconds ?? 0);
  const frames = Array.isArray(artifact.frames) ? artifact.frames : [];
  const summary = artifact.frameOutputSummary ?? {};
  const actualFrameCount = Number(summary.actualFrameCount ?? frames.length);
  const requestedFps = Number(summary.frameSampleRateFps ?? artifact.processingOptions?.frameSampleRateFps ?? 1);
  const extractFps = durationSeconds > 0 ? actualFrameCount / durationSeconds : requestedFps;
  if (!durationSeconds || !frames.length || !Number.isFinite(extractFps) || extractFps <= 0) throw codedError("shot_boundary_input_invalid", "抽帧产物不足，无法启动镜头切分");
  if (analysisFps > extractFps) throw codedError("analysis_fps_exceeds_extract_fps", "分析采样率高于抽帧采样率，请重新抽帧或降低分析采样率");
  const stride = Math.max(1, Math.round(extractFps / analysisFps));
  const sourceArtifactId = artifact.sampleVideo?.artifactId;
  return sanitizeForAppServerText({
    sampleVideoId: artifact.sampleVideoId,
    sourceArtifactId,
    traceId: artifact.trace?.traceId ?? null,
    framesDir: "frames",
    durationSeconds,
    extractSampling: {
      requestedFps,
      targetFrameCount: Number(summary.targetFrameCount ?? frames.length),
      actualFrameCount,
      maxFrames: Number(summary.maxFrames ?? 120),
    },
    analysisSampling: { fps: analysisFps, stride },
    frames: frames.reduce((result, frame, sourceFrameIndex) => {
      if (sourceFrameIndex % stride !== 0) return result;
      result.push({
        inputIndex: result.length,
        sourceFrameIndex,
        frameId: frame.frameId,
        artifactId: frame.artifactId,
        parentArtifactId: frame.parentArtifactId ?? null,
        timestamp: Number(frame.timestamp ?? 0),
        fileName: basename(frame.imageUri),
        filePath: resolveLocalImagePath(frame.imageUri, runtimeRoot),
      });
      return result;
    }, []),
  });
}

function buildTurnInputs(input) {
  const extractFps = input.durationSeconds > 0 ? round(input.extractSampling.actualFrameCount / input.durationSeconds) : round(input.extractSampling.requestedFps);
  const inputs = [
    {
      type: "text",
      text: [
        "请基于后续 localImage 图片序列做镜头切分，只返回 JSON object。",
        "图片已按时间顺序排列；每张图片前的文字给出 frameId 和 timestamp。",
        `采样信息：extractFps=${extractFps}，analysisFps=${round(input.analysisSampling.fps)}，stride=${input.analysisSampling.stride}，durationSeconds=${round(input.durationSeconds)}，frameCount=${input.frames.length}。`,
        `时间范围：0 到 ${round(input.durationSeconds)} 秒。`,
        "输出必须可用于脚本切分原视频轨：start/end 单位为秒，覆盖 0 到 durationSeconds，按时间升序，不重叠。",
        `输出 schema：${JSON.stringify({ shots: [{ index: 0, shotNo: "S001", start: 0, end: round(input.durationSeconds), representativeFrameId: "frame_example", confidence: 0.8, reason: "视觉变化摘要" }] })}`,
        "返回前自检：JSON 可解析；shots 非空；每个 representativeFrameId 来自输入；start < end；首镜头 start=0；末镜头 end=durationSeconds。",
      ].join("\n"),
      text_elements: [],
    },
  ];
  for (const frame of input.frames) {
    inputs.push({
      type: "localImage",
      path: frame.filePath,
    });
  }
  return sanitizeForAppServerText(inputs);
}

function sanitizeForAppServerText(value) {
  if (typeof value === "string") return value.replace(/[\uD800-\uDFFF]/g, "");
  if (Array.isArray(value)) return value.map((item) => sanitizeForAppServerText(item));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeForAppServerText(item)]));
}

function parseAgentResult(message, input, context, lease, turn) {
  const parsed = extractJsonObject(message);
  const rawShots = Array.isArray(parsed.shots) ? parsed.shots : [];
  const fallbackEnd = input.durationSeconds || input.frames.at(-1)?.timestamp || 0;
  const shots = normalizeShots(rawShots, input.frames, fallbackEnd);
  const qualityIssue = detectReasonEncodingIssue(shots);
  if (qualityIssue) {
    throw codedError(
      "agent_output_quality_failed",
      "切镜 Agent 输出存在编码异常，已阻止写入 processed 产物",
      {
        turnId: turn?.turnId ?? null,
        parseFailureReason: qualityIssue.reason,
        outputSummary: summarizeAgentOutput(message, rawShots, shots),
        suspiciousReason: qualityIssue.suspiciousReason,
      },
      true,
    );
  }
  return {
    artifactId: context.artifactId,
    parentArtifactId: input.sourceArtifactId,
    type: "shot-boundary-analysis",
    status: "processed",
    sourceFrameArtifactIds: input.frames.map((frame) => frame.artifactId),
    extractSampling: input.extractSampling,
    analysisSampling: input.analysisSampling,
    agent: {
      provider: "codex-appserver",
      role: ROLE,
      skillPath: SKILL_PATH,
      threadId: lease.thread_id,
      leaseId: lease.lease_id,
      turnId: turn.turnId,
    },
    shots,
    createdAt: new Date().toISOString(),
  };
}

function normalizeShots(rawShots, frames, durationSeconds) {
  const safeDuration = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 1;
  const normalizedFrames = Array.isArray(frames)
    ? frames
      .map((frame) => ({
        frameId: frame.frameId,
        timestamp: Number(frame.timestamp ?? 0),
      }))
      .filter((frame) => frame.frameId)
      .sort((first, second) => first.timestamp - second.timestamp)
    : [];
  const normalized = rawShots
    .map((shot, index) => ({
      start: clamp(Number(shot?.start ?? 0), 0, safeDuration),
      end: clamp(Number(shot?.end ?? safeDuration), 0, safeDuration),
      shotNo: normalizeShotNo(shot?.shotNo),
      representativeFrameId: typeof shot?.representativeFrameId === "string" ? shot.representativeFrameId : "",
      confidence: clamp(Number(shot?.confidence ?? 0.5), 0, 1),
      reason: String(shot?.reason ?? "视觉变化").slice(0, 160),
    }))
    .filter((shot) => Number.isFinite(shot.start) && Number.isFinite(shot.end))
    .sort((first, second) => first.start - second.start || first.end - second.end);
  if (!normalized.length) return [buildFallbackShot(normalizedFrames, safeDuration)];
  const output = [];
  for (let index = 0; index < normalized.length; index += 1) {
    const shot = normalized[index];
    const start = output.length ? output[output.length - 1].end : 0;
    if (start >= safeDuration) break;
    const isLast = index === normalized.length - 1;
    const minEnd = Math.min(safeDuration, start + MIN_SHOT_DURATION_SECONDS);
    const end = isLast ? safeDuration : clamp(shot.end, minEnd, safeDuration);
    output.push({
      id: `shot_${index + 1}`,
      index,
      shotNo: shot.shotNo || formatShotNo(index),
      start,
      end: roundNormalizedTime(end),
      representativeFrameId: resolveRepresentativeFrameId(shot.representativeFrameId, normalizedFrames, start, end),
      confidence: shot.confidence,
      reason: shot.reason,
    });
  }
  const valid = output.filter((shot) => shot.end > shot.start && shot.representativeFrameId);
  if (!valid.length) return [buildFallbackShot(normalizedFrames, safeDuration)];
  valid[valid.length - 1].end = roundNormalizedTime(safeDuration);
  return valid;
}

async function finalizeLease(threadPool, agentRun) {
  const config = typeof threadPool.config === "function" ? await threadPool.config().catch(() => null) : null;
  if (config?.ok && config.discardOnRelease && agentRun?.threadId) {
    await threadPool.discardThread({ threadId: agentRun.threadId, reason: "graceful-successful-release" });
    if (typeof threadPool.releaseOwnerLeases === "function" && agentRun?.traceId) {
      await threadPool.releaseOwnerLeases(agentRun.traceId).catch(() => undefined);
    }
    return { mode: "graceful-discard" };
  }
  await threadPool.releaseLease({ leaseId: agentRun.leaseId, ownerId: agentRun.traceId });
  return { mode: "lease-release" };
}

function normalizeShotNo(value) {
  return String(value ?? "").trim();
}

function formatShotNo(index) {
  return `S${String(index + 1).padStart(3, "0")}`;
}

function buildFallbackShot(frames, durationSeconds) {
  return {
    id: "shot_1",
    index: 0,
    shotNo: formatShotNo(0),
    start: 0,
    end: roundNormalizedTime(durationSeconds),
    representativeFrameId: resolveRepresentativeFrameId("", frames, 0, durationSeconds),
    confidence: 0.4,
    reason: "帧数量不足，保留单镜头",
  };
}

function detectReasonEncodingIssue(shots) {
  for (const shot of shots) {
    const reason = String(shot?.reason ?? "");
    if (reason.includes("\uFFFD")) {
      return { reason: "reason contains replacement character", suspiciousReason: reason.slice(0, 160) };
    }
    if (looksLikeUtf8Mojibake(reason)) {
      return { reason: "reason matches UTF-8 mojibake pattern", suspiciousReason: reason.slice(0, 160) };
    }
    if (looksLikeGbkMojibake(reason)) {
      return { reason: "reason matches GBK mojibake pattern", suspiciousReason: reason.slice(0, 160) };
    }
  }
  return null;
}

function looksLikeUtf8Mojibake(text) {
  const value = String(text ?? "");
  return /(?:Ã.|Â.|æ[\u0080-\u00FF]|å[\u0080-\u00FF]|ç[\u0080-\u00FF]|ä[\u0080-\u00FF]|é[\u0080-\u00FF]){2,}/.test(value);
}

function looksLikeGbkMojibake(text) {
  const value = String(text ?? "");
  return /(鏈|娴嬪|鏄庢|瑙嗚|鍙樺|锟斤拷)/.test(value);
}

function summarizeAgentOutput(message, rawShots, normalizedShots) {
  return {
    messagePreview: String(message ?? "").replace(/\s+/g, " ").slice(0, 200),
    rawShotCount: Array.isArray(rawShots) ? rawShots.length : 0,
    normalizedShotCount: Array.isArray(normalizedShots) ? normalizedShots.length : 0,
    firstReasons: Array.isArray(normalizedShots) ? normalizedShots.slice(0, 3).map((shot) => String(shot.reason ?? "").slice(0, 80)) : [],
  };
}

function resolveRepresentativeFrameId(frameId, frames, start, end) {
  if (frameId && frames.some((frame) => frame.frameId === frameId)) return frameId;
  if (!frames.length) return "";
  const midpoint = (start + end) / 2;
  const inRange = frames.filter((frame) => frame.timestamp >= start && frame.timestamp <= end);
  const candidates = inRange.length ? inRange : frames;
  let best = candidates[0];
  for (const frame of candidates) {
    if (Math.abs(frame.timestamp - midpoint) < Math.abs(best.timestamp - midpoint)) best = frame;
  }
  return best?.frameId ?? frames[0]?.frameId ?? "";
}

function roundNormalizedTime(value) {
  return round(clamp(value, 0, Number.POSITIVE_INFINITY)) ?? 0;
}

function buildFailedArtifact(context, errorSummary) {
  const agentRun = context.job?.agentRun ?? null;
  return {
    artifactId: context.artifactId,
    parentArtifactId: context.sampleArtifact?.sampleVideo?.artifactId ?? null,
    type: "shot-boundary-analysis",
    status: "failed",
    sourceFrameArtifactIds: [],
    extractSampling: null,
    analysisSampling: { fps: context.analysisFps, stride: null },
    agent: { provider: "codex-appserver", role: ROLE, skillPath: SKILL_PATH, threadId: agentRun?.threadId ?? null, leaseId: agentRun?.leaseId ?? null, turnId: agentRun?.turnId ?? null },
    shots: [],
    reason: errorSummary.message,
    createdAt: new Date().toISOString(),
  };
}

function cacheParams(input) {
  return {
    sourceArtifactId: input.sourceArtifactId,
    extractSampling: input.extractSampling,
    analysisSampling: input.analysisSampling,
    skillHash: createHash("sha256").update(SKILL_PATH).digest("hex").slice(0, 16),
  };
}

function extractJsonObject(text) {
  const value = String(text ?? "").trim();
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start < 0 || end < start) throw codedError("agent_output_parse_failed", "切镜 Agent 未返回 JSON 对象");
  try {
    return JSON.parse(value.slice(start, end + 1));
  } catch (error) {
    error.code = "agent_output_parse_failed";
    throw error;
  }
}

function safeError(error, stageName) {
  return {
    code: error?.code ?? "shot_boundary_failed",
    message: error instanceof Error ? error.message : "镜头切分失败",
    stageName,
    retryable: typeof error?.retryable === "boolean" ? error.retryable : true,
  };
}

function sanitizeDebugPayload(error) {
  const details = error?.debugPayload ?? null;
  return {
    code: error?.code ?? null,
    message: error instanceof Error ? error.message : String(error ?? "unknown").slice(0, 240),
    turnId: details?.turnId ?? null,
    outputSummary: details?.outputSummary ?? null,
    parseFailureReason: details?.parseFailureReason ?? null,
    suspiciousReason: details?.suspiciousReason ?? null,
    appServer: details,
  };
}

function codedError(code, message, debugPayload = null, retryable = true) {
  const error = new Error(message);
  error.code = code;
  error.debugPayload = debugPayload;
  error.retryable = retryable;
  return error;
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function round(value) {
  return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null;
}

function basename(value) {
  return String(value ?? "").split(/[\\/]/).at(-1) ?? "";
}

function resolveLocalImagePath(imageUri, runtimeRoot) {
  const value = String(imageUri ?? "");
  if (runtimeRoot && value.startsWith("/runtime/")) {
    return path.join(runtimeRoot, ...value.slice("/runtime/".length).split("/"));
  }
  if (isAbsolutePath(value)) return value;
  return value;
}

function isAbsolutePath(value) {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\") || value.startsWith("/");
}

module.exports = { ROLE, SKILL_PATH, STAGES, createShotBoundaryService, prepareInput, buildTurnInputs, normalizeShots, sanitizeForAppServerText };
