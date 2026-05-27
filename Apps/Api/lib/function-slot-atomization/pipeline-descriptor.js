const path = require("path");
const { assertExpectedArtifact } = require("../compatibility/analysis-service-shared");
const { buildAgentRun, updateAgentRun } = require("../function-slot-atomization-analysis/agent-run");
const {
  prepareInput,
  prepareInputPackage,
  renderAnalyzeTurnInputs,
  renderRepairTurnInputs,
  renderBoundaryReworkTurnInputs,
} = require("../function-slot-atomization-analysis/input");
const { executeAnalyzeTurn, executeRepairTurn } = require("../function-slot-atomization-analysis/runner");
const {
  buildProcessedAnalysis,
  buildCacheReuseAnalysis,
  evaluateCacheEligibility,
} = require("../function-slot-atomization-analysis/result-builder");
const { buildFunctionSlotAtomizationContentFingerprint } = require("../function-slot-atomization-analysis/cache-params");
const { runCacheLookup, markCacheWaiting, reuseCachedAnalysis, buildCachePrompt } = require("./cache");
const { attachFunctionSlotAtomizationAnalysis } = require("./artifact-writer");
const { ROLE, SKILL_PATH, STAGES, codedError, resolveSkillHash } = require("../function-slot-atomization-analysis/shared");
const {
  REVIEW_SKILL_PATH,
  runFunctionSlotBoundaryReview,
  resolveBoundaryReviewSkillHash,
} = require("../function-slot-atomization-boundary-review");

