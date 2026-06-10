const { randomUUID } = require("crypto");
const {
  assertExpectedRevision,
  limitText,
  normalizeArtifactRef,
  normalizeConfirmedPlan,
  normalizeConfirmedPlanStatus,
  normalizeIdText,
  normalizeMaterialGapMatrix,
  normalizeMaterialPackBinding,
  normalizeMaterialPackRef,
  normalizePathText,
  normalizeStoryboardResult,
  normalizeStoryboardVersions,
  upsertMessage,
} = require("./conversation-normalizers");

function createConversationArtifactActions({ mutateConversation }) {
  async function confirmPlan({ conversationId, turnId = null, confirmationId = null, note = null, sourceRestructurePath = null, sourceShotDesignPath = null, displayArtifact = null, storyboardArtifact = null, storyboardMode = null, defaultVersionId = null, storyboardVersions = null, status = null, traceId = null, runId = null, stageId = null, expectedRevision = null }) {
    if (!conversationId) return null;
    const now = new Date().toISOString();
    return mutateConversation(conversationId, (conversation) => {
      assertExpectedRevision(conversation, expectedRevision);
      conversation.traceId = traceId ?? conversation.traceId ?? null;
      conversation.runId = runId ?? conversation.runId ?? null;
      conversation.stageId = stageId ?? conversation.stageId ?? null;
      const previous = normalizeConfirmedPlan(conversation.confirmedPlan);
      const nextDisplayArtifact = normalizeArtifactRef(displayArtifact) ?? previous?.displayArtifact ?? null;
      const nextStoryboardArtifact = normalizeArtifactRef(storyboardArtifact) ?? previous?.storyboardArtifact ?? null;
      const nextStoryboardVersions = normalizeStoryboardVersions(storyboardVersions) ?? previous?.storyboardVersions ?? [];
      conversation.confirmedPlan = {
        status: normalizeConfirmedPlanStatus(status, nextStoryboardArtifact, nextDisplayArtifact),
        mode: storyboardMode ?? previous?.mode ?? (nextStoryboardVersions.length > 1 ? "multi_version" : "single"),
        defaultVersionId: normalizeIdText(defaultVersionId) ?? previous?.defaultVersionId ?? nextStoryboardVersions[0]?.versionId ?? null,
        turnId: turnId ?? conversation.latestTurnId ?? null,
        confirmationId: normalizeIdText(confirmationId),
        confirmedAt: conversation.confirmedPlan?.confirmedAt ?? now,
        updatedAt: now,
        note: limitText(note),
        sourceRestructurePath: normalizePathText(sourceRestructurePath) ?? previous?.sourceRestructurePath ?? null,
        sourceShotDesignPath: normalizePathText(sourceShotDesignPath) ?? previous?.sourceShotDesignPath ?? null,
        displayArtifact: nextDisplayArtifact,
        storyboardArtifact: nextStoryboardArtifact,
        storyboardVersions: nextStoryboardVersions,
        traceId: traceId ?? null,
        runId: runId ?? null,
        stageId: stageId ?? null,
      };
    });
  }

  async function bindDefaultMaterialPack({ conversationId, materialPackRef = null, binding = null, traceId = null, runId = null, stageId = null, expectedRevision = null }) {
    if (!conversationId || !materialPackRef) return null;
    const normalizedRef = normalizeMaterialPackRef(materialPackRef);
    if (!normalizedRef) return null;
    return mutateConversation(conversationId, (conversation) => {
      assertExpectedRevision(conversation, expectedRevision);
      conversation.defaultMaterialPackRef = normalizedRef;
      conversation.defaultMaterialPackBinding = normalizeMaterialPackBinding({
        ...binding,
        sampleVideoId: binding?.sampleVideoId ?? normalizedRef.sampleVideoId,
        traceId: traceId ?? binding?.traceId ?? normalizedRef.traceId,
        runId: runId ?? binding?.runId ?? null,
        stageId: stageId ?? binding?.stageId ?? null,
        boundAt: binding?.boundAt ?? new Date().toISOString(),
      });
      conversation.traceId = traceId ?? conversation.traceId ?? null;
      conversation.runId = runId ?? conversation.runId ?? null;
      conversation.stageId = stageId ?? conversation.stageId ?? null;
    }, { skipArchived: true });
  }

  async function clearDefaultMaterialPack({ conversationId, traceId = null, runId = null, stageId = null, expectedRevision = null }) {
    if (!conversationId) return null;
    return mutateConversation(conversationId, (conversation) => {
      assertExpectedRevision(conversation, expectedRevision);
      conversation.defaultMaterialPackRef = null;
      conversation.defaultMaterialPackBinding = null;
      conversation.traceId = traceId ?? conversation.traceId ?? null;
      conversation.runId = runId ?? conversation.runId ?? null;
      conversation.stageId = stageId ?? conversation.stageId ?? null;
    }, { skipArchived: true });
  }

  async function createStoryboardResultMessage({ conversationId, turnId = null, confirmationId = null, planRevisionKey = null, sourceRestructurePath = null, sourceShotDesignPath = null, storyboardArtifact = null, mode = null, defaultVersionId = null, versions = null, status = "storyboard_processing", traceId = null, runId = null, stageId = null, expectedRevision = null }) {
    if (!conversationId || !confirmationId) return null;
    const now = new Date().toISOString();
    const messageId = `storyboard-result-${normalizeIdText(confirmationId)}-${now}-${randomUUID()}`;
    return mutateConversation(conversationId, (conversation) => {
      assertExpectedRevision(conversation, expectedRevision);
      conversation.traceId = traceId ?? conversation.traceId ?? null;
      conversation.runId = runId ?? conversation.runId ?? null;
      conversation.stageId = stageId ?? conversation.stageId ?? null;
      upsertMessage(conversation, {
        id: messageId,
        turnId: turnId ?? conversation.latestTurnId ?? null,
        role: "system",
        text: formatStoryboardResultText(status),
        status: "completed",
        storyboardResult: normalizeStoryboardResult({
          planRevisionKey,
          turnId: turnId ?? conversation.latestTurnId ?? null,
          confirmationId,
          status,
          mode,
          defaultVersionId,
          sourceRestructurePath,
          sourceShotDesignPath,
          storyboardArtifact,
          versions,
          traceId,
          runId,
          stageId,
          createdAt: now,
          updatedAt: now,
        }),
        createdAt: now,
        updatedAt: now,
      });
    });
  }

  async function createMaterialGapMatrixMessage({ conversationId, turnId = null, materialGapMatrix = null, traceId = null, runId = null, stageId = null, expectedRevision = null }) {
    if (!conversationId || !materialGapMatrix) return null;
    const normalized = normalizeMaterialGapMatrix(materialGapMatrix);
    if (!normalized) return null;
    const now = new Date().toISOString();
    const messageId = `material-gap-matrix-${normalizeIdText(turnId) ?? "turn"}-${normalizeIdText(normalized.artifactId) ?? now}-${randomUUID()}`;
    return mutateConversation(conversationId, (conversation) => {
      assertExpectedRevision(conversation, expectedRevision);
      conversation.traceId = traceId ?? normalized.traceId ?? conversation.traceId ?? null;
      conversation.runId = runId ?? normalized.runId ?? conversation.runId ?? null;
      conversation.stageId = stageId ?? normalized.stageId ?? conversation.stageId ?? null;
      upsertMessage(conversation, {
        id: messageId,
        turnId: turnId ?? conversation.latestTurnId ?? null,
        role: "system",
        text: formatMaterialGapMatrixText(normalized),
        status: "completed",
        materialGapMatrix: normalized,
        createdAt: now,
        updatedAt: now,
      });
    });
  }

  async function updateStoryboardResultMessage({ conversationId, confirmationId = null, storyboardArtifact = null, versions = null, status = null, traceId = null, runId = null, stageId = null }) {
    if (!conversationId || !confirmationId) return null;
    const now = new Date().toISOString();
    return mutateConversation(conversationId, (conversation) => {
      const messages = Array.isArray(conversation.messages) ? conversation.messages : [];
      const index = findStoryboardResultMessageIndex(messages, confirmationId);
      if (index < 0) return { changed: false };
      const current = messages[index];
      const currentResult = normalizeStoryboardResult(current.storyboardResult);
      const nextArtifact = normalizeArtifactRef(storyboardArtifact) ?? currentResult?.storyboardArtifact ?? null;
      const nextStatus = status ?? currentResult?.status ?? "storyboard_processing";
      messages[index] = {
        ...current,
        text: formatStoryboardResultText(nextStatus),
        status: "completed",
        storyboardResult: normalizeStoryboardResult({
          ...currentResult,
          status: nextStatus,
          storyboardArtifact: nextArtifact,
          versions: versions ?? currentResult?.versions ?? [],
          artifactId: nextArtifact?.artifactId ?? currentResult?.artifactId ?? null,
          processingJobId: nextArtifact?.processingJobId ?? currentResult?.processingJobId ?? null,
          traceId: traceId ?? nextArtifact?.traceId ?? currentResult?.traceId ?? null,
          runId: runId ?? nextArtifact?.runId ?? currentResult?.runId ?? null,
          stageId: stageId ?? nextArtifact?.stageId ?? currentResult?.stageId ?? null,
          updatedAt: now,
        }),
        updatedAt: now,
      };
      conversation.messages = messages;
      conversation.traceId = traceId ?? conversation.traceId ?? null;
      conversation.runId = runId ?? conversation.runId ?? null;
      conversation.stageId = stageId ?? conversation.stageId ?? null;
    });
  }

  return {
    bindDefaultMaterialPack,
    clearDefaultMaterialPack,
    confirmPlan,
    createMaterialGapMatrixMessage,
    createStoryboardResultMessage,
    updateStoryboardResultMessage,
  };
}

function findStoryboardResultMessageIndex(messages, confirmationId) {
  const expected = normalizeIdText(confirmationId);
  if (!expected) return -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (normalizeIdText(messages[index]?.storyboardResult?.confirmationId) === expected) return index;
  }
  return -1;
}

function formatStoryboardResultText(status) {
  const normalized = normalizeConfirmedPlanStatus(status, null, null);
  if (normalized === "completed") return "方案完成";
  if (normalized === "storyboard_failed") return "故事板准备失败";
  if (normalized === "confirmed") return "方案已确认";
  return "故事板准备中";
}

function formatMaterialGapMatrixText(matrix) {
  if (matrix?.status && matrix.status !== "processed") return "素材缺口矩阵生成失败";
  const summary = matrix?.summary ?? {};
  const issueCount = Number(summary.missingCount ?? 0) + Number(summary.partialCount ?? 0) + Number(summary.unsafeCount ?? 0);
  return issueCount > 0 ? `素材缺口矩阵：${issueCount} 个槽位需关注` : "素材缺口矩阵：当前槽位素材直接满足度较好";
}

module.exports = {
  createConversationArtifactActions,
};
