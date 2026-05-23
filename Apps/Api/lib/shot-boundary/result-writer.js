async function submitRepairTurn({
  context,
  agentRun,
  prepared,
  contactSheets,
  validationError,
  priorTurn,
  repairAttemptCount,
  runStage,
  stages,
  appServer,
  rootDir,
  renderRepairTurnInputs,
  role,
}) {
  const repairTurn = renderRepairTurnInputs({
    prepared,
    contactSheets,
    validationError,
    priorTurnOutput: priorTurn.finalMessage,
    repairAttemptCount,
    roleProfile: context.roleProfile,
  });
  context.promptTemplate = {
    promptTemplateId: repairTurn.promptTemplateId,
    promptTemplateVersion: repairTurn.promptTemplateVersion,
    promptTemplateHash: repairTurn.promptTemplateHash,
  };
  const started = await runStage(context, stages.turnRepaired, 91, {
    artifactId: context.artifactId,
    parentArtifactId: prepared.sourceArtifactId,
    inputSummary: { threadId: agentRun.threadId, previousTurnId: priorTurn.turnId, repairAttemptCount, validatorCode: validationError.debugPayload?.validation?.validatorCode ?? validationError.code },
    action: () => appServer.startTurnWithInputs({
      workspaceRoot: rootDir,
      threadId: agentRun.threadId,
      inputs: repairTurn.inputs,
      timeoutSeconds: 240,
    }),
    outputSummary: (result) => ({
      role,
      threadId: result.threadId,
      turnId: result.turnId,
      status: result.status,
      repairAttemptCount,
      profileVersion: context.roleProfile?.profileVersion ?? null,
      promptTemplateId: context.promptTemplate?.promptTemplateId ?? null,
      promptTemplateVersion: context.promptTemplate?.promptTemplateVersion ?? null,
      promptTemplateHash: context.promptTemplate?.promptTemplateHash ?? null,
    }),
  });
  return runStage(context, stages.repairCollected, 93, {
    artifactId: context.artifactId,
    parentArtifactId: prepared.sourceArtifactId,
    inputSummary: { threadId: agentRun.threadId, turnId: started.turnId, repairAttemptCount },
    action: () => appServer.collectTurnResult({
      workspaceRoot: rootDir,
      threadId: agentRun.threadId,
      turnId: started.turnId,
      timeoutSeconds: 120,
    }),
    outputSummary: (result) => ({
      role,
      threadId: result.threadId,
      turnId: result.turnId,
      status: result.status,
      repairAttemptCount,
      profileVersion: context.roleProfile?.profileVersion ?? null,
      promptTemplateId: context.promptTemplate?.promptTemplateId ?? null,
      promptTemplateVersion: context.promptTemplate?.promptTemplateVersion ?? null,
      promptTemplateHash: context.promptTemplate?.promptTemplateHash ?? null,
    }),
  });
}

async function resolveFinalAnalysis({
  context,
  agentRun,
  turn,
  prepared,
  contactSheets,
  runStage,
  stages,
  maxRepairAttempts,
  buildProcessedAnalysis,
  appServer,
  rootDir,
  renderRepairTurnInputs,
  codedError,
  role,
}) {
  let repairAttemptCount = 0;
  let finalTurn = turn;
  let resultOrigin = "new_turn";
  while (repairAttemptCount <= maxRepairAttempts) {
    try {
      await runStage(context, stages.turnValidated, 90, {
        artifactId: context.artifactId,
        parentArtifactId: prepared.sourceArtifactId,
        inputSummary: { turnId: finalTurn.turnId, repairAttemptCount },
        action: async () => {
          const lease = { thread_id: agentRun.threadId, lease_id: agentRun.leaseId };
          return buildProcessedAnalysis(finalTurn.finalMessage, prepared, contactSheets, context, lease, finalTurn, {
            resultOrigin,
            repairAttemptCount,
          });
        },
        outputSummary: (result) => ({
          turnId: finalTurn.turnId,
          resultOrigin,
          boundaryCount: result.boundaries?.length ?? 0,
          shotCount: result.shots?.length ?? 0,
          repairAttemptCount,
        }),
      });
      return {
        finalTurn,
        repairAttemptCount,
        resultOrigin,
        validationSummary: {
          status: "passed",
          rawBoundaryCount: null,
          normalizedBoundaryCount: null,
          repairAttemptCount,
          validatorCode: null,
        },
      };
    } catch (error) {
      if (error?.code !== "shot_boundary_validation_failed" || repairAttemptCount >= maxRepairAttempts) {
        context.validationSummary = {
          ...(error?.debugPayload?.validation ?? {}),
          status: "failed",
          repairAttemptCount,
          validatorCode: error?.debugPayload?.validation?.validatorCode ?? error?.code ?? null,
        };
        error.debugPayload = {
          ...(error.debugPayload ?? {}),
          repairAttemptCount,
          validation: context.validationSummary,
          turnId: finalTurn?.turnId ?? null,
          resultOrigin,
        };
        throw error;
      }
      repairAttemptCount += 1;
      context.validationSummary = {
        ...(error?.debugPayload?.validation ?? {}),
        status: "failed",
        repairAttemptCount,
        validatorCode: error?.debugPayload?.validation?.validatorCode ?? error?.code ?? null,
      };
      error.debugPayload = {
        ...(error.debugPayload ?? {}),
        repairAttemptCount,
        validation: context.validationSummary,
        turnId: finalTurn?.turnId ?? null,
        resultOrigin,
      };
      finalTurn = await submitRepairTurn({
        context,
        agentRun,
        prepared,
        contactSheets,
        validationError: error,
        priorTurn: finalTurn,
        repairAttemptCount,
        runStage,
        stages,
        appServer,
        rootDir,
        renderRepairTurnInputs,
        role,
      });
      resultOrigin = "repaired_turn";
    }
  }
  throw codedError("shot_boundary_validation_failed", "切镜结果校验失败", { repairAttemptCount: maxRepairAttempts }, false);
}

