function createAnalysisPipelineRunner({
  runtime,
  threadPool,
  appServer,
  rootDir,
  pollIntervalMs,
  maxCollectAttempts,
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
            rootDir,
            pollIntervalMs,
            maxCollectAttempts,
            onTurnStarted: ({ lease: startedLease, started }) => {
              lease = startedLease;
              context.agentRun = descriptor.buildAgentRun({ context, lease: startedLease, turn: started, input });
              runtime.job.resumeProcessing(context.job.jobId, descriptor.STAGES.analyzed, descriptor.progress.analyzed, {
                agentRun: context.agentRun,
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
          turnInputs: repairTurn,
          appServer,
          rootDir,
          pollIntervalMs,
          maxCollectAttempts,
          onTurnCollect: (turn) => runtime.updateActiveThreadMessage(context, turn),
        });
        const analysis = descriptor.buildProcessedAnalysis(executed.finalTurn.finalMessage, context.input, context, context.agentRun, executed.finalTurn, {
          repairAttemptCount,
        });
        context.finalOutputText = executed.finalTurn.finalMessage ?? null;
        context.agentRun = descriptor.updateAgentRun(context.agentRun, context, executed.finalTurn);
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
        rootDir,
        pollIntervalMs,
        maxCollectAttempts,
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
        rootDir,
        pollIntervalMs,
        maxCollectAttempts,
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

module.exports = {
  createAnalysisPipelineRunner,
};
