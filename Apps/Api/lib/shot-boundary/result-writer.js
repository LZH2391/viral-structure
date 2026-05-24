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
  repairPollIntervalMs = 2000,
  repairCollectMaxAttempts = 90,
  updateActiveThreadMessage,
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
  const collected = await collectRepairTurn({
    context,
    agentRun,
    started,
    repairAttemptCount,
    runStage,
    stages,
    appServer,
    rootDir,
    role,
    repairPollIntervalMs,
    repairCollectMaxAttempts,
    updateActiveThreadMessage,
  });
  return collected;
}

async function collectRepairTurn({
  context,
  agentRun,
  started,
  repairAttemptCount,
  runStage,
  stages,
  appServer,
  rootDir,
  role,
  repairPollIntervalMs,
  repairCollectMaxAttempts,
  updateActiveThreadMessage,
}) {
  let collected = null;
  const maxAttempts = Math.max(1, Number(repairCollectMaxAttempts || 1));
  const intervalMs = Math.max(0, Number(repairPollIntervalMs ?? 2000));
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (attempt > 1) await delay(intervalMs);
    collected = await runStage(context, stages.repairCollected, 93, {
      artifactId: context.artifactId,
      parentArtifactId: agentRun.parentArtifactId,
      inputSummary: { threadId: agentRun.threadId, turnId: started.turnId, repairAttemptCount, attempt },
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
        attempt,
        hasFinalMessage: Boolean(String(result.finalMessage ?? "").trim()),
        finalMessagePreview: safePreview(result.finalMessage),
        activeThreadMessagePreview: safePreview(result.activeThreadMessage),
        profileVersion: context.roleProfile?.profileVersion ?? null,
        promptTemplateId: context.promptTemplate?.promptTemplateId ?? null,
        promptTemplateVersion: context.promptTemplate?.promptTemplateVersion ?? null,
        promptTemplateHash: context.promptTemplate?.promptTemplateHash ?? null,
      }),
    });
    await updateActiveThreadMessage?.(collected.threadId, collected.turnId, collected.activeThreadMessage ?? null, collected.status);
    if (collected.status === "completed") return collected;
    if (!isPendingTurnStatus(collected.status)) {
      throwRepairCollectIncomplete(context, stages, agentRun, started, collected, repairAttemptCount, attempt, false);
    }
  }
  throwRepairCollectIncomplete(context, stages, agentRun, started, collected, repairAttemptCount, maxAttempts, true);
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
  repairAttemptOffset = 0,
  repairPollIntervalMs,
  repairCollectMaxAttempts,
  updateActiveThreadMessage,
}) {
  let repairAttemptCount = repairAttemptOffset;
  let finalTurn = turn;
  let resultOrigin = repairAttemptOffset > 0 ? "review_reworked_turn" : "new_turn";
  const maxAllowedRepairAttempt = repairAttemptOffset + maxRepairAttempts;
  while (repairAttemptCount <= maxAllowedRepairAttempt) {
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
      if (error?.code !== "shot_boundary_validation_failed" || repairAttemptCount >= maxAllowedRepairAttempt) {
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
        repairPollIntervalMs,
        repairCollectMaxAttempts,
        updateActiveThreadMessage,
      });
      resultOrigin = repairAttemptOffset > 0 ? "review_reworked_turn" : "repaired_turn";
    }
  }
  throw codedError("shot_boundary_validation_failed", "切镜结果校验失败", { repairAttemptCount: maxRepairAttempts }, false);
}

