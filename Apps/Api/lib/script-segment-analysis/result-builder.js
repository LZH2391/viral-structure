const { randomUUID } = require("crypto");
const { validateSegments } = require("./validation");
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
    stageName: STAGES.materialized,
    sampleVideoId: input.sampleVideoId,
    sourceShotBoundaryArtifactId: input.parentArtifactId,
    commerceBrief: input.commerceBrief ?? null,
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
    stageName: context.activeStage?.stageName ?? STAGES.analyzed,
    sampleVideoId: context.sampleVideoId,
    sourceShotBoundaryArtifactId: context.artifact?.shotBoundaryAnalysis?.artifactId ?? null,
    commerceBrief: context.input?.commerceBrief ?? context.artifact?.shotBoundaryAnalysis?.commerceBrief ?? null,
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

module.exports = {
  buildProcessedAnalysis,
  buildFailedArtifact,
};
