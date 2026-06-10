const {
  normalizeText,
  safePreview,
} = require("./shot-storyboard-pipeline-utils");

function createStoryboardConversationUpdater({ agentConversationStore }) {
  async function markProcessed({ options, job, traceContext, artifactId }) {
    const conversationId = normalizeText(options.conversationId);
    if (!conversationId || !agentConversationStore?.confirmPlan) return;
    const current = await agentConversationStore.get?.(conversationId).catch(() => null);
    const optionConfirmationId = normalizeText(options.confirmationId);
    const optionTurnId = normalizeText(options.restructureArtifactId);
    if (!isCurrentStoryboardConfirmation(current, { confirmationId: optionConfirmationId, turnId: optionTurnId })) {
      await updateStoryboardResultMessage({
        conversationId,
        confirmationId: optionConfirmationId,
        storyboardArtifact: buildStoryboardArtifact({ artifactId, job, traceContext, status: "processed" }),
        status: "completed",
        traceContext,
      });
      return;
    }
    await agentConversationStore.confirmPlan({
      conversationId,
      turnId: current?.confirmedPlan?.turnId ?? normalizeText(options.restructureArtifactId),
      confirmationId: optionConfirmationId ?? current?.confirmedPlan?.confirmationId ?? null,
      sourceRestructurePath: normalizeText(options.restructureFinalPath) ?? current?.confirmedPlan?.sourceRestructurePath ?? null,
      sourceShotDesignPath: normalizeText(options.shotDesignFinalPath) ?? current?.confirmedPlan?.sourceShotDesignPath ?? null,
      note: "Shot Storyboard Prep 流水线已完成。",
      storyboardArtifact: buildStoryboardArtifact({ artifactId, job, traceContext, status: "processed" }),
      status: "completed",
      traceId: traceContext.traceId,
      runId: traceContext.runId,
      stageId: traceContext.stageId,
    }).catch(() => null);
    await updateStoryboardResultMessage({
      conversationId,
      confirmationId: optionConfirmationId,
      storyboardArtifact: buildStoryboardArtifact({ artifactId, job, traceContext, status: "processed" }),
      status: "completed",
      traceContext,
    });
  }

  async function markFailed({ options, job, traceContext, artifactId, error }) {
    const conversationId = normalizeText(options.conversationId);
    if (!conversationId || !agentConversationStore?.confirmPlan) return;
    const current = await agentConversationStore.get?.(conversationId).catch(() => null);
    if (!current?.confirmedPlan) return;
    const optionConfirmationId = normalizeText(options.confirmationId);
    const optionTurnId = normalizeText(options.restructureArtifactId);
    if (!isCurrentStoryboardConfirmation(current, { confirmationId: optionConfirmationId, turnId: optionTurnId })) {
      await updateStoryboardResultMessage({
        conversationId,
        confirmationId: optionConfirmationId,
        storyboardArtifact: buildStoryboardArtifact({ artifactId, job, traceContext, status: "failed" }),
        status: "storyboard_failed",
        traceContext,
      });
      return;
    }
    await agentConversationStore.confirmPlan({
      conversationId,
      turnId: current.confirmedPlan.turnId ?? normalizeText(options.restructureArtifactId),
      confirmationId: optionConfirmationId ?? current.confirmedPlan.confirmationId ?? null,
      sourceRestructurePath: normalizeText(options.restructureFinalPath) ?? current.confirmedPlan.sourceRestructurePath ?? null,
      sourceShotDesignPath: normalizeText(options.shotDesignFinalPath) ?? current.confirmedPlan.sourceShotDesignPath ?? null,
      note: `Shot Storyboard Prep 流水线失败：${safePreview(error?.message ?? "未知错误", 160)}`,
      storyboardArtifact: buildStoryboardArtifact({ artifactId, job, traceContext, status: "failed" }),
      status: "storyboard_failed",
      traceId: traceContext.traceId,
      runId: traceContext.runId,
      stageId: traceContext.stageId,
    }).catch(() => null);
    await updateStoryboardResultMessage({
      conversationId,
      confirmationId: optionConfirmationId,
      storyboardArtifact: buildStoryboardArtifact({ artifactId, job, traceContext, status: "failed" }),
      status: "storyboard_failed",
      traceContext,
    });
  }

  async function markBatchStarted({ options, job, traceContext, artifactId, versionResults }) {
    const conversationId = normalizeText(options.conversationId);
    if (!conversationId || !agentConversationStore?.confirmPlan) return;
    const defaultVersion = versionResults.find((item) => item.versionId === options.defaultVersionId) ?? versionResults[0] ?? null;
    const storyboardArtifact = buildStoryboardArtifact({ artifactId, job, traceContext, status: "processing" });
    await agentConversationStore.confirmPlan({
      conversationId,
      turnId: normalizeText(options.restructureArtifactId) ?? null,
      confirmationId: normalizeText(options.confirmationId),
      sourceRestructurePath: defaultVersion?.sourceRestructurePath ?? normalizeText(options.restructureFinalPath) ?? null,
      sourceShotDesignPath: defaultVersion?.sourceShotDesignPath ?? normalizeText(options.shotDesignFinalPath) ?? null,
      note: "多版本 Shot Storyboard Prep 流水线已启动。",
      storyboardArtifact,
      storyboardMode: "multi_version",
      defaultVersionId: options.defaultVersionId ?? defaultVersion?.versionId ?? null,
      storyboardVersions: versionResults,
      status: "storyboard_processing",
      traceId: traceContext.traceId,
      runId: traceContext.runId,
      stageId: traceContext.stageId,
    }).catch(() => null);
    await agentConversationStore.updateStoryboardResultMessage?.({
      conversationId,
      confirmationId: normalizeText(options.confirmationId),
      storyboardArtifact,
      versions: versionResults,
      status: versionResults.some((item) => item.status === "failed") ? "storyboard_failed" : "completed",
      traceId: traceContext.traceId,
      runId: traceContext.runId,
      stageId: traceContext.stageId,
    }).catch(() => null);
  }

  async function updateStoryboardResultMessage({ conversationId, confirmationId, storyboardArtifact, status, traceContext }) {
    if (!agentConversationStore?.updateStoryboardResultMessage) return;
    await agentConversationStore.updateStoryboardResultMessage({
      conversationId,
      confirmationId,
      storyboardArtifact,
      status,
      traceId: traceContext.traceId,
      runId: traceContext.runId,
      stageId: traceContext.stageId,
    }).catch(() => null);
  }

  return {
    markBatchStarted,
    markFailed,
    markProcessed,
  };
}

function buildStoryboardArtifact({ artifactId, job, traceContext, status }) {
  return {
    artifactId,
    processingJobId: job?.jobId ?? null,
    traceId: traceContext.traceId,
    runId: traceContext.runId,
    stageId: traceContext.stageId,
    status,
  };
}

function isCurrentStoryboardConfirmation(conversation, { confirmationId, turnId }) {
  const confirmed = conversation?.confirmedPlan;
  if (!confirmed) return false;
  const expectedConfirmationId = normalizeText(confirmationId);
  const expectedTurnId = normalizeText(turnId);
  return Boolean(
    expectedConfirmationId
    && expectedTurnId
    && normalizeText(confirmed.confirmationId) === expectedConfirmationId
    && normalizeText(confirmed.turnId) === expectedTurnId
  );
}

module.exports = {
  createStoryboardConversationUpdater,
};
