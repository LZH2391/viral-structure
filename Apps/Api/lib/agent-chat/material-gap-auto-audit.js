const fs = require("fs/promises");
const path = require("path");
const { randomUUID } = require("crypto");
const { nextStage } = require("../../../../Infrastructure/Observability/trace");
const { loadRoleProfileByRole, renderTurnTemplate } = require("../gateways/threadpool/role-profile-loader");
const { normalizeMaterialGapMatrix } = require("./conversation-normalizers");
const {
  normalizeText,
  safePreview,
} = require("./restructure-auto-display-utils");

const MATERIAL_GAP_ROLE = "material-gap-auditor";
const MATERIAL_GAP_STAGE_NAME = "function.slot.material_gap.auto_audit";

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
      stageTraceContext,
      artifactId,
      parentArtifactId,
      sourceTurnId: payload.turnId,
      restructureFinalPath,
      displayJsonPath,
      materialPackPath,
      outputJsonPath,
      slotAtomDisplay: autoDisplayTransform.slotAtomDisplay,
      materialPackSummary,
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
      role: MATERIAL_GAP_ROLE,
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
      role: MATERIAL_GAP_ROLE,
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
        role: MATERIAL_GAP_ROLE,
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
      role: MATERIAL_GAP_ROLE,
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
  stageTraceContext,
  artifactId,
  parentArtifactId,
  sourceTurnId,
  restructureFinalPath,
  displayJsonPath,
  materialPackPath,
  outputJsonPath,
  slotAtomDisplay,
  materialPackSummary,
}) {
  if (!handlers.threadPool?.ensureRoleReady || !handlers.threadPool?.acquireLease || !handlers.threadPool?.releaseLease || !handlers.appServer?.runTurnWithInputs) {
    throw materialGapError("material_gap_runtime_unavailable", "素材缺口审计需要 ThreadPool lease 和 appServer runTurnWithInputs");
  }
  const roleProfile = await loadRoleProfileByRole(MATERIAL_GAP_ROLE);
  const prompt = renderTurnTemplate(roleProfile, "audit", {
    restructureFinalPath: safeRelative(rootDir, restructureFinalPath),
    displayJsonPath: safeRelative(rootDir, displayJsonPath),
    materialPackPath: safeRelative(rootDir, materialPackPath),
    outputJsonPath: safeRelative(rootDir, outputJsonPath),
    artifactId,
    parentArtifactId: parentArtifactId ?? "",
    sourceTurnId: sourceTurnId ?? "",
    stageName: MATERIAL_GAP_STAGE_NAME,
    slotAtomDisplayJson: JSON.stringify(slotAtomDisplay ?? {}),
    materialPackSummaryJson: JSON.stringify(materialPackSummary ?? {}),
  });
  const ownerId = `material-gap-audit-${stageTraceContext.runId}`;
  const readiness = await handlers.threadPool.ensureRoleReady(MATERIAL_GAP_ROLE);
  if (!readiness?.ok) throw materialGapError(readiness?.error ?? "material_gap_role_unavailable", readiness?.message ?? "素材缺口审计 role 暂不可用");
  const lease = await handlers.threadPool.acquireLease({ role: MATERIAL_GAP_ROLE, ownerId });
  const threadId = lease?.thread_id ?? lease?.threadId ?? null;
  const leaseId = lease?.lease_id ?? lease?.leaseId ?? null;
  if (lease?.ok === false || !threadId || !leaseId) throw materialGapError(lease?.error ?? lease?.code ?? "material_gap_lease_invalid", lease?.message ?? "素材缺口审计 lease 不可用");
  try {
    const turn = await handlers.appServer.runTurnWithInputs({
      workspaceRoot: rootDir,
      threadId,
      skillPath: readiness.status?.skillPath ?? roleProfile.skillPath ?? null,
      inputs: [{ type: "text", text: prompt.text, text_elements: [] }],
      timeoutSeconds: 180,
    });
    if (!isCompleted(turn?.status)) throw materialGapError("material_gap_turn_failed", turn?.message ?? "素材缺口审计 turn 未成功完成");
    const matrix = parseJsonObject(turn.finalMessage ?? turn.message ?? "");
    return {
      matrix,
      agent: {
        role: MATERIAL_GAP_ROLE,
        threadId,
        turnId: turn.turnId ?? turn.turn?.id ?? null,
        profilePath: roleProfile.profilePath,
        profileVersion: roleProfile.profileVersion,
        promptTemplateId: prompt.promptTemplateId,
        promptTemplateVersion: prompt.promptTemplateVersion,
        promptTemplateHash: prompt.promptTemplateHash,
      },
    };
  } finally {
    await handlers.threadPool.releaseLease({ leaseId, ownerId }).catch(() => null);
  }
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
  MATERIAL_GAP_ROLE,
  MATERIAL_GAP_STAGE_NAME,
  maybeAutoAuditMaterialGaps,
};
