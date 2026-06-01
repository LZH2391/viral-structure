const path = require("path");
const { createTraceContext } = require("../../../../Core/Workspace/sample-video-contracts");
const { createTraceIds } = require("../../../../Infrastructure/Observability/trace");
const { sendJson } = require("./utils");
const { readJsonBody } = require("../observability/ui-debug-events");
const { buildAgentActivityFromTurnResult, summarizeAgentTurnTimeline, summarizeAgentTurnTimelineFromItems } = require("../observability/agent-turn-timeline");
const { summarizeThreadConversation } = require("../observability/thread-conversation");
const { buildAgentChatActionProjection, findReplayTask, latestAssistantStatus } = require("../agent-chat/actions");
const { maybeAutoTransformRestructureResult } = require("../agent-chat/restructure-auto-display");
const { loadRoleProfileByRole, renderTurnTemplate } = require("../gateways/threadpool/role-profile-loader");

const OWNER_PREFIX = "workbench-agent-chat";
const DEFAULT_TURN_TIMEOUT_SECONDS = 180;
const conversationLocks = new Map();

async function handleAgentChatThreadStart(req, res, handlers = {}) {
  const body = await (handlers.readJsonBodyImpl ?? readJsonBody)(req).catch(() => ({}));
  const source = normalizeSource(body.source);
  return runAgentChatStage(res, handlers, {
    stageName: source === "threadpool-role" ? "agentChat.threadPool.fork" : "agentChat.thread.start",
    inputSummary: {
      source,
      role: body.role ?? null,
      mode: body.mode ?? null,
      conversationId: normalizeText(body.conversationId),
      expectedRevision: normalizeRevision(body.expectedRevision),
    },
    action: async ({ traceContext }) => {
      if (source === "threadpool-role") {
        const conversationId = normalizeText(body.conversationId);
        return withConversationLock(conversationId, async () => {
          if (conversationId) {
            const error = new Error("ThreadPool 会话和 thread 一一对应，不能给已有会话重新绑定新 thread");
            error.statusCode = 409;
            error.code = "agent_chat_thread_rebind_forbidden";
            error.retryable = false;
            throw error;
          }
          const session = await startThreadPoolRoleSession({ body, handlers, traceContext });
          return persistRestructureSession(session, body, handlers);
        });
      }
      const result = await handlers.appServer.startThread({
        workspaceRoot: handlers.rootDir,
        timeoutSeconds: DEFAULT_TURN_TIMEOUT_SECONDS,
      });
      return {
        ok: true,
        source: "direct",
        status: result.status ?? "created",
        threadId: result.threadId ?? result.thread?.id ?? null,
        traceId: traceContext.traceId,
        runId: traceContext.runId,
        stageId: traceContext.stageId,
        workspaceRoot: handlers.rootDir,
      };
    },
    summarizeOutput: (result) => ({
      source: result.source,
      role: result.role ?? null,
      threadId: result.threadId ?? null,
      parentThreadId: result.parentThreadId ?? null,
      leaseId: result.leaseId ?? null,
      status: result.status ?? null,
    }),
    successStatus: 201,
  });
}

async function handleAgentChatTurnSubmit(req, res, threadId, handlers = {}) {
  const body = await (handlers.readJsonBodyImpl ?? readJsonBody)(req);
  const message = normalizeMessage(body.message ?? body.text);
  if (!message) {
    return sendJson(res, 400, {
      error: "agent_chat_message_required",
      code: "agent_chat_message_required",
      message: "消息不能为空",
    });
  }
  return runAgentChatStage(res, handlers, {
    stageName: "agentChat.turn.submit",
    inputSummary: {
      threadId,
      source: body.source ?? null,
      role: body.role ?? null,
      leaseId: body.leaseId ?? null,
      conversationId: normalizeText(body.conversationId),
      expectedRevision: normalizeRevision(body.expectedRevision),
      messageChars: message.length,
      messagePreview: safePreview(message, 80),
    },
    action: async ({ traceContext }) => {
      const conversationId = normalizeText(body.conversationId);
      return withConversationLock(conversationId, async () => {
        const workspaceRoot = normalizeText(body.workspaceRoot) || handlers.rootDir;
        const expectedRevision = normalizeRevision(body.expectedRevision);
        if (conversationId) {
          const conversation = await handlers.agentConversationStore?.assertActive?.(conversationId, { expectedRevision });
          if (!conversation) {
            const error = new Error("未找到 Agent 会话");
            error.statusCode = 404;
            error.code = "agent_chat_conversation_not_found";
            throw error;
          }
        }
        const result = await handlers.appServer.startTurnWithInputs({
          workspaceRoot,
          threadId,
          inputs: buildTextInputs(message),
          skillPath: normalizeText(body.skillPath),
          timeoutSeconds: DEFAULT_TURN_TIMEOUT_SECONDS,
        });
        const payload = {
          ok: true,
          source: body.source ?? "direct",
          role: body.role ?? null,
          leaseId: body.leaseId ?? null,
          parentThreadId: body.parentThreadId ?? null,
          conversationId,
          workspaceRoot,
          threadId: result.threadId ?? threadId,
          turnId: result.turnId ?? result.turn?.id ?? null,
          status: result.status ?? "submitted",
          traceId: traceContext.traceId,
          runId: traceContext.runId,
          stageId: traceContext.stageId,
        };
        const conversation = await handlers.agentConversationStore?.recordUserTurn?.({
          conversationId: payload.conversationId,
          turnId: payload.turnId,
          text: message,
          traceId: payload.traceId,
          runId: payload.runId,
          stageId: payload.stageId,
        });
        if (conversation?.revision) payload.conversationRevision = conversation.revision;
        return payload;
      });
    },
    summarizeOutput: (result) => ({
      source: result.source,
      role: result.role,
      threadId: result.threadId,
      turnId: result.turnId,
      status: result.status,
    }),
    successStatus: 202,
  });
}