async function resolveReviewedAnalysis({
  context,
  agentRun,
  initialTurn,
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
  reviewer,
  store,
  threadPool,
  jobStore,
  repairPollIntervalMs,
  repairCollectMaxAttempts,
  updateActiveThreadMessage,
}) {
  let currentTurn = initialTurn;
  let analyzerRepairOffset = 0;
  let reviewReworkCount = 0;
  let lastReviewResult = null;
  let lastReviewRun = null;
  while (true) {
    const resolved = await resolveFinalAnalysis({
      context,
      agentRun,
      turn: currentTurn,
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
      repairAttemptOffset: analyzerRepairOffset,
      repairPollIntervalMs,
      repairCollectMaxAttempts,
      updateActiveThreadMessage,
    });
    const lease = { thread_id: agentRun.threadId, lease_id: agentRun.leaseId };
    const shotAnalysis = buildProcessedAnalysis(resolved.finalTurn.finalMessage, prepared, contactSheets, { ...context, validationSummary: resolved.validationSummary }, lease, resolved.finalTurn, {
      resultOrigin: resolved.resultOrigin,
      repairAttemptCount: resolved.repairAttemptCount,
      review: lastReviewResult ? reviewer.summarizeReviewResult(lastReviewResult) : null,
      reviewRuns: lastReviewRun ? [lastReviewRun] : [],
      reviewReworkCount,
    });
    const review = await runReviewTurn({
      context,
      agentRun,
      shotAnalysis,
      prepared,
      runStage,
      stages,
      appServer,
      rootDir,
      reviewer,
      store,
      threadPool,
      jobStore,
      reviewReworkCount,
      updateActiveThreadMessage,
    });
    lastReviewResult = review.result;
    lastReviewRun = review.run;
    if (review.result.decision === "pass") {
      return {
        ...resolved,
        shotAnalysis: {
          ...shotAnalysis,
          review: reviewer.summarizeReviewResult(review.result),
          reviewRuns: [review.run],
          validation: {
            ...shotAnalysis.validation,
            review: {
              decision: review.result.decision,
              issueCount: review.result.issues.length,
              reworkCount: reviewReworkCount,
            },
          },
        },
        reviewResult: review.result,
        reviewRuns: [review.run],
        reviewReworkCount,
      };
    }
    if (review.result.decision === "blocked" || reviewReworkCount >= reviewer.maxReworkCount) {
      const code = review.result.decision === "blocked" ? "shot_boundary_review_blocked" : "shot_boundary_review_rework_limit";
      throw codedError(code, review.result.reason || "切镜 reviewer 未通过", {
        review: reviewer.summarizeReviewResult(review.result),
        reviewRun: lastReviewRun,
        validation: {
          validatorCode: code,
          reviewDecision: review.result.decision,
          issueCount: review.result.issues.length,
          reworkCount: reviewReworkCount,
        },
      }, false);
    }
    reviewReworkCount += 1;
    const reviewError = reviewer.buildAnalyzerReviewReworkError(review.result, reviewReworkCount);
    currentTurn = await submitRepairTurn({
      context,
      agentRun,
      prepared,
      contactSheets,
      validationError: reviewError,
      priorTurn: resolved.finalTurn,
      repairAttemptCount: maxRepairAttempts + reviewReworkCount,
      runStage,
      stages,
      appServer,
      rootDir,
      renderRepairTurnInputs,
      role,
      repairPollIntervalMs,
      repairCollectMaxAttempts,
      updateActiveThreadMessage,
    });
    analyzerRepairOffset = maxRepairAttempts + reviewReworkCount;
    if (reviewReworkCount >= reviewer.maxReworkCount) {
      const finalResolved = await resolveFinalAnalysis({
        context,
        agentRun,
        turn: currentTurn,
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
        repairAttemptOffset: analyzerRepairOffset,
        repairPollIntervalMs,
        repairCollectMaxAttempts,
        updateActiveThreadMessage,
      });
      const acceptedReview = summarizeAcceptedReworkReview(reviewer, review.result, reviewReworkCount);
      const finalShotAnalysis = buildProcessedAnalysis(finalResolved.finalTurn.finalMessage, prepared, contactSheets, { ...context, validationSummary: finalResolved.validationSummary }, lease, finalResolved.finalTurn, {
        resultOrigin: finalResolved.resultOrigin,
        repairAttemptCount: finalResolved.repairAttemptCount,
        review: acceptedReview,
        reviewRuns: [review.run],
        reviewReworkCount,
      });
      return {
        ...finalResolved,
        shotAnalysis: {
          ...finalShotAnalysis,
          review: acceptedReview,
          reviewRuns: [review.run],
          validation: {
            ...finalShotAnalysis.validation,
            review: {
              decision: "pass",
              issueCount: review.result.issues.length,
              reworkCount: reviewReworkCount,
              acceptedWithoutFinalReview: true,
              sourceDecision: review.result.decision,
            },
          },
        },
        reviewResult: {
          ...review.result,
          decision: "pass",
          reason: acceptedReview.reason,
          issues: [],
          acceptedWithoutFinalReview: true,
          sourceDecision: review.result.decision,
        },
        reviewRuns: [review.run],
        reviewReworkCount,
      };
    }
    jobStore?.updateJob?.(context.job.jobId, {
      shotBoundaryReview: {
        currentReviewResult: reviewer.summarizeReviewResult(review.result),
        reworkCount: reviewReworkCount,
        maxReworkCount: reviewer.maxReworkCount,
        reviewerRole: reviewer.role,
        reviewerThreadId: review.run.threadId,
        reviewerTurnId: review.run.turnId,
        producerThreadId: agentRun.threadId,
        updatedAt: new Date().toISOString(),
      },
    });
  }
}

