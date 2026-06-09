const fs = require("fs/promises");
const path = require("path");
const { randomUUID } = require("crypto");
const { nextStage } = require("../../../../Infrastructure/Observability/trace");
const { loadRoleProfileByRole, renderTurnTemplate } = require("../gateways/threadpool/role-profile-loader");
const {
  STAGE_NAME: TRANSFORM_STAGE_NAME,
  buildAgentRepairRequest,
  transformRestructureFinalFile,
} = require("../../../../Infrastructure/FunctionSlotRestructureDisplay/markdown-transformer");
const { resolveStoryboardPlanVersions } = require("./storyboard-version-resolver");
const {
  buildRepairSnippet,
  buildSlotAtomDisplaySummary,
  extractRestructureFinalPath,
  findLatestDisplayFingerprint,
  findLatestRestructureFinalPath,
  fingerprintsEqual,
  isCompleted,
  normalizeFinalMarkdown,
  normalizeText,
  readRestructureFinalFingerprint,
  resolveRestructureFinalPath,
  safePreview,
  safeRelative,
} = require("./restructure-auto-display-utils");

const AUTO_STAGE_NAME = "function.slot.restructure_display.auto_transform";
const REPAIR_ROLE = "function-slot-restructure-display-transformer";
const MAX_REPAIR_ATTEMPTS = 2;

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

  const conversation = await handlers.agentConversationStore?.get?.(conversationId);
  if (conversation?.role !== "function-slot-restructure") return null;
  const finalMessage = String(payload.finalMessage ?? "");
  const explicitPath = normalizeText(url?.searchParams?.get("restructureFinalPath"));
  const currentMessagePath = explicitPath || extractRestructureFinalPath(finalMessage);
  const historicalPath = currentMessagePath ? null : findLatestRestructureFinalPath(conversation);
  const linkedRestructureFinalPath = currentMessagePath || historicalPath;
  if (!linkedRestructureFinalPath) return null;

  const rootDir = handlers.rootDir;
  const logger = handlers.logger;
  if (!rootDir || !logger) return null;

  const stageTraceContext = nextStage(traceContext);
  const artifactId = `artifact_${randomUUID()}`;
  const parentArtifactId = normalizeText(url?.searchParams?.get("parentArtifactId")) ?? null;
  const sourceMode = currentMessagePath ? "linkedFile" : "conversationHistory";
  const restructureFinalPath = resolveRestructureFinalPath({
    rootDir,
    finalMessage,
    explicitPath: linkedRestructureFinalPath,
    conversationId,
    turnId: payload.turnId,
  });
  const displayJsonPath = path.join(path.dirname(restructureFinalPath), "restructure.display.json");
  const repairRequestPath = path.join(path.dirname(restructureFinalPath), "restructure.display.repair-request.json");
  const previousFingerprint = findLatestDisplayFingerprint(conversation, safeRelative(rootDir, restructureFinalPath));
  const trigger = "file_changed";
  const startedAt = Date.now();
  const versionPlan = await resolveStoryboardPlanVersions({
    rootDir,
    restructureFinalPath: safeRelative(rootDir, restructureFinalPath),
  });
  if (versionPlan.mode === "multi_version" && versionPlan.versions.length > 1) {
    return await autoTransformVersionedRestructureResult({
      payload,
      handlers,
      traceContext,
      conversationId,
      rootDir,
      logger,
      stageTraceContext,
      artifactId,
      parentArtifactId,
      sourceMode,
      trigger,
      rootRestructureFinalPath: restructureFinalPath,
      versionPlan,
      startedAt,
    });
  }
  const inputSummary = {
    conversationId,
    turnId: payload.turnId ?? null,
    finalMessageChars: String(payload.finalMessage ?? "").length,
    restructureFinalPath: safeRelative(rootDir, restructureFinalPath),
    displayJsonPath: safeRelative(rootDir, displayJsonPath),
    sourceMode,
    previousFingerprint,
  };

  await logger.writeStageLog({
    traceContext: stageTraceContext,
    stageName: AUTO_STAGE_NAME,
    event: "stage.start",
    artifactId,
    parentArtifactId,
    inputSummary,
  });

  try {
    const fileFingerprint = await readRestructureFinalFingerprint(restructureFinalPath, rootDir);
    if (fingerprintsEqual(fileFingerprint, previousFingerprint)) {
      const outputSummary = {
        artifactId,
        status: "skipped_unchanged",
        restructureFinalPath: safeRelative(rootDir, restructureFinalPath),
        displayJsonPath: safeRelative(rootDir, displayJsonPath),
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
        restructureFinalPath: safeRelative(rootDir, restructureFinalPath),
        displayJsonPath: safeRelative(rootDir, displayJsonPath),
        sourceMode,
        trigger: "file_unchanged",
        fileFingerprint,
      };
    }
    const transformResult = await transformWithRepair({
      handlers,
      rootDir,
      restructureFinalPath,
      displayJsonPath,
      repairRequestPath,
      artifactId,
      parentArtifactId,
      sourceTurnId: payload.turnId,
      stageTraceContext,
    });
    const displayJson = transformResult.displayJson;
    const outputSummary = {
      artifactId,
      status: "processed",
      transformStageName: TRANSFORM_STAGE_NAME,
      restructureFinalPath: safeRelative(rootDir, restructureFinalPath),
      displayJsonPath: safeRelative(rootDir, displayJsonPath),
      sectionCount: displayJson.sourceTextDigest.sectionCount,
      missingSections: displayJson.missingSections,
      repairAttemptCount: transformResult.repairAttemptCount,
      sourceMode,
      trigger,
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
      status: "processed",
      artifactId,
      traceId: stageTraceContext.traceId,
      runId: stageTraceContext.runId,
      stageId: stageTraceContext.stageId,
      stageName: AUTO_STAGE_NAME,
      restructureFinalPath: safeRelative(rootDir, restructureFinalPath),
      displayJsonPath: safeRelative(rootDir, displayJsonPath),
      missingSections: displayJson.missingSections,
      repairAttemptCount: transformResult.repairAttemptCount,
      repairTurns: transformResult.repairTurns,
      sourceMode,
      trigger,
      slotAtomDisplay: buildSlotAtomDisplaySummary(displayJson, {
        displayJsonPath: safeRelative(rootDir, displayJsonPath),
        fileFingerprint,
      }),
    };
  } catch (error) {
    if (!error.repairRequestWritten) {
      const repairRequest = buildAgentRepairRequest({
        error,
        inputPath: safeRelative(rootDir, restructureFinalPath),
        outputPath: safeRelative(rootDir, displayJsonPath),
        restructureArtifactId: artifactId,
      });
      await fs.mkdir(path.dirname(repairRequestPath), { recursive: true });
      await fs.writeFile(repairRequestPath, `${JSON.stringify(repairRequest, null, 2)}\n`, "utf8");
    }
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
      repairAttemptCount: error.repairAttemptCount ?? 0,
      error: safeError.code,
      message: safeError.message,
      debugSnapshotUri: snapshot.uri,
    };
  }
}

