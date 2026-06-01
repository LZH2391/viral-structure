function createAnalysisPipelineRunner({
  runtime,
  threadPool,
  appServer,
  activeTurnRuntime = null,
  rootDir,
  pollIntervalMs,
  maxCollectAttempts,
  collectIdleTimeoutMs,
  collectHardTimeoutMs,
  maxRepairAttempts = 1,
  maxBoundaryReworkAttempts = 1,
}) {
  async function runAnalysisPipeline(context, descriptor) {
    let lease = null;
    try {
      const input = await runtime.runStage(context, descriptor.STAGES.inputPrepared, descriptor.progress.inputPrepared, {
        artifactId: context.artifactId,
        parentArtifactId: descriptor.resolvePreparedParentArtifactId(context),
        inputSummary: descriptor.buildPrepareInputSummary(context),
        action: () => descriptor.prepareInput(context.artifact, descriptor.buildPrepareInputOptions(context)),
        outputSummary: (result) => descriptor.buildPreparedOutputSummary(result),
      });
      context.input = input;
      if (!context.cacheKey) context.cacheKey = descriptor.buildCacheKey(input);
      if (!context.promptTemplate) context.promptTemplate = descriptor.buildAnalyzePromptTemplate(context.roleProfile);

      const cached = await descriptor.runCacheLookup({
        context,
        input,
        runtime,
      });
      if (cached && context.cacheDecision === "ask") {
        descriptor.markCacheWaiting({ context, cached, runtime });
        return null;
      }
      if (cached && context.cacheDecision === "reuse") {
        await descriptor.reuseCachedAnalysis({ context, cachePrompt: descriptor.buildCachePrompt(context, cached), runtime });
        runtime.job.complete(context);
        return null;
      }

      const inputPackage = await runtime.runStage(context, descriptor.STAGES.inputPackaged, descriptor.progress.inputPackaged, {
        artifactId: context.artifactId,
        parentArtifactId: descriptor.resolveMaterializeParentArtifactId(context, input),
        inputSummary: descriptor.buildInputPackageSummary(context, input),
        action: () => descriptor.prepareInputPackage({
          input,
          sampleDir: descriptor.resolveSampleDir(context),
          store: descriptor.store,
        }),
        outputSummary: (result) => descriptor.buildInputPackageOutputSummary(result),
      });
      context.inputPackage = inputPackage;

      const analyzeTurn = descriptor.renderAnalyzeTurnInputs({ input, inputPackage, roleProfile: context.roleProfile });
      const analyzed = await runtime.runStage(context, descriptor.STAGES.analyzed, descriptor.progress.analyzed, {
        artifactId: context.artifactId,
        parentArtifactId: descriptor.resolveMaterializeParentArtifactId(context, input),
        inputSummary: descriptor.buildAnalyzeInputSummary(context, input, inputPackage),
        action: async () => {
          const executed = await descriptor.executeAnalyzeTurn({
            context,
            input,
            turnInputs: analyzeTurn,
            threadPool,
            appServer,
            activeTurnRuntime,
            rootDir,
            pollIntervalMs,
            maxCollectAttempts,
            collectIdleTimeoutMs,
            collectHardTimeoutMs,
            onThreadAcquire: (activity) => {
              runtime.job.resumeProcessing(context.job.jobId, threadAcquireStage(descriptor), threadAcquireProgress(descriptor), {
                threadAcquire: buildThreadAcquireSummary(activity),
              });
            },
            onTurnSubmit: ({ lease: startedLease, started }) => {
              const nextRun = descriptor.buildAgentRun({ context, lease: startedLease, turn: started, input });
              context.agentRun = nextRun;
              runtime.job.resumeProcessing(context.job.jobId, turnSubmitStage(descriptor), turnSubmitProgress(descriptor), {
                agentRun: nextRun,
                threadAcquire: buildThreadAcquireSummary({
                  role: nextRun.role,
                  status: "acquired",
                  leaseId: startedLease?.lease_id ?? null,
                  threadId: startedLease?.thread_id ?? null,
                }),
              });
            },
            onTurnCollectStart: ({ lease: startedLease, started }) => {
              if (!context.agentRun) context.agentRun = descriptor.buildAgentRun({ context, lease: startedLease, turn: started, input });
              runtime.job.resumeProcessing(context.job.jobId, turnCollectStage(descriptor), turnCollectProgress(descriptor), {
                agentRun: context.agentRun,
              });
            },
            onTurnStarted: ({ lease: startedLease, started }) => {
              lease = startedLease;
              context.agentRun = context.agentRun ?? descriptor.buildAgentRun({ context, lease: startedLease, turn: started, input });
              upsertDescriptorTraceCard(runtime, context, descriptor, "analyze", {
                status: "running",
                run: context.agentRun,
                artifactId: context.artifactId,
                parentArtifactId: descriptor.resolveMaterializeParentArtifactId(context, input),
              });
            },
            onTurnCollect: (turn) => runtime.updateActiveThreadMessage(context, turn),
          });
          lease = executed.lease;
          if (!context.agentRun) {
            context.agentRun = descriptor.buildAgentRun({ context, lease: executed.lease, turn: executed.started, input });
          }
          runtime.job.resumeProcessing(context.job.jobId, descriptor.STAGES.analyzed, descriptor.progress.analyzed, {
            agentRun: context.agentRun,
            activeThreadMessage: null,
          });
          const analysis = descriptor.buildProcessedAnalysis(executed.finalTurn.finalMessage, input, context, context.agentRun, executed.finalTurn, {
            repairAttemptCount: 0,
          });
          context.finalOutputText = executed.finalTurn.finalMessage ?? null;
          context.agentRun = descriptor.updateAgentRun(context.agentRun, context, executed.finalTurn);
          context.agentRun.lastTokenUsage = extractTurnTokenUsage(executed.finalTurn);
          upsertDescriptorTraceCard(runtime, context, descriptor, "analyze", {
            status: "completed",
            run: context.agentRun,
            artifactId: analysis.artifactId,
            parentArtifactId: analysis.parentArtifactId,
          });
          return { analysis, finalTurn: executed.finalTurn };
        },
        outputSummary: (result) => descriptor.buildAnalyzeOutputSummary(context, result),
      });

      let analysis = analyzed.analysis;
      let finalTurn = analyzed.finalTurn;

      const validated = await runtime.runStage(context, descriptor.STAGES.validated, descriptor.progress.validated, {
        artifactId: analysis.artifactId,
        parentArtifactId: analysis.parentArtifactId,
        inputSummary: descriptor.buildValidateInputSummary(analysis, finalTurn),
        action: () => analysis,
        outputSummary: (result) => descriptor.buildValidateOutputSummary(result),
      });
      analysis = validated;

      if (!descriptor.isValidationPassed(analysis)) {
        throw descriptor.buildValidationError(analysis, finalTurn);
      }

      return await reviewAndMaterialize(context, descriptor, analysis);
    } catch (error) {
      if (descriptor.canAttemptRepair?.(error, context) && context.input) {
        for (let repairAttemptCount = 1; repairAttemptCount <= maxRepairAttempts; repairAttemptCount += 1) {
          try {
            const repaired = await runRepair(context, descriptor, error, repairAttemptCount);
            if (repaired) return repaired;
          } catch (repairError) {
            error = repairError;
          }
        }
      }
      await runtime.thread.cleanup(context, threadPool, lease, descriptor.cleanupReason);
      await runtime.markFailed(context, error);
      return null;
    }
  }

  async function runRepair(context, descriptor, validationError, repairAttemptCount) {
    const repairTurn = descriptor.renderRepairTurnInputs({
      input: context.input,
      inputPackage: context.inputPackage,
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
    const repaired = await runtime.runStage(context, descriptor.STAGES.repaired, descriptor.progress.repaired, {
      artifactId: context.artifactId,
      parentArtifactId: descriptor.resolveMaterializeParentArtifactId(context, context.input),
      inputSummary: descriptor.buildRepairInputSummary(context, validationError, repairAttemptCount),
      action: async () => {
        const executed = await descriptor.executeRepairTurn({
          agentRun: context.agentRun,
          context,
          input: context.input,
          turnInputs: repairTurn,
          threadPool,
          appServer,
          activeTurnRuntime,
          rootDir,
          pollIntervalMs,
          maxCollectAttempts,
          collectIdleTimeoutMs,
          collectHardTimeoutMs,
          onTurnCollect: (turn) => runtime.updateActiveThreadMessage(context, turn),
          onLeaseReplaced: ({ previousAgentRun, agentRun, decision }) => {
            context.agentRun = agentRun;
            const threadContextPolicy = {
              event: decision.reason,
              maxInputTokenRatio: 0.8,
              previousThreadId: previousAgentRun?.threadId ?? null,
              previousLeaseId: previousAgentRun?.leaseId ?? null,
              threadId: agentRun?.threadId ?? null,
              leaseId: agentRun?.leaseId ?? null,
              inputTokens: decision.inputTokens,
              modelContextWindow: decision.modelContextWindow,
              ratio: decision.ratio,
            };
            context.threadContextPolicy = threadContextPolicy;
            if (context.activeStage) {
              context.activeStage.outputSummary = {
                ...(context.activeStage.outputSummary ?? {}),
                threadContextPolicy,
              };
            }
            runtime.thread.upsertTraceCard(context, descriptor.buildAgentTraceCard?.(context, "thread-context", {
              status: "completed",
              run: agentRun,
              artifactId: context.artifactId,
              parentArtifactId: descriptor.resolveMaterializeParentArtifactId(context, context.input),
              activity: threadContextPolicy,
            }));
            runtime.job.resumeProcessing(context.job.jobId, descriptor.STAGES.repaired, descriptor.progress.repaired, {
              agentRun,
              threadContextPolicy,
            });
          },
        });
        if (executed.agentRun) context.agentRun = executed.agentRun;
        const analysis = descriptor.buildProcessedAnalysis(executed.finalTurn.finalMessage, context.input, context, context.agentRun, executed.finalTurn, {
          repairAttemptCount,
        });
        context.finalOutputText = executed.finalTurn.finalMessage ?? null;
        context.agentRun = descriptor.updateAgentRun(context.agentRun, context, executed.finalTurn);
        context.agentRun.lastTokenUsage = extractTurnTokenUsage(executed.finalTurn);
        runtime.job.resumeProcessing(context.job.jobId, descriptor.STAGES.repaired, descriptor.progress.repaired, {
          agentRun: context.agentRun,
          activeThreadMessage: null,
        });
        return { analysis, finalTurn: executed.finalTurn, repairAttemptCount };
      },
      outputSummary: (result) => descriptor.buildRepairOutputSummary(context, result),
    });
    return reviewAndMaterialize(context, descriptor, repaired.analysis);
  }

  async function reviewAndMaterialize(context, descriptor, analysis) {
    if (typeof descriptor.runBoundaryReview !== "function") {
      return materialize(context, descriptor, analysis);
    }
    let currentAnalysis = analysis;
    for (let reviewAttemptCount = 1; reviewAttemptCount <= maxBoundaryReworkAttempts + 1; reviewAttemptCount += 1) {
      currentAnalysis = await descriptor.runBoundaryReview({
        context,
        analysis: currentAnalysis,
        runtime,
        threadPool,
        appServer,
        activeTurnRuntime,
        rootDir,
        pollIntervalMs,
        maxCollectAttempts,
        collectIdleTimeoutMs,
        collectHardTimeoutMs,
        reviewAttemptCount,
      });
      currentAnalysis = appendBoundaryReviewHistory(currentAnalysis);
      const boundaryReview = currentAnalysis.boundaryReview;
      if (boundaryReview?.decision !== "rework") break;
      const reworkAttemptCount = reviewAttemptCount;
      if (reworkAttemptCount > maxBoundaryReworkAttempts || typeof descriptor.runBoundaryRework !== "function") break;
      currentAnalysis = await descriptor.runBoundaryRework({
        context,
        analysis: currentAnalysis,
        boundaryReview,
        runtime,
        appServer,
        activeTurnRuntime,
        rootDir,
        pollIntervalMs,
        maxCollectAttempts,
        collectIdleTimeoutMs,
        collectHardTimeoutMs,
        reworkAttemptCount,
      });
    }
    return materialize(context, descriptor, currentAnalysis);
  }

  function appendBoundaryReviewHistory(analysis) {
    if (!analysis?.boundaryReview) return analysis;
    const history = Array.isArray(analysis.boundaryReviewHistory) ? analysis.boundaryReviewHistory : [];
    return {
      ...analysis,
      boundaryReviewHistory: [...history, analysis.boundaryReview].slice(-4),
    };
  }

  async function materialize(context, descriptor, analysis) {
    const materializedArtifact = await runtime.runStage(context, descriptor.STAGES.materialized, descriptor.progress.materialized, {
      artifactId: analysis.artifactId,
      parentArtifactId: analysis.parentArtifactId,
      inputSummary: descriptor.buildMaterializeInputSummary(analysis),
      action: async () => {
        await descriptor.assertMaterializeDependencies(context);
        const nextArtifact = await descriptor.attachAnalysis(context.sampleVideoId, analysis, {
          traceId: context.traceContext.traceId,
          sourceTraceId: context.artifact?.trace?.traceId ?? null,
        });
        if (runtime.materialize?.registerSampleArtifact) {
          await runtime.materialize.registerSampleArtifact(context, nextArtifact);
        }
        return nextArtifact;
      },
      outputSummary: (artifact) => descriptor.buildMaterializeOutputSummary(artifact),
    });
    await runtime.thread.finalize(context, threadPool);
    runtime.job.complete(context);
    return materializedArtifact;
  }

  return {
    runAnalysisPipeline,
  };
}

function threadAcquireStage(descriptor) {
  return descriptor.STAGES.threadAcquire ?? descriptor.STAGES.analyzed.replace(/\.analyze$/, ".thread_acquire");
}

function turnSubmitStage(descriptor) {
  return descriptor.STAGES.turnSubmit ?? descriptor.STAGES.analyzed.replace(/\.analyze$/, ".turn_submit");
}

function turnCollectStage(descriptor) {
  return descriptor.STAGES.turnCollect ?? descriptor.STAGES.analyzed.replace(/\.analyze$/, ".turn_collect");
}

function threadAcquireProgress(descriptor) {
  return Math.max(0, descriptor.progress.analyzed - 2);
}

function turnSubmitProgress(descriptor) {
  return Math.max(0, descriptor.progress.analyzed - 1);
}

function turnCollectProgress(descriptor) {
  return descriptor.progress.analyzed;
}

function buildThreadAcquireSummary(activity = {}) {
  return {
    role: activity.role ?? null,
    status: activity.status ?? null,
    attemptCount: activity.attemptCount ?? null,
    readinessDetail: activity.readinessDetail ?? null,
    lastRequestError: activity.lastRequestError ?? null,
    requestTimeoutMs: activity.requestTimeoutMs ?? null,
    leaseId: activity.leaseId ?? null,
    threadId: activity.threadId ?? null,
    updatedAt: new Date().toISOString(),
  };
}

function extractTurnTokenUsage(turn) {
  if (!turn || typeof turn !== "object") return null;
  const activityUsage = turn.turnActivity?.tokenUsage ?? null;
  const directUsage = turn.last_token_usage ?? turn.lastTokenUsage ?? turn.token_usage ?? turn.tokenUsage ?? null;
  const modelContextWindow = turn.model_context_window ?? turn.modelContextWindow ?? turn.turnActivity?.modelContextWindow ?? null;
  if (!activityUsage && !directUsage && modelContextWindow == null) return null;
  return {
    ...(activityUsage ? { last_token_usage: normalizeUsage(activityUsage) } : {}),
    ...(directUsage ? { last_token_usage: normalizeUsage(directUsage) } : {}),
    ...(modelContextWindow != null ? { model_context_window: Number(modelContextWindow) } : {}),
  };
}

function normalizeUsage(usage) {
  if (!usage || typeof usage !== "object") return {};
  return {
    input_tokens: Number(usage.input_tokens ?? usage.inputTokens ?? 0),
    output_tokens: Number(usage.output_tokens ?? usage.outputTokens ?? 0),
    total_tokens: Number(usage.total_tokens ?? usage.totalTokens ?? 0),
  };
}

function upsertDescriptorTraceCard(runtime, context, descriptor, id, options = {}) {
  if (typeof descriptor.buildAgentTraceCard !== "function") return null;
  return runtime.thread.upsertTraceCard(context, descriptor.buildAgentTraceCard(context, id, options));
}

module.exports = {
  createAnalysisPipelineRunner,
};
