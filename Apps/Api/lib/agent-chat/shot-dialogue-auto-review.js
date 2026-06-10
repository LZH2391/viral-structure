const path = require("path");
const { randomUUID } = require("crypto");
const { nextStage } = require("../../../../Infrastructure/Observability/trace");

const { AUTO_STAGE_NAME, REVIEW_ROLE } = require("./shot-dialogue-review-constants");
const { runDialogueReviewTurn } = require("./shot-dialogue-review-turn");
const {
  extractGeneratedShotDesignFinalPath,
  extractShotDesignFinalPath,
  findLatestDialogueReviewSummary,
  findLatestReviewFingerprint,
  findLatestShotDesignFinalPath,
  fingerprintsEqual,
  isCompleted,
  isCurrentTurnFileOutput,
  isDialogueReviewEligibleConversation,
  normalizeText,
  parseReviewJson,
  readDialogueFingerprint,
  readFileFingerprint,
  resolveShotDesignFinalPath,
  safePreview,
  safeRelative,
} = require("./shot-dialogue-review-utils");

const { buildDialogueReviewKey, hasActiveDialogueReview, inFlightDialogueReviewKeys } = require("./shot-dialogue-review-dedupe");
const { reviewShotDialogueForConversation } = require("./shot-dialogue-manual-review");