async function autoTransformVersionedRestructureResult({
  payload,
  handlers,
  conversationId,
  rootDir,
  logger,
  stageTraceContext,
  artifactId,
  parentArtifactId,
  sourceMode,
  trigger,
  rootRestructureFinalPath,
  versionPlan,
  startedAt,
}) {
  const inputSummary = {
    conversationId,
    turnId: payload.turnId ?? null,
    finalMessageChars: String(payload.finalMessage ?? "").length,
    restructureFinalPath: safeRelative(rootDir, rootRestructureFinalPath),
    mode: "multi_version",
    defaultVersionId: versionPlan.defaultVersionId ?? null,
    versionCount: versionPlan.versions.length,
    sourceMode,
  };
  await logger.writeStageLog({
    traceContext: stageTraceContext,
    stageName: AUTO_STAGE_NAME,
    event: "stage.start",
    artifactId,
    parentArtifactId,
    inputSummary,
  });
  try {
    const slotAtomDisplays = [];
    const repairTurns = [];
    const missingSections = new Set();
    let repairAttemptCount = 0;
    for (const version of versionPlan.versions) {
      const versionPath = resolveRestructureFinalPath({
        rootDir,
        finalMessage: "",
        explicitPath: version.restructureFinalPath,
        conversationId: null,
        turnId: null,
      });
      const versionDisplayJsonPath = path.join(path.dirname(versionPath), "restructure.display.json");
      const versionRepairRequestPath = path.join(path.dirname(versionPath), "restructure.display.repair-request.json");
      const fileFingerprint = await readRestructureFinalFingerprint(versionPath, rootDir);
      const transformResult = await transformWithRepair({
        handlers,
        rootDir,
        restructureFinalPath: versionPath,
        displayJsonPath: versionDisplayJsonPath,
        repairRequestPath: versionRepairRequestPath,
        artifactId,
        parentArtifactId,
        sourceTurnId: payload.turnId,
        stageTraceContext,
      });
      repairAttemptCount += transformResult.repairAttemptCount;
      transformResult.repairTurns.forEach((turn) => repairTurns.push({ ...turn, versionId: version.versionId ?? null }));
      for (const section of transformResult.displayJson.missingSections ?? []) missingSections.add(section);
      slotAtomDisplays.push({
        ...buildSlotAtomDisplaySummary(transformResult.displayJson, {
          displayJsonPath: safeRelative(rootDir, versionDisplayJsonPath),
          fileFingerprint,
        }),
        versionId: version.versionId ?? null,
        versionName: version.versionName ?? version.versionId ?? "默认方案",
        rootRestructureFinalPath: safeRelative(rootDir, rootRestructureFinalPath),
        sourceRestructureFinalPath: safeRelative(rootDir, versionPath),
      });
    }
    const defaultDisplay = selectDefaultVersionDisplay(slotAtomDisplays, versionPlan.defaultVersionId);
    const defaultDisplayWithVersions = defaultDisplay ? {
      ...defaultDisplay,
      mode: "multi_version",
      defaultVersionId: versionPlan.defaultVersionId ?? null,
      versionDisplays: slotAtomDisplays,
    } : null;
    const outputSummary = {
      artifactId,
      status: "processed",
      transformStageName: TRANSFORM_STAGE_NAME,
      restructureFinalPath: safeRelative(rootDir, rootRestructureFinalPath),
      mode: "multi_version",
      defaultVersionId: versionPlan.defaultVersionId ?? null,
      versionCount: slotAtomDisplays.length,
      missingSections: Array.from(missingSections),
      repairAttemptCount,
      sourceMode,
      trigger,
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
      restructureFinalPath: safeRelative(rootDir, rootRestructureFinalPath),
      displayJsonPath: defaultDisplay?.displayJsonPath ?? null,
      mode: "multi_version",
      defaultVersionId: versionPlan.defaultVersionId ?? null,
      selectedVersionId: defaultDisplay?.versionId ?? null,
      versions: versionPlan.versions,
      missingSections: Array.from(missingSections),
      repairAttemptCount,
      repairTurns,
      sourceMode,
      trigger,
      slotAtomDisplay: defaultDisplayWithVersions,
      slotAtomDisplays,
    };
  } catch (error) {
    const safeError = {
      code: error?.code ?? "restructure_display_auto_transform_failed",
      message: safePreview(error instanceof Error ? error.message : "多版本结构展示自动转换失败", 240),
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
        mode: "multi_version",
        versionCount: versionPlan.versions.length,
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
      restructureFinalPath: safeRelative(rootDir, rootRestructureFinalPath),
      mode: "multi_version",
      defaultVersionId: versionPlan.defaultVersionId ?? null,
      versions: versionPlan.versions,
      error: safeError.code,
      message: safeError.message,
      debugSnapshotUri: snapshot.uri,
    };
  }
}