async function handleAgentChatManualReplacementSubmit(req, res, threadId, handlers = {}) {
  const body = await (handlers.readJsonBodyImpl ?? readJsonBody)(req).catch(() => ({}));
  const conversationId = normalizeText(body.conversationId);
  const replacements = normalizeManualReplacements(body.replacements);
  const sourceRestructureFinalPath = normalizeWorkspaceRelativePath(body.sourceRestructureFinalPath, handlers.rootDir);
  const sourceDisplayJsonPath = normalizeWorkspaceRelativePath(body.sourceDisplayJsonPath, handlers.rootDir);
  return runAgentChatStage(res, handlers, {
    stageName: "agentChat.manualReplacement.submit",
    inputSummary: {
      threadId,
      conversationId,
      replacementCount: replacements.length,
      sourceRestructureFinalPath,
      sourceDisplayJsonPath,
    },
    action: async ({ traceContext }) => {
      if (!conversationId) throw badRequestError("agent_chat_conversation_required", "manual replacement 需要 conversationId");
      return withConversationLock(conversationId, async () => {
        const conversation = await handlers.agentConversationStore?.assertActive?.(conversationId, { expectedRevision: normalizeRevision(body.expectedRevision) });
        if (!conversation) throw notFoundError("agent_chat_conversation_not_found", "未找到 Agent 会话");
        if (conversation.role !== "function-slot-restructure") throw badRequestError("agent_chat_manual_replacement_role_invalid", "manual replacement 只能提交给 function-slot-restructure 会话");
        if (conversation.threadId && conversation.threadId !== threadId) throw badRequestError("agent_chat_manual_replacement_thread_mismatch", "manual replacement threadId 与会话不一致");
        const workspaceRoot = normalizeText(body.workspaceRoot) || conversation.workspaceRoot || handlers.rootDir;
        const roleProfile = await loadRoleProfileByRole("function-slot-restructure");
        const replacementSummary = buildManualReplacementSummary(replacements);
        const prompt = renderTurnTemplate(roleProfile, "manualReplacement", {
          sourceRestructureFinalPath,
          sourceDisplayJsonPath,
          displayFingerprintJson: JSON.stringify(normalizeDisplayFingerprint(body.displayFingerprint), null, 2),
          replacementsJson: JSON.stringify(replacements, null, 2),
          replacementSummary,
          userInstruction: "用户手动替换了上述 Slot/Atom。请根据替换后的结构重新设计；如果替换破坏链路逻辑、素材能力、binding rule 或证明路径，必须先说明影响并请求用户确认，不要直接重写最终方案。",
        });
        const result = await handlers.appServer.startTurnWithInputs({
          workspaceRoot,
          threadId,
          inputs: buildTextInputs(prompt.text),
          skillPath: conversation.skillPath || roleProfile.skillPath || normalizeText(body.skillPath),
          timeoutSeconds: DEFAULT_TURN_TIMEOUT_SECONDS,
        });
        const turnId = result.turnId ?? result.turn?.id ?? null;
        const recorded = await handlers.agentConversationStore?.recordUserTurn?.({
          conversationId,
          turnId,
          text: replacementSummary,
          traceId: traceContext.traceId,
          runId: traceContext.runId,
          stageId: traceContext.stageId,
        }) ?? conversation;
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
          userTurnText: replacementSummary,
          promptTemplateId: prompt.promptTemplateId,
          promptTemplateVersion: prompt.promptTemplateVersion,
          promptTemplateHash: prompt.promptTemplateHash,
          traceId: traceContext.traceId,
          runId: traceContext.runId,
          stageId: traceContext.stageId,
        };
      });
    },
    summarizeOutput: (result) => ({
      role: result.role,
      threadId: result.threadId,
      turnId: result.turnId,
      status: result.status,
      conversationRevision: result.conversationRevision ?? null,
      promptTemplateVersion: result.promptTemplateVersion,
    }),
    successStatus: 202,
  });
}

async function handleAgentChatTurnStop(req, res, threadId, turnId, handlers = {}) {
  const body = await (handlers.readJsonBodyImpl ?? readJsonBody)(req).catch(() => ({}));
  return runAgentChatStage(res, handlers, {
    stageName: "agentChat.turn.stop",
    inputSummary: {
      threadId,
      turnId,
      conversationId: normalizeText(body.conversationId),
      expectedRevision: normalizeRevision(body.expectedRevision),
      reason: safePreview(body.reason, 120),
    },
    action: async ({ traceContext }) => {
      const conversationId = normalizeText(body.conversationId);
      return withConversationLock(conversationId, async () => {
        const workspaceRoot = normalizeText(body.workspaceRoot) || handlers.rootDir;
        let conversation = conversationId ? await handlers.agentConversationStore?.assertActive?.(conversationId, { expectedRevision: normalizeRevision(body.expectedRevision) }) : null;
        if (conversationId && !conversation) throw notFoundError("agent_chat_conversation_not_found", "未找到 Agent 会话");
        const cancelled = await cancelTurnIfAvailable({ handlers, workspaceRoot, threadId, turnId });
        conversation = await handlers.agentConversationStore?.recordTurnStopped?.({
          conversationId,
          turnId,
          text: normalizeText(body.reason) ? `已停止当前 turn：${normalizeText(body.reason)}` : "已停止当前 turn",
          traceId: traceContext.traceId,
          runId: traceContext.runId,
          stageId: traceContext.stageId,
        }) ?? conversation;
        return {
          ok: true,
          action: "stop_turn",
          threadId,
          turnId,
          status: cancelled.status ?? "canceled",
          conversationRevision: conversation?.revision ?? null,
          actionProjection: buildAgentChatActionProjection({
            conversation,
            threadId,
            turnId,
            status: "canceled",
            retryable: true,
          }),
          traceId: traceContext.traceId,
          runId: traceContext.runId,
          stageId: traceContext.stageId,
        };
      });
    },
    summarizeOutput: (result) => ({
      action: result.action,
      threadId: result.threadId,
      turnId: result.turnId,
      status: result.status,
      conversationRevision: result.conversationRevision,
      availableActions: result.actionProjection.availableActions,
    }),
    successStatus: 200,
  });
}

