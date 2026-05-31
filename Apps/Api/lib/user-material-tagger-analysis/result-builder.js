const { randomUUID } = require("crypto");
const { validateUserMaterialPack } = require("./validation");
const { buildUserMaterialTaggerContentFingerprint } = require("./cache-params");
const {
  ROLE,
  SKILL_PATH,
  STAGES,
  codedError,
  extractJsonObject,
  summarizeAgentOutput,
} = require("./shared");

function buildProcessedAnalysis(message, input, context, agentRun, turn, { repairAttemptCount = 0 } = {}) {
  const parsed = parseAgentOutput(message, agentRun, turn, repairAttemptCount);
  const validation = validateUserMaterialPack(parsed, input);
  if (!validation.ok) {
    throw codedError("user_material_tagger_validation_failed", "用户素材识别输出未通过校验", {
      validation: {
        ...validation.summary,
        status: "failed",
        repairAttemptCount,
      },
      outputSummary: summarizeAgentOutput(message, parsed),
      turnId: turn?.turnId ?? agentRun?.turnId ?? null,
      repairAttemptCount,
    }, false);
  }
  return {
    artifactId: context.artifactId ?? `artifact_${randomUUID()}`,
    parentArtifactId: input.parentArtifactId,
    traceId: context.traceContext?.traceId ?? null,
    type: "user-material-pack",
    schemaVersion: "user-material-pack.stable",
    status: "processed",
    resultOrigin: repairAttemptCount > 0 ? "repaired_turn" : "new_turn",
    stageName: STAGES.materialized,
    sampleVideoId: input.sampleVideoId,
    sourceShotBoundaryArtifactId: input.parentArtifactId,
    sourceShotCount: input.shots.length,
    sourceArtifacts: parsed.sourceArtifacts ?? {
      shotBoundaryAnalysis: {
        artifactId: input.parentArtifactId,
        traceId: null,
        shotCount: input.shots.length,
      },
    },
    cacheKey: context.cacheKey ?? buildUserMaterialTaggerContentFingerprint(input),
    inputPackage: context.inputPackage ?? null,
    shotCards: validation.shotCards,
    materialGroups: validation.materialGroups,
    proofCoverage: validation.proofCoverage,
    sequenceRecommendations: validation.sequenceRecommendations,
    globalConstraints: validation.globalConstraints,
    restructureInputSummary: validation.restructureInputSummary,
    validation: {
      status: "passed",
      shotCardCount: validation.shotCards.length,
      materialGroupCount: validation.materialGroups.length,
      proofCoverageCount: validation.proofCoverage.length,
      validatorCode: null,
      repairAttemptCount,
    },
    agent: buildAgentArtifact(context, agentRun, turn),
    traceMeta: parsed.traceMeta ?? null,
    reason: null,
    debugSnapshotUri: null,
    createdAt: new Date().toISOString(),
  };
}

function parseAgentOutput(message, agentRun, turn, repairAttemptCount) {
  try {
    return extractJsonObject(message);
  } catch (error) {
    const validatorCode = error?.code ?? "agent_output_parse_failed";
    throw codedError("user_material_tagger_validation_failed", "用户素材识别输出未通过校验", {
      validation: {
        validatorCode,
        code: validatorCode,
        message: error instanceof Error ? error.message : "用户素材识别 Agent 未返回合法 JSON",
        readableMessage: "输出不是合法 JSON object",
        path: "$",
        repairAttemptCount,
        status: "failed",
      },
      outputSummary: summarizeAgentOutput(message, null),
      turnId: turn?.turnId ?? agentRun?.turnId ?? null,
      repairAttemptCount,
    }, false);
  }
}