async function runSummaryTurn({
  context,
  agentRun,
  shotAnalysis,
  runStage,
  stages,
  appServer,
  rootDir,
  renderSummaryTurnInputs,
  validateCommerceBriefOutput,
  role,
}) {
  const summaryTurn = renderSummaryTurnInputs({
    shots: shotAnalysis.shots,
    roleProfile: context.roleProfile,
  });
  context.promptTemplate = {
    promptTemplateId: summaryTurn.promptTemplateId,
    promptTemplateVersion: summaryTurn.promptTemplateVersion,
    promptTemplateHash: summaryTurn.promptTemplateHash,
  };
  const started = await runStage(context, stages.summaryStarted, 92, {
    artifactId: context.artifactId,
    parentArtifactId: shotAnalysis.artifactId,
    inputSummary: { threadId: agentRun.threadId, shotCount: shotAnalysis.shots?.length ?? 0 },
    action: () => appServer.startTurnWithInputs({
      workspaceRoot: rootDir,
      threadId: agentRun.threadId,
      inputs: summaryTurn.inputs,
      timeoutSeconds: 240,
    }),
    outputSummary: (result) => ({
      role,
      threadId: result.threadId,
      turnId: result.turnId,
      status: result.status,
      profileVersion: context.roleProfile?.profileVersion ?? null,
      promptTemplateId: context.promptTemplate?.promptTemplateId ?? null,
      promptTemplateVersion: context.promptTemplate?.promptTemplateVersion ?? null,
      promptTemplateHash: context.promptTemplate?.promptTemplateHash ?? null,
    }),
  });
  const collected = await runStage(context, stages.summaryCollected, 94, {
    artifactId: context.artifactId,
    parentArtifactId: shotAnalysis.artifactId,
    inputSummary: { threadId: agentRun.threadId, turnId: started.turnId, shotCount: shotAnalysis.shots?.length ?? 0 },
    action: () => appServer.collectTurnResult({
      workspaceRoot: rootDir,
      threadId: agentRun.threadId,
      turnId: started.turnId,
      timeoutSeconds: 120,
    }),
    outputSummary: (result) => ({
      role,
      threadId: result.threadId,
      turnId: result.turnId,
      status: result.status,
      profileVersion: context.roleProfile?.profileVersion ?? null,
      promptTemplateId: context.promptTemplate?.promptTemplateId ?? null,
      promptTemplateVersion: context.promptTemplate?.promptTemplateVersion ?? null,
      promptTemplateHash: context.promptTemplate?.promptTemplateHash ?? null,
    }),
  });
  if (collected.status !== "completed") {
    throw require("../shot-boundary-analysis").codedError("shot_summary_turn_incomplete", "带货总结 Agent 未完成", {
      turnId: collected.turnId ?? started.turnId ?? null,
      status: collected.status ?? null,
    }, true);
  }
  const commerceBrief = await runStage(context, stages.summaryValidated, 95, {
    artifactId: context.artifactId,
    parentArtifactId: shotAnalysis.artifactId,
    inputSummary: { turnId: collected.turnId, shotCount: shotAnalysis.shots?.length ?? 0 },
    action: () => validateCommerceBriefOutput(collected.finalMessage, collected),
    outputSummary: (brief) => ({
      turnId: collected.turnId,
      hasSellingObject: Boolean(brief?.sellingObject),
      hasProofApproach: Boolean(brief?.proofApproach),
      hasPromisedOutcome: Boolean(brief?.promisedOutcome),
      hasPersuasionTarget: Boolean(brief?.persuasionTarget),
      hasConversionAction: Boolean(brief?.conversionAction),
      uncertaintyCount: Array.isArray(brief?.uncertainties) ? brief.uncertainties.length : 0,
    }),
  });
  return { turn: collected, commerceBrief };
}

