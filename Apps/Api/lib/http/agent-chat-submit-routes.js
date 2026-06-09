const path = require("path");
const { sendJson } = require("./utils");
const { readJsonBody } = require("../observability/ui-debug-events");
const { buildAgentChatActionProjection } = require("../agent-chat/actions");
const { maybeStartConversationTitleGeneration } = require("../agent-chat/title-service");
const { loadRoleProfileByRole, renderTurnTemplate } = require("../gateways/threadpool/role-profile-loader");
const { normalizeTurnStatus } = require("../active-turns/status");
const {
  assertConversationReadyForNewTurn,
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
  assertConversationThreadMatches,
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
      materialPackRef: summarizeContextRef(body.materialPackRef, ["sampleVideoId", "artifactId", "traceId"]),
      structureRef: summarizeContextRef(body.structureRef, ["sampleVideoId", "artifactId", "traceId"]),
    },
    action: async ({ traceContext }) => {
      const conversationId = normalizeText(body.conversationId);
      const payload = await withConversationLock(conversationId, async () => {
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
          assertConversationThreadMatches(conversation, threadId);
          assertConversationReadyForNewTurn(conversation);
        }
        const context = await buildRestructureContext({
          body,
          handlers,
          role: body.role,
          workspaceRoot,
        });
        const agentMessage = context.agentMessage ? `${message}\n\n${context.agentMessage}` : message;
        const result = await handlers.appServer.startTurnWithInputs({
          workspaceRoot,
          threadId,
          inputs: buildTextInputs(agentMessage),
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
          userInputOrigin: context.userInputOrigin,
          materialPackRef: context.materialPackRef,
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
      if (payload.conversationId) {
        const titleSourceConversation = await handlers.agentConversationStore?.get?.(payload.conversationId).catch(() => null);
        const titleGeneration = await maybeStartConversationTitleGeneration({
          handlers,
          conversation: titleSourceConversation,
          message,
          turnId: payload.turnId,
          traceContext,
        }).catch((error) => ({
          ok: false,
          status: "failed",
          error: error?.code ?? "conversation_title_start_failed",
          message: safePreview(error instanceof Error ? error.message : "标题生成启动失败", 160),
        }));
        if (titleGeneration) {
          payload.titleGeneration = summarizeTitleGeneration(titleGeneration);
          payload.conversationRevision = titleGeneration.conversation?.revision ?? payload.conversationRevision ?? null;
          payload.conversationTitle = titleGeneration.conversation?.title ?? payload.conversationTitle ?? null;
          payload.conversationTitleState = titleGeneration.conversation?.titleState ?? null;
        }
      }
      return payload;
    },
    summarizeOutput: (result) => ({
      source: result.source,
      role: result.role,
      threadId: result.threadId,
      turnId: result.turnId,
      status: result.status,
      titleStatus: result.titleGeneration?.status ?? null,
    }),
    successStatus: 202,
  });
}

function summarizeTitleGeneration(value) {
  if (!value) return null;
  return {
    ok: value.ok !== false,
    status: value.status ?? value.titleState?.status ?? null,
    titleTurnId: value.titleState?.titleTurnId ?? null,
    error: value.errorSummary?.code ?? value.error ?? null,
  };
}

async function buildRestructureContext({ body, handlers, role, workspaceRoot }) {
  if (normalizeText(role) !== "function-slot-restructure") {
    return { agentMessage: null, userInputOrigin: null };
  }
  const materialPackRef = normalizeMaterialPackRef(body.materialPackRef);
  const structureRef = normalizeStructureRef(body.structureRef);
  if (!materialPackRef && !structureRef) {
    return { agentMessage: null, userInputOrigin: null };
  }
  const materialPackContext = materialPackRef
    ? await buildMaterialPackContext(materialPackRef, handlers)
    : null;
  const structureContext = structureRef
    ? await buildStructureContext(structureRef, handlers)
    : null;
  const sections = [
    materialPackContext?.agentMessage,
    structureContext,
  ].filter(Boolean);
  return {
    agentMessage: sections.join("\n"),
    materialPackRef: materialPackContext?.ref ?? null,
    userInputOrigin: materialPackRef && structureRef
      ? "material_and_structure_context"
      : materialPackRef
        ? "material_context"
        : "structure_context",
  };
}

async function buildMaterialPackContext(ref, handlers) {
  const detail = ref.sampleVideoId && typeof handlers.artifactIndex?.getItem === "function"
    ? await handlers.artifactIndex.getItem(ref.sampleVideoId).catch(() => null)
    : null;
  const pack = detail?.artifact?.userMaterialPack ?? null;
  const resultUri = normalizeText(detail?.artifact?.userMaterialPackRef?.uri ?? pack?.resultUri);
  if (pack?.type !== "user-material-pack" || pack?.schemaVersion !== "user-material-pack.stable" || !resultUri) {
    throw badRequestError(
      "agent_chat_material_pack_path_required",
      "素材包引用必须解析到已完成的 user-material-pack.stable 结果文件",
    );
  }
  return {
    agentMessage: `使用此素材包：${resultUri}`,
    ref: {
      ...ref,
      artifactId: normalizeText(pack.artifactId ?? ref.artifactId),
      traceId: normalizeText(pack.traceId ?? ref.traceId),
      resultUri,
      shotCardCount: nullableNumber(pack.shotCards?.length ?? ref.shotCardCount),
      materialGroupCount: nullableNumber(pack.materialGroups?.length ?? ref.materialGroupCount),
      proofCoverageCount: nullableNumber(pack.proofCoverage?.length ?? ref.proofCoverageCount),
    },
  };
}