function summarizeAcceptedReworkReview(reviewer, reviewResult, reviewReworkCount) {
  return {
    ...reviewer.summarizeReviewResult(reviewResult),
    decision: "pass",
    reason: `第 ${reviewReworkCount} 次 reviewer rework 已按 issues 修复，按策略不再送审，直接接受结果`,
    issueCount: 0,
    issues: [],
    acceptedWithoutFinalReview: true,
    sourceDecision: reviewResult.decision,
    sourceIssueCount: Array.isArray(reviewResult.issues) ? reviewResult.issues.length : 0,
  };
}

async function runReviewTurn({
  context,
  agentRun,
  shotAnalysis,
  prepared,
  runStage,
  stages,
  appServer,
  rootDir,
  reviewer,
  store,
  threadPool,
  jobStore,
  reviewReworkCount,
  updateActiveThreadMessage,
}) {
  let lease = null;
  const reviewerProfile = await reviewer.loadRoleProfileByRole(reviewer.role);
  const reviewSheets = await runStage(context, stages.reviewSheetsPrepared, 91, {
    artifactId: context.artifactId,
    parentArtifactId: shotAnalysis.artifactId,
    inputSummary: { shotCount: shotAnalysis.shots?.length ?? 0, reworkCount: reviewReworkCount },
    action: () => reviewer.prepareReviewSheets({
      prepared,
      shotAnalysis,
      sampleDir: store.sampleDir(context.sampleVideoId),
      store,
      contactSheetGenerator: reviewer.contactSheetGenerator,
    }),
    outputSummary: (sheets) => ({
      sheetCount: sheets.filter((sheet) => sheet.localImagePath).length,
      emptySheetCount: sheets.filter((sheet) => sheet.empty).length,
      shotCount: shotAnalysis.shots?.length ?? 0,
    }),
  });
  try {
    const leaseAcquisition = await runStage(context, stages.reviewThreadAcquired, 92, {
      artifactId: context.artifactId,
      parentArtifactId: shotAnalysis.artifactId,
      inputSummary: { role: reviewer.role, producerRole: agentRun.role, producerThreadId: agentRun.threadId, shotCount: shotAnalysis.shots?.length ?? 0 },
      action: () => reviewer.acquireLeaseWithRetry(threadPool, {
        role: reviewer.role,
        ownerId: `${context.traceContext.traceId}:review`,
        codedError: require("../shot-boundary-analysis").codedError,
      }),
      outputSummary: (result) => ({
        role: reviewer.role,
        leaseId: result.lease.lease_id,
        threadId: result.lease.thread_id,
        attemptCount: result.attemptCount,
      }),
    });
    lease = leaseAcquisition.lease;
    const reviewTurn = reviewer.renderReviewTurnInputs({
      prepared,
      shotAnalysis,
      reviewSheets,
      roleProfile: reviewerProfile,
    });
    const started = await runStage(context, stages.reviewStarted, 93, {
      artifactId: context.artifactId,
      parentArtifactId: shotAnalysis.artifactId,
      inputSummary: { role: reviewer.role, threadId: lease.thread_id, leaseId: lease.lease_id, shotCount: shotAnalysis.shots?.length ?? 0, sheetCount: reviewSheets.length },
      action: () => appServer.startTurnWithInputs({
        workspaceRoot: rootDir,
        threadId: lease.thread_id,
        inputs: reviewTurn.inputs,
        timeoutSeconds: 240,
      }),
      outputSummary: (result) => ({
        role: reviewer.role,
        threadId: result.threadId,
        turnId: result.turnId,
        status: result.status,
        promptTemplateId: reviewTurn.promptTemplateId,
        promptTemplateVersion: reviewTurn.promptTemplateVersion,
        promptTemplateHash: reviewTurn.promptTemplateHash,
      }),
    });
    jobStore?.updateJob?.(context.job.jobId, {
      shotBoundaryReview: {
        reworkCount: reviewReworkCount,
        maxReworkCount: reviewer.maxReworkCount,
        reviewerRole: reviewer.role,
        reviewerThreadId: started.threadId,
        reviewerTurnId: started.turnId,
        producerThreadId: agentRun.threadId,
        status: "turn_submitted",
        updatedAt: new Date().toISOString(),
      },
    });
    const collected = await collectReviewTurn({
      context,
      shotAnalysis,
      lease,
      started,
      runStage,
      stages,
      appServer,
      rootDir,
      reviewer,
      updateActiveThreadMessage,
    });
    const result = await runStage(context, stages.reviewValidated, 95, {
      artifactId: context.artifactId,
      parentArtifactId: shotAnalysis.artifactId,
      inputSummary: { role: reviewer.role, threadId: lease.thread_id, turnId: collected.turnId, shotCount: shotAnalysis.shots?.length ?? 0 },
      action: () => reviewer.validateReviewResult(collected.finalMessage, shotAnalysis, collected),
      outputSummary: (reviewResult) => ({
        role: reviewer.role,
        decision: reviewResult.decision,
        issueCount: reviewResult.issues.length,
        reworkCount: reviewReworkCount,
      }),
    });
    await threadPool.releaseLease({ leaseId: lease.lease_id, ownerId: `${context.traceContext.traceId}:review` });
    lease = null;
    return {
      result,
      run: {
        provider: "codex-appserver",
        role: reviewer.role,
        threadId: leaseAcquisition.lease.thread_id,
        leaseId: leaseAcquisition.lease.lease_id,
        turnId: collected.turnId ?? started.turnId ?? null,
        promptTemplateId: reviewTurn.promptTemplateId,
        promptTemplateVersion: reviewTurn.promptTemplateVersion,
        promptTemplateHash: reviewTurn.promptTemplateHash,
        sheetCount: reviewSheets.filter((sheet) => sheet.localImagePath).length,
        reworkCount: reviewReworkCount,
        status: "completed",
      },
    };
  } catch (error) {
    if (lease?.thread_id) {
      await threadPool.discardThread({ threadId: lease.thread_id, reason: "shot-boundary-review-failed" }).catch(() => undefined);
      await threadPool.releaseOwnerLeases?.(`${context.traceContext.traceId}:review`).catch(() => undefined);
    }
    throw error;
  }
}

