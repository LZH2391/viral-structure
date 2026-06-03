const fs = require("fs/promises");
const path = require("path");
const { loadRoleProfileByRole, renderTurnTemplate } = require("../gateways/threadpool/role-profile-loader");
const { AUTO_STAGE_NAME, REVIEW_ROLE } = require("./shot-dialogue-review-constants");
const { isTerminalStatus, parseReviewJson, safeRelative } = require("./shot-dialogue-review-utils");

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
      return collectDialogueReviewTurnUntilTerminal({
        activeTurnRuntime: handlers.activeTurnRuntime,
        workspaceRoot,
        threadId: started.threadId ?? threadId,
        turnId,
        timeoutSeconds,
        traceContext,
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

async function collectDialogueReviewTurnUntilTerminal({
  activeTurnRuntime,
  workspaceRoot,
  threadId,
  turnId,
  timeoutSeconds,
  traceContext,
}) {
  const startedAt = Date.now();
  const timeoutMs = Math.max(1, Number(timeoutSeconds) || 180) * 1000;
  let lastResult = null;
  while (Date.now() - startedAt < timeoutMs) {
    lastResult = await activeTurnRuntime.collect({
      workspaceRoot,
      threadId,
      turnId,
      timeoutSeconds: Math.min(30, Math.max(5, Math.ceil((timeoutMs - (Date.now() - startedAt)) / 1000))),
      traceContext,
      skipOwnerHandler: true,
    });
    if (isTerminalStatus(lastResult?.status)) return lastResult;
    await sleep(1200);
  }
  const error = new Error("dialogue review turn did not complete before timeout");
  error.code = "dialogue_robotic_review_turn_timeout";
  error.retryable = true;
  error.debugPayload = {
    threadId,
    turnId,
    lastStatus: lastResult?.status ?? null,
  };
  throw error;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}


module.exports = { runDialogueReviewTurn };
