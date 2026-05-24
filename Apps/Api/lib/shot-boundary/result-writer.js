async function writeCompletedAnalysis({
  context,
  agentRun,
  turn,
  runStage,
  stages,
  prepareInput,
  store,
  buildProcessedAnalysis,
  attachAnalysis,
  artifactIndex,
  resolveExistingFileHash,
  loadSampleArtifact,
  finalizeLease,
  threadPool,
  appServer,
  rootDir,
  reviewer,
  role,
  jobStore,
  sampleStatus,
  updateActiveThreadMessage,
}) {
  if (typeof buildProcessedAnalysis !== "function") {
    throw new Error("buildProcessedAnalysis is not available");
  }
  const prepared = prepareInput(context.sampleArtifact, agentRun.analysisFps, { runtimeRoot: store.runtimeRoot });
  const transform = await runTransformTurn({
    context,
    agentRun,
    turn,
    prepared,
    runStage,
    stages,
    appServer,
    rootDir,
    reviewer,
    threadPool,
    store,
    updateActiveThreadMessage,
  });
  const shotAnalysis = buildProcessedAnalysis(JSON.stringify({
    shots: transform.result.shots,
    commerceBrief: transform.result.commerceBrief,
  }), prepared, transform.resultSheets, context, { thread_id: transform.run.threadId, lease_id: transform.run.leaseId }, { turnId: transform.run.turnId }, {
    resultOrigin: "transformed_turn",
    repairAttemptCount: 0,
    enableReview: context.enableReview !== false,
    inputMode: "raw_video_path_text",
    agentRole: reviewer.role,
    agentProfilePath: transform.run.profilePath,
    agentProfileVersion: transform.run.profileVersion,
    agentPromptTemplateId: transform.run.promptTemplateId,
    agentPromptTemplateVersion: transform.run.promptTemplateVersion,
    agentPromptTemplateHash: transform.run.promptTemplateHash,
    agentInitFingerprint: transform.run.initFingerprint,
    agentSkillPath: reviewer.skillPath,
    agentSkillHash: transform.run.skillHash,
    rawAnalyzer: {
      role,
      threadId: agentRun.threadId,
      turnId: turn.turnId,
      leaseId: null,
      inputMode: "raw_video_path_text",
      rawResultPreview: safePreview(turn.finalMessage),
    },
  });
  await runStage(context, stages.resultWritten, 95, {
    artifactId: context.artifactId,
    parentArtifactId: prepared.sourceArtifactId ?? null,
    inputSummary: {
      rawThreadId: agentRun.threadId,
      rawTurnId: turn.turnId,
      transformThreadId: transform.run.threadId,
      transformTurnId: transform.run.turnId,
      frameCount: prepared.frames.length,
      sheetCount: transform.resultSheets.length,
      resultOrigin: "transformed_turn",
    },
    action: async () => {
      await attachAnalysis(context.sampleVideoId, shotAnalysis, {
        traceId: context.traceContext.traceId,
        sourceTraceId: context.sampleArtifact?.trace?.traceId ?? null,
      });
      await artifactIndex.registerSampleArtifact({
        artifact: await loadSampleArtifact(context.sampleVideoId),
        fileHash: await resolveExistingFileHash(context.sampleVideoId),
        traceId: context.traceContext.traceId,
      });
      await finalizeLease(threadPool, transform.run, { shouldDiscard: false });
      return shotAnalysis;
    },
    outputSummary: (result) => ({
      status: result.status,
      sheetCount: result.contactSheets?.length ?? 0,
      boundaryCount: result.boundaries?.length ?? 0,
      shotCount: result.shots.length,
      artifactType: result.type,
      resultOrigin: result.resultOrigin,
      hasVideoSummary: Boolean(result.commerceBrief?.videoSummary),
    }),
  });
  jobStore.updateJob(context.job.jobId, {
    agentRun: { ...agentRun, status: "completed", updatedAt: new Date().toISOString() },
    shotBoundaryTransform: {
      ...transform.run,
      status: "completed",
      updatedAt: new Date().toISOString(),
    },
    stage: sampleStatus.processed,
    status: sampleStatus.processed,
    progress: 100,
    errorSummary: null,
    activeThreadMessage: null,
  });
}