async function handleAgentChatThreadStop(req, res, threadId, handlers = {}) {
  const body = await (handlers.readJsonBodyImpl ?? readJsonBody)(req).catch(() => ({}));
  return runAgentChatStage(res, handlers, {
    stageName: "agentChat.thread.stop",
    inputSummary: {
      threadId,
      activeTurnId: normalizeText(body.activeTurnId ?? body.turnId),
      conversationId: normalizeText(body.conversationId),
      source: normalizeSource(body.source),
      leaseId: normalizeText(body.leaseId),
      discardThread: Boolean(body.discardThread),
      archiveConversation: Boolean(body.archiveConversation),
      reason: safePreview(body.reason, 120),
    },
    action: async ({ traceContext }) => {
      const conversationId = normalizeText(body.conversationId);
      return withConversationLock(conversationId, async () => {
        const workspaceRoot = normalizeText(body.workspaceRoot) || handlers.rootDir;
        let conversation = conversationId ? await handlers.agentConversationStore?.assertActive?.(conversationId, { expectedRevision: normalizeRevision(body.expectedRevision) }) : null;
        if (conversationId && !conversation) throw notFoundError("agent_chat_conversation_not_found", "未找到 Agent 会话");
        const activeTurnId = normalizeText(body.activeTurnId ?? body.turnId ?? conversation?.latestTurnId);
        const turnStop = activeTurnId ? await cancelTurnIfAvailable({ handlers, workspaceRoot, threadId, turnId: activeTurnId }) : null;
        let leaseRelease = null;
        let threadDiscard = null;
        if (normalizeSource(body.source ?? conversation?.source) === "threadpool-role") {
          const leaseId = normalizeText(body.leaseId ?? conversation?.leaseId);
          const ownerId = normalizeText(body.ownerId ?? conversation?.ownerId) || OWNER_PREFIX;
          if (leaseId && typeof handlers.threadPool?.releaseLease === "function") {
            leaseRelease = await handlers.threadPool.releaseLease({ leaseId, ownerId }).catch((error) => safeThreadPoolError(error));
          }
          if (body.discardThread && typeof handlers.threadPool?.discardThread === "function") {
            threadDiscard = await handlers.threadPool.discardThread({
              threadId,
              reason: normalizeText(body.reason) || "agent-chat-thread-stopped",
            }).catch((error) => safeThreadPoolError(error));
          }
        }
        conversation = await handlers.agentConversationStore?.stopThread?.({
          conversationId,
          reason: normalizeText(body.reason),
          traceId: traceContext.traceId,
          runId: traceContext.runId,
          stageId: traceContext.stageId,
        }) ?? conversation;
        if (body.archiveConversation && conversationId) {
          conversation = await handlers.agentConversationStore?.archive?.(conversationId, { expectedRevision: null }) ?? conversation;
        }
        return {
          ok: true,
          action: "stop_thread",
          threadId,
          activeTurnId,
          turnStop,
          leaseRelease,
          threadDiscard,
          conversationStatus: conversation?.status ?? null,
          conversationRevision: conversation?.revision ?? null,
          actionProjection: buildAgentChatActionProjection({
            conversation,
            threadId,
            turnId: activeTurnId,
            status: turnStop?.status ?? latestAssistantStatus(conversation, activeTurnId),
            retryable: true,
          }),
          traceId: traceContext.traceId,
          runId: traceContext.runId,
          stageId: traceContext.stageId,
        };
      });
    },
    summarizeOutput: (result) => ({
      action: result.action,
      threadId: result.threadId,
      activeTurnId: result.activeTurnId,
      turnStopStatus: result.turnStop?.status ?? null,
      leaseRelease: result.leaseRelease?.status ?? null,
      threadDiscard: result.threadDiscard?.status ?? null,
      conversationStatus: result.conversationStatus,
    }),
    successStatus: 200,
  });
}

async function handleAgentChatTurnRetry(req, res, threadId, turnId, handlers = {}) {
  const body = await (handlers.readJsonBodyImpl ?? readJsonBody)(req).catch(() => ({}));
  const mode = normalizeRetryMode(body.mode);
  return runAgentChatStage(res, handlers, {
    stageName: mode === "new_thread" ? "agentChat.thread.retry" : "agentChat.turn.retry",
    inputSummary: {
      threadId,
      turnId,
      mode,
      conversationId: normalizeText(body.conversationId),
      source: normalizeSource(body.source),
      role: normalizeText(body.role),
    },
    action: async ({ traceContext }) => {
      const conversationId = normalizeText(body.conversationId);
      if (!conversationId) throw badRequestError("agent_chat_conversation_required", "重试需要 conversationId 以读取可重放任务");
      return withConversationLock(conversationId, async () => {
        const conversation = await handlers.agentConversationStore?.assertActive?.(conversationId, { expectedRevision: normalizeRevision(body.expectedRevision) });
        if (!conversation) throw notFoundError("agent_chat_conversation_not_found", "未找到 Agent 会话");
        const replayTask = findReplayTask(conversation, turnId);
        if (!replayTask) throw badRequestError("agent_chat_replay_task_missing", "未找到可重放任务");
        const session = mode === "new_thread"
          ? await createRetryThreadSession({ body, conversation, handlers, traceContext })
          : {
              source: conversation.source ?? body.source ?? "direct",
              role: conversation.role ?? body.role ?? null,
              threadId,
              leaseId: conversation.leaseId ?? body.leaseId ?? null,
              parentThreadId: conversation.parentThreadId ?? body.parentThreadId ?? null,
              workspaceRoot: normalizeText(body.workspaceRoot) || conversation.workspaceRoot || handlers.rootDir,
              skillPath: normalizeText(body.skillPath) || conversation.skillPath || null,
            };
        let boundConversation = conversation;
        if (mode === "new_thread") {
          boundConversation = await handlers.agentConversationStore?.bindThread?.({
            conversationId,
            threadId: session.threadId,
            parentThreadId: session.parentThreadId,
            leaseId: session.leaseId,
            ownerId: session.ownerId,
            workspaceRoot: session.workspaceRoot,
            skillPath: session.skillPath,
            source: session.source,
            traceId: traceContext.traceId,
            runId: traceContext.runId,
            stageId: traceContext.stageId,
          }) ?? conversation;
        }
        const result = await handlers.appServer.startTurnWithInputs({
          workspaceRoot: session.workspaceRoot || handlers.rootDir,
          threadId: session.threadId,
          inputs: buildTextInputs(replayTask.text),
          skillPath: session.skillPath,
          timeoutSeconds: DEFAULT_TURN_TIMEOUT_SECONDS,
        });
        const retryTurnId = result.turnId ?? result.turn?.id ?? null;
        const recorded = await handlers.agentConversationStore?.recordUserTurn?.({
          conversationId,
          turnId: retryTurnId,
          text: replayTask.text,
          traceId: traceContext.traceId,
          runId: traceContext.runId,
          stageId: traceContext.stageId,
        }) ?? boundConversation;
        return {
          ok: true,
          action: mode === "new_thread" ? "retry_new_thread" : "retry_same_thread",
          sourceTurnId: replayTask.sourceTurnId,
          threadId: session.threadId,
          previousThreadId: threadId,
          turnId: retryTurnId,
          status: result.status ?? "submitted",
          conversationRevision: recorded?.revision ?? null,
          actionProjection: buildAgentChatActionProjection({
            conversation: recorded,
            threadId: session.threadId,
            turnId: retryTurnId,
            status: result.status ?? "submitted",
            retryable: true,
          }),
          traceId: traceContext.traceId,
          runId: traceContext.runId,
          stageId: traceContext.stageId,
        };
      });
    },
    summarizeOutput: (result) => ({
      action: result.action,
      sourceTurnId: result.sourceTurnId,
      previousThreadId: result.previousThreadId,
      threadId: result.threadId,
      turnId: result.turnId,
      status: result.status,
      conversationRevision: result.conversationRevision,
    }),
    successStatus: 202,
  });
}