async function collectReviewTurn({
  context,
  shotAnalysis,
  lease,
  started,
  runStage,
  stages,
  appServer,
  rootDir,
  reviewer,
  updateActiveThreadMessage,
}) {
  let collected = null;
  const maxAttempts = Math.max(1, Number(reviewer.reviewCollectMaxAttempts || 90));
  const intervalMs = Math.max(0, Number(reviewer.reviewPollIntervalMs ?? 2000));
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (attempt > 1) await delay(intervalMs);
    collected = await runStage(context, stages.reviewCollected, 94, {
      artifactId: context.artifactId,
      parentArtifactId: shotAnalysis.artifactId,
      inputSummary: { role: reviewer.role, threadId: lease.thread_id, turnId: started.turnId, shotCount: shotAnalysis.shots?.length ?? 0, attempt },
      action: () => appServer.collectTurnResult({
        workspaceRoot: rootDir,
        threadId: lease.thread_id,
        turnId: started.turnId,
        timeoutSeconds: 120,
      }),
      outputSummary: (result) => ({
        role: reviewer.role,
        threadId: result.threadId,
        turnId: result.turnId,
        status: result.status,
        attempt,
      }),
    });
    await updateActiveThreadMessage?.(collected.threadId, collected.turnId, collected.activeThreadMessage ?? null, collected.status);
    if (collected.status === "completed") return collected;
    if (!isPendingTurnStatus(collected.status)) {
      throwReviewIncomplete(context, stages, started, shotAnalysis, collected, reviewer.role, false);
    }
  }
  throwReviewIncomplete(context, stages, started, shotAnalysis, collected, reviewer.role, true);
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
  summaryPollIntervalMs = 2000,
  summaryCollectMaxAttempts = 90,
  updateActiveThreadMessage,
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
  const collected = await collectSummaryTurn({
    context,
    agentRun,
    started,
    shotAnalysis,
    runStage,
    stages,
    appServer,
    rootDir,
    role,
    summaryPollIntervalMs,
    summaryCollectMaxAttempts,
    updateActiveThreadMessage,
  });
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

