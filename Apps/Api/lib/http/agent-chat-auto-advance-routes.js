const { createHash, randomUUID } = require("crypto");
const { readJsonBody } = require("../observability/ui-debug-events");
const { buildAgentChatActionProjection } = require("../agent-chat/actions");
const { findLatestRestructureFinalPath } = require("../agent-chat/restructure-auto-display-utils");
const { loadRoleProfileByRole, renderTurnTemplate } = require("../gateways/threadpool/role-profile-loader");
const { normalizeTurnStatus } = require("../active-turns/status");
const {
  assertConversationReadyForNewTurn,
  badRequestError,
  normalizeRevision,
  normalizeText,
  runAgentChatStage,
  safePreview,
  withConversationLock,
} = require("./agent-chat-route-core");
const {
  DEFAULT_TURN_TIMEOUT_SECONDS,
  assertAgentChatTurnStarted,
  assertExpectedThreadResult,
  buildTextInputs,
  registerAgentChatActiveTurn,
} = require("./agent-chat-route-shared");

async function handleAgentChatConversationAutoAdvance(req, res, conversationId, handlers = {}) {
  const body = await (handlers.readJsonBodyImpl ?? readJsonBody)(req).catch(() => ({}));
  return runAgentChatStage(res, handlers, {
    stageName: "agentChat.autoAdvance.submit",
    inputSummary: {
      conversationId,
      sourceTurnId: normalizeText(body.sourceTurnId),
      sourceRestructureFinalPath: normalizeText(body.restructureFinalPath),
      autoAdvanceKey: normalizeText(body.autoAdvanceKey),
      expectedRevision: normalizeRevision(body.expectedRevision),
    },
    action: async ({ traceContext }) => withConversationLock(conversationId, async () => {
      const conversation = await handlers.agentConversationStore?.assertActive?.(conversationId, {
        expectedRevision: normalizeRevision(body.expectedRevision),
      });
      if (!conversation) throw badRequestError("agent_chat_conversation_not_found", "未找到 Agent 会话");
      if (conversation.role !== "function-slot-restructure") {
        throw badRequestError("agent_chat_auto_advance_role_invalid", "自动推进只能提交给 function-slot-restructure 会话");
      }
      const threadId = normalizeText(body.threadId) ?? conversation.threadId;
      if (!threadId) throw badRequestError("agent_chat_auto_advance_thread_missing", "当前会话缺少可推进的 thread");
      if (conversation.threadId && conversation.threadId !== threadId) {
        throw badRequestError("agent_chat_auto_advance_thread_mismatch", "自动推进 threadId 与会话不一致");
      }
      const restructureFinalPath = normalizeText(body.restructureFinalPath) ?? findLatestRestructureFinalPath(conversation);
      if (!restructureFinalPath) {
        throw badRequestError("agent_chat_auto_advance_restructure_missing", "未找到可推进的 restructure.final.md");
      }
      const sourceRestructureFingerprint = normalizeFingerprint(body.restructureFingerprint);
      const sourceDisplayFingerprint = normalizeFingerprint(body.displayFingerprint);
      const autoAdvanceKey = buildAutoAdvanceKey({
        conversationId,
        restructureFinalPath,
        sourceTurnId: normalizeText(body.sourceTurnId) ?? conversation.latestTurnId ?? null,
        sourceRestructureFingerprint,
        sourceDisplayFingerprint,
      });
      const duplicate = findDuplicateAutoAdvance(conversation, {
        autoAdvanceKey,
        restructureFinalPath,
        sourceRestructureFingerprint,
        sourceDisplayFingerprint,
      });
      if (duplicate) {
        return {
          ok: true,
          source: conversation.source ?? body.source ?? "threadpool-role",
          role: conversation.role,
          conversationId,
          conversationRevision: conversation.revision ?? null,
          workspaceRoot: normalizeText(body.workspaceRoot) || conversation.workspaceRoot || handlers.rootDir,
          threadId,
          turnId: duplicate.turnId ?? conversation.latestTurnId ?? null,
          status: "skipped_duplicate",
          userTurnText: duplicate.text ?? buildAutoAdvanceShotDesignSummary(),
          traceId: traceContext.traceId,
          runId: traceContext.runId,
          stageId: traceContext.stageId,
          latestTurnId: conversation.latestTurnId ?? duplicate.turnId ?? null,
          threadStopped: Boolean(conversation.threadStopped),
          retryable: false,
          activeTurnStatus: normalizeTurnStatus("completed"),
          autoAdvanceState: {
            nextAction: "wait",
            reason: "duplicate_auto_advance",
            dedupeKey: autoAdvanceKey,
            status: "skipped_duplicate",
          },
          actionProjection: buildAgentChatActionProjection({
            conversation,
            threadId,
            turnId: duplicate.turnId ?? conversation.latestTurnId ?? null,
            status: "completed",
            retryable: false,
          }),
        };
      }
      assertConversationReadyForNewTurn(conversation);
      const workspaceRoot = normalizeText(body.workspaceRoot) || conversation.workspaceRoot || handlers.rootDir;
      const roleProfile = await loadRoleProfileByRole("function-slot-restructure");
      const prompt = renderTurnTemplate(roleProfile, "autoShotDesign", {
        sourceRestructureFinalPath: restructureFinalPath,
        sourceTurnId: normalizeText(body.sourceTurnId) ?? conversation.latestTurnId ?? "",
        userInstruction: normalizeText(body.userInstruction) ?? "无",
      });
      const promptText = prompt.text.trim();
      const message = buildAutoAdvanceShotDesignSummary({
        restructureFinalPath,
        sourceTurnId: normalizeText(body.sourceTurnId) ?? conversation.latestTurnId ?? null,
      });
      const result = await handlers.appServer.startTurnWithInputs({
        workspaceRoot,
        threadId,
        inputs: buildTextInputs(promptText),
        skillPath: conversation.skillPath || roleProfile.skillPath || normalizeText(body.skillPath),
        timeoutSeconds: DEFAULT_TURN_TIMEOUT_SECONDS,
      });
      assertAgentChatTurnStarted(result);
      assertExpectedThreadResult(result, threadId, "agent_chat_auto_advance_thread_mismatch");
      const turnId = result.turnId ?? result.turn?.id ?? null;
      const recorded = await handlers.agentConversationStore?.recordUserTurn?.({
        conversationId,
        turnId,
        text: message,
        traceId: traceContext.traceId,
        runId: traceContext.runId,
          stageId: traceContext.stageId,
          userInputOrigin: "auto_advance",
          autoAdvanceKey,
          sourceRestructurePath: restructureFinalPath,
          sourceRestructureFingerprint,
          sourceDisplayFingerprint,
        }) ?? conversation;
      await registerAgentChatActiveTurn(handlers, {
        payload: {
          conversationId,
          source: conversation.source ?? body.source ?? "threadpool-role",
          role: conversation.role,
          leaseId: conversation.leaseId ?? body.leaseId ?? null,
          threadPoolOwnerId: conversation.ownerId ?? body.ownerId ?? null,
          workspaceRoot,
          threadId: result.threadId ?? threadId,
          turnId,
          status: result.status ?? "submitted",
          traceId: traceContext.traceId,
          runId: traceContext.runId,
          stageId: traceContext.stageId,
          parentArtifactId: normalizeText(body.parentArtifactId) ?? normalizeText(body.sourceTurnId) ?? conversation.latestTurnId ?? null,
        },
        conversation: recorded,
        message,
        traceContext,
        stageName: "agentChat.autoAdvance.submit",
        sourceTurnId: normalizeText(body.sourceTurnId) ?? conversation.latestTurnId ?? null,
      });
      return {
        ok: true,
        source: conversation.source ?? body.source ?? "threadpool-role",
        role: conversation.role,
        conversationId,
        conversationRevision: recorded?.revision ?? null,
        workspaceRoot,
        threadId: result.threadId ?? threadId,
        turnId,
        status: result.status ?? "submitted",
        userTurnText: message,
        traceId: traceContext.traceId,
        runId: traceContext.runId,
        stageId: traceContext.stageId,
        latestTurnId: recorded?.latestTurnId ?? turnId,
        threadStopped: Boolean(recorded?.threadStopped),
        retryable: true,
        activeTurnStatus: normalizeTurnStatus(result.status ?? "submitted"),
        autoAdvanceState: {
          nextAction: "submitShotDesign",
          reason: "slot_atom_display_available",
          dedupeKey: autoAdvanceKey,
          status: "submitted",
        },
        promptTemplateId: prompt.promptTemplateId,
        promptTemplateVersion: prompt.promptTemplateVersion,
        promptTemplateHash: prompt.promptTemplateHash,
        actionProjection: buildAgentChatActionProjection({
          conversation: recorded,
          threadId: result.threadId ?? threadId,
          turnId,
          status: result.status ?? "submitted",
          retryable: true,
        }),
      };
    }),
    summarizeOutput: (result) => ({
      role: result.role,
      threadId: result.threadId,
      turnId: result.turnId,
      status: result.status,
      conversationRevision: result.conversationRevision ?? null,
      autoAdvanceState: result.autoAdvanceState?.status ?? null,
      promptTemplateVersion: result.promptTemplateVersion ?? null,
    }),
    successStatus: 202,
  });
}

