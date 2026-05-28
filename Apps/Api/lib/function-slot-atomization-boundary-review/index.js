const { randomUUID } = require("crypto");
const { createAnalysisFinalOutputStore } = require("../stores/analysis-final-output-store");
const { loadRoleProfileByRole } = require("../gateways/threadpool/role-profile-loader");
const { finalizeLease, cleanupLease } = require("../shot-boundary/threadpool-runner");
const { STAGES, resolveSkillHash } = require("../function-slot-atomization-analysis/shared");
const { renderReviewTurnInputs } = require("./input");
const { executeAnalyzeTurn } = require("./runner");
const { validateBoundaryReviewResult, summarizeBoundaryReviewResult } = require("./validation");
const {
  REVIEW_ROLE,
  REVIEW_SKILL_PATH,
  REVIEW_SCHEMA_VERSION,
  safeReviewError,
  sanitizeReviewDebugPayload,
} = require("./shared");

async function runFunctionSlotBoundaryReview({
  context,
  analysis,
  runtime,
  threadPool,
  appServer,
  rootDir,
  store,
  pollIntervalMs,
  maxCollectAttempts,
  collectIdleTimeoutMs,
  collectHardTimeoutMs,
  reviewAttemptCount = 1,
}) {
  const reviewArtifactId = `artifact_${randomUUID()}`;
  let lease = null;
  const finalOutput = await runtime.runStage(context, STAGES.finalOutputPrepared, 82, {
    artifactId: analysis.artifactId,
    parentArtifactId: analysis.parentArtifactId,
    inputSummary: {
      sampleVideoId: context.sampleVideoId,
      functionSlotAtomizationArtifactId: analysis.artifactId,
      analyzerThreadId: analysis.agent?.threadId ?? null,
      analyzerTurnId: analysis.agent?.turnId ?? null,
    },
    action: () => createAnalysisFinalOutputStore({ store, rootDir }).writeFinalOutput({
      sampleVideoId: context.sampleVideoId,
      analysis,
      finalOutputText: context.finalOutputText ?? null,
      traceId: context.traceContext?.traceId ?? null,
      stageName: STAGES.finalOutputPrepared,
      source: "pre-boundary-review-final-message",
    }),
    outputSummary: (result) => ({
      outputKey: result?.outputKey ?? null,
      filePath: result?.filePath ?? null,
    }),
  });

  try {
    const reviewRoleProfile = await loadRoleProfileByRole(REVIEW_ROLE);
    const reviewTurn = renderReviewTurnInputs({
      context,
      analysis,
      finalOutput,
      roleProfile: reviewRoleProfile,
    });
    const reviewed = await runtime.runStage(context, STAGES.boundaryReviewed, 90, {
      artifactId: reviewArtifactId,
      parentArtifactId: analysis.artifactId,
      inputSummary: {
        role: REVIEW_ROLE,
        sampleVideoId: context.sampleVideoId,
        functionSlotAtomizationArtifactId: analysis.artifactId,
        finalOutputPath: finalOutput?.filePath ?? null,
        fieldRolesHash: reviewTurn.fieldRolesHash,
        reviewAttemptCount,
      },
      action: async () => {
        const executed = await executeAnalyzeTurn({
          context,
          turnInputs: reviewTurn,
          threadPool,
          appServer,
          rootDir,
          pollIntervalMs,
          maxCollectAttempts,
          collectIdleTimeoutMs,
          collectHardTimeoutMs,
          onTurnStarted: ({ lease: startedLease, started }) => {
            lease = startedLease;
            runtime.thread.upsertTraceCard(context, {
              id: `boundary-review-${reviewAttemptCount}`,
              label: "Boundary Review",
              role: REVIEW_ROLE,
              stageName: STAGES.boundaryReviewed,
              status: "running",
              threadId: startedLease?.thread_id ?? null,
              turnId: started?.turnId ?? null,
              leaseId: startedLease?.lease_id ?? null,
              traceId: context.traceContext?.traceId ?? null,
              artifactId: reviewArtifactId,
              parentArtifactId: analysis.artifactId ?? null,
              activity: null,
              latestMessagePreview: null,
              startedAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            });
          },
          onTurnCollect: (turn) => runtime.updateActiveThreadMessage(context, turn),
        });
        lease = executed.lease;
        const result = validateBoundaryReviewResult(executed.finalTurn.finalMessage, executed.finalTurn);
        await finalizeLease(threadPool, {
          leaseId: executed.lease?.lease_id ?? null,
          threadId: executed.lease?.thread_id ?? null,
          traceId: context.traceContext.traceId,
        });
        lease = null;
        const reviewArtifact = buildBoundaryReviewArtifact({
          context,
          analysis,
          result,
          reviewArtifactId,
          finalOutput,
          roleProfile: reviewRoleProfile,
          reviewTurn,
          executed,
          reviewAttemptCount,
        });
        runtime.thread.upsertTraceCard(context, {
          id: `boundary-review-${reviewAttemptCount}`,
          label: "Boundary Review",
          role: REVIEW_ROLE,
          stageName: STAGES.boundaryReviewed,
          status: "completed",
          threadId: executed.lease?.thread_id ?? null,
          turnId: executed.finalTurn?.turnId ?? null,
          leaseId: executed.lease?.lease_id ?? null,
          traceId: context.traceContext?.traceId ?? null,
          artifactId: reviewArtifactId,
          parentArtifactId: analysis.artifactId ?? null,
          activity: null,
          latestMessagePreview: result?.decision ?? null,
          startedAt: null,
          updatedAt: new Date().toISOString(),
        });
        return reviewArtifact;
      },
      outputSummary: summarizeBoundaryReviewResult,
    });
    return {
      ...analysis,
      boundaryReview: reviewed,
    };
  } catch (error) {
    if (lease?.thread_id) {
      await cleanupLease(threadPool, lease, context.traceContext.traceId, "function-slot-atomization-boundary-review-failed");
    }
    throw error;
  }
}