async function collectSummaryTurn({
  context,
  agentRun,
  started,
  shotAnalysis,
  runStage,
  stages,
  appServer,
  rootDir,
  role,
  summaryPollIntervalMs,
  summaryCollectMaxAttempts,
  updateActiveThreadMessage,
}) {
  let collected = null;
  const maxAttempts = Math.max(1, Number(summaryCollectMaxAttempts || 1));
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (attempt > 1) await delay(summaryPollIntervalMs);
    collected = await runStage(context, stages.summaryCollected, 94, {
      artifactId: context.artifactId,
      parentArtifactId: shotAnalysis.artifactId,
      inputSummary: { threadId: agentRun.threadId, turnId: started.turnId, shotCount: shotAnalysis.shots?.length ?? 0, attempt },
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
        attempt,
        profileVersion: context.roleProfile?.profileVersion ?? null,
        promptTemplateId: context.promptTemplate?.promptTemplateId ?? null,
        promptTemplateVersion: context.promptTemplate?.promptTemplateVersion ?? null,
        promptTemplateHash: context.promptTemplate?.promptTemplateHash ?? null,
      }),
    });
    await updateActiveThreadMessage?.(collected.threadId, collected.turnId, collected.activeThreadMessage ?? null, collected.status);
    if (collected.status === "completed") return collected;
    if (!isPendingTurnStatus(collected.status)) {
      throwSummaryIncomplete(context, stages, started, shotAnalysis, collected, false);
    }
  }
  throwSummaryIncomplete(context, stages, started, shotAnalysis, collected, true);
}

function throwSummaryIncomplete(context, stages, started, shotAnalysis, collected, retryable) {
  context.activeStage = {
    stageName: stages.summaryCollected,
    artifactId: context.artifactId,
    parentArtifactId: shotAnalysis.artifactId,
    inputSummary: { turnId: started.turnId, shotCount: shotAnalysis.shots?.length ?? 0 },
    outputSummary: { turnId: collected?.turnId ?? started.turnId ?? null, status: collected?.status ?? null },
    startedAt: Date.now(),
  };
  throw require("../shot-boundary-analysis").codedError("shot_summary_turn_incomplete", "带货总结 Agent 未完成", {
    turnId: collected?.turnId ?? started.turnId ?? null,
    status: collected?.status ?? null,
  }, retryable);
}