async function buildStructureContext(ref, handlers) {
  const artifactId = sanitizeLibraryArtifactId(ref.artifactId);
  const libraryArtifact = typeof handlers.functionSlotLibraryService?.readLibraryArtifact === "function"
    ? await handlers.functionSlotLibraryService.readLibraryArtifact(artifactId).catch(() => null)
    : null;
  if (!libraryArtifact) {
    throw badRequestError("agent_chat_structure_ref_not_found", "引用结构必须指向已入库的 FunctionSlotLibrary 样例结构");
  }
  return `使用此样例结构：Artifacts/FunctionSlotLibrary/${artifactId}`;
}

function normalizeMaterialPackRef(value) {
  if (!value || typeof value !== "object") return null;
  const sampleVideoId = normalizeText(value.sampleVideoId);
  if (!sampleVideoId) throw badRequestError("agent_chat_material_pack_sample_required", "素材包引用缺少 sampleVideoId");
  return {
    sampleVideoId,
    artifactId: normalizeText(value.artifactId),
    title: normalizeText(value.title),
    traceId: normalizeText(value.traceId),
    resultUri: normalizeText(value.resultUri ?? value.uri),
    shotCardCount: nullableNumber(value.shotCardCount),
    materialGroupCount: nullableNumber(value.materialGroupCount),
    proofCoverageCount: nullableNumber(value.proofCoverageCount),
  };
}

function normalizeStructureRef(value) {
  if (!value || typeof value !== "object") return null;
  const artifactId = normalizeText(value.artifactId);
  if (!artifactId) throw badRequestError("agent_chat_structure_artifact_required", "引用结构缺少 artifactId");
  return {
    artifactId,
    sampleVideoId: normalizeText(value.sampleVideoId),
    title: normalizeText(value.title),
    traceId: normalizeText(value.traceId),
    slotCount: nullableNumber(value.slotCount),
    atomCount: nullableNumber(value.atomCount),
  };
}

function summarizeContextRef(value, keys) {
  if (!value || typeof value !== "object") return null;
  return Object.fromEntries(keys.map((key) => [key, normalizeText(value[key])]));
}

function sanitizeLibraryArtifactId(value) {
  const artifactId = normalizeText(value);
  if (!artifactId || !/^[A-Za-z0-9_.-]+$/.test(artifactId)) {
    throw badRequestError("agent_chat_structure_artifact_invalid", "引用结构 artifactId 不合法");
  }
  return artifactId;
}

async function handleAgentChatManualReplacementSubmit(req, res, threadId, handlers = {}) {
  const body = await (handlers.readJsonBodyImpl ?? readJsonBody)(req).catch(() => ({}));
  const conversationId = normalizeText(body.conversationId);
  const replacements = normalizeManualReplacements(body.replacements);
  const sourceRestructureFinalPath = normalizeWorkspaceRelativePath(body.sourceRestructureFinalPath, handlers.rootDir);
  const sourceDisplayJsonPath = normalizeWorkspaceRelativePath(body.sourceDisplayJsonPath, handlers.rootDir);
  const rootRestructureFinalPath = normalizeOptionalWorkspaceRelativePath(body.rootRestructureFinalPath, handlers.rootDir);
  const sourceTurnId = normalizeText(body.sourceTurnId);
  const versionId = normalizeText(body.versionId);
  const versionName = normalizeText(body.versionName);
  return runAgentChatStage(res, handlers, {
    stageName: "agentChat.manualReplacement.submit",
    inputSummary: {
      threadId,
      conversationId,
      replacementCount: replacements.length,
      sourceRestructureFinalPath,
      sourceDisplayJsonPath,
      rootRestructureFinalPath,
      sourceTurnId,
      versionId,
      versionName,
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
        assertConversationReadyForNewTurn(conversation);
        const workspaceRoot = normalizeText(body.workspaceRoot) || conversation.workspaceRoot || handlers.rootDir;
        const roleProfile = await loadRoleProfileByRole("function-slot-restructure");
        const replacementSummary = buildManualReplacementSummary(replacements, { sourceTurnId, versionId, versionName });
        const prompt = renderTurnTemplate(roleProfile, "manualReplacement", {
          sourceRestructureFinalPath,
          sourceDisplayJsonPath,
          rootRestructureFinalPath: rootRestructureFinalPath ?? "",
          sourceTurnId: sourceTurnId ?? "",
          versionId: versionId ?? "",
          versionName: versionName ?? "",
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
          userInputOrigin: "manual_replacement",
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

function buildManualReplacementSummary(replacements, context = {}) {
  const lines = ["用户手动替换 Slot/Atom："];
  if (context.versionId || context.versionName || context.sourceTurnId) {
    lines.push(`- 调整对象：${context.versionName || context.versionId || "默认方案"}${context.versionId ? ` (${context.versionId})` : ""}${context.sourceTurnId ? ` / turn ${context.sourceTurnId}` : ""}`);
  }
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

function normalizeOptionalWorkspaceRelativePath(value, rootDir) {
  return normalizeText(value) ? normalizeWorkspaceRelativePath(value, rootDir) : null;
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