async function runTransformTurn({
  context,
  agentRun,
  turn,
  prepared,
  runStage,
  stages,
  appServer,
  rootDir,
  reviewer,
  threadPool,
  store,
  updateActiveThreadMessage,
}) {
  let lease = null;
  const roleProfile = await reviewer.loadRoleProfileByRole(reviewer.role);
  try {
    const leaseAcquisition = await runStage(context, stages.reviewThreadAcquired, 90, {
      artifactId: context.artifactId,
      parentArtifactId: prepared.sourceArtifactId,
      inputSummary: { role: reviewer.role, producerThreadId: agentRun.threadId, rawTurnId: turn.turnId },
      action: () => reviewer.acquireLeaseWithRetry(threadPool, {
        role: reviewer.role,
        ownerId: `${context.traceContext.traceId}:transform`,
        codedError: require("../shot-boundary-analysis").codedError,
      }),
      outputSummary: (result) => ({
        role: reviewer.role,
        leaseId: result.lease.lease_id,
        threadId: result.lease.thread_id,
        attemptCount: result.attemptCount,
      }),
    });
    lease = leaseAcquisition.lease;
    const transformTurn = reviewer.renderTransformTurnInputs({
      prepared,
      rawFinalMessage: turn.finalMessage,
      roleProfile,
    });
    const started = await runStage(context, stages.reviewStarted, 92, {
      artifactId: context.artifactId,
      parentArtifactId: prepared.sourceArtifactId,
      inputSummary: { role: reviewer.role, threadId: lease.thread_id, leaseId: lease.lease_id, rawTurnId: turn.turnId },
      action: () => appServer.startTurnWithInputs({
        workspaceRoot: rootDir,
        threadId: lease.thread_id,
        inputs: transformTurn.inputs,
        timeoutSeconds: 240,
      }),
      outputSummary: (result) => ({
        role: reviewer.role,
        threadId: result.threadId,
        turnId: result.turnId,
        status: result.status,
        promptTemplateId: transformTurn.promptTemplateId,
        promptTemplateVersion: transformTurn.promptTemplateVersion,
        promptTemplateHash: transformTurn.promptTemplateHash,
      }),
    });
    const collected = await collectTurn({
      context,
      stageName: stages.reviewCollected,
      artifactId: context.artifactId,
      parentArtifactId: prepared.sourceArtifactId,
      threadId: lease.thread_id,
      turnId: started.turnId,
      appServer,
      rootDir,
      runStage,
      inputSummary: (attempt) => ({ role: reviewer.role, threadId: lease.thread_id, turnId: started.turnId, attempt }),
      outputSummary: (result, attempt) => ({
        role: reviewer.role,
        threadId: result.threadId,
        turnId: result.turnId,
        status: result.status,
        attempt,
        finalMessagePreview: safePreview(result.finalMessage),
      }),
      updateActiveThreadMessage,
      activeMessageOptions: {
        role: reviewer.role,
        fallbackMessage: "正在转换切镜结果",
      },
      maxAttempts: reviewer.reviewCollectMaxAttempts,
      intervalMs: reviewer.reviewPollIntervalMs,
      incompleteCode: "shot_boundary_transform_turn_incomplete",
      incompleteMessage: "切镜结果转换 Agent 未完成",
    });
    const result = await runStage(context, stages.reviewValidated, 94, {
      artifactId: context.artifactId,
      parentArtifactId: prepared.sourceArtifactId,
      inputSummary: { role: reviewer.role, threadId: lease.thread_id, turnId: collected.turnId },
      action: () => reviewer.validateTransformResult(collected.finalMessage, prepared, collected),
      outputSummary: (value) => reviewer.summarizeTransformResult(value),
    });
    const resultSheets = await runStage(context, stages.reviewSheetsPrepared, 95, {
      artifactId: context.artifactId,
      parentArtifactId: prepared.sourceArtifactId,
      inputSummary: { shotCount: result.shots.length, boundaryCount: result.boundaries.length },
      action: () => reviewer.prepareShotSheets({
        prepared,
        shots: result.shots,
        artifactId: context.artifactId,
        sampleDir: store.sampleDir(context.sampleVideoId),
        store,
        contactSheetGenerator: reviewer.contactSheetGenerator,
      }),
      outputSummary: (sheets) => ({
        sheetCount: sheets.filter((sheet) => sheet.localImagePath).length,
        emptySheetCount: sheets.filter((sheet) => sheet.empty).length,
      }),
    });
    return {
      result,
      resultSheets,
      run: {
        provider: "codex-appserver",
        role: reviewer.role,
        traceId: `${context.traceContext.traceId}:transform`,
        profilePath: roleProfile.profilePath ?? null,
        profileVersion: roleProfile.profileVersion ?? null,
        initFingerprint: contentHash(JSON.stringify({
          profileVersion: roleProfile.profileVersion ?? null,
          initTemplateHash: roleProfile.init?.templateHash ?? null,
          skillPath: reviewer.skillPath ?? null,
        })),
        skillHash: context.reviewSkillHash ?? null,
        threadId: lease.thread_id,
        leaseId: lease.lease_id,
        turnId: collected.turnId ?? started.turnId ?? null,
        promptTemplateId: transformTurn.promptTemplateId,
        promptTemplateVersion: transformTurn.promptTemplateVersion,
        promptTemplateHash: transformTurn.promptTemplateHash,
      },
    };
  } catch (error) {
    if (lease?.thread_id) {
      await threadPool.discardThread({ threadId: lease.thread_id, reason: "shot-boundary-transform-failed" }).catch(() => undefined);
      await threadPool.releaseOwnerLeases?.(`${context.traceContext.traceId}:transform`).catch(() => undefined);
    }
    throw error;
  }
}

