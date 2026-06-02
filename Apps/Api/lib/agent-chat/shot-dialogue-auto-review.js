const fs = require("fs/promises");
const path = require("path");
const { createHash, randomUUID } = require("crypto");
const { nextStage } = require("../../../../Infrastructure/Observability/trace");
const { loadRoleProfileByRole, renderTurnTemplate } = require("../gateways/threadpool/role-profile-loader");

const AUTO_STAGE_NAME = "function.slot.dialogue_robotic_review.auto_review";
const REVIEW_ROLE = "function-slot-dialogue-robotic-reviewer";

async function maybeAutoReviewShotDialogue({
  payload,
  handlers,
  traceContext,
  conversationId,
  url = null,
} = {}) {
  if (!isCompleted(payload?.status)) return null;
  if (!String(payload?.finalMessage ?? "").trim()) return null;
  if (!conversationId) return null;

  const rootDir = handlers.rootDir;
  const logger = handlers.logger;
  if (!rootDir || !logger) return null;

  const finalMessage = String(payload.finalMessage ?? "");
  const explicitPath = normalizeText(url?.searchParams?.get("shotDesignFinalPath"));
  const conversation = await handlers.agentConversationStore?.get?.(conversationId);
  const currentMessagePath = explicitPath || extractShotDesignFinalPath(finalMessage);
  const historicalPath = currentMessagePath ? null : findLatestShotDesignFinalPath(conversation);
  const linkedShotDesignFinalPath = currentMessagePath || historicalPath;
  if (!linkedShotDesignFinalPath) return null;
  if (!isDialogueReviewEligibleConversation(conversation, linkedShotDesignFinalPath)) return null;

  const stageTraceContext = nextStage(traceContext);
  const artifactId = `artifact_${randomUUID()}`;
  const parentArtifactId = normalizeText(url?.searchParams?.get("parentArtifactId")) ?? payload.turnId ?? null;
  const sourceMode = currentMessagePath ? "linkedFile" : "conversationHistory";
  const shotDesignFinalPath = resolveShotDesignFinalPath({
    rootDir,
    finalMessage,
    explicitPath: linkedShotDesignFinalPath,
    conversationId,
    turnId: payload.turnId,
  });
  const reviewOutputPath = path.join(path.dirname(shotDesignFinalPath), "dialogue-robotic-review.final.json");
  const previousFingerprint = findLatestReviewFingerprint(conversation, safeRelative(rootDir, shotDesignFinalPath));
  const inputSummary = {
    conversationId,
    turnId: payload.turnId ?? null,
    finalMessageChars: finalMessage.length,
    shotDesignFinalPath: safeRelative(rootDir, shotDesignFinalPath),
    reviewOutputPath: safeRelative(rootDir, reviewOutputPath),
    sourceMode,
    previousFingerprint,
    role: REVIEW_ROLE,
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
    const fileFingerprint = await readFileFingerprint(shotDesignFinalPath, rootDir);
    if (fingerprintsEqual(fileFingerprint, previousFingerprint)) {
      const outputSummary = {
        artifactId,
        status: "skipped_unchanged",
        shotDesignFinalPath: safeRelative(rootDir, shotDesignFinalPath),
        reviewOutputPath: safeRelative(rootDir, reviewOutputPath),
        sourceMode,
        trigger: "file_unchanged",
        fileFingerprint,
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
        status: "skipped_unchanged",
        artifactId,
        traceId: stageTraceContext.traceId,
        runId: stageTraceContext.runId,
        stageId: stageTraceContext.stageId,
        stageName: AUTO_STAGE_NAME,
        shotDesignFinalPath: safeRelative(rootDir, shotDesignFinalPath),
        reviewOutputPath: safeRelative(rootDir, reviewOutputPath),
        sourceMode,
        trigger: "file_unchanged",
        fileFingerprint,
      };
    }

    const reviewResult = await runDialogueReviewTurn({
      handlers,
      rootDir,
      shotDesignFinalPath,
      reviewOutputPath,
      artifactId,
      parentArtifactId,
      sourceTurnId: payload.turnId,
      stageTraceContext,
      fileFingerprint,
    });
    const outputSummary = {
      artifactId,
      status: "processed",
      decision: reviewResult.review.decision,
      issueCount: reviewResult.review.issues.length,
      shotDesignFinalPath: safeRelative(rootDir, shotDesignFinalPath),
      reviewOutputPath: safeRelative(rootDir, reviewOutputPath),
      sourceMode,
      trigger: "file_changed",
      fileFingerprint,
      role: REVIEW_ROLE,
      promptTemplateVersion: reviewResult.agent.promptTemplateVersion,
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
      shotDesignFinalPath: safeRelative(rootDir, shotDesignFinalPath),
      reviewOutputPath: safeRelative(rootDir, reviewOutputPath),
      sourceMode,
      trigger: "file_changed",
      fileFingerprint,
      decision: reviewResult.review.decision,
      issueCount: reviewResult.review.issues.length,
      turnId: reviewResult.agent.turnId,
      role: REVIEW_ROLE,
      promptTemplateVersion: reviewResult.agent.promptTemplateVersion,
    };
  } catch (error) {
    const safeError = {
      code: error?.code ?? "dialogue_robotic_review_auto_failed",
      message: safePreview(error instanceof Error ? error.message : "台词机器人感自动审查失败", 240),
      retryable: error?.retryable !== false,
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
        role: REVIEW_ROLE,
        shotDesignFinalPath: safeRelative(rootDir, shotDesignFinalPath),
        reviewOutputPath: safeRelative(rootDir, reviewOutputPath),
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
      status: "review_failed",
      artifactId,
      traceId: stageTraceContext.traceId,
      runId: stageTraceContext.runId,
      stageId: stageTraceContext.stageId,
      stageName: AUTO_STAGE_NAME,
      shotDesignFinalPath: safeRelative(rootDir, shotDesignFinalPath),
      reviewOutputPath: safeRelative(rootDir, reviewOutputPath),
      error: safeError.code,
      message: safeError.message,
      debugSnapshotUri: snapshot.uri,
    };
  }
}

