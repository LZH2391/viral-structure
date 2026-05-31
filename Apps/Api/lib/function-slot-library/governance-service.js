const { randomUUID } = require("crypto");
const { SAMPLE_STATUS, createTraceContext } = require("../../../../Core/Workspace/sample-video-contracts");
const { createTraceIds, nextStage } = require("../../../../Infrastructure/Observability/trace");
const { createAppServerTurnRunner } = require("../analysis-runtime-v2/appserver-turn-runner");
const { loadRoleProfileByRole, renderTurnTemplate } = require("../gateways/threadpool/role-profile-loader");
const {
  resolveSkillHash,
  sanitizeForAppServerText,
  stableJson,
} = require("../function-slot-atomization-analysis/shared");
const {
  DEFAULT_REFERENCE_DIR,
  DEFAULT_SKILL_SCRIPT_DIR,
  GOVERNANCE_RELATIVE_PATH,
  ROLE,
  SAMPLE_VIDEO_ID,
  SLOT_INDEX_RELATIVE_PATH,
  STAGES,
} = require("./governance-constants");
const {
  buildAgentArtifact,
  buildAgentRun,
  buildAgentTraceCards,
  updateActiveThread,
} = require("./governance-agent-metadata");
const { createGovernanceFileOps } = require("./governance-file-ops");
const {
  buildCoverageSummary,
  buildTurnInputSummary,
  codedError,
  extractTurnTokenUsage,
  promptTemplateSummary,
  safeErrorMessage,
  safePreview,
  sanitizeDebugPayload,
  summarizeGovernanceArtifact,
} = require("./governance-utils");

