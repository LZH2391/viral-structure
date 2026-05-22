const path = require("path");
const { randomUUID } = require("crypto");
const { createTraceContext, SAMPLE_STATUS } = require("../../../Core/Workspace/sample-video-contracts");
const { createTraceIds, nextStage } = require("../../../Infrastructure/Observability/trace");
const { loadRoleProfileByRole } = require("./role-profile-loader");
const { createThreadPoolProxy } = require("./threadpool-proxy");
const { createAppServerBridge } = require("./appserver-bridge");
const { finalizeLease, cleanupLease } = require("./shot-boundary/threadpool-runner");
const { buildAgentRun, updateAgentRun } = require("./script-segment-analysis/agent-run");
const { prepareInput, renderAnalyzeTurnInputs, renderRepairTurnInputs } = require("./script-segment-analysis/input");
const { executeAnalyzeTurn, executeRepairTurn } = require("./script-segment-analysis/runner");
const { buildProcessedAnalysis, buildFailedArtifact } = require("./script-segment-analysis/result-builder");
const {
  ROLE,
  SKILL_PATH,
  STAGES,
  codedError,
  safeError,
  sanitizeDebugPayload,
  resolveSkillHash,
} = require("./script-segment-analysis/shared");

const DEFAULT_POLL_INTERVAL_MS = 1500;
const MAX_REPAIR_ATTEMPTS = 1;
const MAX_COLLECT_ATTEMPTS = 40;