async function maybeCompleteAutomaticAdvance({ handlers, conversationId, payload, traceContext }) {
  if (!conversationId) return null;
  if (payload?.autoDialogueRoboticReview?.status !== "processed") return null;
  if (payload.autoDialogueRoboticReview.decision !== "pass") return null;
  const conversation = await handlers.agentConversationStore?.get?.(conversationId).catch(() => null);
  if (!conversation || !isAutoAdvanceTurn(conversation, payload.turnId)) return null;
  if (conversation.confirmedPlan?.storyboardArtifact) {
    return {
      ok: true,
      status: conversation.confirmedPlan.status ?? "storyboard_processing",
      confirmationId: conversation.confirmedPlan.confirmationId ?? null,
      conversationRevision: conversation.revision ?? null,
      storyboardArtifact: conversation.confirmedPlan.storyboardArtifact,
      traceId: traceContext.traceId,
      runId: traceContext.runId,
      stageId: traceContext.stageId,
      skipped: true,
    };
  }
  const sourceRestructurePath = findLatestRestructureFinalPath(conversation);
  const sourceShotDesignPath = normalizeText(payload.autoDialogueRoboticReview.shotDesignFinalPath);
  if (!sourceRestructurePath || !sourceShotDesignPath) return null;
  const stageTraceContext = {
    ...traceContext,
    stageId: `stage_auto_advance_confirm_${randomUUID()}`,
  };
  const stageName = "agentChat.autoAdvance.confirm";
  const startedAt = Date.now();
  const confirmationId = buildConfirmationId(payload.turnId);
  const inputSummary = {
    conversationId,
    turnId: payload.turnId ?? null,
    confirmationId,
    sourceRestructurePath,
    sourceShotDesignPath,
  };
  await handlers.logger?.writeStageLog?.({
    traceContext: stageTraceContext,
    stageName,
    event: "stage.start",
    parentArtifactId: payload.turnId ?? null,
    inputSummary,
  });
  try {
    const gate = await handlers.agentConversationStore?.confirmPlan?.({
      conversationId,
      turnId: payload.turnId,
      confirmationId,
      sourceRestructurePath,
      sourceShotDesignPath,
      note: "自动推进：Shot 设计台词审查通过，准备触发 Shot Storyboard Prep 流水线。",
      status: "confirmed",
      traceId: stageTraceContext.traceId,
      runId: stageTraceContext.runId,
      stageId: stageTraceContext.stageId,
    });
    const storyboardResult = await handlers.shotStoryboardAutoPipelineService?.enqueue?.({
      sampleVideoId: "function-slot-workflow",
      restructureFinalPath: sourceRestructurePath,
      shotDesignFinalPath: sourceShotDesignPath,
      restructureArtifactId: payload.turnId,
      parentArtifactId: payload.turnId,
      confirmationId,
      conversationId,
      runImageGeneration: true,
      runPdfAgent: false,
    });
    if (!storyboardResult) {
      const error = new Error("Shot Storyboard Prep pipeline 服务不可用");
      error.code = "storyboard_prep_pipeline_unavailable";
      error.statusCode = 503;
      throw error;
    }
    const confirmed = await handlers.agentConversationStore?.confirmPlan?.({
      conversationId,
      turnId: payload.turnId,
      confirmationId,
      sourceRestructurePath,
      sourceShotDesignPath,
      note: "自动推进：已确认当前方案，已触发 Shot Storyboard Prep 流水线。",
      storyboardArtifact: {
        artifactId: storyboardResult.artifactId,
        processingJobId: storyboardResult.processingJobId,
        traceId: storyboardResult.traceId,
        runId: storyboardResult.runId,
        stageId: storyboardResult.stageId,
        status: storyboardResult.status,
      },
      status: resolveConfirmedPlanStatusFromStoryboard(storyboardResult),
      traceId: stageTraceContext.traceId,
      runId: stageTraceContext.runId,
      stageId: stageTraceContext.stageId,
    });
    const result = {
      ok: true,
      status: resolveConfirmedPlanStatusFromStoryboard(storyboardResult),
      confirmationId,
      conversationRevision: confirmed?.revision ?? gate?.revision ?? null,
      storyboardArtifact: confirmed?.confirmedPlan?.storyboardArtifact ?? null,
      traceId: stageTraceContext.traceId,
      runId: stageTraceContext.runId,
      stageId: stageTraceContext.stageId,
    };
    await handlers.logger?.writeStageLog?.({
      traceContext: stageTraceContext,
      stageName,
      event: "stage.end",
      artifactId: storyboardResult.artifactId ?? null,
      parentArtifactId: payload.turnId ?? null,
      outputSummary: {
        status: result.status,
        confirmationId,
        storyboardArtifactId: result.storyboardArtifact?.artifactId ?? null,
        storyboardJobId: result.storyboardArtifact?.processingJobId ?? storyboardResult.processingJobId ?? null,
      },
      durationMs: Date.now() - startedAt,
    });
    return result;
  } catch (error) {
    const safeError = {
      code: error?.code ?? "agent_chat_auto_advance_confirm_failed",
      message: safePreview(error instanceof Error ? error.message : "自动确认方案失败", 240),
      retryable: error?.retryable !== false,
    };
    const snapshot = await handlers.logger?.writeDebugSnapshot?.({
      traceContext: stageTraceContext,
      stageName,
      parentArtifactId: payload.turnId ?? null,
      reason: safeError.code,
      inputSummary,
      debugPayload: safeError,
    });
    await handlers.logger?.writeStageLog?.({
      traceContext: stageTraceContext,
      stageName,
      event: "stage.fail",
      parentArtifactId: payload.turnId ?? null,
      errorSummary: { ...safeError, debugSnapshotUri: snapshot?.uri ?? null },
      durationMs: Date.now() - startedAt,
    });
    return {
      ok: false,
      status: "failed",
      error: safeError.code,
      message: safeError.message,
      retryable: safeError.retryable,
      debugSnapshotUri: snapshot?.uri ?? null,
      traceId: stageTraceContext.traceId,
      runId: stageTraceContext.runId,
      stageId: stageTraceContext.stageId,
    };
  }
}

