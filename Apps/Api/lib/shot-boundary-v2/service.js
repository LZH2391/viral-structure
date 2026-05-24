const fs = require("fs/promises");
const path = require("path");
const { randomUUID } = require("crypto");
const { createTraceContext, SAMPLE_STATUS } = require("../../../../Core/Workspace/sample-video-contracts");
const { createTraceIds } = require("../../../../Infrastructure/Observability/trace");
const { loadRoleProfileByRole } = require("../role-profile-loader");
const { createAppServerBridge } = require("../appserver-bridge");
const { createThreadPoolProxy } = require("../threadpool-proxy");
const { acquireLeaseWithRetry, cleanupLease, finalizeLease } = require("../shot-boundary/threadpool-runner");
const { prepareInput, resolveSkillHash, safeError, codedError } = require("../shot-boundary-analysis");
const { appendShotBoundaryHistory } = require("../shot-boundary/history");
const { resolveExistingFileHash } = require("../shot-boundary/cache");
const { buildEvidencePackage } = require("./evidence");
const { renderV2AnalyzeTurnInputs } = require("./input");
const { buildV2ProcessedAnalysis } = require("./result-builder");

const ROLE = "shot-boundary-v2-analyzer";
const SKILL_PATH = "C:\\ByteDanceFullStack\\.agents\\skills\\shot-boundary-v2-analyzer\\SKILL.md";
const STAGES = {
  inputPrepared: "shot.v2.input_prepare",
  evidencePrepared: "shot.v2.evidence_prepare",
  threadAcquired: "shot.v2.thread_acquire",
  turnStarted: "shot.v2.analyze.submit",
  turnCollected: "shot.v2.analyze.collect",
  turnValidated: "shot.v2.validate",
  resultWritten: "shot.v2.merge",
};