async function collectTurn({
  context,
  stageName,
  artifactId,
  parentArtifactId,
  threadId,
  turnId,
  appServer,
  rootDir,
  runStage,
  inputSummary,
  outputSummary,
  updateActiveThreadMessage,
  activeMessageOptions,
  maxAttempts = 90,
  intervalMs = 2000,
  incompleteCode,
  incompleteMessage,
}) {
  let collected = null;
  const attempts = Math.max(1, Number(maxAttempts || 1));
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (attempt > 1) await delay(intervalMs);
    collected = await runStage(context, stageName, 93, {
      artifactId,
      parentArtifactId,
      inputSummary: inputSummary(attempt),
      action: () => appServer.collectTurnResult({
        workspaceRoot: rootDir,
        threadId,
        turnId,
        timeoutSeconds: 120,
      }),
      outputSummary: (result) => outputSummary(result, attempt),
    });
    await updateActiveThreadMessage?.(collected.threadId, collected.turnId, collected.activeThreadMessage ?? null, collected.status, activeMessageOptions);
    if (collected.status === "completed") return collected;
    if (!isPendingTurnStatus(collected.status)) break;
  }
  const error = require("../shot-boundary-analysis").codedError(incompleteCode, incompleteMessage, {
    turnId: collected?.turnId ?? turnId ?? null,
    status: collected?.status ?? null,
    finalMessagePreview: safePreview(collected?.finalMessage),
    activeThreadMessagePreview: safePreview(collected?.activeThreadMessage),
  }, true);
  context.activeStage = {
    stageName,
    artifactId,
    parentArtifactId,
    inputSummary: inputSummary(attempts),
    outputSummary: outputSummary(collected ?? {}, attempts),
    startedAt: Date.now(),
  };
  throw error;
}

function safePreview(value, maxLength = 200) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, maxLength) : null;
}

function isPendingTurnStatus(status) {
  return ["created", "pending", "queued", "submitted", "running", "inprogress", "in_progress", "collecting"].includes(String(status ?? "").trim().toLowerCase());
}

function delay(ms) {
  const duration = Math.max(0, Number(ms || 0));
  return duration > 0 ? new Promise((resolve) => setTimeout(resolve, duration)) : Promise.resolve();
}

const { contentHash } = require("../shot-boundary-analysis");

module.exports = {
  writeCompletedAnalysis,
};