function selectDefaultVersionDisplay(displays, defaultVersionId) {
  return displays.find((item) => item.versionId && item.versionId === defaultVersionId)
    ?? displays[0]
    ?? null;
}

async function transformWithRepair({
  handlers,
  rootDir,
  restructureFinalPath,
  displayJsonPath,
  repairRequestPath,
  artifactId,
  parentArtifactId,
  sourceTurnId,
  stageTraceContext,
}) {
  const repairTurns = [];
  let lastError = null;
  let transformInputPath = restructureFinalPath;
  for (let attempt = 0; attempt <= MAX_REPAIR_ATTEMPTS; attempt += 1) {
    try {
      const displayJson = await transformRestructureFinalFile({
        inputPath: transformInputPath,
        outputPath: displayJsonPath,
        restructureArtifactId: artifactId,
      });
      return {
        displayJson,
        repairAttemptCount: attempt,
        repairTurns,
      };
    } catch (error) {
      lastError = error;
      if (attempt >= MAX_REPAIR_ATTEMPTS) break;
      const repairAttemptCount = attempt + 1;
      const repairedPath = path.join(path.dirname(restructureFinalPath), `restructure.final.repair-attempt-${repairAttemptCount}.md`);
      const repairRequest = buildAgentRepairRequest({
        error,
        inputPath: safeRelative(rootDir, transformInputPath),
        repairedPath: safeRelative(rootDir, repairedPath),
        outputPath: safeRelative(rootDir, displayJsonPath),
        restructureArtifactId: artifactId,
        repairAttemptCount,
      });
      await fs.writeFile(repairRequestPath, `${JSON.stringify(repairRequest, null, 2)}\n`, "utf8");
      const repair = await runFormatRepairTurn({
        handlers,
        rootDir,
        repairRequest,
        repairAttemptCount,
        repairInputPath: transformInputPath,
        repairedPath,
        restructureFinalPath,
        artifactId,
        parentArtifactId,
        sourceTurnId,
        stageTraceContext,
      });
      transformInputPath = repairedPath;
      repairTurns.push({
        ...repair.summary,
        repairedPath: safeRelative(rootDir, repairedPath),
      });
    }
  }
  if (lastError) {
    lastError.repairAttemptCount = MAX_REPAIR_ATTEMPTS;
    lastError.repairRequestWritten = true;
  }
  throw lastError;
}