async function handleAgentChatThreadCompact(req, res, threadId, handlers = {}) {
  const body = await (handlers.readJsonBodyImpl ?? readJsonBody)(req).catch(() => ({}));
  return runAgentChatStage(res, handlers, {
    stageName: "agentChat.context.compact",
    inputSummary: {
      threadId,
      conversationId: normalizeText(body.conversationId),
      workspaceRoot: normalizeText(body.workspaceRoot),
      contextUsage: summarizeCompactUsage(body.contextUsage),
    },
    action: async ({ traceContext }) => {
      if (typeof handlers.appServer?.compactThread !== "function") {
        const error = new Error("AppServer compact 能力不可用");
        error.statusCode = 503;
        error.code = "appserver_thread_compact_unavailable";
        throw error;
      }
      const workspaceRoot = normalizeText(body.workspaceRoot) || handlers.rootDir;
      const result = await handlers.appServer.compactThread({
        workspaceRoot,
        threadId,
        timeoutSeconds: DEFAULT_TURN_TIMEOUT_SECONDS,
      });
      const conversationId = normalizeText(body.conversationId);
      let conversation = null;
      if (conversationId) {
        conversation = await handlers.agentConversationStore?.recordSystemMessage?.({
          conversationId,
          text: "上下文已自动压缩",
          traceId: traceContext.traceId,
          runId: traceContext.runId,
          stageId: traceContext.stageId,
          expectedRevision: normalizeRevision(body.expectedRevision),
        });
        if (!conversation) {
          const error = new Error("未找到 Agent 会话");
          error.statusCode = 404;
          error.code = "agent_chat_conversation_not_found";
          throw error;
        }
      }
      return {
        ok: true,
        threadId: result.threadId ?? threadId,
        status: result.status ?? "started",
        compactStatus: result.status ?? "started",
        conversationRevision: conversation?.revision ?? null,
        traceId: traceContext.traceId,
        runId: traceContext.runId,
        stageId: traceContext.stageId,
      };
    },
    summarizeOutput: (result) => ({
      threadId: result.threadId,
      status: result.status,
      compactStatus: result.compactStatus,
      conversationRevision: result.conversationRevision ?? null,
    }),
    successStatus: 200,
  });
}

async function handleAgentChatTurnCollect(res, threadId, turnId, handlers = {}, url = null) {
  return runAgentChatStage(res, handlers, {
    stageName: "agentChat.turn.collect",
    inputSummary: { threadId, turnId },
    action: async ({ traceContext }) => {
      const workspaceRoot = url?.searchParams?.get("workspaceRoot") || handlers.rootDir;
      const result = await handlers.appServer.collectTurnResult({
        workspaceRoot,
        threadId,
        turnId,
        timeoutSeconds: DEFAULT_TURN_TIMEOUT_SECONDS,
      });
      const activity = buildAgentActivityFromTurnResult(result);
      const payload = {
        ok: true,
        threadId: result.threadId ?? threadId,
        turnId: result.turnId ?? turnId,
        status: result.status ?? "unknown",
        finalMessage: result.finalMessage ?? null,
        activeThreadMessage: result.activeThreadMessage ?? null,
        activity,
        traceId: traceContext.traceId,
        runId: traceContext.runId,
        stageId: traceContext.stageId,
      };
      const materializedDisplay = await maybeMaterializeRestructureDisplay({
        payload,
        handlers,
        traceContext,
        url,
      });
      if (materializedDisplay) payload.materializedDisplay = materializedDisplay;
      const conversationId = normalizeText(url?.searchParams?.get("conversationId"));
      const autoDisplayTransform = await maybeAutoTransformRestructureResult({
        payload,
        handlers,
        traceContext,
        conversationId,
        url,
      });
      if (autoDisplayTransform) payload.autoDisplayTransform = autoDisplayTransform;
      const activeText = normalizeActiveMessage(payload.activeThreadMessage);
      await handlers.agentConversationStore?.recordAssistantTurn?.({
        conversationId,
        turnId: payload.turnId,
        text: payload.finalMessage || activeText || (isTerminalStatus(payload.status) ? "" : "生成中"),
        status: payload.status,
        traceId: payload.traceId,
        runId: payload.runId,
        stageId: payload.stageId,
        slotAtomDisplay: payload.autoDisplayTransform?.slotAtomDisplay ?? null,
      });
      return payload;
    },
    summarizeOutput: (result) => ({
      threadId: result.threadId,
      turnId: result.turnId,
      status: result.status,
      finalMessageChars: result.finalMessage ? String(result.finalMessage).length : 0,
      activityStatus: result.activity?.status ?? null,
      autoDisplayStatus: result.autoDisplayTransform?.status ?? null,
    }),
    successStatus: 200,
  });
}

async function maybeMaterializeRestructureDisplay({ payload, handlers, traceContext, url }) {
  if (payload.status !== "completed") return null;
  if (!payload.finalMessage) return null;
  if (normalizeText(url?.searchParams?.get("role")) !== "function-slot-restructure-display-transformer") return null;
  const service = handlers.restructureDisplayOverlayService;
  if (!service?.materializeFromTurn) return null;
  return service.materializeFromTurn({
    finalMessage: payload.finalMessage,
    restructureFinalPath: normalizeText(url?.searchParams?.get("restructureFinalPath")),
    sourceTurnId: payload.turnId,
    parentArtifactId: normalizeText(url?.searchParams?.get("parentArtifactId")),
    confirmationId: normalizeText(url?.searchParams?.get("confirmationId")),
    traceContext,
  });
}

