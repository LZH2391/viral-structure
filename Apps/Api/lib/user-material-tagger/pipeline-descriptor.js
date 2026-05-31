const path = require("path");
const { assertExpectedArtifact } = require("../compatibility/analysis-service-shared");
const { buildAgentRun, updateAgentRun } = require("../user-material-tagger-analysis/agent-run");
const { prepareInput, prepareInputPackage, renderAnalyzeTurnInputs, renderRepairTurnInputs } = require("../user-material-tagger-analysis/input");
const { executeAnalyzeTurn, executeRepairTurn } = require("../user-material-tagger-analysis/runner");
const { buildProcessedAnalysis, buildCacheReuseAnalysis, evaluateCacheEligibility } = require("../user-material-tagger-analysis/result-builder");
const { buildUserMaterialTaggerContentFingerprint } = require("../user-material-tagger-analysis/cache-params");
const { findCachedArtifact, runCacheLookup, markCacheWaiting, reuseCachedAnalysis, buildCachePrompt } = require("./cache");
const { attachUserMaterialPack } = require("./artifact-writer");
const { ROLE, SKILL_PATH, STAGES, codedError, resolveSkillHash } = require("../user-material-tagger-analysis/shared");

function createUserMaterialTaggerPipelineDescriptor({ store, artifactIndex }) {
  return {
    ROLE,
    SKILL_PATH,
    STAGES,
    progress: {
      inputPrepared: 18,
      inputPackaged: 24,
      cacheLookup: 28,
      analyzed: 56,
      validated: 74,
      repaired: 88,
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
    buildCacheKey: (input) => buildUserMaterialTaggerContentFingerprint(input),
    buildAnalyzePromptTemplate(roleProfile) {
      const prompt = roleProfile?.turnTemplates?.analyze ?? {};
      return {
        promptTemplateId: "analyze",
        promptTemplateVersion: prompt.templateVersion ?? null,
        promptTemplateHash: prompt.templateHash ?? null,
      };
    },
    resolvePreparedParentArtifactId(context) {
      return context.artifact.shotBoundaryAnalysis?.artifactId ?? context.artifact.sampleVideo?.artifactId ?? null;
    },
    resolveMaterializeParentArtifactId(context, input) {
      return input.parentArtifactId ?? context.artifact.shotBoundaryAnalysis?.artifactId ?? null;
    },
    buildPrepareInputOptions() {
      return { runtimeRoot: store.runtimeRoot };
    },
    buildPrepareInputSummary(context) {
      return {
        sampleVideoId: context.sampleVideoId,
        sourceShotBoundaryArtifactId: context.artifact.shotBoundaryAnalysis?.artifactId ?? null,
        shotCount: context.artifact.shotBoundaryAnalysis?.shots?.length ?? 0,
      };
    },
    buildPreparedOutputSummary(result) {
      return {
        shotCount: result.shots.length,
        parentArtifactId: result.parentArtifactId,
        hasCommerceBrief: Boolean(result.commerceBrief),
      };
    },
    buildInputPackageSummary(context, input) {
      return {
        sampleVideoId: context.sampleVideoId,
        sourceShotBoundaryArtifactId: input.parentArtifactId,
        shotCount: input.shots.length,
        frameCount: input.frames?.length ?? 0,
      };
    },
    buildInputPackageOutputSummary(result) {
      return {
        shotCount: result.manifest.shotCount,
        sheetCount: result.sheetCount,
        emptyShotCount: result.emptyShotCount,
        manifestHash: result.hashes.manifestHash,
        visualManifestHash: result.hashes.visualManifestHash,
      };
    },
    buildAnalyzeInputSummary(context, input, inputPackage) {
      return {
        role: ROLE,
        shotCount: input.shots.length,
        sheetCount: inputPackage.sheetCount,
        emptyShotCount: inputPackage.emptyShotCount,
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
        shotCardCount: result.analysis.shotCards.length,
        materialGroupCount: result.analysis.materialGroups.length,
        proofCoverageCount: result.analysis.proofCoverage.length,
        promptTemplateVersion: result.analysis.agent?.promptTemplateVersion ?? null,
      };
    },
    buildValidateInputSummary(analysis, finalTurn) {
      return {
        shotCardCount: analysis.shotCards.length,
        materialGroupCount: analysis.materialGroups.length,
        proofCoverageCount: analysis.proofCoverage.length,
        turnId: finalTurn?.turnId ?? null,
      };
    },
    buildValidateOutputSummary(result) {
      return {
        status: result.validation?.status ?? null,
        shotCardCount: result.shotCards.length,
        materialGroupCount: result.materialGroups.length,
        proofCoverageCount: result.proofCoverage.length,
        validatorCode: result.validation?.validatorCode ?? null,
        repairAttemptCount: result.validation?.repairAttemptCount ?? 0,
      };
    },
    buildValidationError(analysis, finalTurn) {
      return codedError("user_material_tagger_validation_failed", "用户素材识别输出未通过校验", {
        validation: analysis.validation,
        turnId: finalTurn?.turnId ?? null,
      }, false);
    },
    isValidationPassed(analysis) {
      return analysis?.validation?.status === "passed";
    },
    canAttemptRepair(error, context) {
      return error?.code === "user_material_tagger_validation_failed" && context.agentRun?.threadId;
    },
    buildRepairInputSummary(context, validationError, repairAttemptCount) {
      return {
        role: ROLE,
        threadId: context.agentRun?.threadId ?? null,
        leaseId: context.agentRun?.leaseId ?? null,
        repairAttemptCount,
        validatorCode: validationError?.debugPayload?.validation?.validatorCode ?? validationError?.code ?? null,
        sheetCount: context.inputPackage?.sheetCount ?? 0,
      };
    },
    buildRepairOutputSummary(context, result) {
      return {
        role: ROLE,
        threadId: context.agentRun?.threadId ?? null,
        turnId: result.finalTurn?.turnId ?? null,
        status: result.analysis.status,
        shotCardCount: result.analysis.shotCards.length,
        materialGroupCount: result.analysis.materialGroups.length,
        repairAttemptCount: result.repairAttemptCount,
        threadContextPolicy: context.threadContextPolicy ?? null,
      };
    },
    buildMaterializeInputSummary(analysis) {
      return {
        shotCardCount: analysis.shotCards.length,
        materialGroupCount: analysis.materialGroups.length,
        proofCoverageCount: analysis.proofCoverage.length,
        threadId: analysis.agent?.threadId ?? null,
        turnId: analysis.agent?.turnId ?? null,
      };
    },
    buildMaterializeOutputSummary(artifact) {
      return {
        shotCardCount: artifact.userMaterialPack?.shotCards?.length ?? 0,
        materialGroupCount: artifact.userMaterialPack?.materialGroups?.length ?? 0,
        userMaterialPackArtifactId: artifact.userMaterialPack?.artifactId ?? null,
      };
    },
    resolveSampleDir(context) {
      return store.sampleDir(context.sampleVideoId);
    },
    async runCacheLookup({ context, input, runtime }) {
      return runCacheLookup({
        context,
        input,
        runStage: runtime.runStage,
        stageName: STAGES.cacheLookup,
        findCached: () => findCachedArtifact({
          context,
          input,
          artifactIndex,
          stageName: STAGES.materialized,
          evaluateCacheEligibility,
          resolveExistingFileHash: async (sampleVideoId) => (await artifactIndex.getItem(sampleVideoId).catch(() => null))?.fileHash ?? null,
        }),
      });
    },
    markCacheWaiting({ context, cached, runtime }) {
      return runtime.job.markCacheWaiting(context, {
        stageName: STAGES.cacheLookup,
        progress: 28,
        cachePrompt: buildCachePrompt(context, cached),
      });
    },
    buildCachePrompt,
    async reuseCachedAnalysis({ context, cachePrompt, runtime }) {
      return reuseCachedAnalysis({
        context,
        cachePrompt,
        runStage: runtime.runStage,
        stageName: STAGES.cacheReuse,
        resolvePrompt: () => require("./cache").resolveCachedPrompt({
          cachePrompt,
          artifactIndex,
          evaluateCacheEligibility,
          codedError,
          expectedCacheKey: context.cacheKey ?? null,
        }),
        buildCacheReuseAnalysis,
        attachAnalysis: (sampleVideoId, analysis, traceMeta) => attachUserMaterialPack(sampleVideoId, analysis, store, traceMeta),
        registerArtifact: async (artifact) => runtime.materialize?.registerSampleArtifact?.(context, artifact),
      });
    },
    async attachAnalysis(sampleVideoId, analysis, traceMeta) {
      return attachUserMaterialPack(sampleVideoId, analysis, store, traceMeta);
    },
    async assertMaterializeDependencies(context) {
      const latestArtifact = await store.readJson(path.join(store.sampleDir(context.sampleVideoId), "artifact.json"));
      const conflictError = (code, message, debugPayload) => {
        const error = codedError(code, message, debugPayload, false);
        error.statusCode = 409;
        return error;
      };
      assertExpectedArtifact({
        expectedArtifactId: context.input?.parentArtifactId ?? context.expectedShotBoundaryArtifactId ?? null,
        actualArtifactId: latestArtifact?.shotBoundaryAnalysis?.artifactId ?? null,
        conflictError,
        code: "user_material_tagger_shot_boundary_stale",
        message: "切镜结果已更新，请刷新后再运行素材识别",
        expectedKey: "expectedShotBoundaryArtifactId",
        actualKey: "actualShotBoundaryArtifactId",
      });
    },
    cleanupReason: "user-material-tagger-analysis-failed",
  };
}

module.exports = {
  createUserMaterialTaggerPipelineDescriptor,
};
