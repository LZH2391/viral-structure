const { randomUUID } = require("crypto");
const { nextStage } = require("../../../../Infrastructure/Observability/trace");
const { loadRoleProfileByRole, renderTurnTemplate } = require("../gateways/threadpool/role-profile-loader");
const { buildTitleInputSummary, extractFirstSentence } = require("./title-input");
const { fallbackTitleFromFirstSentence, parseTitleResult, safePreview } = require("./title-result");

const TITLE_ROLE = "conversation-title-generator";
const TITLE_STAGE_NAME = "agentChat.title.generate";
const TITLE_OWNER_PREFIX = "workbench-agent-chat-title";
const TITLE_COLLECT_TIMEOUT_SECONDS = 2;

async function maybeStartConversationTitleGeneration({ handlers, conversation, message, turnId, traceContext } = {}) {
  if (!handlers?.agentConversationStore?.updateTitleState) return null;
  if (!handlers.threadPool?.ensureRoleReady || !handlers.threadPool?.acquireLease || !handlers.appServer?.startTurnWithInputs) return null;
  if (!conversation?.conversationId || !isFirstUserTurn(conversation)) return null;
  if (isTitleFinal(conversation.titleState)) return null;

  const firstSentence = extractFirstSentence(message);
  if (!firstSentence) return null;
  const stageTraceContext = nextStage(traceContext);
  const inputSummary = buildTitleInputSummary({ conversation, turnId, firstSentence });
  const logger = handlers.logger;
  const artifactId = `artifact_${randomUUID()}`;
  const parentArtifactId = turnId ?? null;
  let lease = null;
  let titleState = null;

  try {
    await logger?.writeStageLog?.({
      traceContext: stageTraceContext,
      stageName: TITLE_STAGE_NAME,
      event: "stage.start",
      artifactId,
      parentArtifactId,
      inputSummary,
    });

    const readiness = await handlers.threadPool.ensureRoleReady(TITLE_ROLE);
    if (!readiness?.ok) throw titleError(readiness?.error ?? "title_role_unavailable", readiness?.message ?? "标题生成 role 暂不可用");

    const ownerId = `${TITLE_OWNER_PREFIX}-${stageTraceContext.runId}`;
    lease = await handlers.threadPool.acquireLease({ role: TITLE_ROLE, ownerId });
    const threadId = lease?.thread_id ?? lease?.threadId ?? null;
    const leaseId = lease?.lease_id ?? lease?.leaseId ?? null;
    if (lease?.ok === false || !threadId || !leaseId) throw titleError(lease?.error ?? lease?.code ?? "title_lease_unavailable", lease?.message ?? "标题生成 lease 不可用");

    const roleProfile = await loadRoleProfileByRole(TITLE_ROLE);
    const prompt = renderTurnTemplate(roleProfile, "generate", {
      inputSummaryJson: JSON.stringify(inputSummary, null, 2),
      firstSentence,
    });
    const result = await handlers.appServer.startTurnWithInputs({
      workspaceRoot: readiness.status?.workspaceRoot ?? conversation.workspaceRoot ?? handlers.rootDir,
      threadId,
      inputs: buildTextInputs(prompt.text),
      skillPath: readiness.status?.skillPath ?? roleProfile.skillPath ?? null,
      timeoutSeconds: 30,
    });
    const titleTurnId = result?.turnId ?? result?.turn?.id ?? null;
    if (result?.ok === false || !titleTurnId) throw titleError(result?.error ?? result?.code ?? "title_turn_start_failed", result?.message ?? "标题生成 turn 启动失败");

    titleState = {
      status: "generating",
      source: "first_user_message",
      role: TITLE_ROLE,
      sourceTurnId: turnId ?? null,
      titleThreadId: threadId,
      titleTurnId,
      leaseId,
      ownerId,
      workspaceRoot: readiness.status?.workspaceRoot ?? conversation.workspaceRoot ?? handlers.rootDir,
      firstSentencePreview: safePreview(firstSentence, 80),
      firstSentenceChars: firstSentence.length,
      promptTemplateVersion: prompt.promptTemplateVersion,
      generatedAt: null,
      errorSummary: null,
      traceId: stageTraceContext.traceId,
      runId: stageTraceContext.runId,
      stageId: stageTraceContext.stageId,
    };
    const updated = await handlers.agentConversationStore.updateTitleState({
      conversationId: conversation.conversationId,
      titleState,
      traceId: stageTraceContext.traceId,
      runId: stageTraceContext.runId,
      stageId: stageTraceContext.stageId,
    });
    await logger?.writeStageLog?.({
      traceContext: stageTraceContext,
      stageName: TITLE_STAGE_NAME,
      event: "stage.end",
      artifactId,
      parentArtifactId,
      outputSummary: { status: "generating", titleTurnId },
    });
    return { ok: true, status: "generating", conversation: updated, titleState };
  } catch (error) {
    if (lease?.lease_id || lease?.leaseId) {
      await handlers.threadPool?.releaseLease?.({
        leaseId: lease.lease_id ?? lease.leaseId,
        ownerId: `${TITLE_OWNER_PREFIX}-${stageTraceContext.runId}`,
      }).catch(() => null);
    }
    const errorSummary = safeTitleError(error);
    const failedState = {
      ...(titleState ?? {}),
      status: "failed",
      source: "first_user_message",
      role: TITLE_ROLE,
      sourceTurnId: turnId ?? null,
      errorSummary,
      traceId: stageTraceContext.traceId,
      runId: stageTraceContext.runId,
      stageId: stageTraceContext.stageId,
    };
    const updated = await handlers.agentConversationStore.updateTitleState({
      conversationId: conversation.conversationId,
      titleState: failedState,
      traceId: stageTraceContext.traceId,
      runId: stageTraceContext.runId,
      stageId: stageTraceContext.stageId,
    }).catch(() => null);
    await logger?.writeStageLog?.({
      traceContext: stageTraceContext,
      stageName: TITLE_STAGE_NAME,
      event: "stage.fail",
      artifactId,
      parentArtifactId,
      errorSummary,
    });
    return { ok: false, status: "failed", conversation: updated, titleState: failedState, errorSummary };
  }
}