async function handleAgentChatConversationList(res, handlers = {}, url = null) {
  return runAgentChatStage(res, handlers, {
    stageName: "agentChat.conversation.list",
    inputSummary: {
      role: url?.searchParams?.get("role") ?? null,
      status: url?.searchParams?.get("status") ?? "active",
    },
    action: async ({ traceContext }) => ({
      ok: true,
      conversations: await handlers.agentConversationStore.list({
        role: normalizeText(url?.searchParams?.get("role")),
        status: normalizeText(url?.searchParams?.get("status")) || "active",
      }),
      traceId: traceContext.traceId,
      runId: traceContext.runId,
      stageId: traceContext.stageId,
    }),
    summarizeOutput: (result) => ({ count: result.conversations.length }),
    successStatus: 200,
  });
}

async function handleAgentChatConversationResume(res, conversationId, handlers = {}) {
  return runAgentChatStage(res, handlers, {
    stageName: "agentChat.conversation.resume",
    inputSummary: { conversationId },
    action: async ({ traceContext }) => {
      const conversation = await handlers.agentConversationStore.get(conversationId);
      if (!conversation || conversation.status === "archived") {
        const error = new Error("未找到 active Agent 会话");
        error.statusCode = 404;
        error.code = "agent_chat_conversation_not_found";
        throw error;
      }
      let refreshed = null;
      let refreshError = null;
      let deleted = false;
      if (conversation.threadId) {
        try {
          const thread = await handlers.appServer.readThread({ workspaceRoot: conversation.workspaceRoot || handlers.rootDir, threadId: conversation.threadId });
          refreshed = summarizeThreadConversation(thread.thread ?? {});
        } catch (error) {
          refreshError = {
            code: error?.code ?? "agent_chat_conversation_thread_unavailable",
            message: safePreview(error instanceof Error ? error.message : "会话线程暂不可读", 160),
          };
          await handlers.agentConversationStore.remove(conversationId);
          deleted = true;
        }
      }
      return {
        ok: true,
        conversation,
        refreshed,
        refreshError,
        deleted,
        traceId: traceContext.traceId,
        runId: traceContext.runId,
        stageId: traceContext.stageId,
      };
    },
    summarizeOutput: (result) => ({
      conversationId,
      threadId: result.conversation.threadId,
      refreshed: Boolean(result.refreshed),
      refreshError: result.refreshError,
    }),
    successStatus: 200,
  });
}

async function handleAgentChatConversationSystemMessage(req, res, conversationId, handlers = {}) {
  const body = await (handlers.readJsonBodyImpl ?? readJsonBody)(req).catch(() => ({}));
  const text = normalizeMessage(body.message ?? body.text);
  if (!text) {
    return sendJson(res, 400, {
      error: "agent_chat_system_message_required",
      code: "agent_chat_system_message_required",
      message: "系统消息不能为空",
    });
  }
  return runAgentChatStage(res, handlers, {
    stageName: "agentChat.conversation.systemMessage",
    inputSummary: { conversationId, messageChars: text.length, messagePreview: safePreview(text, 80) },
    action: async ({ traceContext }) => {
      const conversation = await withConversationLock(conversationId, () => handlers.agentConversationStore.recordSystemMessage({
          conversationId,
          text,
          traceId: traceContext.traceId,
          runId: traceContext.runId,
          stageId: traceContext.stageId,
          expectedRevision: normalizeRevision(body.expectedRevision),
        }),
      );
      if (!conversation) {
        const error = new Error("未找到 Agent 会话");
        error.statusCode = 404;
        error.code = "agent_chat_conversation_not_found";
        throw error;
      }
      return {
        ok: true,
        conversation,
        traceId: traceContext.traceId,
        runId: traceContext.runId,
        stageId: traceContext.stageId,
      };
    },
    summarizeOutput: (result) => ({ conversationId: result.conversation.conversationId, messageCount: result.conversation.messages?.length ?? 0 }),
    successStatus: 200,
  });
}

async function handleAgentChatConversationConfirm(req, res, conversationId, handlers = {}) {
  const body = await (handlers.readJsonBodyImpl ?? readJsonBody)(req).catch(() => ({}));
  return runAgentChatStage(res, handlers, {
    stageName: "agentChat.conversation.confirm",
    inputSummary: {
      conversationId,
      turnId: normalizeText(body.turnId),
      confirmationId: normalizeText(body.confirmationId),
      expectedRevision: normalizeRevision(body.expectedRevision),
      sourceRestructurePath: normalizeText(body.sourceRestructurePath),
      displayArtifactId: normalizeText(body.displayArtifact?.artifactId),
      storyboardArtifactId: normalizeText(body.storyboardArtifact?.artifactId),
    },
    action: async ({ traceContext }) => {
      const conversation = await withConversationLock(conversationId, () => handlers.agentConversationStore.confirmPlan({
          conversationId,
          turnId: normalizeText(body.turnId),
          confirmationId: normalizeText(body.confirmationId),
          note: normalizeText(body.note),
          sourceRestructurePath: normalizeText(body.sourceRestructurePath),
          displayArtifact: normalizeArtifactRef(body.displayArtifact),
          storyboardArtifact: normalizeArtifactRef(body.storyboardArtifact),
          traceId: traceContext.traceId,
          runId: traceContext.runId,
          stageId: traceContext.stageId,
          expectedRevision: normalizeRevision(body.expectedRevision),
        }),
      );
      if (!conversation) {
        const error = new Error("未找到 Agent 会话");
        error.statusCode = 404;
        error.code = "agent_chat_conversation_not_found";
        throw error;
      }
      return {
        ok: true,
        conversation,
        traceId: traceContext.traceId,
        runId: traceContext.runId,
        stageId: traceContext.stageId,
      };
    },
    summarizeOutput: (result) => ({
      conversationId: result.conversation.conversationId,
      confirmedStatus: result.conversation.confirmedPlan?.status ?? null,
      revision: result.conversation.revision ?? null,
    }),
    successStatus: 200,
  });
}

async function handleAgentChatConversationArchive(req, res, conversationId, handlers = {}) {
  const body = await (handlers.readJsonBodyImpl ?? readJsonBody)(req).catch(() => ({}));
  return runAgentChatStage(res, handlers, {
    stageName: "agentChat.conversation.archive",
    inputSummary: { conversationId, expectedRevision: normalizeRevision(body.expectedRevision) },
    action: async ({ traceContext }) => {
      const conversation = await withConversationLock(conversationId, () => handlers.agentConversationStore.archive(conversationId, {
          expectedRevision: normalizeRevision(body.expectedRevision),
        }),
      );
      if (!conversation) {
        const error = new Error("未找到 Agent 会话");
        error.statusCode = 404;
        error.code = "agent_chat_conversation_not_found";
        throw error;
      }
      let threadDiscard = null;
      if (conversation.role === "function-slot-restructure" && conversation.threadId && typeof handlers.threadPool?.discardThread === "function") {
        threadDiscard = await handlers.threadPool.discardThread({
          threadId: conversation.threadId,
          reason: "agent-chat-conversation-archived",
        }).catch((error) => ({
          ok: false,
          error: error?.code ?? "threadpool_discard_failed",
          message: safePreview(error instanceof Error ? error.message : "ThreadPool discard failed", 160),
        }));
      }
      return {
        ok: true,
        conversation,
        threadDiscard,
        traceId: traceContext.traceId,
        runId: traceContext.runId,
        stageId: traceContext.stageId,
      };
    },
    summarizeOutput: (result) => ({ conversationId: result.conversation.conversationId, status: result.conversation.status, threadDiscard: result.threadDiscard }),
    successStatus: 200,
  });
}

