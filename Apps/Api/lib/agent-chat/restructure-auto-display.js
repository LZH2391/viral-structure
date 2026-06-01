const fs = require("fs/promises");
const path = require("path");
const { randomUUID } = require("crypto");
const { nextStage } = require("../../../../Infrastructure/Observability/trace");
const {
  STAGE_NAME: TRANSFORM_STAGE_NAME,
  buildAgentRepairRequest,
  transformRestructureFinalFile,
} = require("../../../../Infrastructure/FunctionSlotRestructureDisplay/markdown-transformer");

const AUTO_STAGE_NAME = "function.slot.restructure_display.auto_transform";

async function maybeAutoTransformRestructureResult({
  payload,
  handlers,
  traceContext,
  conversationId,
  url = null,
} = {}) {
  if (!isCompleted(payload?.status)) return null;
  if (!String(payload?.finalMessage ?? "").trim()) return null;
  if (!conversationId) return null;
  if (!looksLikeRestructureFinal(payload.finalMessage)) return null;

  const conversation = await handlers.agentConversationStore?.get?.(conversationId);
  if (conversation?.role !== "function-slot-restructure") return null;

  const rootDir = handlers.rootDir;
  const logger = handlers.logger;
  if (!rootDir || !logger) return null;

  const stageTraceContext = nextStage(traceContext);
  const artifactId = `artifact_${randomUUID()}`;
  const parentArtifactId = normalizeText(url?.searchParams?.get("parentArtifactId")) ?? null;
  const restructureFinalPath = resolveRestructureFinalPath({
    rootDir,
    finalMessage: payload.finalMessage,
    explicitPath: normalizeText(url?.searchParams?.get("restructureFinalPath")),
    conversationId,
    turnId: payload.turnId,
  });
  const displayJsonPath = path.join(path.dirname(restructureFinalPath), "restructure.display.json");
  const repairRequestPath = path.join(path.dirname(restructureFinalPath), "restructure.display.repair-request.json");
  const inputSummary = {
    conversationId,
    turnId: payload.turnId ?? null,
    finalMessageChars: String(payload.finalMessage ?? "").length,
    restructureFinalPath: safeRelative(rootDir, restructureFinalPath),
    displayJsonPath: safeRelative(rootDir, displayJsonPath),
  };
  const startedAt = Date.now();

  await logger.writeStageLog({
    traceContext: stageTraceContext,
    stageName: AUTO_STAGE_NAME,
    event: "stage.start",
    artifactId,
    parentArtifactId,
    inputSummary,
  });

  try {
    await fs.mkdir(path.dirname(restructureFinalPath), { recursive: true });
    await fs.writeFile(restructureFinalPath, normalizeFinalMarkdown(payload.finalMessage), "utf8");
    const displayJson = await transformRestructureFinalFile({
      inputPath: restructureFinalPath,
      outputPath: displayJsonPath,
      restructureArtifactId: artifactId,
    });
    const outputSummary = {
      artifactId,
      status: "processed",
      transformStageName: TRANSFORM_STAGE_NAME,
      restructureFinalPath: safeRelative(rootDir, restructureFinalPath),
      displayJsonPath: safeRelative(rootDir, displayJsonPath),
      sectionCount: displayJson.sourceTextDigest.sectionCount,
      missingSections: displayJson.missingSections,
    };
    await logger.writeStageLog({
      traceContext: stageTraceContext,
      stageName: AUTO_STAGE_NAME,
      event: "stage.end",
      artifactId,
      parentArtifactId,
      outputSummary,
      durationMs: Date.now() - startedAt,
    });
    return {
      ok: true,
      status: "processed",
      artifactId,
      traceId: stageTraceContext.traceId,
      runId: stageTraceContext.runId,
      stageId: stageTraceContext.stageId,
      stageName: AUTO_STAGE_NAME,
      restructureFinalPath: safeRelative(rootDir, restructureFinalPath),
      displayJsonPath: safeRelative(rootDir, displayJsonPath),
      missingSections: displayJson.missingSections,
    };
  } catch (error) {
    const repairRequest = buildAgentRepairRequest({
      error,
      inputPath: safeRelative(rootDir, restructureFinalPath),
      outputPath: safeRelative(rootDir, displayJsonPath),
      restructureArtifactId: artifactId,
    });
    await fs.mkdir(path.dirname(repairRequestPath), { recursive: true });
    await fs.writeFile(repairRequestPath, `${JSON.stringify(repairRequest, null, 2)}\n`, "utf8");
    const safeError = {
      code: error?.code ?? "restructure_display_auto_transform_failed",
      message: safePreview(error instanceof Error ? error.message : "结构展示自动转换失败", 240),
      retryable: true,
    };
    const snapshot = await logger.writeDebugSnapshot({
      traceContext: stageTraceContext,
      stageName: AUTO_STAGE_NAME,
      artifactId,
      parentArtifactId,
      reason: safeError.code,
      inputSummary,
      outputSummary: null,
      debugPayload: {
        code: safeError.code,
        message: safeError.message,
        validationErrors: error?.validationErrors ?? null,
        repairRequestPath: safeRelative(rootDir, repairRequestPath),
      },
    });
    await logger.writeStageLog({
      traceContext: stageTraceContext,
      stageName: AUTO_STAGE_NAME,
      event: "stage.fail",
      artifactId,
      parentArtifactId,
      errorSummary: { ...safeError, debugSnapshotUri: snapshot.uri },
      durationMs: Date.now() - startedAt,
    });
    return {
      ok: false,
      status: "repair_required",
      artifactId,
      traceId: stageTraceContext.traceId,
      runId: stageTraceContext.runId,
      stageId: stageTraceContext.stageId,
      stageName: AUTO_STAGE_NAME,
      restructureFinalPath: safeRelative(rootDir, restructureFinalPath),
      repairRequestPath: safeRelative(rootDir, repairRequestPath),
      error: safeError.code,
      message: safeError.message,
      debugSnapshotUri: snapshot.uri,
    };
  }
}

