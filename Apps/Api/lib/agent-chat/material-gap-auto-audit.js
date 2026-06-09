const fs = require("fs/promises");
const path = require("path");
const { randomUUID } = require("crypto");
const { nextStage } = require("../../../../Infrastructure/Observability/trace");
const { normalizeMaterialGapMatrix } = require("./conversation-normalizers");
const {
  normalizeText,
  safePreview,
} = require("./restructure-auto-display-utils");

const MATERIAL_GAP_STAGE_NAME = "function.slot.material_gap.auto_audit";
const MATERIAL_GAP_AUDIT_KIND = "function-slot-restructure.internal-material-gap-audit";
const MATERIAL_GAP_PROMPT_TEMPLATE_VERSION = "inline.material-gap-audit.v1";

async function maybeAutoAuditMaterialGaps({
  payload,
  handlers,
  traceContext,
  conversationId,
  autoDisplayTransform = null,
} = {}) {
  if (!isCompleted(payload?.status)) return null;
  if (!conversationId) return null;
  if (!autoDisplayTransform?.slotAtomDisplay || autoDisplayTransform.slotAtomDisplay.status !== "available") return null;

  const conversation = await handlers.agentConversationStore?.get?.(conversationId).catch(() => null);
  if (conversation?.role !== "function-slot-restructure") return null;

  const materialPackRef = findMaterialPackRefForTurn(conversation, payload.turnId);
  if (!materialPackRef?.resultUri) return null;

  const rootDir = handlers.rootDir;
  const logger = handlers.logger;
  if (!rootDir || !logger) return null;

  const stageTraceContext = nextStage(traceContext);
  const artifactId = `artifact_${randomUUID()}`;
  const parentArtifactId = autoDisplayTransform.artifactId ?? payload.turnId ?? null;
  const startedAt = Date.now();
  const restructureFinalPath = resolveWorkspacePath(rootDir, autoDisplayTransform.restructureFinalPath);
  const displayJsonPath = resolveWorkspacePath(rootDir, autoDisplayTransform.displayJsonPath);
  const materialPackPath = resolveWorkspacePath(rootDir, materialPackRef.resultUri);
  const outputJsonPath = restructureFinalPath
    ? path.join(path.dirname(restructureFinalPath), "material-gap-matrix.final.json")
    : path.join(rootDir, "Runtime", "Temp", `material-gap-matrix-${artifactId}.json`);
  const inputSummary = {
    conversationId,
    turnId: payload.turnId ?? null,
    restructureFinalPath: safeRelative(rootDir, restructureFinalPath),
    displayJsonPath: safeRelative(rootDir, displayJsonPath),
    materialPackPath: safeRelative(rootDir, materialPackPath),
    materialPackArtifactId: materialPackRef.artifactId ?? null,
  };

  await logger.writeStageLog({
    traceContext: stageTraceContext,
    stageName: MATERIAL_GAP_STAGE_NAME,
    event: "stage.start",
    artifactId,
    parentArtifactId,
    inputSummary,
  });

  try {
    if (!restructureFinalPath || !displayJsonPath || !materialPackPath) {
      throw materialGapError("material_gap_input_missing", "素材缺口审计缺少可解析的重组方案、展示 JSON 或素材包路径");
    }
    const materialPackSummary = await summarizeMaterialPack(materialPackPath);
    const result = await runMaterialGapAuditTurn({
      handlers,
      rootDir,
      conversation,
      outputJsonPath,
    });
    const normalized = normalizeMaterialGapMatrix({
      ...result.matrix,
      artifactId,
      parentArtifactId,
      matrixJsonPath: safeRelative(rootDir, outputJsonPath),
      sourceRestructurePath: safeRelative(rootDir, restructureFinalPath),
      sourceMaterialPackArtifactId: materialPackSummary.artifactId ?? materialPackRef.artifactId ?? null,
      sourceMaterialPackPath: safeRelative(rootDir, materialPackPath),
      traceId: stageTraceContext.traceId,
      runId: stageTraceContext.runId,
      stageId: stageTraceContext.stageId,
      stageName: MATERIAL_GAP_STAGE_NAME,
      role: result.agent.role,
      turnId: result.agent.turnId,
      promptTemplateVersion: result.agent.promptTemplateVersion,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await fs.mkdir(path.dirname(outputJsonPath), { recursive: true });
    await fs.writeFile(outputJsonPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
    const outputSummary = {
      artifactId,
      status: normalized.status,
      slotCount: normalized.summary?.slotCount ?? normalized.rows.length,
      missingCount: normalized.summary?.missingCount ?? 0,
      partialCount: normalized.summary?.partialCount ?? 0,
      unsafeCount: normalized.summary?.unsafeCount ?? 0,
      matrixJsonPath: safeRelative(rootDir, outputJsonPath),
      sourceRole: result.agent.role,
      forkThreadId: result.agent.threadId,
      parentThreadId: result.agent.parentThreadId,
      promptTemplateVersion: result.agent.promptTemplateVersion,
    };
    await logger.writeStageLog({
      traceContext: stageTraceContext,
      stageName: MATERIAL_GAP_STAGE_NAME,
      event: "stage.end",
      artifactId,
      parentArtifactId,
      outputSummary,
      durationMs: Date.now() - startedAt,
    });
    const updatedConversation = await handlers.agentConversationStore?.createMaterialGapMatrixMessage?.({
      conversationId,
      turnId: payload.turnId,
      materialGapMatrix: normalized,
      traceId: stageTraceContext.traceId,
      runId: stageTraceContext.runId,
      stageId: stageTraceContext.stageId,
    }).catch(() => null);
    return { ok: true, materialGapMatrix: normalized, conversation: updatedConversation };
  } catch (error) {
    const safeError = {
      code: error?.code ?? "material_gap_auto_audit_failed",
      message: safePreview(error instanceof Error ? error.message : "素材缺口矩阵生成失败", 240),
      retryable: error?.retryable !== false,
    };
    const snapshot = await logger.writeDebugSnapshot({
      traceContext: stageTraceContext,
      stageName: MATERIAL_GAP_STAGE_NAME,
      artifactId,
      parentArtifactId,
      reason: safeError.code,
      inputSummary,
      outputSummary: null,
      debugPayload: {
        code: safeError.code,
        message: safeError.message,
        sourceRole: conversation.role ?? null,
      },
    });
    await logger.writeStageLog({
      traceContext: stageTraceContext,
      stageName: MATERIAL_GAP_STAGE_NAME,
      event: "stage.fail",
      artifactId,
      parentArtifactId,
      errorSummary: { ...safeError, debugSnapshotUri: snapshot.uri },
      durationMs: Date.now() - startedAt,
    });
    const failedMatrix = normalizeMaterialGapMatrix({
      schemaVersion: "material_gap_matrix.v1",
      status: "failed",
      artifactId,
      parentArtifactId,
      matrixJsonPath: safeRelative(rootDir, outputJsonPath),
      sourceRestructurePath: safeRelative(rootDir, restructureFinalPath),
      sourceMaterialPackArtifactId: materialPackRef.artifactId ?? null,
      sourceMaterialPackPath: safeRelative(rootDir, materialPackPath),
      summary: { slotCount: 0, satisfiedCount: 0, partialCount: 0, missingCount: 0, unsafeCount: 0, notRequiredCount: 0, topMissingMaterialTypes: [], overallImpact: "" },
      rows: [],
      traceId: stageTraceContext.traceId,
      runId: stageTraceContext.runId,
      stageId: stageTraceContext.stageId,
      stageName: MATERIAL_GAP_STAGE_NAME,
      role: conversation.role ?? "function-slot-restructure",
      error: safeError.code,
      message: safeError.message,
      debugSnapshotUri: snapshot.uri,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const updatedConversation = await handlers.agentConversationStore?.createMaterialGapMatrixMessage?.({
      conversationId,
      turnId: payload.turnId,
      materialGapMatrix: failedMatrix,
      traceId: stageTraceContext.traceId,
      runId: stageTraceContext.runId,
      stageId: stageTraceContext.stageId,
    }).catch(() => null);
    return { ok: false, materialGapMatrix: failedMatrix, conversation: updatedConversation };
  }
}

async function runMaterialGapAuditTurn({
  handlers,
  rootDir,
  conversation,
  outputJsonPath,
}) {
  if (!handlers.appServer?.startThread || !handlers.appServer?.runTurnWithInputs) {
    throw materialGapError("material_gap_runtime_unavailable", "素材缺口审计需要 AppServer direct child thread 和 runTurnWithInputs");
  }
  const parentThreadId = normalizeText(conversation?.threadId);
  if (!parentThreadId) {
    throw materialGapError("material_gap_parent_thread_missing", "素材缺口审计需要当前重组会话 threadId");
  }
  const workspaceRoot = conversation.workspaceRoot ?? rootDir;
  const started = await handlers.appServer.startThread({
    workspaceRoot,
    timeoutSeconds: 180,
  });
  const childThreadId = started?.threadId ?? started?.thread?.id ?? null;
  if (started?.ok === false || !childThreadId) {
    throw materialGapError(started?.error ?? started?.code ?? "material_gap_child_thread_start_failed", started?.message ?? "素材缺口审计 child thread 创建失败");
  }
  const prompt = renderMaterialGapAuditPrompt();
  const turn = await handlers.appServer.runTurnWithInputs({
    workspaceRoot,
    threadId: childThreadId,
    skillPath: conversation.skillPath ?? null,
    inputs: [{ type: "text", text: prompt.text, text_elements: [] }],
    timeoutSeconds: 180,
  });
  if (!isCompleted(turn?.status)) throw materialGapError("material_gap_turn_failed", turn?.message ?? "素材缺口审计 turn 未成功完成");
  const matrix = await parseMaterialGapMatrix(turn, outputJsonPath);
  return {
    matrix,
    agent: {
      role: conversation.role ?? "function-slot-restructure",
      threadId: childThreadId,
      parentThreadId,
      turnId: turn.turnId ?? turn.turn?.id ?? null,
      promptTemplateId: "internalMaterialGapAudit",
      promptTemplateVersion: MATERIAL_GAP_PROMPT_TEMPLATE_VERSION,
      auditKind: MATERIAL_GAP_AUDIT_KIND,
    },
  };
}

function renderMaterialGapAuditPrompt() {
  return {
    promptTemplateId: "internalMaterialGapAudit",
    promptTemplateVersion: MATERIAL_GAP_PROMPT_TEMPLATE_VERSION,
    text: [
      "你是当前 function-slot-restructure 会话内部 fork 出的只读旁路审计 turn。",
      "基于当前上下文中已完成的重组槽位方案和当前用户素材包，生成“结构槽位素材缺口矩阵” JSON。",
      "",
      "硬性边界：",
      "- 只返回 JSON object，不要 Markdown，不要解释。",
      "- 不修改任何重组方案、展示 JSON 或素材包文件。",
      "- 不生成 Shot 表、台词、分镜、时间轴或最终包装方案。",
      "- 不改变、不删除、不重排重组槽位链。",
      "- 这是 advisory-only 旁路审计，主重组方案不会消费你的结果。",
      "",
      "字段要求：",
      "- schemaVersion 固定为 material_gap_matrix.v1。",
      "- status 固定为 processed，除非输入无法读取或无法判断。",
      "- sourceRestructurePath 使用当前重组方案来源，未知可留空。",
      "- sourceMaterialPackArtifactId 使用当前素材包 artifactId，未知可留空。",
      "- rows 必须按槽位顺序输出。",
      "- 每个槽位都必须判断当前素材能否直接满足该槽位的画面/证明需要。",
      "- directSatisfaction 只能是 satisfied、partial、missing、unsafe、not_required。",
      "",
      "输出 JSON 形状：",
      JSON.stringify({
        schemaVersion: "material_gap_matrix.v1",
        status: "processed",
        sourceRestructurePath: "",
        sourceMaterialPackArtifactId: "",
        slotChainFingerprint: {},
        summary: {
          slotCount: 0,
          satisfiedCount: 0,
          partialCount: 0,
          missingCount: 0,
          unsafeCount: 0,
          notRequiredCount: 0,
          topMissingMaterialTypes: [],
          overallImpact: "",
        },
        rows: [{
          slotId: "",
          slotSubtype: "",
          slotFunction: "",
          requiredMaterialTypes: [],
          directSatisfaction: "missing",
          missingMaterialTypes: [],
          impact: "",
          availableEvidenceRefs: [],
          handoffToShotDesign: "",
        }],
      }, null, 2),
    ].join("\n"),
  };
}

async function summarizeMaterialPack(materialPackPath) {
  const raw = await fs.readFile(materialPackPath, "utf8");
  const pack = JSON.parse(raw);
  return {
    artifactId: pack.artifactId ?? null,
    type: pack.type ?? null,
    schemaVersion: pack.schemaVersion ?? null,
    sampleVideoId: pack.sampleVideoId ?? null,
    shotCardCount: Array.isArray(pack.shotCards) ? pack.shotCards.length : 0,
    materialGroupCount: Array.isArray(pack.materialGroups) ? pack.materialGroups.length : 0,
    proofCoverage: (Array.isArray(pack.proofCoverage) ? pack.proofCoverage : []).map((item) => ({
      proofNeedClass: item.proofNeedClass ?? null,
      coverage: item.coverage ?? null,
      candidateShots: Array.isArray(item.candidateShots) ? item.candidateShots.slice(0, 8) : [],
      candidateGroups: Array.isArray(item.candidateGroups) ? item.candidateGroups.slice(0, 8) : [],
      reason: safePreview(item.reason, 160),
      gapAdviceRefs: Array.isArray(item.gapAdviceRefs) ? item.gapAdviceRefs.slice(0, 8) : [],
    })),
    restructureInputSummary: pack.restructureInputSummary ?? null,
    semanticDictionaries: {
      guardrailDict: pack.semanticDictionaries?.guardrailDict ?? {},
      supportDict: pack.semanticDictionaries?.supportDict ?? {},
    },
  };
}

function findMaterialPackRefForTurn(conversation, turnId) {
  const messages = Array.isArray(conversation?.messages) ? conversation.messages : [];
  const expectedTurnId = normalizeText(turnId);
  if (expectedTurnId) {
    const direct = messages.find((message) => message?.role === "user" && normalizeText(message.turnId) === expectedTurnId && message.materialPackRef);
    if (direct?.materialPackRef) return direct.materialPackRef;
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user" && messages[index].materialPackRef) return messages[index].materialPackRef;
  }
  return null;
}

function resolveWorkspacePath(rootDir, value) {
  const text = normalizeText(value);
  if (!text) return null;
  if (/^[A-Za-z]:[\\/]/.test(text)) return path.resolve(text);
  const clean = text.replace(/^[/\\]+/, "");
  return path.resolve(rootDir, clean);
}

function safeRelative(rootDir, value) {
  const text = normalizeText(value);
  if (!text) return null;
  const relative = path.relative(rootDir, text).replace(/\\/g, "/");
  return relative && !relative.startsWith("..") ? relative : text.replace(/\\/g, "/");
}

function parseJsonObject(value) {
  const text = String(value ?? "").trim();
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
    throw materialGapError("material_gap_output_parse_failed", "素材缺口审计未返回合法 JSON object");
  }
}

async function parseMaterialGapMatrix(turn, outputJsonPath) {
  const text = String(turn?.finalMessage ?? turn?.message ?? "").trim();
  try {
    return parseJsonObject(text);
  } catch (finalMessageError) {
    try {
      return JSON.parse(await fs.readFile(outputJsonPath, "utf8"));
    } catch {
      throw finalMessageError;
    }
  }
}

function isCompleted(status) {
  return ["completed", "complete"].includes(String(status ?? "").toLowerCase());
}

function materialGapError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.retryable = true;
  return error;
}

module.exports = {
  MATERIAL_GAP_STAGE_NAME,
  maybeAutoAuditMaterialGaps,
};