function createFunctionSlotAtomizationPipelineDescriptor({ store }) {
  return {
    ROLE,
    SKILL_PATH,
    STAGES,
    progress: {
      inputPrepared: 18,
      inputPackaged: 28,
      cacheLookup: 32,
      analyzed: 58,
      validated: 78,
      repaired: 88,
      boundaryReviewed: 90,
      boundaryReworked: 92,
      cacheReuse: 92,
      materialized: 96,
    },
    store,
    resolveSkillHash,
    prepareInput,
    prepareInputPackage,
    renderAnalyzeTurnInputs,
    renderRepairTurnInputs,
    executeAnalyzeTurn,
    executeRepairTurn,
    buildAgentRun,
    updateAgentRun,
    buildProcessedAnalysis,
    buildCacheReuseAnalysis,
    evaluateCacheEligibility,
    buildCacheKey: (input) => buildFunctionSlotAtomizationContentFingerprint(input),
    buildAnalyzePromptTemplate(roleProfile) {
      const prompt = roleProfile?.turnTemplates?.analyze ?? {};
      return {
        promptTemplateId: "analyze",
        promptTemplateVersion: prompt.templateVersion ?? null,
        promptTemplateHash: prompt.templateHash ?? null,
      };
    },
    resolvePreparedParentArtifactId(context) {
      return context.artifact.packagingStructureAnalysis?.artifactId
        ?? context.artifact.rhythmStructureAnalysis?.artifactId
        ?? context.artifact.scriptSegmentAnalysis?.artifactId
        ?? context.artifact.sampleVideo?.artifactId
        ?? null;
    },
    resolveMaterializeParentArtifactId(context, input) {
      return input.parentArtifactId ?? this.resolvePreparedParentArtifactId(context);
    },
    buildPrepareInputOptions() {
      return {};
    },
    buildPrepareInputSummary(context) {
      return {
        sampleVideoId: context.sampleVideoId,
        sourceScriptSegmentArtifactId: context.artifact.scriptSegmentAnalysis?.artifactId ?? null,
        sourceRhythmStructureArtifactId: context.artifact.rhythmStructureAnalysis?.artifactId ?? null,
        sourcePackagingStructureArtifactId: context.artifact.packagingStructureAnalysis?.artifactId ?? null,
      };
    },
    buildPreparedOutputSummary(result) {
      return {
        parentArtifactId: result.parentArtifactId,
        scriptSegmentCount: result.scriptSegmentAnalysis.segments.length,
        rhythmSectionCount: result.rhythmStructureAnalysis.sections.length,
        packagingBlockCount: result.packagingStructureAnalysis.packagingBlocks.length,
      };
    },
    buildInputPackageSummary(context, input) {
      return {
        sampleVideoId: context.sampleVideoId,
        sourceScriptSegmentArtifactId: input.sourceScriptSegmentArtifactId,
        sourceRhythmStructureArtifactId: input.sourceRhythmStructureArtifactId,
        sourcePackagingStructureArtifactId: input.sourcePackagingStructureArtifactId,
      };
    },
    buildInputPackageOutputSummary(result) {
      return {
        manifestHash: result.hashes.manifestHash,
        outputContractHash: result.hashes.outputContractHash,
      };
    },
    buildAnalyzeInputSummary(context, input) {
      return {
        role: ROLE,
        scriptSegmentCount: input.scriptSegmentAnalysis.segments.length,
        rhythmSectionCount: input.rhythmStructureAnalysis.sections.length,
        packagingBlockCount: input.packagingStructureAnalysis.packagingBlocks.length,
        promptTemplateVersion: context.promptTemplate?.promptTemplateVersion ?? null,
      };
    },
    buildAnalyzeOutputSummary(context, result) {
      return {
        role: ROLE,
        threadId: context.agentRun?.threadId ?? null,
        leaseId: context.agentRun?.leaseId ?? null,
        turnId: result.finalTurn?.turnId ?? null,
        status: result.analysis.status,
        slotCount: result.analysis.slotMap.slots.length,
        promptTemplateVersion: result.analysis.agent?.promptTemplateVersion ?? null,
      };
    },
    buildValidateInputSummary(analysis, finalTurn) {
      return {
        slotCount: analysis.slotMap.slots.length,
        turnId: finalTurn?.turnId ?? null,
      };
    },
    buildValidateOutputSummary(result) {
      return {
        status: result.validation?.status ?? null,
        slotCount: result.slotMap?.slots?.length ?? 0,
        validatorCode: result.validation?.validatorCode ?? null,
        repairAttemptCount: result.validation?.repairAttemptCount ?? 0,
      };
    },
    buildValidationError(analysis, finalTurn) {
      return codedError("function_slot_atomization_validation_failed", "功能槽位原子化输出未通过校验", {
        validation: analysis.validation,
        turnId: finalTurn?.turnId ?? null,
      }, false);
    },
    isValidationPassed(analysis) {
      return analysis?.validation?.status === "passed";
    },
    canAttemptRepair(error, context) {
      return error?.code === "function_slot_atomization_validation_failed" && context.agentRun?.threadId;
    },
    buildRepairInputSummary(context, validationError, repairAttemptCount) {
      return {
        role: ROLE,
        threadId: context.agentRun?.threadId ?? null,
        leaseId: context.agentRun?.leaseId ?? null,
        repairAttemptCount,
        validatorCode: validationError?.debugPayload?.validation?.validatorCode ?? validationError?.code ?? null,
      };
    },
    buildRepairOutputSummary(context, result) {
      return {
        role: ROLE,
        threadId: context.agentRun?.threadId ?? null,
        turnId: result.finalTurn?.turnId ?? null,
        status: result.analysis.status,
        slotCount: result.analysis.slotMap.slots.length,
        repairAttemptCount: result.repairAttemptCount,
      };
    },
    buildBoundaryReworkInputSummary(context, boundaryReview, reworkAttemptCount) {
      return {
        role: ROLE,
        threadId: context.agentRun?.threadId ?? null,
        leaseId: context.agentRun?.leaseId ?? null,
        reworkAttemptCount,
        boundaryReviewDecision: boundaryReview?.decision ?? null,
        boundaryReviewIssueCount: Array.isArray(boundaryReview?.issues) ? boundaryReview.issues.length : 0,
        boundaryReviewArtifactId: boundaryReview?.artifactId ?? null,
      };
    },
    buildBoundaryReworkOutputSummary(context, result) {
      return {
        role: ROLE,
        threadId: context.agentRun?.threadId ?? null,
        turnId: result.finalTurn?.turnId ?? null,
        status: result.analysis.status,
        slotCount: result.analysis.slotMap.slots.length,
        reworkAttemptCount: result.reworkAttemptCount,
      };
    },
    buildMaterializeInputSummary(analysis) {
      return {
        slotCount: analysis.slotMap.slots.length,
        threadId: analysis.agent?.threadId ?? null,
        turnId: analysis.agent?.turnId ?? null,
        boundaryReviewDecision: analysis.boundaryReview?.decision ?? null,
        boundaryReviewIssueCount: analysis.boundaryReview?.issues?.length ?? 0,
        boundaryReworkAttemptCount: analysis.validation?.boundaryReworkAttemptCount ?? 0,
      };
    },
    buildMaterializeOutputSummary(artifact) {
      return {
        slotCount: artifact.functionSlotAtomizationAnalysis?.slotMap?.slots?.length ?? 0,
        functionSlotAtomizationArtifactId: artifact.functionSlotAtomizationAnalysis?.artifactId ?? null,
        boundaryReviewDecision: artifact.functionSlotAtomizationAnalysis?.boundaryReview?.decision ?? null,
        boundaryReviewIssueCount: artifact.functionSlotAtomizationAnalysis?.boundaryReview?.issues?.length ?? 0,
        boundaryReworkAttemptCount: artifact.functionSlotAtomizationAnalysis?.validation?.boundaryReworkAttemptCount ?? 0,
      };
    },
    resolveSampleDir(context) {
      return store.sampleDir(context.sampleVideoId);
    },
    runCacheLookup,
    markCacheWaiting,
    buildCachePrompt,
    reuseCachedAnalysis,
    async attachAnalysis(sampleVideoId, analysis, traceMeta) {
      return attachFunctionSlotAtomizationAnalysis(sampleVideoId, analysis, store, traceMeta);
    },
    async runBoundaryReview({ context, analysis, runtime, threadPool, appServer, rootDir, pollIntervalMs, maxCollectAttempts, reviewAttemptCount }) {
      context.boundaryReviewSkillPath = REVIEW_SKILL_PATH;
      context.boundaryReviewSkillHash = context.boundaryReviewSkillHash ?? await resolveBoundaryReviewSkillHash();
      return runFunctionSlotBoundaryReview({
        context,
        analysis,
        runtime,
        threadPool,
        appServer,
        rootDir,
        store,
        pollIntervalMs,
        maxCollectAttempts,
        reviewAttemptCount,
      });
    },
    async runBoundaryRework({ context, analysis, boundaryReview, runtime, appServer, rootDir, pollIntervalMs, maxCollectAttempts, reworkAttemptCount }) {
      const boundaryReworkTurn = renderBoundaryReworkTurnInputs({
        inputPackage: context.inputPackage,
        boundaryReview,
        priorTurnOutput: context.finalOutputText,
        reworkAttemptCount,
        roleProfile: context.roleProfile,
      });
      context.promptTemplate = {
        promptTemplateId: boundaryReworkTurn.promptTemplateId,
        promptTemplateVersion: boundaryReworkTurn.promptTemplateVersion,
        promptTemplateHash: boundaryReworkTurn.promptTemplateHash,
      };
      const reworked = await runtime.runStage(context, STAGES.boundaryReworked, this.progress.boundaryReworked, {
        artifactId: context.artifactId,
        parentArtifactId: analysis.artifactId,
        inputSummary: this.buildBoundaryReworkInputSummary(context, boundaryReview, reworkAttemptCount),
        action: async () => {
          const executed = await executeRepairTurn({
            agentRun: context.agentRun,
            turnInputs: boundaryReworkTurn,
            appServer,
            rootDir,
            pollIntervalMs,
            maxCollectAttempts,
            onTurnCollect: (turn) => runtime.updateActiveThreadMessage(context, turn),
          });
          const nextAnalysis = buildProcessedAnalysis(executed.finalTurn.finalMessage, context.input, context, context.agentRun, executed.finalTurn, {
            repairAttemptCount: analysis.validation?.repairAttemptCount ?? 0,
            boundaryReworkAttemptCount: reworkAttemptCount,
          });
          context.finalOutputText = executed.finalTurn.finalMessage ?? null;
          context.agentRun = updateAgentRun(context.agentRun, context, executed.finalTurn);
          runtime.job.resumeProcessing(context.job.jobId, STAGES.boundaryReworked, this.progress.boundaryReworked, {
            agentRun: context.agentRun,
            activeThreadMessage: null,
          });
          return {
            analysis: {
              ...nextAnalysis,
              boundaryReviewHistory: analysis.boundaryReviewHistory ?? [],
              boundaryRework: {
                attemptCount: reworkAttemptCount,
                sourceBoundaryReviewArtifactId: boundaryReview?.artifactId ?? null,
                sourceBoundaryReviewDecision: boundaryReview?.decision ?? null,
                sourceBoundaryReviewIssueCount: boundaryReview?.issues?.length ?? 0,
              },
            },
            finalTurn: executed.finalTurn,
            reworkAttemptCount,
          };
        },
        outputSummary: (result) => this.buildBoundaryReworkOutputSummary(context, result),
      });
      return reworked.analysis;
    },
    async assertMaterializeDependencies(context) {
      const latestArtifact = await store.readJson(path.join(store.sampleDir(context.sampleVideoId), "artifact.json"));
      assertExpectedThreeArtifacts({
        latestArtifact,
        context,
        conflictCode: "function_slot_atomization_dependency_stale",
        conflictMessage: "上游脚本/节奏/包装结果已更新，请刷新后再运行原子化分析",
      });
    },
    cleanupReason: "function-slot-atomization-failed",
  };
}