function buildAutoAdvanceShotDesignSummary() {
  return "继续完善 Shot 设计";
}

function buildAutoAdvanceKey({ conversationId, restructureFinalPath, sourceTurnId = null, sourceRestructureFingerprint = null, sourceDisplayFingerprint = null }) {
  const payload = {
    conversationId: normalizeText(conversationId),
    restructureFinalPath: normalizeText(restructureFinalPath),
    sourceTurnId: normalizeText(sourceTurnId),
    restructureFingerprint: stableFingerprint(sourceRestructureFingerprint),
    displayFingerprint: stableFingerprint(sourceDisplayFingerprint),
  };
  return `auto_advance_${createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 24)}`;
}

function findDuplicateAutoAdvance(conversation, { autoAdvanceKey, restructureFinalPath, sourceRestructureFingerprint, sourceDisplayFingerprint }) {
  const messages = Array.isArray(conversation?.messages) ? conversation.messages : [];
  const restructurePath = normalizePath(restructureFinalPath);
  for (const message of messages) {
    if (message?.role !== "user" || normalizeText(message.userInputOrigin) !== "auto_advance") continue;
    if (normalizeText(message.autoAdvanceKey) === autoAdvanceKey) return message;
    if (restructurePath && normalizePath(message.sourceRestructurePath) === restructurePath) {
      const sameRestructure = fingerprintsMatch(message.sourceRestructureFingerprint, sourceRestructureFingerprint);
      const sameDisplay = fingerprintsMatch(message.sourceDisplayFingerprint, sourceDisplayFingerprint);
      if (sameRestructure || sameDisplay) return message;
    }
  }
  return null;
}