async function runDialogueReviewTurn({
  handlers,
  rootDir,
  shotDesignFinalPath,
  reviewOutputPath,
  artifactId,
  parentArtifactId,
  sourceTurnId,
  stageTraceContext,
  fileFingerprint,
}) {
  if (!handlers.threadPool?.ensureRoleReady || !handlers.threadPool?.acquireLease || !handlers.threadPool?.releaseLease || !handlers.appServer?.runTurnWithInputs) {
    const error = new Error("dialogue review requires ThreadPool lease and appServer runTurnWithInputs");
    error.code = "dialogue_robotic_review_runtime_unavailable";
    throw error;
  }
  const roleProfile = await loadRoleProfileByRole(REVIEW_ROLE);
  const prompt = renderTurnTemplate(roleProfile, "review", {
    shotDesignFinalPath: safeRelative(rootDir, shotDesignFinalPath),
    reviewOutputPath: safeRelative(rootDir, reviewOutputPath),
    artifactId,
    parentArtifactId: parentArtifactId ?? "",
    sourceTurnId: sourceTurnId ?? "",
    stageName: AUTO_STAGE_NAME,
    fileFingerprintJson: JSON.stringify(fileFingerprint),
  });
  const ownerId = `dialogue-robotic-review-${stageTraceContext.runId}`;
  const readiness = await handlers.threadPool.ensureRoleReady(REVIEW_ROLE);
  if (!readiness?.ok) {
    const error = new Error(readiness?.message || "dialogue robotic review role unavailable");
    error.code = readiness?.error || "dialogue_robotic_review_role_unavailable";
    throw error;
  }
  const lease = await handlers.threadPool.acquireLease({ role: REVIEW_ROLE, ownerId });
  const threadId = lease.thread_id ?? lease.threadId;
  const leaseId = lease.lease_id ?? lease.leaseId;
  if (lease?.ok === false || !threadId || !leaseId) {
    const error = new Error(lease?.message ?? "dialogue review lease missing leaseId/threadId");
    error.code = lease?.error ?? lease?.code ?? "dialogue_robotic_review_lease_invalid";
    throw error;
  }
  try {
    const turn = await handlers.appServer.runTurnWithInputs({
      workspaceRoot: rootDir,
      threadId,
      skillPath: readiness.status?.skillPath ?? roleProfile.skillPath ?? null,
      inputs: [{ type: "text", text: prompt.text, text_elements: [] }],
      timeoutSeconds: 180,
    });
    const finalMessage = String(turn.finalMessage ?? turn.message ?? "");
    const review = parseReviewJson(finalMessage);
    const artifact = {
      schemaVersion: "function_slot_dialogue_robotic_review.v1",
      artifactId,
      parentArtifactId,
      artifactType: "function-slot-dialogue-robotic-review",
      stageName: AUTO_STAGE_NAME,
      createdAt: new Date().toISOString(),
      traceId: stageTraceContext.traceId,
      runId: stageTraceContext.runId,
      stageId: stageTraceContext.stageId,
      source: {
        shotDesignFinalPath: safeRelative(rootDir, shotDesignFinalPath),
        sourceTurnId: sourceTurnId ?? null,
        fileFingerprint,
      },
      agent: {
        role: REVIEW_ROLE,
        threadId,
        turnId: turn.turnId ?? turn.turn?.id ?? null,
        profilePath: roleProfile.profilePath,
        profileVersion: roleProfile.profileVersion,
        promptTemplateId: prompt.promptTemplateId,
        promptTemplateVersion: prompt.promptTemplateVersion,
        promptTemplateHash: prompt.promptTemplateHash,
      },
      review,
    };
    await fs.mkdir(path.dirname(reviewOutputPath), { recursive: true });
    await fs.writeFile(reviewOutputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
    return {
      review,
      agent: artifact.agent,
    };
  } finally {
    await handlers.threadPool.releaseLease({ leaseId, ownerId }).catch(() => null);
  }
}

function parseReviewJson(value) {
  const text = stripCodeFence(String(value ?? "").trim());
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const wrapped = new Error("dialogue review finalMessage is not valid JSON");
    wrapped.code = "dialogue_robotic_review_json_invalid";
    wrapped.retryable = true;
    wrapped.cause = error;
    throw wrapped;
  }
  const decision = String(parsed?.decision ?? "").trim();
  if (!["pass", "rework", "blocked"].includes(decision)) {
    const error = new Error("dialogue review decision must be pass, rework, or blocked");
    error.code = "dialogue_robotic_review_decision_invalid";
    error.retryable = true;
    throw error;
  }
  return {
    decision,
    reason: safePreview(parsed.reason, 500) ?? "",
    issues: Array.isArray(parsed.issues) ? parsed.issues.map(normalizeIssue).filter(Boolean) : [],
  };
}