async function writeCompletedAnalysis({
  context,
  agentRun,
  turn,
  runStage,
  stages,
  prepareInput,
  store,
  buildProcessedAnalysis,
  attachAnalysis,
  artifactIndex,
  resolveExistingFileHash,
  loadSampleArtifact,
  finalizeLease,
  threadPool,
  maxRepairAttempts,
  appServer,
  rootDir,
  renderRepairTurnInputs,
  renderSummaryTurnInputs,
  validateCommerceBriefOutput,
  codedError,
  role,
  jobStore,
  sampleStatus,
}) {
  const prepared = prepareInput(context.sampleArtifact, agentRun.analysisFps, { runtimeRoot: store.runtimeRoot });
  const contactSheets = agentRun.contactSheets ?? [];
  const resolved = await resolveFinalAnalysis({
    context,
    agentRun,
    turn,
    prepared,
    contactSheets,
    runStage,
    stages,
    maxRepairAttempts,
    buildProcessedAnalysis,
    appServer,
    rootDir,
    renderRepairTurnInputs,
    codedError,
    role,
  });
  const lease = { thread_id: agentRun.threadId, lease_id: agentRun.leaseId };
  const shotAnalysis = buildProcessedAnalysis(resolved.finalTurn.finalMessage, prepared, contactSheets, { ...context, validationSummary: resolved.validationSummary }, lease, resolved.finalTurn, {
    resultOrigin: resolved.resultOrigin,
    repairAttemptCount: resolved.repairAttemptCount,
  });
  const summary = await runSummaryTurn({
    context,
    agentRun,
    shotAnalysis,
    runStage,
    stages,
    appServer,
    rootDir,
    renderSummaryTurnInputs,
    validateCommerceBriefOutput,
    role,
  });
  await runStage(context, stages.resultWritten, 95, {
    artifactId: context.artifactId,
    parentArtifactId: prepared.sourceArtifactId ?? null,
    inputSummary: { turnId: resolved.finalTurn.turnId, summaryTurnId: summary.turn.turnId, frameCount: prepared.frames.length, sheetCount: contactSheets.length, resultOrigin: resolved.resultOrigin, repairAttemptCount: resolved.repairAttemptCount },
    action: async () => {
      const analysis = {
        ...shotAnalysis,
        commerceBrief: summary.commerceBrief,
        validation: {
          ...shotAnalysis.validation,
          commerceBrief: {
            hasSellingObject: Boolean(summary.commerceBrief?.sellingObject),
            hasProofApproach: Boolean(summary.commerceBrief?.proofApproach),
            hasPromisedOutcome: Boolean(summary.commerceBrief?.promisedOutcome),
            hasPersuasionTarget: Boolean(summary.commerceBrief?.persuasionTarget),
            hasConversionAction: Boolean(summary.commerceBrief?.conversionAction),
            uncertaintyCount: Array.isArray(summary.commerceBrief?.uncertainties) ? summary.commerceBrief.uncertainties.length : 0,
          },
        },
        agent: {
          ...shotAnalysis.agent,
          summaryTurnId: summary.turn.turnId,
          summaryPromptTemplateId: context.promptTemplate?.promptTemplateId ?? null,
          summaryPromptTemplateVersion: context.promptTemplate?.promptTemplateVersion ?? null,
          summaryPromptTemplateHash: context.promptTemplate?.promptTemplateHash ?? null,
        },
      };
      await attachAnalysis(context.sampleVideoId, analysis, {
        traceId: context.traceContext.traceId,
        sourceTraceId: context.sampleArtifact?.trace?.traceId ?? null,
      });
      await artifactIndex.registerSampleArtifact({
        artifact: await loadSampleArtifact(context.sampleVideoId),
        fileHash: await resolveExistingFileHash(context.sampleVideoId),
        traceId: context.traceContext.traceId,
      });
      await finalizeLease(threadPool, agentRun, { shouldDiscard: false });
      return analysis;
    },
    outputSummary: (result) => ({
      status: result.status,
      sheetCount: result.contactSheets?.length ?? 0,
      boundaryCount: result.boundaries?.length ?? 0,
      shotCount: result.shots.length,
      artifactType: result.type,
      resultOrigin: result.resultOrigin,
      repairAttemptCount: result.validation?.repairAttemptCount ?? 0,
    }),
  });
  jobStore.updateJob(context.job.jobId, {
    agentRun: { ...agentRun, status: "completed", updatedAt: new Date().toISOString() },
    stage: sampleStatus.processed,
    status: sampleStatus.processed,
    progress: 100,
    errorSummary: null,
  });
}

module.exports = {
  writeCompletedAnalysis,
};