function throwReviewIncomplete(context, stages, started, shotAnalysis, collected, role, retryable) {
  context.activeStage = {
    stageName: stages.reviewCollected,
    artifactId: context.artifactId,
    parentArtifactId: shotAnalysis.artifactId,
    inputSummary: { role, turnId: started.turnId, shotCount: shotAnalysis.shots?.length ?? 0 },
    outputSummary: { turnId: collected?.turnId ?? started.turnId ?? null, status: collected?.status ?? null },
    startedAt: Date.now(),
  };
  throw require("../shot-boundary-analysis").codedError("shot_boundary_review_turn_incomplete", "切镜 reviewer 未完成", {
    role,
    turnId: collected?.turnId ?? started.turnId ?? null,
    status: collected?.status ?? null,
  }, retryable);
}

function throwRepairCollectIncomplete(context, stages, agentRun, started, collected, repairAttemptCount, attemptCount, retryable) {
  context.activeStage = {
    stageName: stages.repairCollected,
    artifactId: context.artifactId,
    parentArtifactId: agentRun.parentArtifactId,
    inputSummary: { threadId: agentRun.threadId, turnId: started.turnId, repairAttemptCount, attemptCount },
    outputSummary: summarizeCollectedTurn(collected, started.turnId),
    startedAt: Date.now(),
  };
  const status = collected?.status ?? null;
  const code = retryable ? "appserver_turn_collect_timeout" : "appserver_turn_collect_failed";
  const message = retryable ? "切镜修复 Agent 长时间未返回结果" : "切镜修复 Agent 结果收集失败";
  throw require("../shot-boundary-analysis").codedError(code, message, {
    turnId: collected?.turnId ?? started.turnId ?? null,
    repairAttemptCount,
    attemptCount,
    collectStatus: status,
    status,
    finalMessagePreview: safePreview(collected?.finalMessage),
    activeThreadMessagePreview: safePreview(collected?.activeThreadMessage),
    validation: {
      status: "failed",
      repairAttemptCount,
      validatorCode: code,
    },
  }, retryable);
}

function summarizeCollectedTurn(collected, fallbackTurnId) {
  return {
    turnId: collected?.turnId ?? fallbackTurnId ?? null,
    status: collected?.status ?? null,
    hasFinalMessage: Boolean(String(collected?.finalMessage ?? "").trim()),
    finalMessagePreview: safePreview(collected?.finalMessage),
    activeThreadMessagePreview: safePreview(collected?.activeThreadMessage),
  };
}

function safePreview(value, maxLength = 200) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, maxLength) : null;
}

function isReviewTurnPayload(payload) {
  const text = String(payload?.inputs?.[0]?.text ?? "");
  return text.includes("切镜审查") && text.includes("decision") && text.includes("issues");
}

function isPendingTurnStatus(status) {
  return ["created", "pending", "queued", "submitted", "running", "inprogress", "in_progress", "collecting"].includes(String(status ?? "").trim().toLowerCase());
}

function delay(ms) {
  const duration = Math.max(0, Number(ms || 0));
  return duration > 0 ? new Promise((resolve) => setTimeout(resolve, duration)) : Promise.resolve();
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
  repairPollIntervalMs,
  repairCollectMaxAttempts,
  renderSummaryTurnInputs,
  validateCommerceBriefOutput,
  codedError,
  role,
  jobStore,
  sampleStatus,
  summaryPollIntervalMs,
  summaryCollectMaxAttempts,
  reviewer,
  updateActiveThreadMessage,
}) {
  const prepared = prepareInput(context.sampleArtifact, agentRun.analysisFps, { runtimeRoot: store.runtimeRoot });
  const contactSheets = agentRun.contactSheets ?? [];
  const resolved = await resolveReviewedAnalysis({
    context,
    agentRun,
    initialTurn: turn,
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
    reviewer,
    store,
    threadPool,
    jobStore,
    repairPollIntervalMs,
    repairCollectMaxAttempts,
    updateActiveThreadMessage,
  });
  const shotAnalysis = resolved.shotAnalysis;
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
    summaryPollIntervalMs,
    summaryCollectMaxAttempts,
    updateActiveThreadMessage,
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
    activeThreadMessage: null,
  });
}

module.exports = {
  writeCompletedAnalysis,
};