function normalizeIssue(value) {
  if (!value || typeof value !== "object") return null;
  return {
    shot: String(value.shot ?? "unknown"),
    original: safePreview(value.original, 300) ?? "",
    robotic_type: String(value.robotic_type ?? ""),
    reason: safePreview(value.reason, 500) ?? "",
    minimal_direction: safePreview(value.minimal_direction, 500) ?? "",
  };
}

function stripCodeFence(value) {
  const match = value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : value;
}

function findLatestShotDesignFinalPath(conversation) {
  const messages = Array.isArray(conversation?.messages) ? conversation.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const pathFromMessage = extractShotDesignFinalPath(messages[index]?.text);
    if (pathFromMessage) return pathFromMessage;
  }
  return normalizeText(conversation?.confirmedPlan?.sourceShotDesignPath);
}

function findLatestReviewFingerprint(conversation, shotDesignFinalPath) {
  const messages = Array.isArray(conversation?.messages) ? conversation.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const fingerprint = messages[index]?.dialogueRoboticReview?.fileFingerprint;
    if (fingerprint?.path === shotDesignFinalPath) return fingerprint;
  }
  return null;
}

async function readFileFingerprint(filePath, rootDir) {
  const content = await fs.readFile(filePath);
  const stat = await fs.stat(filePath);
  return {
    path: safeRelative(rootDir, filePath),
    size: stat.size,
    mtimeMs: Math.trunc(stat.mtimeMs),
    sha256: createHash("sha256").update(content).digest("hex"),
  };
}

function fingerprintsEqual(left, right) {
  if (!left || !right) return false;
  return left.path === right.path
    && left.size === right.size
    && left.sha256 === right.sha256;
}

function resolveShotDesignFinalPath({ rootDir, finalMessage, explicitPath, conversationId, turnId }) {
  const inferred = explicitPath || extractShotDesignFinalPath(finalMessage);
  const relativePath = inferred
    ? normalizeRelativeArtifactPath(inferred, rootDir)
    : path.join("Artifacts", "FunctionSlotRestructure", safeSlug(conversationId || turnId || "agent-chat"), "shot-design.final.md");
  const resolved = path.resolve(rootDir, relativePath);
  const root = path.resolve(rootDir);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    const error = new Error("shot-design.final.md path is outside workspace");
    error.code = "shot_design_final_path_outside_workspace";
    throw error;
  }
  return resolved;
}

function extractShotDesignFinalPath(finalMessage) {
  const text = String(finalMessage ?? "");
  const saved = text.match(/保存路径[：:]\s*`([^`]+shot-design\.final\.md)`/i);
  if (saved?.[1]) return saved[1];
  const artifactPath = text.match(/(Artifacts[\\/]+FunctionSlotRestructure[^\n`]*?shot-design\.final\.md)/i);
  if (artifactPath?.[1]) return artifactPath[1];
  const absolutePath = text.match(/([A-Za-z]:[\\/][^\n`)]*?shot-design\.final\.md)/i);
  return absolutePath?.[1] ?? null;
}

function normalizeRelativeArtifactPath(value, rootDir) {
  const text = String(value ?? "").trim().replaceAll("\\", "/");
  if (!text) return null;
  const absolute = path.isAbsolute(text) || /^[A-Za-z]:\//.test(text);
  if (!absolute) return text;
  return path.relative(rootDir, path.resolve(text)).replaceAll(path.sep, "/");
}

function isCompleted(status) {
  return String(status ?? "").toLowerCase() === "completed";
}

function isDialogueReviewEligibleConversation(conversation, shotDesignPath) {
  const role = String(conversation?.role ?? "").trim();
  if (!["function-slot-shot-design", "function-slot-restructure"].includes(role)) return false;
  return /shot-design\.final\.md$/i.test(String(shotDesignPath ?? "").trim());
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
  REVIEW_ROLE,
  extractShotDesignFinalPath,
  maybeAutoReviewShotDialogue,
  parseReviewJson,
};