async function maybeAutoReviewShotDialogue({
  payload,
  handlers,
  traceContext,
  conversationId,
  url = null,
  activeBinding = null,
} = {}) {
  if (!isCompleted(payload?.status)) return null;
  if (!String(payload?.finalMessage ?? "").trim()) return null;
  if (!conversationId) return null;

  const rootDir = handlers.rootDir;
  const logger = handlers.logger;
  if (!rootDir || !logger) return null;

  const finalMessage = String(payload.finalMessage ?? "");
  const conversation = await handlers.agentConversationStore?.get?.(conversationId);
  const currentOutputPath = extractGeneratedShotDesignFinalPath(finalMessage);
  const rememberedPath = currentOutputPath || findLatestShotDesignFinalPath(conversation);
  if (!rememberedPath) return null;
  if (!isDialogueReviewEligibleConversation(conversation, rememberedPath)) return null;

  const stageTraceContext = nextStage(traceContext);
  const artifactId = `artifact_${randomUUID()}`;
  const parentArtifactId = normalizeText(url?.searchParams?.get("parentArtifactId")) ?? payload.turnId ?? null;
  const sourceMode = currentOutputPath ? "currentTurnOutput" : "rememberedShotDesignPath";
  const shotDesignFinalPath = resolveShotDesignFinalPath({
    rootDir,
    finalMessage,
    explicitPath: rememberedPath,
    conversationId,
    turnId: payload.turnId,
  });
  if (currentOutputPath && !await isCurrentTurnFileOutput(shotDesignFinalPath, activeBinding)) return null;
  const reviewOutputPath = path.join(path.dirname(shotDesignFinalPath), "dialogue-robotic-review.final.json");
  const relativeShotDesignFinalPath = safeRelative(rootDir, shotDesignFinalPath);
  const previousReview = findLatestDialogueReviewSummary(conversation, relativeShotDesignFinalPath);
  const previousFingerprint = previousReview?.fileFingerprint ?? null;
  const previousDialogueFingerprint = previousReview?.dialogueFingerprint ?? null;
  const dialogueFingerprint = await readDialogueFingerprint(shotDesignFinalPath, rootDir).catch(() => null);
  if (!currentOutputPath && !previousDialogueFingerprint) return null;
  if (fingerprintsEqual(dialogueFingerprint, previousDialogueFingerprint)) {
    if (!currentOutputPath) return null;
    const reused = buildReusedDialogueReviewResult({
      previousReview,
      payload,
      stageTraceContext,
      shotDesignFinalPath: relativeShotDesignFinalPath,
      reviewOutputPath: safeRelative(rootDir, reviewOutputPath),
      dialogueFingerprint,
      sourceMode,
      artifactId,
    });
    if (reused) {
      await logger.writeStageLog({
        traceContext: stageTraceContext,
        stageName: AUTO_STAGE_NAME,
        event: "stage.start",
        artifactId,
        parentArtifactId,
        inputSummary: {
          conversationId,
          turnId: payload.turnId ?? null,
          shotDesignFinalPath: relativeShotDesignFinalPath,
          sourceMode,
          previousDialogueFingerprint,
          dialogueFingerprint,
          trigger: "dialogue_unchanged",
          role: REVIEW_ROLE,
        },
      });
      await logger.writeStageLog({
        traceContext: stageTraceContext,
        stageName: AUTO_STAGE_NAME,
        event: "stage.end",
        artifactId,
        parentArtifactId,
        outputSummary: {
          artifactId,
          status: reused.status,
          decision: reused.decision,
          issueCount: reused.issueCount,
          shotDesignFinalPath: relativeShotDesignFinalPath,
          sourceMode,
          trigger: reused.trigger,
          dialogueFingerprint,
        },
        durationMs: 0,
      });
    }
    return reused;
  }
  const reviewKey = buildDialogueReviewKey({
    conversationId,
    shotDesignFinalPath: relativeShotDesignFinalPath,
    dialogueFingerprint,
  });
  if (await hasActiveDialogueReview(handlers, reviewKey) || inFlightDialogueReviewKeys.has(reviewKey)) {
    return {
      ok: true,
      status: "skipped_in_progress",
      artifactId: null,
      traceId: stageTraceContext.traceId,
      runId: stageTraceContext.runId,
      stageId: stageTraceContext.stageId,
      stageName: AUTO_STAGE_NAME,
      shotDesignFinalPath: relativeShotDesignFinalPath,
      reviewOutputPath: safeRelative(rootDir, reviewOutputPath),
      sourceMode,
      trigger: "review_in_progress",
      dialogueFingerprint,
      role: REVIEW_ROLE,
    };
  }
  const inputSummary = {
    conversationId,
    turnId: payload.turnId ?? null,
    finalMessageChars: finalMessage.length,
    shotDesignFinalPath: relativeShotDesignFinalPath,
    reviewOutputPath: safeRelative(rootDir, reviewOutputPath),
    sourceMode,
    previousFingerprint,
    previousDialogueFingerprint,
    dialogueFingerprint,
    reviewKey,
    role: REVIEW_ROLE,
  };
  const startedAt = Date.now();
  inFlightDialogueReviewKeys.add(reviewKey);

  try {
    await logger.writeStageLog({
      traceContext: stageTraceContext,
      stageName: AUTO_STAGE_NAME,
      event: "stage.start",
      artifactId,
      parentArtifactId,
      inputSummary,
    });

    const fileFingerprint = await readFileFingerprint(shotDesignFinalPath, rootDir);
    if (fingerprintsEqual(fileFingerprint, previousFingerprint)) {
      if (!currentOutputPath) return null;
      const outputSummary = {
        artifactId,
        status: "skipped_unchanged",
        shotDesignFinalPath: relativeShotDesignFinalPath,
        reviewOutputPath: safeRelative(rootDir, reviewOutputPath),
        sourceMode,
        trigger: "file_unchanged",
        fileFingerprint,
      };
      await logger.writeStageLog({
        traceContext: stageTraceContext,
        stageName: AUTO_STAGE_NAME,
        event: "stage.end",
        artifactId,
        parentArtifactId,
        outputSummary,
        durationMs: Date.now() - startedAt,
      });
      return {
        ok: true,
        status: "skipped_unchanged",
        artifactId,
        traceId: stageTraceContext.traceId,
        runId: stageTraceContext.runId,
        stageId: stageTraceContext.stageId,
        stageName: AUTO_STAGE_NAME,
        shotDesignFinalPath: safeRelative(rootDir, shotDesignFinalPath),
        reviewOutputPath: safeRelative(rootDir, reviewOutputPath),
        sourceMode,
        trigger: "file_unchanged",
        fileFingerprint,
        dialogueFingerprint,
        decision: previousReview?.decision ?? null,
        issueCount: previousReview?.issueCount ?? 0,
        role: previousReview?.role ?? REVIEW_ROLE,
        promptTemplateVersion: previousReview?.promptTemplateVersion ?? null,
      };
    }

    const reviewResult = await runDialogueReviewTurn({
      handlers,
      rootDir,
      shotDesignFinalPath,
      reviewOutputPath,
      artifactId,
      parentArtifactId,
      sourceTurnId: payload.turnId,
      stageTraceContext,
      fileFingerprint,
      dialogueFingerprint,
      reviewKey,
    });
    const outputSummary = {
      artifactId,
      status: "processed",
      decision: reviewResult.review.decision,
      issueCount: reviewResult.review.issues.length,
      shotDesignFinalPath: safeRelative(rootDir, shotDesignFinalPath),
      reviewOutputPath: safeRelative(rootDir, reviewOutputPath),
      sourceMode,
      trigger: "file_changed",
      fileFingerprint,
      dialogueFingerprint,
      role: REVIEW_ROLE,
      promptTemplateVersion: reviewResult.agent.promptTemplateVersion,
    };
    await logger.writeStageLog({
      traceContext: stageTraceContext,
      stageName: AUTO_STAGE_NAME,
      event: "stage.end",
      artifactId,
      parentArtifactId,
      outputSummary,
      durationMs: Date.now() - startedAt,
    });
    return {
      ok: true,
      status: "processed",
      artifactId,
      traceId: stageTraceContext.traceId,
      runId: stageTraceContext.runId,
      stageId: stageTraceContext.stageId,
      stageName: AUTO_STAGE_NAME,
      shotDesignFinalPath: safeRelative(rootDir, shotDesignFinalPath),
      reviewOutputPath: safeRelative(rootDir, reviewOutputPath),
      sourceMode,
      trigger: "file_changed",
      fileFingerprint,
      dialogueFingerprint,
      decision: reviewResult.review.decision,
      issueCount: reviewResult.review.issues.length,
      turnId: reviewResult.agent.turnId,
      role: REVIEW_ROLE,
      promptTemplateVersion: reviewResult.agent.promptTemplateVersion,
    };
  } catch (error) {
    const safeError = {
      code: error?.code ?? "dialogue_robotic_review_auto_failed",
      message: safePreview(error instanceof Error ? error.message : "台词机器人感自动审查失败", 240),
      retryable: error?.retryable !== false,
    };
    const snapshot = await logger.writeDebugSnapshot({
      traceContext: stageTraceContext,
      stageName: AUTO_STAGE_NAME,
      artifactId,
      parentArtifactId,
      reason: safeError.code,
      inputSummary,
      outputSummary: null,
      debugPayload: {
        code: safeError.code,
        message: safeError.message,
        role: REVIEW_ROLE,
        shotDesignFinalPath: safeRelative(rootDir, shotDesignFinalPath),
        reviewOutputPath: safeRelative(rootDir, reviewOutputPath),
      },
    });
    await logger.writeStageLog({
      traceContext: stageTraceContext,
      stageName: AUTO_STAGE_NAME,
      event: "stage.fail",
      artifactId,
      parentArtifactId,
      errorSummary: { ...safeError, debugSnapshotUri: snapshot.uri },
      durationMs: Date.now() - startedAt,
    });
    return {
      ok: false,
      status: "review_failed",
      artifactId,
      traceId: stageTraceContext.traceId,
      runId: stageTraceContext.runId,
      stageId: stageTraceContext.stageId,
      stageName: AUTO_STAGE_NAME,
      shotDesignFinalPath: safeRelative(rootDir, shotDesignFinalPath),
      reviewOutputPath: safeRelative(rootDir, reviewOutputPath),
      error: safeError.code,
      message: safeError.message,
      debugSnapshotUri: snapshot.uri,
    };
  } finally {
    inFlightDialogueReviewKeys.delete(reviewKey);
  }
}

function buildReusedDialogueReviewResult({ previousReview, payload, stageTraceContext, shotDesignFinalPath, reviewOutputPath, dialogueFingerprint, sourceMode, artifactId }) {
  if (!previousReview?.decision) return null;
  return {
    ok: true,
    status: "skipped_unchanged",
    artifactId,
    traceId: stageTraceContext.traceId,
    runId: stageTraceContext.runId,
    stageId: stageTraceContext.stageId,
    stageName: AUTO_STAGE_NAME,
    shotDesignFinalPath,
    reviewOutputPath,
    sourceMode,
    trigger: "dialogue_unchanged",
    fileFingerprint: previousReview.fileFingerprint ?? null,
    dialogueFingerprint,
    decision: previousReview.decision,
    issueCount: previousReview.issueCount ?? 0,
    turnId: payload?.turnId ?? null,
    role: previousReview.role ?? REVIEW_ROLE,
    promptTemplateVersion: previousReview.promptTemplateVersion ?? null,
  };
}

module.exports = {
  AUTO_STAGE_NAME,
  REVIEW_ROLE,
  extractShotDesignFinalPath,
  maybeAutoReviewShotDialogue,
  parseReviewJson,
  reviewShotDialogueForConversation,
};