function createFunctionSlotGovernanceService({
  rootDir,
  store,
  logger,
  jobStore,
  threadPool,
  appServer,
  python = process.env.PYTHON || "python",
  skillScriptDir = DEFAULT_SKILL_SCRIPT_DIR,
  referenceDir = DEFAULT_REFERENCE_DIR,
  pollIntervalMs = 1500,
  collectIdleTimeoutMs = 15 * 60 * 1000,
  collectHardTimeoutMs = 60 * 60 * 1000,
  maxRepairAttempts = 1,
} = {}) {
  if (!rootDir) throw new Error("rootDir is required for FunctionSlotGovernanceService");
  if (!store) throw new Error("store is required for FunctionSlotGovernanceService");
  if (!logger) throw new Error("logger is required for FunctionSlotGovernanceService");
  if (!jobStore) throw new Error("jobStore is required for FunctionSlotGovernanceService");
  if (!threadPool) throw new Error("threadPool is required for FunctionSlotGovernanceService");
  if (!appServer) throw new Error("appServer is required for FunctionSlotGovernanceService");

  const turnRunner = createAppServerTurnRunner({
    role: ROLE,
    codedError,
    collectFailedMessage: "FunctionSlotLibrary 语义治理 Agent 结果收集失败",
    collectTimeoutMessage: "FunctionSlotLibrary 语义治理 Agent 长时间未返回结果",
    startTimeoutSeconds: 240,
    collectTimeoutSeconds: 120,
  });
  const fileOps = createGovernanceFileOps({ rootDir, python, skillScriptDir, referenceDir });

  async function enqueue(options = {}) {
    await store.ensureRuntimeDirs?.();
    const traceContext = createTraceContext(createTraceIds());
    const job = jobStore.createJob({ sampleVideoId: SAMPLE_VIDEO_ID, traceId: traceContext.traceId });
    const artifactId = `artifact_${randomUUID()}`;
    const context = {
      traceContext,
      job,
      jobStore,
      artifactId,
      parentArtifactId: null,
      sampleVideoId: SAMPLE_VIDEO_ID,
      activeStage: null,
      roleProfile: null,
      promptTemplate: null,
      agentRun: null,
      finalOutputText: null,
      options: {
        refreshEvidence: options.refreshEvidence !== false,
      },
    };
    runGovernance(context).catch(() => undefined);
    return {
      processingJobId: job.jobId,
      sampleVideoId: SAMPLE_VIDEO_ID,
      traceId: traceContext.traceId,
      runId: traceContext.runId,
      stageId: traceContext.stageId,
      artifactId,
      parentArtifactId: null,
      status: "submitted",
      message: "FunctionSlotLibrary 语义治理任务已提交。",
    };
  }

  async function runGovernance(context) {
    let lease = null;
    try {
      if (context.options.refreshEvidence) {
        await runStage(context, STAGES.evidence, 20, {
          inputSummary: { sourceRoot: "Artifacts/FunctionSlotLibrary", mode: "evidence_only" },
          action: fileOps.refreshEvidence,
          outputSummary: (result) => result,
        });
      }

      const input = await fileOps.prepareGovernanceInput();
      const originalGovernanceText = await fileOps.readGovernanceText();
      context.roleProfile = await loadRoleProfileByRole(ROLE);
      context.skillHash = await resolveSkillHash(context.roleProfile.skillPath);
      const analyzeTurn = renderGovernanceTurn(context.roleProfile, "semanticGovernance", input);
      context.promptTemplate = promptTemplateSummary(analyzeTurn);

      const analyzed = await runStage(context, STAGES.analyze, 55, {
        inputSummary: buildTurnInputSummary(input, analyzeTurn),
        action: async () => {
          const executed = await turnRunner.executeAnalyzeTurn({
            context,
            turnInputs: analyzeTurn,
            threadPool,
            appServer,
            rootDir,
            pollIntervalMs,
            collectIdleTimeoutMs,
            collectHardTimeoutMs,
            onTurnStarted: ({ lease: startedLease, started }) => {
              lease = startedLease;
              context.agentRun = buildAgentRun(context, startedLease, started, "turn_submitted");
              jobStore.updateJob(context.job.jobId, {
                agentRun: context.agentRun,
                agentTraceCards: buildAgentTraceCards(context, "running"),
              });
            },
            onTurnCollect: (turn) => updateActiveThread(context, turn),
          });
          lease = executed.lease;
          context.finalOutputText = executed.finalTurn.finalMessage ?? null;
          context.agentRun = {
            ...context.agentRun,
            turnId: executed.finalTurn.turnId ?? context.agentRun?.turnId ?? null,
            status: "completed",
            updatedAt: new Date().toISOString(),
            lastTokenUsage: extractTurnTokenUsage(executed.finalTurn),
          };
          jobStore.updateJob(context.job.jobId, {
            agentRun: context.agentRun,
            agentTraceCards: buildAgentTraceCards(context, "completed"),
            activeThreadMessage: null,
          });
          return { turn: executed.finalTurn, message: executed.finalTurn.finalMessage ?? "" };
        },
        outputSummary: (result) => ({
          turnId: result.turn?.turnId ?? null,
          messagePreview: safePreview(result.message),
        }),
      });

      let governance = await fileOps.readGovernanceObject();
      let validation = await validateCandidate(context, governance, { repairAttemptCount: 0 });
      for (let repairAttemptCount = 1; !validation.ok && repairAttemptCount <= maxRepairAttempts; repairAttemptCount += 1) {
        const repairTurn = renderGovernanceRepairTurn(context.roleProfile, input, validation, analyzed.message, repairAttemptCount);
        context.promptTemplate = promptTemplateSummary(repairTurn);
        const repaired = await runStage(context, STAGES.repair, 75, {
          inputSummary: {
            repairAttemptCount,
            validatorCode: validation.code,
            issueCount: validation.issues.length,
            promptTemplateVersion: repairTurn.promptTemplateVersion,
          },
          action: async () => {
            const executed = await turnRunner.executeRepairTurn({
              agentRun: context.agentRun,
              context,
              input,
              turnInputs: repairTurn,
              threadPool,
              appServer,
              rootDir,
              pollIntervalMs,
              collectIdleTimeoutMs,
              collectHardTimeoutMs,
              onTurnStarted: ({ started }) => {
                context.agentRun = {
                  ...context.agentRun,
                  turnId: started.turnId ?? context.agentRun?.turnId ?? null,
                  status: "turn_submitted",
                  updatedAt: new Date().toISOString(),
                };
                jobStore.updateJob(context.job.jobId, {
                  agentRun: context.agentRun,
                  agentTraceCards: buildAgentTraceCards(context, "running", "semantic-governance-repair"),
                });
              },
              onTurnCollect: (turn) => updateActiveThread(context, turn),
            });
            if (executed.agentRun) context.agentRun = executed.agentRun;
            context.finalOutputText = executed.finalTurn.finalMessage ?? null;
            context.agentRun = {
              ...context.agentRun,
              turnId: executed.finalTurn.turnId ?? context.agentRun?.turnId ?? null,
              status: "completed",
              updatedAt: new Date().toISOString(),
              lastTokenUsage: extractTurnTokenUsage(executed.finalTurn),
            };
            jobStore.updateJob(context.job.jobId, {
              agentRun: context.agentRun,
              agentTraceCards: buildAgentTraceCards(context, "completed", "semantic-governance-repair"),
              activeThreadMessage: null,
            });
            return { message: executed.finalTurn.finalMessage ?? "", turn: executed.finalTurn };
          },
          outputSummary: (result) => ({
            repairAttemptCount,
            turnId: result.turn?.turnId ?? null,
            messagePreview: safePreview(result.message),
          }),
        });
        governance = await fileOps.readGovernanceObject();
        validation = await validateCandidate(context, governance, { repairAttemptCount });
      }
      if (!validation.ok) {
        await fileOps.restoreGovernanceText(originalGovernanceText);
        throw codedError("function_slot_governance_validation_failed", "语义治理结果未通过校验", {
          validation,
          stageName: STAGES.validate,
          turnId: context.agentRun?.turnId ?? null,
        }, false);
      }

      const materialized = await runStage(context, STAGES.materialize, 95, {
        inputSummary: {
          governanceId: governance.governanceId ?? null,
          sampleCount: governance.coverage?.sampleCount ?? null,
          validationOk: validation.ok,
        },
        action: () => fileOps.writeGovernanceArtifact(context, governance, validation, buildAgentArtifact(context)),
        outputSummary: (artifact) => ({
          artifactId: artifact.artifactId,
          governanceId: artifact.governanceId,
          sampleCount: artifact.coverage?.sampleCount ?? null,
          validationOk: artifact.validation?.ok ?? false,
          governancePath: GOVERNANCE_RELATIVE_PATH,
        }),
      });
      await releaseLease(context);
      jobStore.updateJob(context.job.jobId, {
        status: SAMPLE_STATUS.processed,
        stage: "function_slot_library.semantic_governance.done",
        progress: 100,
        artifactId: materialized.artifactId,
        parentArtifactId: materialized.parentArtifactId,
        governance: summarizeGovernanceArtifact(materialized),
        agentRun: context.agentRun ? { ...context.agentRun, status: "completed", updatedAt: new Date().toISOString() } : null,
        agentTraceCards: buildAgentTraceCards(context, "completed"),
        activeThreadMessage: null,
      });
      return materialized;
    } catch (error) {
      await cleanupLease(lease, context);
      await markFailed(context, error);
      return null;
    }
  }

  function renderGovernanceTurn(roleProfile, templateId, input) {
    const prompt = renderTurnTemplate(roleProfile, templateId, {
      slotIndexPath: input.slotIndexPath,
      governancePath: input.governancePath,
      semanticProtocolPath: input.semanticProtocolPath,
      atomBindingRuleProtocolPath: input.atomBindingRuleProtocolPath,
      outputFormatPath: input.outputFormatPath,
      coverageSummaryJson: stableJson(buildCoverageSummary(input)),
    });
    return {
      ...prompt,
      inputs: sanitizeForAppServerText([{ type: "text", text: prompt.text, text_elements: [] }]),
    };
  }

  function renderGovernanceRepairTurn(roleProfile, input, validation, priorOutput, repairAttemptCount) {
    const prompt = renderTurnTemplate(roleProfile, "semanticGovernanceRepair", {
      slotIndexPath: input.slotIndexPath,
      governancePath: input.governancePath,
      semanticProtocolPath: input.semanticProtocolPath,
      atomBindingRuleProtocolPath: input.atomBindingRuleProtocolPath,
      outputFormatPath: input.outputFormatPath,
      validationErrorJson: stableJson({
        repairAttemptCount,
        code: validation.code,
        message: validation.message,
        issues: validation.issues,
      }),
      priorOutputSummaryJson: stableJson({
        hasPriorOutput: Boolean(String(priorOutput ?? "").trim()),
        outputLength: String(priorOutput ?? "").length,
        messagePreview: safePreview(priorOutput),
      }),
    });
    return {
      ...prompt,
      inputs: sanitizeForAppServerText([{ type: "text", text: prompt.text, text_elements: [] }]),
    };
  }

  async function validateCandidate(context, governance, { repairAttemptCount }) {
    return runStage(context, STAGES.validate, repairAttemptCount ? 82 : 68, {
      inputSummary: {
        governanceId: governance?.governanceId ?? null,
        repairAttemptCount,
        sampleCount: governance?.coverage?.sampleCount ?? null,
      },
      action: () => fileOps.validateGovernanceObject(governance),
      outputSummary: (result) => ({
        ok: result.ok,
        code: result.code ?? null,
        issueCount: result.issues.length,
        repairAttemptCount,
      }),
    });
  }

  async function runStage(context, stageName, progress, options) {
    context.traceContext = nextStage(context.traceContext);
    const startedAt = Date.now();
    context.activeStage = {
      stageName,
      artifactId: context.artifactId,
      parentArtifactId: context.parentArtifactId,
      inputSummary: options.inputSummary ?? null,
      outputSummary: null,
      startedAt,
    };
    jobStore.updateJob(context.job.jobId, {
      stage: stageName,
      status: SAMPLE_STATUS.processing,
      progress,
      runId: context.traceContext.runId,
      stageId: context.traceContext.stageId,
      artifactId: context.artifactId,
      parentArtifactId: context.parentArtifactId,
      errorSummary: null,
    });
    await logger.writeStageLog({
      traceContext: context.traceContext,
      stageName,
      event: "stage.start",
      artifactId: context.artifactId,
      parentArtifactId: context.parentArtifactId,
      inputSummary: options.inputSummary ?? null,
    });
    const result = await options.action();
    const outputSummary = options.outputSummary ? options.outputSummary(result) : null;
    context.activeStage.outputSummary = outputSummary;
    await logger.writeStageLog({
      traceContext: context.traceContext,
      stageName,
      event: "stage.end",
      artifactId: context.artifactId,
      parentArtifactId: context.parentArtifactId,
      outputSummary,
      durationMs: Date.now() - startedAt,
    });
    context.activeStage = null;
    return result;
  }

  async function markFailed(context, error) {
    const activeStage = context.activeStage ?? {
      stageName: error?.debugPayload?.stageName ?? STAGES.analyze,
      artifactId: context.artifactId,
      parentArtifactId: context.parentArtifactId,
      inputSummary: null,
      outputSummary: null,
      startedAt: Date.now(),
    };
    const snapshot = await logger.writeDebugSnapshot({
      traceContext: context.traceContext,
      stageName: activeStage.stageName,
      artifactId: activeStage.artifactId,
      parentArtifactId: activeStage.parentArtifactId,
      reason: error?.code ?? "function_slot_governance_failed",
      inputSummary: activeStage.inputSummary,
      outputSummary: activeStage.outputSummary,
      debugPayload: sanitizeDebugPayload(error),
    }).catch(() => null);
    const errorSummary = {
      code: error?.code ?? "function_slot_governance_failed",
      message: safeErrorMessage(error),
      retryable: error?.retryable !== false,
      stageName: activeStage.stageName,
      debugSnapshotUri: snapshot?.uri ?? null,
    };
    await logger.writeStageLog({
      traceContext: context.traceContext,
      stageName: activeStage.stageName,
      event: "stage.fail",
      artifactId: activeStage.artifactId,
      parentArtifactId: activeStage.parentArtifactId,
      outputSummary: activeStage.outputSummary,
      durationMs: activeStage.startedAt ? Date.now() - activeStage.startedAt : null,
      errorSummary,
    }).catch(() => undefined);
    jobStore.updateJob(context.job.jobId, {
      stage: activeStage.stageName,
      status: SAMPLE_STATUS.failed,
      progress: 100,
      errorSummary,
      agentRun: context.agentRun ? { ...context.agentRun, status: "failed", updatedAt: new Date().toISOString() } : null,
      agentTraceCards: buildAgentTraceCards(context, "failed"),
      activeThreadMessage: null,
    });
    context.activeStage = null;
  }

  async function releaseLease(context) {
    if (!context.agentRun?.leaseId || !threadPool?.releaseLease) return;
    await threadPool.releaseLease({ leaseId: context.agentRun.leaseId, ownerId: context.traceContext.traceId }).catch(() => undefined);
  }

  async function cleanupLease(lease, context) {
    if (lease?.lease_id && threadPool?.releaseLease) {
      await threadPool.releaseLease({ leaseId: lease.lease_id, ownerId: context.traceContext.traceId }).catch(() => undefined);
    }
  }

  return { enqueue, _private: fileOps };
}

module.exports = {
  ROLE,
  STAGES,
  createFunctionSlotGovernanceService,
};