function normalizeFingerprint(value) {
  if (!value || typeof value !== "object") return null;
  return {
    path: normalizePath(value.path),
    size: normalizeNullableNumber(value.size),
    mtimeMs: normalizeNullableNumber(value.mtimeMs),
    sha256: normalizeText(value.sha256),
  };
}

function fingerprintsMatch(left, right) {
  const a = normalizeFingerprint(left);
  const b = normalizeFingerprint(right);
  if (!a || !b) return false;
  if (a.sha256 && b.sha256 && a.sha256 === b.sha256) return true;
  if (a.path && b.path && a.path === b.path && a.size === b.size && a.mtimeMs === b.mtimeMs) return true;
  return false;
}

function stableFingerprint(value) {
  const fingerprint = normalizeFingerprint(value);
  if (!fingerprint) return null;
  return {
    path: fingerprint.path,
    size: fingerprint.size,
    mtimeMs: fingerprint.mtimeMs,
    sha256: fingerprint.sha256,
  };
}

function normalizePath(value) {
  return normalizeText(value)?.replaceAll("\\", "/") ?? null;
}

function normalizeNullableNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function resolveConfirmedPlanStatusFromStoryboard(storyboardResult) {
  const status = String(storyboardResult?.status ?? "").trim();
  if (status === "processed" || status === "completed") return "completed";
  if (status === "failed") return "storyboard_failed";
  return "storyboard_processing";
}

function isAutoAdvanceTurn(conversation, turnId) {
  const target = normalizeText(turnId);
  if (!target) return false;
  return (conversation.messages ?? []).some((message) => (
    message?.role === "user"
    && normalizeText(message.turnId) === target
    && normalizeText(message.userInputOrigin) === "auto_advance"
  ));
}

function buildConfirmationId(turnId) {
  const suffix = String(turnId ?? "turn").replace(/[^A-Za-z0-9_.-]+/g, "").slice(-8) || "turn";
  return `auto_confirm_${suffix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

module.exports = {
  handleAgentChatConversationAutoAdvance,
  maybeCompleteAutomaticAdvance,
  buildAutoAdvanceKey,
};