async function maybeCollectConversationTitle({ handlers, conversation, conversationId, traceContext } = {}) {
  const current = conversation ?? await handlers?.agentConversationStore?.get?.(conversationId).catch(() => null);
  const state = current?.titleState;
  if (!current?.conversationId || state?.status !== "generating") return current ?? null;
  if (!state.titleThreadId || !state.titleTurnId) return current;
  const stageTraceContext = nextStage(traceContext);
  const logger = handlers.logger;
  const inputSummary = {
    conversationId: current.conversationId,
    titleThreadId: state.titleThreadId,
    titleTurnId: state.titleTurnId,
    sourceTurnId: state.sourceTurnId ?? null,
  };

  try {
    await logger?.writeStageLog?.({
      traceContext: stageTraceContext,
      stageName: TITLE_STAGE_NAME,
      event: "stage.start",
      parentArtifactId: state.sourceTurnId ?? null,
      inputSummary,
    });
    const result = await handlers.appServer.collectTurnResult({
      workspaceRoot: state.workspaceRoot ?? current.workspaceRoot ?? handlers.rootDir,
      threadId: state.titleThreadId,
      turnId: state.titleTurnId,
      timeoutSeconds: TITLE_COLLECT_TIMEOUT_SECONDS,
    });
    if (!isTerminalStatus(result?.status)) {
      await logger?.writeStageLog?.({
        traceContext: stageTraceContext,
        stageName: TITLE_STAGE_NAME,
        event: "stage.end",
        parentArtifactId: state.sourceTurnId ?? null,
        outputSummary: { status: result?.status ?? "running" },
      });
      return current;
    }
    if (!isSuccessfulStatus(result?.status)) {
      throw titleError(result?.error ?? result?.code ?? "title_turn_failed", result?.message ?? "标题生成 turn 未成功完成");
    }
    const fallbackTitle = fallbackTitleFromFirstSentence(state.firstSentencePreview);
    const parsed = parseTitleResult(result.finalMessage ?? result.activeThreadMessage, fallbackTitle);
    const title = parsed.title || fallbackTitle;
    const titleState = {
      ...state,
      status: "completed",
      generatedAt: new Date().toISOString(),
      confidence: parsed.confidence,
      rawPreview: parsed.rawPreview,
      errorSummary: null,
      traceId: stageTraceContext.traceId,
      runId: stageTraceContext.runId,
      stageId: stageTraceContext.stageId,
    };
    const updated = await handlers.agentConversationStore.updateTitle({
      conversationId: current.conversationId,
      title,
      titleState,
      traceId: stageTraceContext.traceId,
      runId: stageTraceContext.runId,
      stageId: stageTraceContext.stageId,
    });
    await releaseTitleLease(handlers, titleState);
    await logger?.writeStageLog?.({
      traceContext: stageTraceContext,
      stageName: TITLE_STAGE_NAME,
      event: "stage.end",
      parentArtifactId: state.sourceTurnId ?? null,
      outputSummary: { status: "completed", titlePreview: safePreview(title, 40) },
    });
    return updated;
  } catch (error) {
    if (isNonTerminalCollectError(error)) {
      await logger?.writeStageLog?.({
        traceContext: stageTraceContext,
        stageName: TITLE_STAGE_NAME,
        event: "stage.end",
        parentArtifactId: state.sourceTurnId ?? null,
        outputSummary: { status: "pending", warning: safePreview(error instanceof Error ? error.message : "标题生成仍在进行", 160) },
      });
      return current;
    }
    const errorSummary = safeTitleError(error);
    const failedState = {
      ...state,
      status: "failed",
      errorSummary,
      traceId: stageTraceContext.traceId,
      runId: stageTraceContext.runId,
      stageId: stageTraceContext.stageId,
    };
    const updated = await handlers.agentConversationStore.updateTitleState({
      conversationId: current.conversationId,
      titleState: failedState,
      traceId: stageTraceContext.traceId,
      runId: stageTraceContext.runId,
      stageId: stageTraceContext.stageId,
    }).catch(() => current);
    await releaseTitleLease(handlers, failedState);
    await logger?.writeStageLog?.({
      traceContext: stageTraceContext,
      stageName: TITLE_STAGE_NAME,
      event: "stage.fail",
      parentArtifactId: state.sourceTurnId ?? null,
      errorSummary,
    });
    return updated;
  }
}