async function handleAgentChatTurnTimeline(res, threadId, turnId, handlers = {}, url = null) {
  return runAgentChatStage(res, handlers, {
    stageName: "agentChat.timeline.read",
    inputSummary: { threadId, turnId },
    action: async () => {
      const workspaceRoot = url?.searchParams?.get("workspaceRoot") || handlers.rootDir;
      const threadResult = await handlers.appServer.readThread({ workspaceRoot, threadId });
      const thread = threadResult.thread ?? {};
      const turn = findTurn(thread, turnId);
      let timeline = null;
      let source = "thread/read";
      let itemListFallback = null;
      if (typeof handlers.appServer.listTurnItems === "function") {
        try {
          const listed = await handlers.appServer.listTurnItems({ workspaceRoot, threadId, turnId, limit: 500, sortDirection: "asc" });
          if (Array.isArray(listed?.items) && listed.items.length > 0) {
            timeline = summarizeAgentTurnTimelineFromItems({ thread, turn, items: listed.items, turnId });
            source = "thread/turns/items/list";
          }
        } catch (error) {
          itemListFallback = {
            code: error?.code ?? "appserver_turn_items_list_failed",
            message: safePreview(error instanceof Error ? error.message : "turn item list unavailable", 160),
          };
        }
      }
      timeline = timeline ?? summarizeAgentTurnTimeline(thread, turnId);
      if (!timeline) {
        const error = new Error("未找到对应 turn");
        error.statusCode = 404;
        error.code = "agent_chat_turn_not_found";
        throw error;
      }
      return {
        ...timeline,
        source,
        itemListFallback,
      };
    },
    summarizeOutput: (result) => ({
      threadId: result.threadId,
      turnId: result.turnId,
      status: result.status,
      itemCount: result.items?.length ?? 0,
      source: result.source,
      itemListFallback: result.itemListFallback,
    }),
    successStatus: 200,
  });
}

async function handleAgentChatLeaseRelease(req, res, handlers = {}) {
  const body = await (handlers.readJsonBodyImpl ?? readJsonBody)(req);
  return runAgentChatStage(res, handlers, {
    stageName: "agentChat.threadPool.release",
    inputSummary: {
      leaseId: body.leaseId ?? body.lease_id ?? null,
      ownerId: body.ownerId ?? body.owner_id ?? null,
    },
    action: async ({ traceContext }) => {
      const ownerId = normalizeText(body.ownerId ?? body.owner_id) || OWNER_PREFIX;
      const leaseId = normalizeText(body.leaseId ?? body.lease_id);
      if (!leaseId) {
        const error = new Error("leaseId 不能为空");
        error.statusCode = 400;
        error.code = "agent_chat_lease_id_required";
        throw error;
      }
      let result;
      try {
        result = await handlers.threadPool.releaseLease({ leaseId, ownerId });
      } catch (error) {
        if (!isUnknownActiveLeaseError(error)) throw error;
        result = { ok: true, status: "already_released" };
      }
      const conversationId = normalizeText(body.conversationId ?? body.conversation_id);
      const deletedConversation = conversationId ? await handlers.agentConversationStore?.remove?.(conversationId) : null;
      return {
        ok: result.ok !== false,
        leaseId,
        ownerId,
        status: result.status ?? "released",
        conversationDeleted: Boolean(deletedConversation),
        traceId: traceContext.traceId,
        runId: traceContext.runId,
        stageId: traceContext.stageId,
      };
    },
    summarizeOutput: (result) => ({ leaseId: result.leaseId, ownerId: result.ownerId, status: result.status, conversationDeleted: result.conversationDeleted }),
    successStatus: 200,
  });
}

async function startThreadPoolRoleSession({ body, handlers, traceContext }) {
  const role = normalizeText(body.role);
  if (!role) {
    const error = new Error("role 不能为空");
    error.statusCode = 400;
    error.code = "agent_chat_role_required";
    throw error;
  }
  const ownerId = normalizeText(body.ownerId ?? body.owner_id) || `${OWNER_PREFIX}-${traceContext.runId}`;
  const readiness = await handlers.threadPool.ensureRoleReady(role);
  if (!readiness?.ok) {
    return {
      ok: false,
      source: "threadpool-role",
      role,
      status: "unavailable",
      error: readiness?.error ?? "threadpool_role_unavailable",
      message: readiness?.message ?? "ThreadPool role 暂不可用",
      retryable: readiness?.retryable ?? true,
      traceId: traceContext.traceId,
      runId: traceContext.runId,
      stageId: traceContext.stageId,
    };
  }
  const lease = await handlers.threadPool.acquireLease({ role, ownerId });
  const threadId = lease.thread_id ?? lease.threadId ?? null;
  return {
    ok: lease.ok !== false,
    source: "threadpool-role",
    role,
    ownerId,
    leaseId: lease.lease_id ?? lease.leaseId ?? null,
    threadId,
    parentThreadId: lease.parent_thread_id ?? lease.parentThreadId ?? readiness.status?.seedThreadId ?? null,
    workspaceRoot: readiness.status?.workspaceRoot ?? handlers.rootDir,
    skillPath: readiness.status?.skillPath ?? null,
    status: lease.status ?? "forked",
    traceId: traceContext.traceId,
    runId: traceContext.runId,
    stageId: traceContext.stageId,
  };
}

async function persistRestructureSession(session, body, handlers) {
  if (session?.role !== "function-slot-restructure" || session?.ok === false) return session;
  const conversation = await handlers.agentConversationStore?.createOrUpdateFromSession?.(session, {
    conversationId: normalizeText(body.conversationId),
    sampleVideoId: normalizeText(body.sampleVideoId),
    expectedRevision: normalizeRevision(body.expectedRevision),
  });
  return {
    ...session,
    conversationId: conversation?.conversationId ?? null,
    conversationStatus: conversation?.status ?? null,
    conversationRevision: conversation?.revision ?? null,
  };
}