function assertExpectedThreeArtifacts({ latestArtifact, context, conflictCode, conflictMessage }) {
  const expected = {
    expectedScriptSegmentArtifactId: context.input?.sourceScriptSegmentArtifactId ?? context.expectedScriptSegmentArtifactId ?? null,
    expectedRhythmStructureArtifactId: context.input?.sourceRhythmStructureArtifactId ?? context.expectedRhythmStructureArtifactId ?? null,
    expectedPackagingStructureArtifactId: context.input?.sourcePackagingStructureArtifactId ?? context.expectedPackagingStructureArtifactId ?? null,
  };
  assertExpectedArtifactId({
    expectedArtifactId: expected.expectedScriptSegmentArtifactId,
    actualArtifactId: latestArtifact?.scriptSegmentAnalysis?.artifactId ?? null,
    expectedKey: "expectedScriptSegmentArtifactId",
    actualKey: "actualScriptSegmentArtifactId",
    conflictCode,
    conflictMessage,
  });
  assertExpectedArtifactId({
    expectedArtifactId: expected.expectedRhythmStructureArtifactId,
    actualArtifactId: latestArtifact?.rhythmStructureAnalysis?.artifactId ?? null,
    expectedKey: "expectedRhythmStructureArtifactId",
    actualKey: "actualRhythmStructureArtifactId",
    conflictCode,
    conflictMessage,
  });
  assertExpectedArtifactId({
    expectedArtifactId: expected.expectedPackagingStructureArtifactId,
    actualArtifactId: latestArtifact?.packagingStructureAnalysis?.artifactId ?? null,
    expectedKey: "expectedPackagingStructureArtifactId",
    actualKey: "actualPackagingStructureArtifactId",
    conflictCode,
    conflictMessage,
  });
}

function assertExpectedArtifactId({ expectedArtifactId, actualArtifactId, expectedKey, actualKey, conflictCode, conflictMessage }) {
  assertExpectedArtifact({
    expectedArtifactId,
    actualArtifactId,
    conflictError: (code, message, debugPayload) => {
      const error = codedError(code, message, debugPayload, false);
      error.statusCode = 409;
      return error;
    },
    code: conflictCode,
    message: conflictMessage,
    expectedKey,
    actualKey,
  });
}

module.exports = {
  createFunctionSlotAtomizationPipelineDescriptor,
  assertExpectedThreeArtifacts,
};
