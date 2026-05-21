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
  resultWritten: "agent.shotBoundary.resultWritten",
};

function createShotBoundaryService({
  rootDir,
  store,
  logger,
  jobStore,
  artifactIndex,
  threadPool = createThreadPoolProxy(),
  appServer = createAppServerBridge(),
  skillPath = SKILL_PATH,
} = {}) {
  async function enqueue({ sampleVideoId, analysisFps = 1 }) {
    await store.ensureRuntimeDirs();
    const sampleArtifact = await loadSampleArtifact(sampleVideoId);
    const traceContext = createTraceContext(createTraceIds());
    const artifactId = `artifact_${randomUUID()}`;
    const job = jobStore.createJob({ sampleVideoId, traceId: traceContext.traceId });
    runAnalysis({ sampleVideoId, analysisFps: Number(analysisFps || 1), sampleArtifact, traceContext, artifactId, job }).catch(() => undefined);
    return { processingJobId: job.jobId, sampleVideoId, traceId: traceContext.traceId };
  }

  async function runAnalysis(context) {
    let lease = null;
    try {
      const prepared = await runStage(context, STAGES.inputPrepared, 20, {
        artifactId: context.artifactId,
        parentArtifactId: context.sampleArtifact.sampleVideo.artifactId,
        inputSummary: { sampleVideoId: context.sampleVideoId, analysisFps: context.analysisFps },
        action: () => prepareInput(context.sampleArtifact, context.analysisFps),
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
        action: () => appServer.runTurnWithInputs({
          workspaceRoot: rootDir,
          threadId: lease.thread_id,
          skillPath,
          inputs: buildTurnInputs(prepared),
          timeoutSeconds: 240,
        }),
        outputSummary: (result) => ({ role: ROLE, threadId: result.threadId, turnId: result.turnId, status: result.status }),
      });
      const analysis = parseAgentResult(turn.finalMessage, prepared, context, lease, turn);
      await runStage(context, STAGES.resultWritten, 95, {
        artifactId: analysis.artifactId,
        parentArtifactId: analysis.parentArtifactId,
        inputSummary: { turnId: turn.turnId, frameCount: prepared.frames.length, stride: prepared.analysisSampling.stride },
        action: async () => {
          await attachAnalysis(context.sampleVideoId, analysis);
          await artifactIndex.registerSampleArtifact({ artifact: await loadSampleArtifact(context.sampleVideoId), fileHash: await resolveExistingFileHash(context.sampleVideoId), traceId: context.traceContext.traceId });
          await threadPool.releaseLease({ leaseId: lease.lease_id, ownerId: context.traceContext.traceId });
          lease = null;
          return analysis;
        },
        outputSummary: (result) => ({ status: result.status, shotCount: result.shots.length, artifactType: result.type }),
      });
      jobStore.updateJob(context.job.jobId, { stage: SAMPLE_STATUS.processed, status: SAMPLE_STATUS.processed, progress: 100 });
    } catch (error) {
      if (lease?.thread_id) {
        await threadPool.discardThread({ threadId: lease.thread_id, reason: "shot-boundary-analysis-failed" }).catch(() => undefined);
      }
      await markFailed(context, error);
    }
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
    const activeStage = context.activeStage ?? { stageName: STAGES.turnStarted, artifactId: context.artifactId, parentArtifactId: context.sampleArtifact?.sampleVideo?.artifactId ?? null, inputSummary: null, outputSummary: null, startedAt: Date.now() };
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
    jobStore.updateJob(context.job.jobId, { stage: activeStage.stageName, status: SAMPLE_STATUS.failed, progress: 100, errorSummary: { ...errorSummary, debugSnapshotUri: snapshot.uri } });
    context.activeStage = null;
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

  return { enqueue, prepareInput };
}

function prepareInput(artifact, analysisFps) {
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
    frames: frames.filter((_, index) => index % stride === 0).map((frame, index) => ({
      index,
      frameId: frame.frameId,
      artifactId: frame.artifactId,
      parentArtifactId: frame.parentArtifactId ?? null,
      timestamp: Number(frame.timestamp ?? 0),
      fileName: basename(frame.imageUri),
      filePath: frame.imageUri,
    })),
  });
}

function buildTurnInputs(input) {
  const safeInput = sanitizeForAppServerText(input);
  return [
    {
      type: "text",
      text: [
        "请基于以下帧 manifest 做镜头切分分析，只返回 JSON object。",
        JSON.stringify(safeInput),
      ].join("\n"),
      text_elements: [],
    },
  ];
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
  const frameIds = new Set(frames.map((frame) => frame.frameId));
  const safeDuration = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 1;
  const normalized = rawShots.map((shot, index) => {
    const start = clamp(Number(shot.start ?? 0), 0, safeDuration);
    const end = clamp(Number(shot.end ?? safeDuration), start + 0.01, safeDuration);
    const representativeFrameId = frameIds.has(shot.representativeFrameId) ? shot.representativeFrameId : frames[0]?.frameId ?? "";
    return {
      id: `shot_${index + 1}`,
      index,
      start,
      end,
      representativeFrameId,
      confidence: clamp(Number(shot.confidence ?? 0.5), 0, 1),
      reason: String(shot.reason ?? "视觉变化").slice(0, 160),
    };
  }).filter((shot) => shot.end > shot.start && shot.representativeFrameId);
  if (normalized.length) return normalized;
  return [{ id: "shot_1", index: 0, start: 0, end: safeDuration, representativeFrameId: frames[0]?.frameId ?? "", confidence: 0.4, reason: "帧数量不足，保留单镜头" }];
}

function buildFailedArtifact(context, errorSummary) {
  return {
    artifactId: context.artifactId,
    parentArtifactId: context.sampleArtifact?.sampleVideo?.artifactId ?? null,
    type: "shot-boundary-analysis",
    status: "failed",
    sourceFrameArtifactIds: [],
    extractSampling: null,
    analysisSampling: { fps: context.analysisFps, stride: null },
    agent: { provider: "codex-appserver", role: ROLE, skillPath: SKILL_PATH, threadId: null, leaseId: null, turnId: null },
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
    retryable: true,
  };
}

function sanitizeDebugPayload(error) {
  return {
    code: error?.code ?? null,
    message: error instanceof Error ? error.message : String(error ?? "unknown").slice(0, 240),
    appServer: error?.debugPayload ?? null,
  };
}

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
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

module.exports = { ROLE, SKILL_PATH, STAGES, createShotBoundaryService, prepareInput, buildTurnInputs, normalizeShots, sanitizeForAppServerText };