async function runAgentChatStage(res, handlers, { stageName, inputSummary, action, summarizeOutput, successStatus }) {
  const traceContext = createTraceContext(createTraceIds());
  const startedAt = Date.now();
  const activeLogger = handlers.logger;
  await activeLogger.writeStageLog({
    traceContext,
    stageName,
    event: "stage.start",
    inputSummary,
  });
  try {
    const result = await action({ traceContext });
    await activeLogger.writeStageLog({
      traceContext,
      stageName,
      event: "stage.end",
      outputSummary: summarizeOutput(result),
      durationMs: Date.now() - startedAt,
    });
    return sendJson(res, result?.ok === false ? 503 : successStatus, result);
  } catch (error) {
    const safeError = {
      code: error?.code ?? "agent_chat_request_failed",
      message: safePreview(error instanceof Error ? error.message : "Agent chat 请求失败", 240),
      retryable: error?.statusCode ? error.statusCode >= 500 : true,
    };
    const snapshot = await activeLogger.writeDebugSnapshot({
      traceContext,
      stageName,
      reason: safeError.code,
      inputSummary,
      debugPayload: {
        message: safeError.message,
        code: safeError.code,
        detail: error?.debugPayload ? summarizeDebugPayload(error.debugPayload) : null,
      },
    });
    await activeLogger.writeStageLog({
      traceContext,
      stageName,
      event: "stage.fail",
      errorSummary: { ...safeError, debugSnapshotUri: snapshot.uri },
      durationMs: Date.now() - startedAt,
    });
    return sendJson(res, error?.statusCode ?? 503, {
      ok: false,
      error: safeError.code,
      code: safeError.code,
      message: safeError.message,
      retryable: safeError.retryable,
      traceId: traceContext.traceId,
      debugSnapshotUri: snapshot.uri,
      stageName,
    });
  }
}

function normalizeSource(value) {
  return String(value ?? "").trim() === "threadpool-role" ? "threadpool-role" : "direct";
}

function normalizeManualReplacements(value) {
  if (!Array.isArray(value) || !value.length) throw badRequestError("agent_chat_manual_replacement_required", "至少需要一个 Slot/Atom 替换项");
  return value.map((item, index) => {
    if (!item || typeof item !== "object") throw badRequestError("agent_chat_manual_replacement_invalid", `replacement[${index}] 格式不合法`);
    const type = normalizeText(item.type);
    if (type === "slot") {
      return {
        type: "slot",
        slotOrder: nullableNumber(item.slotOrder),
        fromSlotSubtypeId: requiredText(item.fromSlotSubtypeId, `replacement[${index}].fromSlotSubtypeId`),
        fromSlotLabel: normalizeText(item.fromSlotLabel),
        toSlotSubtypeId: requiredText(item.toSlotSubtypeId, `replacement[${index}].toSlotSubtypeId`),
        toSlotLabel: normalizeText(item.toSlotLabel),
        candidateId: requiredText(item.candidateId, `replacement[${index}].candidateId`),
        sourceSampleId: normalizeText(item.sourceSampleId),
        sourceArtifactId: normalizeText(item.sourceArtifactId),
        affectedAtomIds: normalizeStringList(item.affectedAtomIds),
      };
    }
    if (type === "atom") {
      const atomKind = normalizeText(item.atomKind);
      if (!["script", "rhythm", "packaging"].includes(atomKind)) throw badRequestError("agent_chat_manual_replacement_atom_kind_invalid", `replacement[${index}].atomKind 不合法`);
      return {
        type: "atom",
        atomKind,
        slotSubtypeId: requiredText(item.slotSubtypeId, `replacement[${index}].slotSubtypeId`),
        slotLabel: normalizeText(item.slotLabel),
        fromAtomId: requiredText(item.fromAtomId, `replacement[${index}].fromAtomId`),
        fromAtomLabel: normalizeText(item.fromAtomLabel),
        toAtomId: requiredText(item.toAtomId, `replacement[${index}].toAtomId`),
        toAtomLabel: normalizeText(item.toAtomLabel),
        candidateId: requiredText(item.candidateId, `replacement[${index}].candidateId`),
        sourceSampleId: normalizeText(item.sourceSampleId),
        sourceArtifactId: normalizeText(item.sourceArtifactId),
      };
    }
    throw badRequestError("agent_chat_manual_replacement_type_invalid", `replacement[${index}].type 只支持 slot 或 atom`);
  });
}

function buildManualReplacementSummary(replacements) {
  const lines = ["用户手动替换 Slot/Atom："];
  for (const item of replacements) {
    if (item.type === "slot") {
      lines.push(`- Slot ${item.slotOrder ?? ""} ${item.fromSlotLabel ?? item.fromSlotSubtypeId} -> ${item.toSlotLabel ?? item.toSlotSubtypeId}`);
    } else {
      lines.push(`- ${item.atomKind} Atom (${item.slotLabel ?? item.slotSubtypeId}) ${item.fromAtomLabel ?? item.fromAtomId} -> ${item.toAtomLabel ?? item.toAtomId}`);
    }
  }
  return lines.join("\n");
}

function normalizeDisplayFingerprint(value) {
  if (!value || typeof value !== "object") return null;
  return {
    path: normalizeText(value.path),
    size: nullableNumber(value.size),
    mtimeMs: nullableNumber(value.mtimeMs),
    sha256: normalizeText(value.sha256),
  };
}

function normalizeWorkspaceRelativePath(value, rootDir) {
  const text = requiredText(value, "path").replaceAll("\\", "/");
  const absolute = /^[A-Za-z]:\//.test(text) || text.startsWith("/");
  const root = path.resolve(rootDir).replaceAll("\\", "/");
  const resolved = (absolute ? path.resolve(text) : path.resolve(rootDir, text)).replaceAll("\\", "/");
  if (resolved !== root && !resolved.startsWith(`${root}/`)) throw badRequestError("agent_chat_manual_replacement_path_outside_workspace", "替换请求路径不能超出 workspace");
  return path.relative(rootDir, resolved).replaceAll("\\", "/");
}

function requiredText(value, fieldName) {
  const text = normalizeText(value);
  if (!text) throw badRequestError("agent_chat_manual_replacement_field_required", `${fieldName} 不能为空`);
  return text;
}

