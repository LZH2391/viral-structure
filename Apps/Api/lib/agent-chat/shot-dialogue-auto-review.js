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

const inFlightDialogueReviewKeys = new Set();

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
  if (fingerprintsEqual(dialogueFingerprint, previousDialogueFingerprint)) return null;
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

async function reviewShotDialogueForConversation({
  handlers,
  traceContext,
  conversationId,
  shotDesignFinalPath: requestedShotDesignFinalPath = null,
  sourceTurnId = null,
  parentArtifactId = null,
  trigger = "manual",
  force = false,
} = {}) {
  if (!conversationId) {
    const error = new Error("conversationId is required for dialogue review");
    error.code = "dialogue_robotic_review_conversation_required";
    error.statusCode = 400;
    throw error;
  }
  const rootDir = handlers.rootDir;
  const logger = handlers.logger;
  if (!rootDir || !logger) {
    const error = new Error("dialogue review requires rootDir and logger");
    error.code = "dialogue_robotic_review_runtime_unavailable";
    error.statusCode = 503;
    throw error;
  }

  const conversation = await handlers.agentConversationStore?.get?.(conversationId);
  if (!conversation) {
    const error = new Error("未找到 Agent 会话");
    error.code = "agent_chat_conversation_not_found";
    error.statusCode = 404;
    throw error;
  }
  const linkedShotDesignFinalPath = normalizeText(requestedShotDesignFinalPath) || findLatestShotDesignFinalPath(conversation);
  if (!linkedShotDesignFinalPath) {
    const error = new Error("未找到可审查的 shot-design.final.md");
    error.code = "dialogue_robotic_review_shot_design_missing";
    error.statusCode = 400;
    throw error;
  }
  if (!isDialogueReviewEligibleConversation(conversation, linkedShotDesignFinalPath)) {
    const error = new Error("当前会话不支持台词机器人感审查");
    error.code = "dialogue_robotic_review_conversation_ineligible";
    error.statusCode = 400;
    throw error;
  }

  const stageTraceContext = nextStage(traceContext);
  const artifactId = `artifact_${randomUUID()}`;
  const sourceParentArtifactId = normalizeText(parentArtifactId) ?? normalizeText(sourceTurnId) ?? conversation.latestTurnId ?? null;
  const shotDesignFinalPath = resolveShotDesignFinalPath({
    rootDir,
    finalMessage: "",
    explicitPath: linkedShotDesignFinalPath,
    conversationId,
    turnId: sourceTurnId,
  });
  const reviewOutputPath = path.join(path.dirname(shotDesignFinalPath), "dialogue-robotic-review.final.json");
  const relativeShotDesignFinalPath = safeRelative(rootDir, shotDesignFinalPath);
  const previousReview = findLatestDialogueReviewSummary(conversation, relativeShotDesignFinalPath);
  const previousFingerprint = previousReview?.fileFingerprint ?? null;
  const inputSummary = {
    conversationId,
    sourceTurnId: sourceTurnId ?? conversation.latestTurnId ?? null,
    shotDesignFinalPath: relativeShotDesignFinalPath,
    reviewOutputPath: safeRelative(rootDir, reviewOutputPath),
    previousFingerprint,
    role: REVIEW_ROLE,
    trigger,
    force: Boolean(force),
  };
  const startedAt = Date.now();
  let activeReviewKey = null;

  await logger.writeStageLog({
    traceContext: stageTraceContext,
    stageName: AUTO_STAGE_NAME,
    event: "stage.start",
    artifactId,
    parentArtifactId: sourceParentArtifactId,
    inputSummary,
  });

  try {
    const fileFingerprint = await readFileFingerprint(shotDesignFinalPath, rootDir);
    const dialogueFingerprint = await readDialogueFingerprint(shotDesignFinalPath, rootDir).catch(() => null);
    const reviewKey = buildDialogueReviewKey({
      conversationId,
      shotDesignFinalPath: relativeShotDesignFinalPath,
      dialogueFingerprint,
    });
    if (!force && fingerprintsEqual(fileFingerprint, previousFingerprint)) {
      const outputSummary = {
        artifactId,
        status: "skipped_unchanged",
        shotDesignFinalPath: relativeShotDesignFinalPath,
        reviewOutputPath: safeRelative(rootDir, reviewOutputPath),
        trigger: "file_unchanged",
        fileFingerprint,
        dialogueFingerprint,
      };
      await logger.writeStageLog({
        traceContext: stageTraceContext,
        stageName: AUTO_STAGE_NAME,
        event: "stage.end",
        artifactId,
        parentArtifactId: sourceParentArtifactId,
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
        shotDesignFinalPath: relativeShotDesignFinalPath,
        reviewOutputPath: safeRelative(rootDir, reviewOutputPath),
        sourceMode: "manual",
        trigger: "file_unchanged",
        fileFingerprint,
        dialogueFingerprint,
        decision: previousReview?.decision ?? null,
        issueCount: previousReview?.issueCount ?? 0,
        role: previousReview?.role ?? REVIEW_ROLE,
        promptTemplateVersion: previousReview?.promptTemplateVersion ?? null,
      };
    }
    if (!force && (await hasActiveDialogueReview(handlers, reviewKey) || inFlightDialogueReviewKeys.has(reviewKey))) {
      const outputSummary = {
        artifactId,
        status: "skipped_in_progress",
        shotDesignFinalPath: relativeShotDesignFinalPath,
        reviewOutputPath: safeRelative(rootDir, reviewOutputPath),
        trigger: "review_in_progress",
        fileFingerprint,
        dialogueFingerprint,
        role: REVIEW_ROLE,
      };
      await logger.writeStageLog({
        traceContext: stageTraceContext,
        stageName: AUTO_STAGE_NAME,
        event: "stage.end",
        artifactId,
        parentArtifactId: sourceParentArtifactId,
        outputSummary,
        durationMs: Date.now() - startedAt,
      });
      return {
        ok: true,
        status: "skipped_in_progress",
        artifactId,
        traceId: stageTraceContext.traceId,
        runId: stageTraceContext.runId,
        stageId: stageTraceContext.stageId,
        stageName: AUTO_STAGE_NAME,
        shotDesignFinalPath: relativeShotDesignFinalPath,
        reviewOutputPath: safeRelative(rootDir, reviewOutputPath),
        sourceMode: "manual",
        trigger: "review_in_progress",
        fileFingerprint,
        dialogueFingerprint,
        role: REVIEW_ROLE,
      };
    }

    activeReviewKey = reviewKey;
    inFlightDialogueReviewKeys.add(activeReviewKey);
    const reviewResult = await runDialogueReviewTurn({
      handlers,
      rootDir,
      shotDesignFinalPath,
      reviewOutputPath,
      artifactId,
      parentArtifactId: sourceParentArtifactId,
      sourceTurnId: sourceTurnId ?? conversation.latestTurnId,
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
      shotDesignFinalPath: relativeShotDesignFinalPath,
      reviewOutputPath: safeRelative(rootDir, reviewOutputPath),
      trigger,
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
      parentArtifactId: sourceParentArtifactId,
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
      shotDesignFinalPath: relativeShotDesignFinalPath,
      reviewOutputPath: safeRelative(rootDir, reviewOutputPath),
      sourceMode: "manual",
      trigger,
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
      code: error?.code ?? "dialogue_robotic_review_manual_failed",
      message: safePreview(error instanceof Error ? error.message : "台词机器人感审查失败", 240),
      retryable: error?.retryable !== false,
    };
    const snapshot = await logger.writeDebugSnapshot({
      traceContext: stageTraceContext,
      stageName: AUTO_STAGE_NAME,
      artifactId,
      parentArtifactId: sourceParentArtifactId,
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
      parentArtifactId: sourceParentArtifactId,
      errorSummary: { ...safeError, debugSnapshotUri: snapshot.uri },
      durationMs: Date.now() - startedAt,
    });
    error.code = safeError.code;
    error.retryable = safeError.retryable;
    error.debugPayload = { ...safeError, debugSnapshotUri: snapshot.uri };
    throw error;
  } finally {
    if (activeReviewKey) inFlightDialogueReviewKeys.delete(activeReviewKey);
  }
}

function buildDialogueReviewKey({ conversationId, shotDesignFinalPath, dialogueFingerprint }) {
  return [
    "dialogue-review",
    normalizeText(conversationId) ?? "conversation",
    normalizeText(shotDesignFinalPath) ?? "shot-design",
    normalizeText(dialogueFingerprint?.sha256) ?? "no-dialogue-fingerprint",
  ].join(":");
}

async function hasActiveDialogueReview(handlers, reviewKey) {
  if (!reviewKey || typeof handlers.activeTurnRuntime?.listActive !== "function") return false;
  const active = await handlers.activeTurnRuntime.listActive({ ownerType: "agent-chat-dialogue-review" }).catch(() => []);
  return active.some((binding) => binding?.replayRef?.refId === reviewKey);
}

module.exports = {
  AUTO_STAGE_NAME,
  REVIEW_ROLE,
  extractShotDesignFinalPath,
  maybeAutoReviewShotDialogue,
  parseReviewJson,
  reviewShotDialogueForConversation,
};
