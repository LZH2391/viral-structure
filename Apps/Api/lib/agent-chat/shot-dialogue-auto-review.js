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
  activeBinding = null,
} = {}) {
  if (!isCompleted(payload?.status)) return null;
  if (!String(payload?.finalMessage ?? "").trim()) return null;
  if (!conversationId) return null;

  const rootDir = handlers.rootDir;
  const logger = handlers.logger;
  if (!rootDir || !logger) return null;

  const finalMessage = String(payload.finalMessage ?? "");
  const conversation = await handlers.agentConversationStore?.get?.(conversationId);
  const currentOutputPath = extractGeneratedShotDesignFinalPath(finalMessage);
  const rememberedPath = currentOutputPath || findLatestShotDesignFinalPath(conversation);
  if (!rememberedPath) return null;
  if (!isDialogueReviewEligibleConversation(conversation, rememberedPath)) return null;

  const stageTraceContext = nextStage(traceContext);
  const artifactId = `artifact_${randomUUID()}`;
  const parentArtifactId = normalizeText(url?.searchParams?.get("parentArtifactId")) ?? payload.turnId ?? null;
  const sourceMode = currentOutputPath ? "currentTurnOutput" : "rememberedShotDesignPath";
  const shotDesignFinalPath = resolveShotDesignFinalPath({
    rootDir,
    finalMessage,
    explicitPath: rememberedPath,
    conversationId,
    turnId: payload.turnId,
  });
  if (currentOutputPath && !await isCurrentTurnFileOutput(shotDesignFinalPath, activeBinding)) return null;
  const reviewOutputPath = path.join(path.dirname(shotDesignFinalPath), "dialogue-robotic-review.final.json");
  const relativeShotDesignFinalPath = safeRelative(rootDir, shotDesignFinalPath);
  const previousReview = findLatestDialogueReviewSummary(conversation, relativeShotDesignFinalPath);
  const previousFingerprint = previousReview?.fileFingerprint ?? null;
  const previousDialogueFingerprint = previousReview?.dialogueFingerprint ?? null;
  const dialogueFingerprint = await readDialogueFingerprint(shotDesignFinalPath, rootDir).catch(() => null);
  if (!currentOutputPath && !previousDialogueFingerprint) return null;
  if (fingerprintsEqual(dialogueFingerprint, previousDialogueFingerprint)) return null;
  const inputSummary = {
    conversationId,
    turnId: payload.turnId ?? null,
    finalMessageChars: finalMessage.length,
    shotDesignFinalPath: relativeShotDesignFinalPath,
    reviewOutputPath: safeRelative(rootDir, reviewOutputPath),
    sourceMode,
    previousFingerprint,
    previousDialogueFingerprint,
    dialogueFingerprint,
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
        shotDesignFinalPath: relativeShotDesignFinalPath,
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
      dialogueFingerprint,
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
      dialogueFingerprint,
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
      dialogueFingerprint,
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

async function reviewShotDialogueForConversation({
  handlers,
  traceContext,
  conversationId,
  shotDesignFinalPath: requestedShotDesignFinalPath = null,
  sourceTurnId = null,
  parentArtifactId = null,
  trigger = "manual",
  force = false,
} = {}) {
  if (!conversationId) {
    const error = new Error("conversationId is required for dialogue review");
    error.code = "dialogue_robotic_review_conversation_required";
    error.statusCode = 400;
    throw error;
  }
  const rootDir = handlers.rootDir;
  const logger = handlers.logger;
  if (!rootDir || !logger) {
    const error = new Error("dialogue review requires rootDir and logger");
    error.code = "dialogue_robotic_review_runtime_unavailable";
    error.statusCode = 503;
    throw error;
  }

  const conversation = await handlers.agentConversationStore?.get?.(conversationId);
  if (!conversation) {
    const error = new Error("未找到 Agent 会话");
    error.code = "agent_chat_conversation_not_found";
    error.statusCode = 404;
    throw error;
  }
  const linkedShotDesignFinalPath = normalizeText(requestedShotDesignFinalPath) || findLatestShotDesignFinalPath(conversation);
  if (!linkedShotDesignFinalPath) {
    const error = new Error("未找到可审查的 shot-design.final.md");
    error.code = "dialogue_robotic_review_shot_design_missing";
    error.statusCode = 400;
    throw error;
  }
  if (!isDialogueReviewEligibleConversation(conversation, linkedShotDesignFinalPath)) {
    const error = new Error("当前会话不支持台词机器人感审查");
    error.code = "dialogue_robotic_review_conversation_ineligible";
    error.statusCode = 400;
    throw error;
  }

  const stageTraceContext = nextStage(traceContext);
  const artifactId = `artifact_${randomUUID()}`;
  const sourceParentArtifactId = normalizeText(parentArtifactId) ?? normalizeText(sourceTurnId) ?? conversation.latestTurnId ?? null;
  const shotDesignFinalPath = resolveShotDesignFinalPath({
    rootDir,
    finalMessage: "",
    explicitPath: linkedShotDesignFinalPath,
    conversationId,
    turnId: sourceTurnId,
  });
  const reviewOutputPath = path.join(path.dirname(shotDesignFinalPath), "dialogue-robotic-review.final.json");
  const relativeShotDesignFinalPath = safeRelative(rootDir, shotDesignFinalPath);
  const previousReview = findLatestDialogueReviewSummary(conversation, relativeShotDesignFinalPath);
  const previousFingerprint = previousReview?.fileFingerprint ?? null;
  const inputSummary = {
    conversationId,
    sourceTurnId: sourceTurnId ?? conversation.latestTurnId ?? null,
    shotDesignFinalPath: relativeShotDesignFinalPath,
    reviewOutputPath: safeRelative(rootDir, reviewOutputPath),
    previousFingerprint,
    role: REVIEW_ROLE,
    trigger,
    force: Boolean(force),
  };
  const startedAt = Date.now();

  await logger.writeStageLog({
    traceContext: stageTraceContext,
    stageName: AUTO_STAGE_NAME,
    event: "stage.start",
    artifactId,
    parentArtifactId: sourceParentArtifactId,
    inputSummary,
  });

  try {
    const fileFingerprint = await readFileFingerprint(shotDesignFinalPath, rootDir);
    const dialogueFingerprint = await readDialogueFingerprint(shotDesignFinalPath, rootDir).catch(() => null);
    if (!force && fingerprintsEqual(fileFingerprint, previousFingerprint)) {
      const outputSummary = {
        artifactId,
        status: "skipped_unchanged",
        shotDesignFinalPath: relativeShotDesignFinalPath,
        reviewOutputPath: safeRelative(rootDir, reviewOutputPath),
        trigger: "file_unchanged",
        fileFingerprint,
        dialogueFingerprint,
      };
      await logger.writeStageLog({
        traceContext: stageTraceContext,
        stageName: AUTO_STAGE_NAME,
        event: "stage.end",
        artifactId,
        parentArtifactId: sourceParentArtifactId,
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
        shotDesignFinalPath: relativeShotDesignFinalPath,
        reviewOutputPath: safeRelative(rootDir, reviewOutputPath),
        sourceMode: "manual",
        trigger: "file_unchanged",
        fileFingerprint,
        dialogueFingerprint,
        decision: previousReview?.decision ?? null,
        issueCount: previousReview?.issueCount ?? 0,
        role: previousReview?.role ?? REVIEW_ROLE,
        promptTemplateVersion: previousReview?.promptTemplateVersion ?? null,
      };
    }

    const reviewResult = await runDialogueReviewTurn({
      handlers,
      rootDir,
      shotDesignFinalPath,
      reviewOutputPath,
      artifactId,
      parentArtifactId: sourceParentArtifactId,
      sourceTurnId: sourceTurnId ?? conversation.latestTurnId,
      stageTraceContext,
      fileFingerprint,
      dialogueFingerprint,
    });
    const outputSummary = {
      artifactId,
      status: "processed",
      decision: reviewResult.review.decision,
      issueCount: reviewResult.review.issues.length,
      shotDesignFinalPath: relativeShotDesignFinalPath,
      reviewOutputPath: safeRelative(rootDir, reviewOutputPath),
      trigger,
      fileFingerprint,
      dialogueFingerprint,
      role: REVIEW_ROLE,
      promptTemplateVersion: reviewResult.agent.promptTemplateVersion,
    };
    await logger.writeStageLog({
      traceContext: stageTraceContext,
      stageName: AUTO_STAGE_NAME,
      event: "stage.end",
      artifactId,
      parentArtifactId: sourceParentArtifactId,
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
      shotDesignFinalPath: relativeShotDesignFinalPath,
      reviewOutputPath: safeRelative(rootDir, reviewOutputPath),
      sourceMode: "manual",
      trigger,
      fileFingerprint,
      dialogueFingerprint,
      decision: reviewResult.review.decision,
      issueCount: reviewResult.review.issues.length,
      turnId: reviewResult.agent.turnId,
      role: REVIEW_ROLE,
      promptTemplateVersion: reviewResult.agent.promptTemplateVersion,
    };
  } catch (error) {
    const safeError = {
      code: error?.code ?? "dialogue_robotic_review_manual_failed",
      message: safePreview(error instanceof Error ? error.message : "台词机器人感审查失败", 240),
      retryable: error?.retryable !== false,
    };
    const snapshot = await logger.writeDebugSnapshot({
      traceContext: stageTraceContext,
      stageName: AUTO_STAGE_NAME,
      artifactId,
      parentArtifactId: sourceParentArtifactId,
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
      parentArtifactId: sourceParentArtifactId,
      errorSummary: { ...safeError, debugSnapshotUri: snapshot.uri },
      durationMs: Date.now() - startedAt,
    });
    error.code = safeError.code;
    error.retryable = safeError.retryable;
    error.debugPayload = { ...safeError, debugSnapshotUri: snapshot.uri };
    throw error;
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
  dialogueFingerprint,
}) {
  if (!handlers.threadPool?.ensureRoleReady || !handlers.threadPool?.acquireLease || !handlers.threadPool?.releaseLease || !canRunDialogueReviewTurn(handlers)) {
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
    const turn = await startAndCollectDialogueReviewTurn({
      handlers,
      workspaceRoot: rootDir,
      threadId,
      skillPath: readiness.status?.skillPath ?? roleProfile.skillPath ?? null,
      inputs: [{ type: "text", text: prompt.text, text_elements: [] }],
      timeoutSeconds: 180,
      binding: {
        ownerType: "agent-chat-dialogue-review",
        ownerId: artifactId,
        currentAttemptId: `${artifactId}:${stageTraceContext.stageId}`,
        stageName: AUTO_STAGE_NAME,
        traceId: stageTraceContext.traceId,
        runId: stageTraceContext.runId,
        stageId: stageTraceContext.stageId,
        artifactId,
        parentArtifactId: parentArtifactId ?? null,
        leaseId,
        threadPoolOwnerId: ownerId,
        replayRef: {
          type: "dialogue-review-input",
          refId: artifactId,
          sourceTurnId: sourceTurnId ?? null,
        },
      },
      traceContext: stageTraceContext,
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
        dialogueFingerprint,
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

function canRunDialogueReviewTurn(handlers) {
  if (handlers.activeTurnRuntime?.start && handlers.activeTurnRuntime?.collect) return true;
  return Boolean(handlers.appServer?.runTurnWithInputs);
}

async function startAndCollectDialogueReviewTurn({
  handlers,
  workspaceRoot,
  threadId,
  skillPath,
  inputs,
  timeoutSeconds,
  binding,
  traceContext,
}) {
  if (handlers.activeTurnRuntime?.start && handlers.activeTurnRuntime?.collect) {
    try {
      const started = await handlers.activeTurnRuntime.start({
        workspaceRoot,
        threadId,
        skillPath,
        inputs,
        timeoutSeconds,
        binding,
        enforceThreadId: true,
      });
      const turnId = started.turnId ?? started.turn?.id ?? null;
      if (!turnId) return started;
      return handlers.activeTurnRuntime.collect({
        workspaceRoot,
        threadId: started.threadId ?? threadId,
        turnId,
        timeoutSeconds,
        traceContext,
        skipOwnerHandler: true,
      });
    } catch (error) {
      if (error?.code !== "appserver_turn_start_unavailable" || !handlers.appServer?.runTurnWithInputs) throw error;
    }
  }
  return handlers.appServer.runTurnWithInputs({
    workspaceRoot,
    threadId,
    skillPath,
    inputs,
    timeoutSeconds,
  });
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

function findLatestDialogueReviewSummary(conversation, shotDesignFinalPath) {
  const messages = Array.isArray(conversation?.messages) ? conversation.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const review = messages[index]?.dialogueRoboticReview;
    if (review?.fileFingerprint?.path === shotDesignFinalPath || review?.dialogueFingerprint?.path === shotDesignFinalPath) return review;
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

async function readDialogueFingerprint(filePath, rootDir) {
  const content = await fs.readFile(filePath, "utf8");
  const entries = extractDialogueEntries(content);
  const normalized = entries.map((entry) => `${entry.shot}\t${entry.dialogue}`).join("\n");
  return {
    path: safeRelative(rootDir, filePath),
    size: entries.length,
    sha256: createHash("sha256").update(normalized).digest("hex"),
    entryCount: entries.length,
    nonEmptyCount: entries.filter((entry) => entry.dialogue && entry.dialogue !== "无").length,
  };
}

function extractDialogueEntries(markdown) {
  const lines = String(markdown ?? "").split(/\r?\n/);
  const entries = [];
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (!isMarkdownTableLine(lines[index]) || !isMarkdownSeparatorLine(lines[index + 1])) continue;
    const headers = splitMarkdownRow(lines[index]).map(normalizeTableCell);
    const dialogueIndex = headers.findIndex(isDialogueHeader);
    if (dialogueIndex < 0) continue;
    const shotIndex = headers.findIndex((header) => header === "shot" || header.includes("镜头"));
    index += 2;
    for (; index < lines.length && isMarkdownTableLine(lines[index]); index += 1) {
      const cells = splitMarkdownRow(lines[index]);
      const dialogue = normalizeDialogueCell(cells[dialogueIndex]);
      entries.push({
        shot: normalizeTableCell(cells[shotIndex]) || `row_${entries.length + 1}`,
        dialogue,
      });
    }
    index -= 1;
  }
  return entries;
}

function isMarkdownTableLine(line) {
  return /^\s*\|.*\|\s*$/.test(String(line ?? ""));
}

function isMarkdownSeparatorLine(line) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(String(line ?? ""));
}

function splitMarkdownRow(line) {
  return String(line ?? "").trim().replace(/^\|/, "").replace(/\|$/, "").split("|");
}

function isDialogueHeader(value) {
  return /台词|字幕|旁白|屏幕文字|口播/i.test(String(value ?? ""));
}

function normalizeTableCell(value) {
  return String(value ?? "").replace(/<br\s*\/?>/gi, "\n").replace(/\s+/g, " ").trim();
}

function normalizeDialogueCell(value) {
  return normalizeTableCell(value)
    .replace(/^[-–—]+$/, "")
    .replace(/^无(?:新增)?(?:台词|字幕|口播|旁白)?$/i, "无")
    .trim();
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

function extractGeneratedShotDesignFinalPath(finalMessage) {
  const text = String(finalMessage ?? "");
  const saved = text.match(/保存路径[：:]\s*`([^`]+shot-design\.final\.md)`/i);
  if (saved?.[1]) return saved[1];
  if (!/(已生成|生成并落盘|已写入|写入|已保存|保存|落盘|更新|已更新|改写|已改写|返工后|重新生成|完成 Shot 设计|Shot 设计已完成)/i.test(text)) return null;
  return extractShotDesignFinalPath(text);
}

async function isCurrentTurnFileOutput(filePath, activeBinding) {
  const createdAtMs = Date.parse(activeBinding?.createdAt ?? "");
  if (!Number.isFinite(createdAtMs)) return true;
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat) return true;
  return stat.mtimeMs + 1000 >= createdAtMs;
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
  reviewShotDialogueForConversation,
};