async function runFormatRepairTurn({
  handlers,
  rootDir,
  repairRequest,
  repairAttemptCount,
  repairInputPath,
  repairedPath,
  restructureFinalPath,
  artifactId,
  parentArtifactId,
  sourceTurnId,
  stageTraceContext,
}) {
  if (!handlers.threadPool?.ensureRoleReady || !handlers.threadPool?.acquireLease || !handlers.threadPool?.releaseLease || !handlers.appServer?.runTurnWithInputs) {
    const error = new Error("agentRepair requires ThreadPool lease and appServer runTurnWithInputs");
    error.code = "restructure_display_agent_repair_unavailable";
    throw error;
  }
  const roleProfile = await loadRoleProfileByRole(REPAIR_ROLE);
  const sourceMarkdown = await fs.readFile(repairInputPath, "utf8");
  const prompt = renderTurnTemplate(roleProfile, "repairTurn", {
    repairAttemptCount,
    restructureFinalPath: repairRequest.source.restructureFinalPath ?? safeRelative(rootDir, repairInputPath),
    repairedPath: repairRequest.source.repairedPath ?? safeRelative(rootDir, repairedPath),
    restructureArtifactId: repairRequest.source.restructureArtifactId ?? artifactId,
    parentArtifactId: parentArtifactId ?? "",
    sourceTurnId: sourceTurnId ?? "",
    stageName: AUTO_STAGE_NAME,
    errorCode: repairRequest.errorCode,
    errorMessage: repairRequest.errorMessage,
    debugSnapshotUri: "",
    validationErrorsJson: JSON.stringify(repairRequest.validationErrors ?? []),
    repairTargetsJson: JSON.stringify(repairRequest.repairTargets ?? []),
    scriptInputJson: JSON.stringify({
      restructureFinalPath: safeRelative(rootDir, restructureFinalPath),
      repairInputPath: safeRelative(rootDir, repairInputPath),
      repairedPath: safeRelative(rootDir, repairedPath),
      repairAttemptCount,
      maxRepairAttempts: MAX_REPAIR_ATTEMPTS,
    }),
    sourceSnippet: buildRepairSnippet(sourceMarkdown, repairRequest.repairTargets),
  });
  const ownerId = `restructure-display-repair-${stageTraceContext.runId}`;
  const readiness = await handlers.threadPool.ensureRoleReady(REPAIR_ROLE);
  if (!readiness?.ok) {
    const error = new Error(readiness?.message || "display repair role unavailable");
    error.code = readiness?.error || "restructure_display_repair_role_unavailable";
    throw error;
  }
  const lease = await handlers.threadPool.acquireLease({ role: REPAIR_ROLE, ownerId });
  const threadId = lease.thread_id ?? lease.threadId;
  const leaseId = lease.lease_id ?? lease.leaseId;
  if (lease?.ok === false || !threadId || !leaseId) {
    const error = new Error(lease?.message ?? "display repair lease missing leaseId/threadId");
    error.code = lease?.error ?? lease?.code ?? "restructure_display_repair_lease_invalid";
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
    await assertRepairOutputExists(repairedPath);
    return {
      summary: {
        repairAttemptCount,
        role: REPAIR_ROLE,
        threadId,
        turnId: turn.turnId ?? turn.turn?.id ?? null,
        status: turn.status ?? null,
        promptTemplateVersion: prompt.promptTemplateVersion,
      },
    };
  } finally {
    await handlers.threadPool.releaseLease({ leaseId, ownerId }).catch(() => null);
  }
}

async function assertRepairOutputExists(repairedPath) {
  try {
    await fs.access(repairedPath);
  } catch (error) {
    const wrapped = new Error("display repair turn did not write repaired markdown file");
    wrapped.code = "restructure_display_repair_output_missing";
    wrapped.retryable = true;
    wrapped.cause = error;
    throw wrapped;
  }
}

async function assertReadableRestructureFinal(restructureFinalPath) {
  try {
    await fs.access(restructureFinalPath);
  } catch (error) {
    const wrapped = new Error("restructure.final.md does not exist for linked agent response");
    wrapped.code = "restructure_final_link_target_missing";
    wrapped.statusCode = 404;
    wrapped.retryable = false;
    wrapped.cause = error;
    throw wrapped;
  }
}

module.exports = {
  AUTO_STAGE_NAME,
  MAX_REPAIR_ATTEMPTS,
  extractRestructureFinalPath,
  maybeAutoTransformRestructureResult,
};