function buildBoundaryReviewArtifact({
  context,
  analysis,
  result,
  reviewArtifactId,
  finalOutput,
  roleProfile,
  reviewTurn,
  executed,
  reviewAttemptCount,
}) {
  return {
    artifactId: reviewArtifactId,
    parentArtifactId: analysis.artifactId ?? null,
    traceId: context.traceContext?.traceId ?? null,
    type: "function-slot-atomization-boundary-review",
    schemaVersion: REVIEW_SCHEMA_VERSION,
    status: "processed",
    stageName: STAGES.boundaryReviewed,
    sampleVideoId: context.sampleVideoId,
    sourceFunctionSlotAtomizationArtifactId: analysis.artifactId ?? null,
    sourceFinalOutputPath: finalOutput?.filePath ?? null,
    fieldRolesHash: reviewTurn.fieldRolesHash ?? null,
    reviewAttemptCount,
    decision: result.decision,
    reason: result.reason,
    issues: result.issues,
    agent: {
      provider: "codex-appserver",
      role: REVIEW_ROLE,
      skillPath: REVIEW_SKILL_PATH,
      skillHash: context.boundaryReviewSkillHash ?? null,
      threadId: executed.lease?.thread_id ?? null,
      leaseId: executed.lease?.lease_id ?? null,
      turnId: executed.finalTurn?.turnId ?? null,
      profileVersion: roleProfile?.profileVersion ?? null,
      promptTemplateId: reviewTurn.promptTemplateId ?? null,
      promptTemplateVersion: reviewTurn.promptTemplateVersion ?? null,
      promptTemplateHash: reviewTurn.promptTemplateHash ?? null,
    },
    createdAt: new Date().toISOString(),
  };
}

module.exports = {
  REVIEW_ROLE,
  REVIEW_SKILL_PATH,
  runFunctionSlotBoundaryReview,
  resolveBoundaryReviewSkillHash: () => resolveSkillHash(REVIEW_SKILL_PATH),
  safeReviewError,
  sanitizeReviewDebugPayload,
};