function isFirstUserTurn(conversation) {
  const messages = Array.isArray(conversation?.messages) ? conversation.messages : [];
  return messages.filter((message) => message?.role === "user").length === 1;
}

function isTitleFinal(state) {
  return ["generating", "completed"].includes(String(state?.status ?? ""));
}

async function releaseTitleLease(handlers, state) {
  if (!state?.leaseId || !state?.ownerId || !handlers.threadPool?.releaseLease) return null;
  return handlers.threadPool.releaseLease({ leaseId: state.leaseId, ownerId: state.ownerId }).catch(() => null);
}

function buildTextInputs(message) {
  return [{ type: "text", text: message, text_elements: [] }];
}

function isTerminalStatus(status) {
  return ["completed", "complete", "failed", "cancelled", "canceled"].includes(String(status ?? "").toLowerCase());
}

function isSuccessfulStatus(status) {
  return ["completed", "complete"].includes(String(status ?? "").toLowerCase());
}

function isNonTerminalCollectError(error) {
  const text = `${error?.code ?? ""} ${error?.message ?? ""}`.toLowerCase();
  return text.includes("timeout") || text.includes("running") || text.includes("not completed");
}

function titleError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.retryable = true;
  return error;
}

function safeTitleError(error) {
  return {
    code: error?.code ?? "conversation_title_failed",
    message: safePreview(error instanceof Error ? error.message : "标题生成失败", 200),
    retryable: error?.retryable !== false,
    stageName: TITLE_STAGE_NAME,
  };
}

module.exports = {
  TITLE_ROLE,
  TITLE_STAGE_NAME,
  maybeCollectConversationTitle,
  maybeStartConversationTitleGeneration,
};