function buildFailedArtifact(context, errorSummary, debugSnapshotUri = null) {
  return {
    artifactId: context.artifactId ?? `artifact_${randomUUID()}`,
    parentArtifactId: context.input?.parentArtifactId ?? context.artifact?.shotBoundaryAnalysis?.artifactId ?? context.artifact?.sampleVideo?.artifactId ?? null,
    traceId: context.traceContext?.traceId ?? null,
    type: "user-material-pack",
    schemaVersion: "user-material-pack.stable",
    status: "failed",
    resultOrigin: context.validationSummary?.repairAttemptCount ? "failed_validation" : "new_turn",
    stageName: context.activeStage?.stageName ?? STAGES.analyzed,
    sampleVideoId: context.sampleVideoId,
    sourceShotBoundaryArtifactId: context.artifact?.shotBoundaryAnalysis?.artifactId ?? null,
    sourceShotCount: context.input?.shots?.length ?? context.artifact?.shotBoundaryAnalysis?.shots?.length ?? 0,
    cacheKey: context.cacheKey ?? (context.input ? buildUserMaterialTaggerContentFingerprint(context.input) : null),
    inputPackage: context.inputPackage ?? null,
    shotCards: [],
    materialGroups: [],
    proofCoverage: [],
    sequenceRecommendations: { openingCandidates: [], middleCandidates: [], endingCandidates: [] },
    globalConstraints: [],
    restructureInputSummary: {
      strongMaterialAreas: [],
      weakMaterialAreas: [],
      missingMaterialAreas: [],
      recommendedUse: [],
      doNotUseFor: [],
      needsRestructureAttention: [],
    },
    validation: {
      status: "failed",
      shotCardCount: 0,
      materialGroupCount: 0,
      proofCoverageCount: 0,
      validatorCode: context.validationSummary?.validatorCode ?? errorSummary?.validatorCode ?? errorSummary?.code ?? null,
      repairAttemptCount: context.validationSummary?.repairAttemptCount ?? 0,
    },
    agent: buildAgentArtifact(context, context.agentRun ?? null, null),
    reason: errorSummary?.message ?? null,
    debugSnapshotUri,
    createdAt: new Date().toISOString(),
  };
}

function buildAgentArtifact(context, agentRun, turn) {
  return {
    provider: agentRun?.provider ?? "codex-appserver",
    role: ROLE,
    skillPath: context.skillPath ?? agentRun?.skillPath ?? SKILL_PATH,
    skillHash: context.skillHash ?? agentRun?.skillHash ?? null,
    threadId: agentRun?.threadId ?? null,
    leaseId: agentRun?.leaseId ?? null,
    turnId: turn?.turnId ?? agentRun?.turnId ?? null,
    profileVersion: context.roleProfile?.profileVersion ?? agentRun?.profileVersion ?? null,
    promptTemplateId: context.promptTemplate?.promptTemplateId ?? agentRun?.promptTemplateId ?? null,
    promptTemplateVersion: context.promptTemplate?.promptTemplateVersion ?? agentRun?.promptTemplateVersion ?? null,
    promptTemplateHash: context.promptTemplate?.promptTemplateHash ?? agentRun?.promptTemplateHash ?? null,
  };
}

function buildCacheReuseAnalysis({ cachedAnalysis, context }) {
  return {
    ...cachedAnalysis,
    artifactId: context.artifactId ?? `artifact_${randomUUID()}`,
    parentArtifactId: context.input?.parentArtifactId ?? context.artifact?.shotBoundaryAnalysis?.artifactId ?? cachedAnalysis?.parentArtifactId ?? null,
    traceId: context.traceContext?.traceId ?? null,
    sourceTraceId: cachedAnalysis?.traceId ?? cachedAnalysis?.agent?.traceId ?? null,
    sourceShotBoundaryArtifactId: context.input?.parentArtifactId ?? context.artifact?.shotBoundaryAnalysis?.artifactId ?? cachedAnalysis?.sourceShotBoundaryArtifactId ?? null,
    sourceShotCount: context.input?.shots?.length ?? cachedAnalysis?.sourceShotCount ?? 0,
    resultOrigin: "cache_reuse",
    sourceSampleVideoId: cachedAnalysis?.sampleVideoId ?? cachedAnalysis?.sourceSampleVideoId ?? null,
    sourceUserMaterialPackArtifactId: cachedAnalysis?.artifactId ?? null,
    sourceTurnId: cachedAnalysis?.agent?.turnId ?? null,
    sourceCreatedAt: cachedAnalysis?.createdAt ?? null,
    sampleVideoId: context.sampleVideoId,
    cacheKey: context.cacheKey ?? cachedAnalysis?.cacheKey ?? null,
    createdAt: new Date().toISOString(),
  };
}

function evaluateCacheEligibility(analysis, options = {}) {
  const statusProcessed = analysis?.status === "processed";
  const validationPassed = analysis?.validation?.status === "passed";
  const hasShotCards = Array.isArray(analysis?.shotCards) && analysis.shotCards.length > 0;
  const validatorClean = !analysis?.validation?.validatorCode;
  const cacheKeyMatches = !options.cacheKey || analysis?.cacheKey === options.cacheKey;
  return {
    eligible: Boolean(statusProcessed && validationPassed && hasShotCards && validatorClean && cacheKeyMatches),
    statusProcessed,
    validationPassed,
    hasShotCards,
    validatorClean,
    cacheKeyMatches,
  };
}

module.exports = {
  buildProcessedAnalysis,
  buildFailedArtifact,
  buildCacheReuseAnalysis,
  evaluateCacheEligibility,
};