function normalizeStringList(value) {
  return Array.isArray(value) ? value.map(normalizeText).filter(Boolean) : [];
}

function normalizeMessage(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function normalizeText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function normalizeArtifactRef(value) {
  if (!value || typeof value !== "object") return null;
  return {
    artifactId: normalizeText(value.artifactId),
    traceId: normalizeText(value.traceId),
    runId: normalizeText(value.runId),
    stageId: normalizeText(value.stageId),
    status: normalizeText(value.status),
  };
}

function normalizeRevision(value) {
  if (value == null || value === "") return null;
  const revision = Number(value);
  return Number.isFinite(revision) && revision > 0 ? Math.floor(revision) : null;
}

function normalizeActiveMessage(value) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "text" in value) return String(value.text ?? "");
  return "";
}

function isTerminalStatus(status) {
  return ["completed", "complete", "failed", "cancelled", "canceled"].includes(String(status ?? "").toLowerCase());
}

function isUnknownActiveLeaseError(error) {
  const values = [
    error?.code,
    error?.message,
    error?.payload?.detail,
    error?.payload?.message,
    error?.payload?.error,
  ];
  return values.some((value) => String(value ?? "").includes("unknown active lease"));
}

async function cancelTurnIfAvailable({ handlers, workspaceRoot, threadId, turnId }) {
  if (!turnId) return { status: "not_requested" };
  if (typeof handlers.appServer?.cancelTurn !== "function") {
    const error = new Error("AppServer turn/cancel 能力不可用");
    error.statusCode = 503;
    error.code = "appserver_turn_cancel_unavailable";
    throw error;
  }
  const result = await handlers.appServer.cancelTurn({
    workspaceRoot,
    threadId,
    turnId,
    timeoutSeconds: 30,
  });
  return {
    ok: result?.ok !== false,
    threadId: result?.threadId ?? threadId,
    turnId: result?.turnId ?? turnId,
    status: normalizeText(result?.status) || "canceled",
  };
}

async function createRetryThreadSession({ body, conversation, handlers, traceContext }) {
  const source = normalizeSource(body.source ?? conversation.source);
  if (source === "threadpool-role") {
    const session = await startThreadPoolRoleSession({
      body: {
        ...body,
        source,
        role: normalizeText(body.role) || conversation.role,
      },
      handlers,
      traceContext,
    });
    if (session?.ok === false || !session.threadId) {
      const error = new Error(session?.message || "ThreadPool role 暂不可用");
      error.statusCode = 503;
      error.code = session?.error || "threadpool_role_unavailable";
      throw error;
    }
    return session;
  }
  const workspaceRoot = normalizeText(body.workspaceRoot) || conversation.workspaceRoot || handlers.rootDir;
  const result = await handlers.appServer.startThread({
    workspaceRoot,
    timeoutSeconds: DEFAULT_TURN_TIMEOUT_SECONDS,
  });
  return {
    ok: true,
    source: "direct",
    role: conversation.role ?? normalizeText(body.role),
    threadId: result.threadId ?? result.thread?.id ?? null,
    parentThreadId: conversation.threadId ?? null,
    leaseId: null,
    ownerId: null,
    workspaceRoot,
    skillPath: normalizeText(body.skillPath) || conversation.skillPath || null,
  };
}

function normalizeRetryMode(value) {
  return String(value ?? "").trim() === "new_thread" ? "new_thread" : "same_thread";
}

function safeThreadPoolError(error) {
  return {
    ok: false,
    error: error?.code ?? "threadpool_operation_failed",
    message: safePreview(error instanceof Error ? error.message : "ThreadPool 操作失败", 160),
  };
}

function badRequestError(code, message) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = code;
  error.retryable = false;
  return error;
}

function notFoundError(code, message) {
  const error = new Error(message);
  error.statusCode = 404;
  error.code = code;
  error.retryable = false;
  return error;
}

function buildTextInputs(message) {
  return [{ type: "text", text: message, text_elements: [] }];
}

function summarizeCompactUsage(value) {
  const usage = value && typeof value === "object" ? value : null;
  if (!usage) return null;
  return {
    inputTokens: nullableNumber(usage.inputTokens),
    modelContextWindow: nullablePositiveNumber(usage.modelContextWindow),
    contextThresholdTokens: nullableNumber(usage.contextThresholdTokens),
    contextUsageRatio: nullableNumber(usage.contextUsageRatio),
    contextUsageState: normalizeText(usage.contextUsageState),
  };
}

function findTurn(thread, turnId) {
  const turns = Array.isArray(thread?.turns) ? thread.turns : [];
  const target = String(turnId ?? "");
  return turns.find((turn) => String(turn?.id ?? turn?.turnId ?? "") === target) ?? null;
}

function safePreview(value, limit = 240) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length <= limit ? text : `${text.slice(0, limit)}...`;
}

function nullableNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nullablePositiveNumber(value) {
  const number = nullableNumber(value);
  return number != null && number > 0 ? number : null;
}

function summarizeDebugPayload(value) {
  if (!value || typeof value !== "object") return safePreview(value, 400);
  return {
    error: value.error ?? null,
    status: value.status ?? null,
    message: safePreview(value.message, 240),
    stderr: safePreview(value.stderr, 500),
    stdout: safePreview(value.stdout, 500),
    structured: value.structured ? safePreview(JSON.stringify(value.structured), 500) : null,
  };
}

async function withConversationLock(conversationId, action) {
  if (!conversationId) return action();
  const key = String(conversationId);
  const previous = conversationLocks.get(key) ?? Promise.resolve();
  let release;
  const current = new Promise((resolve) => {
    release = resolve;
  });
  conversationLocks.set(key, previous.then(() => current, () => current));
  await previous.catch(() => undefined);
  try {
    return await action();
  } finally {
    release();
    if (conversationLocks.get(key) === current) conversationLocks.delete(key);
  }
}

module.exports = {
  handleAgentChatConversationArchive,
  handleAgentChatConversationConfirm,
  handleAgentChatConversationList,
  handleAgentChatConversationResume,
  handleAgentChatConversationSystemMessage,
  handleAgentChatLeaseRelease,
  handleAgentChatManualReplacementSubmit,
  handleAgentChatThreadCompact,
  handleAgentChatThreadStart,
  handleAgentChatTurnCollect,
  handleAgentChatThreadStop,
  handleAgentChatTurnRetry,
  handleAgentChatTurnSubmit,
  handleAgentChatTurnStop,
  handleAgentChatTurnTimeline,
};