function createShotBoundaryV2Service({
  rootDir,
  store,
  logger,
  jobStore,
  artifactIndex,
  threadPool = createThreadPoolProxy(),
  appServer = createAppServerBridge(),
  pollIntervalMs = 2000,
  collectMaxAttempts = 120,
} = {}) {
  async function enqueue({ sampleVideoId, analysisFps = 1 }) {
    await store.ensureRuntimeDirs();
    const artifact = await loadArtifact(sampleVideoId);
    const traceContext = createTraceContext(createTraceIds());
    const artifactId = `artifact_${randomUUID()}`;
    const job = jobStore.createJob({ sampleVideoId, traceId: traceContext.traceId });
    const context = {
      sampleVideoId,
      analysisFps: Number(analysisFps || 1),
      artifact,
      traceContext,
      artifactId,
      role: ROLE,
      skillPath: SKILL_PATH,
      skillHash: await resolveSkillHash(SKILL_PATH),
      roleProfile: await loadRoleProfileByRole(ROLE),
      job,
    };
    runV2(context).catch(() => undefined);
    return { processingJobId: job.jobId, sampleVideoId, traceId: traceContext.traceId, analysisMode: "v2" };
  }

  async function runV2(context) {
    let lease = null;
    try {
      const prepared = await runStage(context, STAGES.inputPrepared, 15, {
        artifactId: context.artifactId,
        parentArtifactId: context.artifact.sampleVideo?.artifactId ?? null,
        inputSummary: { sampleVideoId: context.sampleVideoId, analysisFps: context.analysisFps },
        action: () => prepareInput(context.artifact, context.analysisFps, { runtimeRoot: store.runtimeRoot }),
        outputSummary: (input) => ({
          durationSeconds: input.durationSeconds,
          sampledFrameCount: input.frames.length,
          subtitleSegmentCount: input.subtitleContextSummary?.subtitleSegmentCount ?? 0,
        }),
      });
      context.prepared = prepared;
      const evidence = await runStage(context, STAGES.evidencePrepared, 45, {
        artifactId: context.artifactId,
        parentArtifactId: context.artifact.sampleVideo?.artifactId ?? null,
        inputSummary: { sampleVideoId: context.sampleVideoId },
        action: () => buildEvidencePackage({
          artifact: context.artifact,
          sampleDir: store.sampleDir(context.sampleVideoId),
          store,
          parentArtifactId: context.artifact.sampleVideo?.artifactId ?? null,
        }),
        outputSummary: (result) => ({
          durationSeconds: result.metadata.durationSeconds,
          candidateCount: result.candidates.length,
          denseWindowCount: result.denseWindows.length,
          sheetCount: result.sheets.length,
        }),
      });
      context.evidence = evidence;
      const analyzeTurn = renderV2AnalyzeTurnInputs({ artifact: context.artifact, evidence, roleProfile: context.roleProfile });
      context.promptTemplate = {
        promptTemplateId: analyzeTurn.promptTemplateId,
        promptTemplateVersion: analyzeTurn.promptTemplateVersion,
        promptTemplateHash: analyzeTurn.promptTemplateHash,
      };
      const leaseAcquisition = await runStage(context, STAGES.threadAcquired, 60, {
        artifactId: context.artifactId,
        parentArtifactId: context.artifact.sampleVideo?.artifactId ?? null,
        inputSummary: { role: ROLE, sheetCount: evidence.sheets.length, candidateCount: evidence.candidates.length },
        action: () => acquireLeaseWithRetry(threadPool, {
          role: ROLE,
          ownerId: context.traceContext.traceId,
          maxAttempts: 3,
          backoffMs: [500, 1000],
          codedError,
        }),
        outputSummary: (result) => ({
          role: ROLE,
          leaseId: result.lease.lease_id,
          threadId: result.lease.thread_id,
          attemptCount: result.attemptCount,
        }),
      });
      lease = leaseAcquisition.lease;
      const started = await runStage(context, STAGES.turnStarted, 75, {
        artifactId: context.artifactId,
        parentArtifactId: context.artifact.sampleVideo?.artifactId ?? null,
        inputSummary: { role: ROLE, threadId: lease.thread_id, leaseId: lease.lease_id, sheetCount: evidence.sheets.length },
        action: () => appServer.startTurnWithInputs({
          workspaceRoot: rootDir,
          threadId: lease.thread_id,
          inputs: analyzeTurn.inputs,
          timeoutSeconds: 300,
        }),
        outputSummary: (result) => ({ role: ROLE, threadId: result.threadId, turnId: result.turnId, status: result.status }),
      });
      jobStore.updateJob(context.job.jobId, {
        stage: STAGES.turnStarted,
        status: SAMPLE_STATUS.processing,
        progress: 75,
        agentRun: {
          role: ROLE,
          threadId: started.threadId,
          turnId: started.turnId,
          leaseId: lease.lease_id,
          artifactId: context.artifactId,
          startedAt: new Date().toISOString(),
          status: "started",
        },
      });
      const collected = await collectTurn(context, lease, started);
      const analysis = await runStage(context, STAGES.turnValidated, 90, {
        artifactId: context.artifactId,
        parentArtifactId: context.artifact.sampleVideo?.artifactId ?? null,
        inputSummary: { turnId: collected.turnId, candidateCount: evidence.candidates.length },
        action: () => buildV2ProcessedAnalysis(collected.finalMessage, prepared, evidence, context, lease, collected),
        outputSummary: (result) => ({
          shotCount: result.shots.length,
          boundaryCount: result.boundaries.length,
          rejectedCandidateCount: result.rejectedCandidates.length,
        }),
      });
      await runStage(context, STAGES.resultWritten, 98, {
        artifactId: context.artifactId,
        parentArtifactId: context.artifact.sampleVideo?.artifactId ?? null,
        inputSummary: { turnId: collected.turnId, shotCount: analysis.shots.length },
        action: async () => {
          await attachAnalysis(context.sampleVideoId, analysis, {
            traceId: context.traceContext.traceId,
            sourceTraceId: context.artifact.trace?.traceId ?? null,
          });
          await artifactIndex.registerSampleArtifact({
            artifact: await loadArtifact(context.sampleVideoId),
            fileHash: await resolveExistingFileHash(context.sampleVideoId, artifactIndex),
            traceId: context.traceContext.traceId,
          });
          await finalizeLease(threadPool, {
            threadId: lease.thread_id,
            leaseId: lease.lease_id,
            traceId: context.traceContext.traceId,
          }, { shouldDiscard: false });
          return analysis;
        },
        outputSummary: (result) => ({ status: result.status, shotCount: result.shots.length, method: result.method }),
      });
      jobStore.updateJob(context.job.jobId, {
        stage: SAMPLE_STATUS.processed,
        status: SAMPLE_STATUS.processed,
        progress: 100,
        errorSummary: null,
        activeThreadMessage: null,
        agentRun: {
          ...(context.job.agentRun ?? {}),
          status: "completed",
          updatedAt: new Date().toISOString(),
        },
      });
    } catch (error) {
      if (lease?.thread_id) await cleanupLease(threadPool, lease, context.traceContext.traceId, "shot-boundary-v2-failed").catch(() => undefined);
      await markFailed(context, error);
    }
  }

  async function collectTurn(context, lease, started) {
    let collected = null;
    for (let attempt = 1; attempt <= collectMaxAttempts; attempt += 1) {
      if (attempt > 1) await delay(pollIntervalMs);
      collected = await runStage(context, STAGES.turnCollected, 82, {
        artifactId: context.artifactId,
        parentArtifactId: context.artifact.sampleVideo?.artifactId ?? null,
        inputSummary: { role: ROLE, threadId: lease.thread_id, turnId: started.turnId, attempt },
        action: () => appServer.collectTurnResult({
          workspaceRoot: rootDir,
          threadId: lease.thread_id,
          turnId: started.turnId,
          timeoutSeconds: 90,
        }),
        outputSummary: (result) => ({ role: ROLE, turnId: result.turnId, status: result.status, hasFinalMessage: Boolean(result.finalMessage) }),
      });
      jobStore.updateJob(context.job.jobId, {
        stage: STAGES.turnCollected,
        status: SAMPLE_STATUS.processing,
        progress: 82,
        activeThreadMessage: collected.activeThreadMessage ?? null,
      });
      if (collected.status === "completed") return collected;
    }
    throw codedError("shot_boundary_v2_turn_timeout", "V2 切镜 Agent 长时间未完成", { turnId: started.turnId }, true);
  }

  async function runStage(context, stageName, progress, options) {
    const startedAt = Date.now();
    await logger.writeStageLog({
      traceContext: context.traceContext,
      stageName,
      event: "stage.start",
      artifactId: options.artifactId,
      parentArtifactId: options.parentArtifactId,
      inputSummary: options.inputSummary,
    });
    jobStore.updateJob(context.job.jobId, { stage: stageName, status: SAMPLE_STATUS.processing, progress });
    try {
      const result = await options.action();
      await logger.writeStageLog({
        traceContext: context.traceContext,
        stageName,
        event: "stage.end",
        artifactId: options.artifactId,
        parentArtifactId: options.parentArtifactId,
        inputSummary: options.inputSummary,
        outputSummary: typeof options.outputSummary === "function" ? options.outputSummary(result) : options.outputSummary,
        durationMs: Date.now() - startedAt,
      });
      return result;
    } catch (error) {
      const snapshot = await logger.writeDebugSnapshot({
        traceContext: context.traceContext,
        stageName,
        reason: error?.code ?? "shot_boundary_v2_stage_failed",
        inputSummary: options.inputSummary,
        debugPayload: error?.debugPayload ?? { message: error instanceof Error ? error.message : String(error) },
      });
      error.debugSnapshotUri = snapshot.uri;
      await logger.writeStageLog({
        traceContext: context.traceContext,
        stageName,
        event: "stage.fail",
        artifactId: options.artifactId,
        parentArtifactId: options.parentArtifactId,
        inputSummary: options.inputSummary,
        errorSummary: {
          code: error?.code ?? "shot_boundary_v2_stage_failed",
          message: error instanceof Error ? error.message : String(error),
          debugSnapshotUri: snapshot.uri,
          retryable: error?.retryable !== false,
        },
        durationMs: Date.now() - startedAt,
      });
      throw error;
    }
  }

  async function markFailed(context, error) {
    const errorSummary = safeError(error, context.job.stage ?? "shot.v2.failed");
    errorSummary.debugSnapshotUri = error.debugSnapshotUri ?? null;
    jobStore.updateJob(context.job.jobId, {
      status: SAMPLE_STATUS.failed,
      stage: errorSummary.stageName,
      progress: 100,
      errorSummary,
      activeThreadMessage: null,
    });
  }

  async function loadArtifact(sampleVideoId) {
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

  return { enqueue };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms || 0))));
}

module.exports = {
  ROLE,
  SKILL_PATH,
  STAGES,
  createShotBoundaryV2Service,
};