function looksLikeRestructureFinal(finalMessage) {
  const text = String(finalMessage ?? "");
  return /##\s+1\.\s*重组目标与假设/.test(text)
    || /##\s+2\.\s*最终功能槽位链/.test(text)
    || /#\s*重组方案/.test(text);
}

function resolveRestructureFinalPath({ rootDir, finalMessage, explicitPath, conversationId, turnId }) {
  const inferred = explicitPath || extractRestructureFinalPath(finalMessage);
  const relativePath = inferred
    ? normalizeRelativeArtifactPath(inferred, rootDir)
    : path.join("Artifacts", "FunctionSlotRestructure", safeSlug(conversationId || turnId || "agent-chat"), "restructure.final.md");
  const resolved = path.resolve(rootDir, relativePath);
  const root = path.resolve(rootDir);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    const error = new Error("restructure.final.md path is outside workspace");
    error.code = "restructure_final_path_outside_workspace";
    throw error;
  }
  return resolved;
}

function extractRestructureFinalPath(finalMessage) {
  const text = String(finalMessage ?? "");
  const saved = text.match(/保存路径[：:]\s*`([^`]+restructure\.final\.md)`/i);
  if (saved?.[1]) return saved[1];
  const artifactPath = text.match(/(Artifacts[\\/]+FunctionSlotRestructure[^\n`]*?restructure\.final\.md)/i);
  return artifactPath?.[1] ?? null;
}

function normalizeRelativeArtifactPath(value, rootDir) {
  const text = String(value ?? "").trim().replaceAll("\\", "/");
  if (!text) return null;
  const absolute = path.isAbsolute(text) || /^[A-Za-z]:\//.test(text);
  if (!absolute) return text;
  return path.relative(rootDir, path.resolve(text)).replaceAll(path.sep, "/");
}

function normalizeFinalMarkdown(value) {
  const text = String(value ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trimEnd();
  return `${text}\n`;
}

function isCompleted(status) {
  return String(status ?? "").toLowerCase() === "completed";
}

function normalizeText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function safeSlug(value) {
  return String(value ?? "").trim().replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "") || "agent-chat";
}

function safeRelative(rootDir, filePath) {
  return path.relative(rootDir, path.resolve(filePath)).replaceAll(path.sep, "/");
}

function safePreview(value, limit = 240) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length <= limit ? text : `${text.slice(0, limit)}...`;
}

module.exports = {
  AUTO_STAGE_NAME,
  extractRestructureFinalPath,
  maybeAutoTransformRestructureResult,
};
