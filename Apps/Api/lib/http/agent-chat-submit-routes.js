const path = require("path");
const { sendJson } = require("./utils");
const { readJsonBody } = require("../observability/ui-debug-events");
const { buildAgentChatActionProjection } = require("../agent-chat/actions");
const { loadRoleProfileByRole, renderTurnTemplate } = require("../gateways/threadpool/role-profile-loader");
const { normalizeTurnStatus } = require("../active-turns/status");
const {
  badRequestError,
  normalizeMessage,
  normalizeRevision,
  normalizeText,
  nullableNumber,
  runAgentChatStage,
  safePreview,
  withConversationLock,
} = require("./agent-chat-route-core");
const {
  DEFAULT_TURN_TIMEOUT_SECONDS,
  assertAgentChatTurnStarted,
  assertExpectedThreadResult,
  attachAgentChatProjection,
  buildTextInputs,
  registerAgentChatActiveTurn,
} = require("./agent-chat-route-shared");

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
        assertAgentChatTurnStarted(result);
        assertExpectedThreadResult(result, threadId, "agent_chat_turn_start_thread_mismatch");
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
        await registerAgentChatActiveTurn(handlers, {
          payload,
          conversation,
          message,
          traceContext,
          stageName: "agentChat.turn.submit",
          sourceTurnId: null,
        });
        attachAgentChatProjection(payload, conversation, payload.status);
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
        if (!conversation) {
          const error = new Error("未找到 Agent 会话");
          error.statusCode = 404;
          error.code = "agent_chat_conversation_not_found";
          throw error;
        }
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
        assertAgentChatTurnStarted(result);
        assertExpectedThreadResult(result, threadId, "agent_chat_turn_start_thread_mismatch");
        const turnId = result.turnId ?? result.turn?.id ?? null;
        const recorded = await handlers.agentConversationStore?.recordUserTurn?.({
          conversationId,
          turnId,
          text: replacementSummary,
          traceId: traceContext.traceId,
          runId: traceContext.runId,
          stageId: traceContext.stageId,
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
          },
          conversation: recorded,
          message: replacementSummary,
          traceContext,
          stageName: "agentChat.manualReplacement.submit",
          sourceTurnId: conversation.latestTurnId ?? null,
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
          userTurnText: replacementSummary,
          promptTemplateId: prompt.promptTemplateId,
          promptTemplateVersion: prompt.promptTemplateVersion,
          promptTemplateHash: prompt.promptTemplateHash,
          traceId: traceContext.traceId,
          runId: traceContext.runId,
          stageId: traceContext.stageId,
          actionProjection: buildAgentChatActionProjection({
            conversation: recorded,
            threadId: result.threadId ?? threadId,
            turnId,
            status: result.status ?? "submitted",
            retryable: true,
          }),
          latestTurnId: recorded?.latestTurnId ?? turnId,
          threadStopped: Boolean(recorded?.threadStopped),
          retryable: true,
          activeTurnStatus: normalizeTurnStatus(result.status ?? "submitted"),
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

module.exports = {
  handleAgentChatManualReplacementSubmit,
  handleAgentChatTurnSubmit,
};