function createScriptSegmentService({
  rootDir = path.resolve(__dirname, "../..", ".."),
  store,
  logger,
  jobStore,
  artifactIndex,
  threadPool = createThreadPoolProxy(),
  appServer = createAppServerBridge(),
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
} = {}) {
  async function enqueue({ sampleVideoId }) {
    await store.ensureRuntimeDirs();
    const artifact = await loadArtifact(sampleVideoId, store);
    const traceContext = createTraceContext(createTraceIds());
    const job = jobStore.createJob({ sampleVideoId, traceId: traceContext.traceId });
    const roleProfile = await loadRoleProfileByRole(ROLE);
    const context = {
      sampleVideoId,
      artifact,
      traceContext,
      job,
      roleProfile,
      skillPath: SKILL_PATH,
      skillHash: await resolveSkillHash(SKILL_PATH),
      activeStage: null,
      artifactId: `artifact_${randomUUID()}`,
      input: null,
      promptTemplate: null,
      agentRun: null,
      validationSummary: null,
    };
    run(context).catch(() => undefined);
    return { processingJobId: job.jobId, sampleVideoId, traceId: traceContext.traceId };
  }

  async function run(context) {
    let lease = null;
    try {
      const input = await runStage(context, STAGES.inputPrepared, 18, {
        artifactId: context.artifactId,
        parentArtifactId: context.artifact.shotBoundaryAnalysis?.artifactId ?? context.artifact.sampleVideo?.artifactId ?? null,
        inputSummary: {
          sampleVideoId: context.sampleVideoId,
          sourceShotBoundaryArtifactId: context.artifact.shotBoundaryAnalysis?.artifactId ?? null,
          shotCount: context.artifact.shotBoundaryAnalysis?.shots?.length ?? 0,
          hasCommerceBrief: Boolean(context.artifact.shotBoundaryAnalysis?.commerceBrief),
        },
        action: () => prepareInput(context.artifact),
        outputSummary: (result) => ({
          shotCount: result.shots.length,
          hasCommerceBrief: Boolean(result.commerceBrief),
          parentArtifactId: result.parentArtifactId,
        }),
      });
      context.input = input;

      const analyzeTurn = renderAnalyzeTurnInputs({ input, roleProfile: context.roleProfile });
      context.promptTemplate = {
        promptTemplateId: analyzeTurn.promptTemplateId,
        promptTemplateVersion: analyzeTurn.promptTemplateVersion,
        promptTemplateHash: analyzeTurn.promptTemplateHash,
      };

      const analyzed = await runStage(context, STAGES.analyzed, 56, {
        artifactId: context.artifactId,
        parentArtifactId: input.parentArtifactId,
        inputSummary: {
          role: ROLE,
          shotCount: input.shots.length,
          promptTemplateVersion: context.promptTemplate.promptTemplateVersion,
        },
        action: async () => {
          const executed = await executeAnalyzeTurn({
            context,
            input,
            turnInputs: analyzeTurn,
            threadPool,
            appServer,
            rootDir,
            pollIntervalMs,
            maxCollectAttempts: MAX_COLLECT_ATTEMPTS,
          });
          lease = executed.lease;
          context.agentRun = buildAgentRun({ context, lease: executed.lease, turn: executed.started, input });
          jobStore.updateJob(context.job.jobId, {
            agentRun: context.agentRun,
            stage: STAGES.analyzed,
            status: SAMPLE_STATUS.processing,
            progress: 56,
            errorSummary: null,
          });
          const analysis = buildProcessedAnalysis(executed.finalTurn.finalMessage, input, context, context.agentRun, executed.finalTurn, {
            repairAttemptCount: 0,
          });
          context.agentRun = updateAgentRun(context.agentRun, context, executed.finalTurn);
          return { analysis, finalTurn: executed.finalTurn };
        },
        outputSummary: (result) => ({
          role: ROLE,
          threadId: context.agentRun?.threadId ?? null,
          leaseId: context.agentRun?.leaseId ?? null,
          turnId: result.finalTurn?.turnId ?? null,
          status: result.analysis.status,
          segmentCount: result.analysis.segments.length,
          promptTemplateVersion: result.analysis.agent?.promptTemplateVersion ?? null,
        }),
      });

      let analysis = analyzed.analysis;
      let finalTurn = analyzed.finalTurn;

      const validated = await runStage(context, STAGES.validated, 74, {
        artifactId: analysis.artifactId,
        parentArtifactId: analysis.parentArtifactId,
        inputSummary: {
          segmentCount: analysis.segments.length,
          turnId: finalTurn?.turnId ?? null,
        },
        action: () => analysis,
        outputSummary: (result) => ({
          status: result.validation?.status ?? null,
          segmentCount: result.segments.length,
          validatorCode: result.validation?.validatorCode ?? null,
          repairAttemptCount: result.validation?.repairAttemptCount ?? 0,
        }),
      });

      analysis = validated;

      if (analysis.validation?.status !== "passed") {
        throw codedError("script_segment_validation_failed", "脚本段落输出未通过校验", {
          validation: analysis.validation,
          turnId: finalTurn?.turnId ?? null,
        }, false);
      }

      const materializedArtifact = await runStage(context, STAGES.materialized, 96, {
        artifactId: analysis.artifactId,
        parentArtifactId: analysis.parentArtifactId,
        inputSummary: {
          segmentCount: analysis.segments.length,
          threadId: analysis.agent?.threadId ?? null,
          turnId: analysis.agent?.turnId ?? null,
        },
        action: async () => {
          const nextArtifact = await attachScriptSegments(context.sampleVideoId, analysis, store);
          await artifactIndex.registerSampleArtifact({
            artifact: nextArtifact,
            fileHash: await resolveExistingFileHash(context.sampleVideoId, artifactIndex),
            traceId: context.traceContext.traceId,
          });
          return nextArtifact;
        },
        outputSummary: (artifact) => ({
          segmentCount: artifact.scriptSegmentAnalysis?.segments?.length ?? 0,
          scriptArtifactId: artifact.scriptSegmentAnalysis?.artifactId ?? null,
        }),
      });

      if (context.agentRun?.leaseId) {
        await finalizeLease(threadPool, {
          leaseId: context.agentRun.leaseId,
          threadId: context.agentRun.threadId,
          traceId: context.traceContext.traceId,
        }, { shouldDiscard: false });
        lease = null;
      }

      jobStore.updateJob(context.job.jobId, {
        agentRun: context.agentRun ? { ...context.agentRun, status: "completed", updatedAt: new Date().toISOString() } : context.agentRun,
        stage: SAMPLE_STATUS.processed,
        status: SAMPLE_STATUS.processed,
        progress: 100,
        errorSummary: null,
      });
      return materializedArtifact;
    } catch (error) {
      if (error?.code === "script_segment_validation_failed" && context.agentRun?.threadId && context.input) {
        try {
          const repaired = await runRepair(context, error, appServer, rootDir, pollIntervalMs);
          if (repaired) {
            if (context.agentRun?.leaseId) {
              await finalizeLease(threadPool, {
                leaseId: context.agentRun.leaseId,
                threadId: context.agentRun.threadId,
                traceId: context.traceContext.traceId,
              }, { shouldDiscard: false });
              lease = null;
            }
            return repaired;
          }
        } catch (repairError) {
          error = repairError;
        }
      }
      if (lease?.thread_id) {
        await cleanupLease(threadPool, lease, context.traceContext.traceId, "script-segment-analysis-failed");
      } else if (context.agentRun?.threadId) {
        await cleanupLease(threadPool, { thread_id: context.agentRun.threadId, lease_id: context.agentRun.leaseId }, context.traceContext.traceId, "script-segment-analysis-failed");
      }
      await markFailed(context, error, store);
      return null;
    }
  }

  async function runRepair(context, validationError, appServer, rootDir, pollIntervalMs) {
    for (let repairAttemptCount = 1; repairAttemptCount <= MAX_REPAIR_ATTEMPTS; repairAttemptCount += 1) {
      const repairTurn = renderRepairTurnInputs({
        input: context.input,
        validationError,
        priorTurnOutput: validationError?.debugPayload?.outputSummary?.messagePreview ?? "",
        repairAttemptCount,
        roleProfile: context.roleProfile,
      });
      context.promptTemplate = {
        promptTemplateId: repairTurn.promptTemplateId,
        promptTemplateVersion: repairTurn.promptTemplateVersion,
        promptTemplateHash: repairTurn.promptTemplateHash,
      };
      const repaired = await runStage(context, STAGES.repaired, 88, {
        artifactId: context.artifactId,
        parentArtifactId: context.input.parentArtifactId,
        inputSummary: {
          role: ROLE,
          threadId: context.agentRun?.threadId ?? null,
          leaseId: context.agentRun?.leaseId ?? null,
          repairAttemptCount,
          validatorCode: validationError?.debugPayload?.validation?.validatorCode ?? validationError?.code ?? null,
        },
        action: async () => {
          const executed = await executeRepairTurn({
            agentRun: context.agentRun,
            turnInputs: repairTurn,
            appServer,
            rootDir,
            pollIntervalMs,
            maxCollectAttempts: MAX_COLLECT_ATTEMPTS,
          });
          const analysis = buildProcessedAnalysis(executed.finalTurn.finalMessage, context.input, context, context.agentRun, executed.finalTurn, {
            repairAttemptCount,
          });
          context.agentRun = updateAgentRun(context.agentRun, context, executed.finalTurn);
          return { analysis, finalTurn: executed.finalTurn, repairAttemptCount };
        },
        outputSummary: (result) => ({
          role: ROLE,
          threadId: context.agentRun?.threadId ?? null,
          turnId: result.finalTurn?.turnId ?? null,
          status: result.analysis.status,
          segmentCount: result.analysis.segments.length,
          repairAttemptCount: result.repairAttemptCount,
        }),
      });

      const analysis = repaired.analysis;
      const materializedArtifact = await runStage(context, STAGES.materialized, 96, {
        artifactId: analysis.artifactId,
        parentArtifactId: analysis.parentArtifactId,
        inputSummary: {
          segmentCount: analysis.segments.length,
          threadId: analysis.agent?.threadId ?? null,
          turnId: analysis.agent?.turnId ?? null,
          repairAttemptCount: analysis.validation?.repairAttemptCount ?? 0,
        },
        action: async () => {
          const nextArtifact = await attachScriptSegments(context.sampleVideoId, analysis, store);
          await artifactIndex.registerSampleArtifact({
            artifact: nextArtifact,
            fileHash: await resolveExistingFileHash(context.sampleVideoId, artifactIndex),
            traceId: context.traceContext.traceId,
          });
          return nextArtifact;
        },
        outputSummary: (artifact) => ({
          segmentCount: artifact.scriptSegmentAnalysis?.segments?.length ?? 0,
          scriptArtifactId: artifact.scriptSegmentAnalysis?.artifactId ?? null,
        }),
      });

      jobStore.updateJob(context.job.jobId, {
        agentRun: context.agentRun ? { ...context.agentRun, status: "completed", updatedAt: new Date().toISOString() } : context.agentRun,
        stage: SAMPLE_STATUS.processed,
        status: SAMPLE_STATUS.processed,
        progress: 100,
        errorSummary: null,
      });
      return materializedArtifact;
    }
    return null;
  }

  async function runStage(context, stageName, progress, options) {
    context.traceContext = nextStage(context.traceContext);
    const startedAt = Date.now();
    context.activeStage = {
      stageName,
      artifactId: options.artifactId ?? null,
      parentArtifactId: options.parentArtifactId ?? null,
      inputSummary: options.inputSummary ?? null,
      outputSummary: null,
      startedAt,
    };
    jobStore.updateJob(context.job.jobId, { stage: stageName, status: SAMPLE_STATUS.processing, progress, errorSummary: null });
    await logger.writeStageLog({
      traceContext: context.traceContext,
      stageName,
      event: "stage.start",
      artifactId: context.activeStage.artifactId,
      parentArtifactId: context.activeStage.parentArtifactId,
      inputSummary: context.activeStage.inputSummary,
    });
    const result = await options.action();
    const outputSummary = options.outputSummary ? options.outputSummary(result) : null;
    context.activeStage.outputSummary = outputSummary;
    await logger.writeStageLog({
      traceContext: context.traceContext,
      stageName,
      event: "stage.end",
      artifactId: context.activeStage.artifactId,
      parentArtifactId: context.activeStage.parentArtifactId,
      outputSummary,
      durationMs: Date.now() - startedAt,
    });
    context.activeStage = null;
    return result;
  }

  async function markFailed(context, error, store) {
    const activeStage = context.activeStage ?? {
      stageName: STAGES.analyzed,
      artifactId: context.artifactId,
      parentArtifactId: context.input?.parentArtifactId ?? context.artifact?.shotBoundaryAnalysis?.artifactId ?? context.artifact?.sampleVideo?.artifactId ?? null,
      inputSummary: {
        sampleVideoId: context.sampleVideoId,
      },
      outputSummary: null,
      startedAt: Date.now(),
    };
    const safe = safeError(error, activeStage.stageName);
    const snapshot = await logger.writeDebugSnapshot({
      traceContext: context.traceContext,
      stageName: activeStage.stageName,
      artifactId: activeStage.artifactId,
      parentArtifactId: activeStage.parentArtifactId,
      reason: safe.code,
      inputSummary: activeStage.inputSummary,
      outputSummary: activeStage.outputSummary,
      debugPayload: sanitizeDebugPayload(error),
    });
    const errorSummary = { ...safe, debugSnapshotUri: snapshot.uri };
    const failedArtifact = buildFailedArtifact(context, errorSummary, snapshot.uri);
    await attachScriptSegments(context.sampleVideoId, failedArtifact, store).catch(() => undefined);
    await logger.writeStageLog({
      traceContext: context.traceContext,
      stageName: activeStage.stageName,
      event: "stage.fail",
      artifactId: activeStage.artifactId,
      parentArtifactId: activeStage.parentArtifactId,
      outputSummary: activeStage.outputSummary,
      durationMs: activeStage.startedAt ? Date.now() - activeStage.startedAt : null,
      errorSummary,
    });
    jobStore.updateJob(context.job.jobId, {
      agentRun: context.agentRun ? { ...context.agentRun, status: "failed", updatedAt: new Date().toISOString() } : context.agentRun,
      stage: activeStage.stageName,
      status: SAMPLE_STATUS.failed,
      progress: 100,
      errorSummary,
    });
    context.activeStage = null;
  }

  return { enqueue };
}

async function attachScriptSegments(sampleVideoId, scriptSegmentAnalysis, store) {
  const artifactPath = path.join(store.sampleDir(sampleVideoId), "artifact.json");
  const artifact = await store.readJson(artifactPath);
  artifact.scriptSegmentAnalysis = scriptSegmentAnalysis;
  await store.writeJson(artifactPath, artifact);
  return artifact;
}

async function loadArtifact(sampleVideoId, store) {
  return store.readJson(path.join(store.sampleDir(sampleVideoId), "artifact.json"));
}

async function resolveExistingFileHash(sampleVideoId, artifactIndex) {
  const item = await artifactIndex.getItem(sampleVideoId).catch(() => null);
  return item?.fileHash ?? null;
}

module.exports = {
  ROLE,
  SKILL_PATH,
  STAGES,
  createScriptSegmentService,
  prepareInput,
};
