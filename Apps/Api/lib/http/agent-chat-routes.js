const { createTraceContext } = require("../../../../Core/Workspace/sample-video-contracts");
const { createTraceIds } = require("../../../../Infrastructure/Observability/trace");
const { sendJson } = require("./utils");
const { readJsonBody } = require("../observability/ui-debug-events");
const { buildAgentActivityFromTurnResult, summarizeAgentTurnTimeline, summarizeAgentTurnTimelineFromItems } = require("../observability/agent-turn-timeline");
const { summarizeThreadConversation } = require("../observability/thread-conversation");

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
      const activeText = normalizeActiveMessage(payload.activeThreadMessage);
      await handlers.agentConversationStore?.recordAssistantTurn?.({
        conversationId,
        turnId: payload.turnId,
        text: payload.finalMessage || activeText || (isTerminalStatus(payload.status) ? "" : "生成中"),
        status: payload.status,
        traceId: payload.traceId,
        runId: payload.runId,
        stageId: payload.stageId,
      });
      return payload;
    },
    summarizeOutput: (result) => ({
      threadId: result.threadId,
      turnId: result.turnId,
      status: result.status,
      finalMessageChars: result.finalMessage ? String(result.finalMessage).length : 0,
      activityStatus: result.activity?.status ?? null,
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

function buildTextInputs(message) {
  return [{ type: "text", text: message, text_elements: [] }];
}

function summarizeCompactUsage(value) {
  const usage = value && typeof value === "object" ? value : null;
  if (!usage) return null;
  return {
    inputTokens: nullableNumber(usage.inputTokens),
    modelContextWindow: nullableNumber(usage.modelContextWindow),
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
  handleAgentChatThreadCompact,
  handleAgentChatThreadStart,
  handleAgentChatTurnCollect,
  handleAgentChatTurnSubmit,
  handleAgentChatTurnTimeline,
};
