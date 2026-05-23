const { randomUUID } = require("crypto");
const { validateSegments } = require("./validation");
const { buildScriptSegmentContentFingerprint } = require("./cache-params");
const {
  ROLE,
  SKILL_PATH,
  STAGES,
  codedError,
  extractJsonObject,
  summarizeAgentOutput,
} = require("./shared");

function buildProcessedAnalysis(message, input, context, agentRun, turn, { repairAttemptCount = 0 } = {}) {
  const parsed = extractJsonObject(message);
  const validation = validateSegments(parsed, input);
  if (!validation.ok) {
    throw codedError("script_segment_validation_failed", "脚本段落输出未通过校验", {
      validation: {
        ...validation.summary,
        status: "failed",
        repairAttemptCount,
      },
      outputSummary: summarizeAgentOutput(message, parsed?.segments),
      turnId: turn?.turnId ?? agentRun?.turnId ?? null,
      repairAttemptCount,
    }, false);
  }
  return {
    artifactId: context.artifactId ?? `artifact_${randomUUID()}`,
    parentArtifactId: input.parentArtifactId,
    type: "script-segment-analysis",
    status: "processed",
    resultOrigin: repairAttemptCount > 0 ? "repaired_turn" : "new_turn",
    stageName: STAGES.materialized,
    sampleVideoId: input.sampleVideoId,
    sourceShotBoundaryArtifactId: input.parentArtifactId,
    sourceShotCount: input.shots.length,
    cacheKey: context.cacheKey ?? buildScriptSegmentContentFingerprint(input),
    commerceBrief: input.commerceBrief ?? null,
    inputPackage: context.inputPackage ?? null,
    segments: validation.segments,
    validation: {
      status: "passed",
      segmentCount: validation.segments.length,
      validatorCode: null,
      repairAttemptCount,
    },
    agent: buildAgentArtifact(context, agentRun, turn),
    reason: null,
    debugSnapshotUri: null,
    createdAt: new Date().toISOString(),
  };
}

function buildFailedArtifact(context, errorSummary, debugSnapshotUri = null) {
  return {
    artifactId: context.artifactId ?? `artifact_${randomUUID()}`,
    parentArtifactId: context.input?.parentArtifactId ?? context.artifact?.shotBoundaryAnalysis?.artifactId ?? context.artifact?.sampleVideo?.artifactId ?? null,
    type: "script-segment-analysis",
    status: "failed",
    resultOrigin: context.validationSummary?.repairAttemptCount ? "failed_validation" : "new_turn",
    stageName: context.activeStage?.stageName ?? STAGES.analyzed,
    sampleVideoId: context.sampleVideoId,
    sourceShotBoundaryArtifactId: context.artifact?.shotBoundaryAnalysis?.artifactId ?? null,
    sourceShotCount: context.input?.shots?.length ?? context.artifact?.shotBoundaryAnalysis?.shots?.length ?? 0,
    cacheKey: context.cacheKey ?? (context.input ? buildScriptSegmentContentFingerprint(context.input) : null),
    commerceBrief: context.input?.commerceBrief ?? context.artifact?.shotBoundaryAnalysis?.commerceBrief ?? null,
    inputPackage: context.inputPackage ?? null,
    segments: [],
    validation: {
      status: "failed",
      segmentCount: 0,
      validatorCode: context.validationSummary?.validatorCode ?? errorSummary?.code ?? null,
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
    sourceShotBoundaryArtifactId: context.input?.parentArtifactId ?? context.artifact?.shotBoundaryAnalysis?.artifactId ?? cachedAnalysis?.sourceShotBoundaryArtifactId ?? null,
    sourceShotCount: context.input?.shots?.length ?? cachedAnalysis?.sourceShotCount ?? 0,
    resultOrigin: "cache_reuse",
    sourceSampleVideoId: cachedAnalysis?.sampleVideoId ?? cachedAnalysis?.sourceSampleVideoId ?? null,
    sourceScriptSegmentArtifactId: cachedAnalysis?.artifactId ?? null,
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
  const hasSegments = Array.isArray(analysis?.segments) && analysis.segments.length > 0;
  const validatorClean = !analysis?.validation?.validatorCode;
  const cacheKeyMatches = !options.cacheKey || analysis?.cacheKey === options.cacheKey;
  return {
    eligible: Boolean(statusProcessed && validationPassed && hasSegments && validatorClean && cacheKeyMatches),
    statusProcessed,
    validationPassed,
    hasSegments,
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
