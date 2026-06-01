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
  activeTurnRuntime,
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
    activeTurnRuntime,
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
    repairAttemptCount: transform.run.repairAttemptCount ?? 0,
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
      phase: agentRun.role ?? "raw_video_analyze",
      threadId: agentRun.threadId,
      turnId: turn.turnId,
      leaseId: agentRun.leaseId ?? null,
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
      repairAttemptCount: transform.run.repairAttemptCount ?? 0,
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
      await finalizeLease(threadPool, transform.run);
      return shotAnalysis;
    },
    outputSummary: (result) => ({
      status: result.status,
      sheetCount: result.contactSheets?.length ?? 0,
      boundaryCount: result.boundaries?.length ?? 0,
      shotCount: result.shots.length,
      artifactType: result.type,
      resultOrigin: result.resultOrigin,
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
  activeTurnRuntime,
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
      action: () => startTurn({
        appServer,
        activeTurnRuntime,
        workspaceRoot: rootDir,
        threadId: lease.thread_id,
        inputs: transformTurn.inputs,
        timeoutSeconds: 240,
        binding: buildActiveTurnBinding({
          context,
          lease,
          stageName: stages.reviewStarted,
          role: reviewer.role,
          prompt: transformTurn,
          sourceTurnId: turn.turnId,
          attemptKind: "transform",
          parentArtifactId: prepared.sourceArtifactId,
        }),
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
      activeTurnRuntime,
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
    let result;
    let collectedForResult = collected;
    let promptForResult = transformTurn;
    let repairAttemptCount = 0;
    try {
      result = await runStage(context, stages.reviewValidated, 94, {
        artifactId: context.artifactId,
        parentArtifactId: prepared.sourceArtifactId,
        inputSummary: { role: reviewer.role, threadId: lease.thread_id, turnId: collected.turnId },
        action: () => reviewer.validateTransformResult(collected.finalMessage, prepared, collected),
        outputSummary: (value) => reviewer.summarizeTransformResult(value),
      });
    } catch (error) {
      if (!canAttemptTransformRepair(error, reviewer)) throw error;
      repairAttemptCount = 1;
      const repaired = await runTransformRepairTurn({
        context,
        rawTurn: turn,
        prepared,
        validationError: error,
        priorTurnOutput: collected.finalMessage,
        repairAttemptCount,
        roleProfile,
        lease,
        appServer,
        activeTurnRuntime,
        rootDir,
        reviewer,
        runStage,
        stages,
        updateActiveThreadMessage,
      });
      result = repaired.result;
      collectedForResult = repaired.collected;
      promptForResult = repaired.repairTurn;
    }
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
    const visualSheetCount = resultSheets.filter((sheet) => sheet.localImagePath).length;
    if (visualSheetCount > 0) {
      const visualSummaryTurn = reviewer.renderVisualSummaryTurnInputs({
        result,
        resultSheets,
        prepared,
        roleProfile,
      });
      const visualStarted = await runStage(context, stages.visualSummaryStarted, 96, {
        artifactId: context.artifactId,
        parentArtifactId: prepared.sourceArtifactId,
        inputSummary: { role: reviewer.role, threadId: lease.thread_id, leaseId: lease.lease_id, shotCount: result.shots.length, sheetCount: visualSheetCount },
        action: () => startTurn({
          appServer,
          activeTurnRuntime,
          workspaceRoot: rootDir,
          threadId: lease.thread_id,
          inputs: visualSummaryTurn.inputs,
          timeoutSeconds: 240,
          binding: buildActiveTurnBinding({
            context,
            lease,
            stageName: stages.visualSummaryStarted,
            role: reviewer.role,
            prompt: visualSummaryTurn,
            sourceTurnId: collectedForResult.turnId ?? started.turnId ?? null,
            attemptKind: "visual-summary",
            parentArtifactId: prepared.sourceArtifactId,
          }),
        }),
        outputSummary: (value) => ({
          role: reviewer.role,
          threadId: value.threadId,
          turnId: value.turnId,
          status: value.status,
          promptTemplateId: visualSummaryTurn.promptTemplateId,
          promptTemplateVersion: visualSummaryTurn.promptTemplateVersion,
          promptTemplateHash: visualSummaryTurn.promptTemplateHash,
        }),
      });
      const visualCollected = await collectTurn({
        context,
        stageName: stages.visualSummaryCollected,
        artifactId: context.artifactId,
        parentArtifactId: prepared.sourceArtifactId,
        threadId: lease.thread_id,
        turnId: visualStarted.turnId,
        appServer,
        activeTurnRuntime,
        rootDir,
        runStage,
        inputSummary: (attempt) => ({ role: reviewer.role, threadId: lease.thread_id, turnId: visualStarted.turnId, attempt }),
        outputSummary: (value, attempt) => ({
          role: reviewer.role,
          threadId: value.threadId,
          turnId: value.turnId,
          status: value.status,
          attempt,
          finalMessagePreview: safePreview(value.finalMessage),
        }),
        updateActiveThreadMessage,
        activeMessageOptions: {
          role: reviewer.role,
          fallbackMessage: "正在修正镜头画面摘要",
        },
        maxAttempts: reviewer.reviewCollectMaxAttempts,
        intervalMs: reviewer.reviewPollIntervalMs,
        incompleteCode: "shot_boundary_visual_summary_turn_incomplete",
        incompleteMessage: "镜头画面摘要 Agent 未完成",
      });
      const visualSummary = await runStage(context, stages.visualSummaryValidated, 97, {
        artifactId: context.artifactId,
        parentArtifactId: prepared.sourceArtifactId,
        inputSummary: { role: reviewer.role, threadId: lease.thread_id, turnId: visualCollected.turnId, shotCount: result.shots.length },
        action: () => reviewer.validateVisualSummaryResult(visualCollected.finalMessage, result.shots, visualCollected),
        outputSummary: (value) => reviewer.summarizeVisualSummaryResult(value),
      });
      result = reviewer.applyVisualSummaryResult(result, visualSummary);
    }
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
        turnId: collectedForResult.turnId ?? started.turnId ?? null,
        promptTemplateId: promptForResult.promptTemplateId,
        promptTemplateVersion: promptForResult.promptTemplateVersion,
        promptTemplateHash: promptForResult.promptTemplateHash,
        repairAttemptCount,
      },
    };
  } catch (error) {
    if (lease?.lease_id) {
      await threadPool.releaseLease?.({
        leaseId: lease.lease_id,
        ownerId: `${context.traceContext.traceId}:transform`,
      }).catch(() => undefined);
    } else if (lease?.thread_id) {
      await threadPool.releaseOwnerLeases?.(`${context.traceContext.traceId}:transform`).catch(() => undefined);
    }
    throw error;
  }
}

async function runTransformRepairTurn({
  context,
  rawTurn,
  prepared,
  validationError,
  priorTurnOutput,
  repairAttemptCount,
  roleProfile,
  lease,
  appServer,
  activeTurnRuntime,
  rootDir,
  reviewer,
  runStage,
  stages,
  updateActiveThreadMessage,
}) {
  const repairTurn = reviewer.renderRepairTurnInputs({
    prepared,
    rawFinalMessage: rawTurn.finalMessage,
    validationError,
    priorTurnOutput,
    repairAttemptCount,
    roleProfile,
  });
  const started = await runStage(context, stages.reviewRepairStarted, 94, {
    artifactId: context.artifactId,
    parentArtifactId: prepared.sourceArtifactId,
    inputSummary: {
      role: reviewer.role,
      threadId: lease.thread_id,
      leaseId: lease.lease_id,
      rawTurnId: rawTurn.turnId,
      repairAttemptCount,
      validatorCode: validationError?.debugPayload?.validation?.validatorCode ?? validationError?.code ?? null,
    },
    action: () => startTurn({
      appServer,
      activeTurnRuntime,
      workspaceRoot: rootDir,
      threadId: lease.thread_id,
      inputs: repairTurn.inputs,
      timeoutSeconds: 240,
      binding: buildActiveTurnBinding({
        context,
        lease,
        stageName: stages.reviewRepairStarted,
        role: reviewer.role,
        prompt: repairTurn,
        sourceTurnId: rawTurn.turnId,
        attemptKind: `transform-repair-${repairAttemptCount}`,
        parentArtifactId: prepared.sourceArtifactId,
      }),
    }),
    outputSummary: (result) => ({
      role: reviewer.role,
      threadId: result.threadId,
      turnId: result.turnId,
      status: result.status,
      promptTemplateId: repairTurn.promptTemplateId,
      promptTemplateVersion: repairTurn.promptTemplateVersion,
      promptTemplateHash: repairTurn.promptTemplateHash,
      repairAttemptCount,
    }),
  });
  const collected = await collectTurn({
    context,
    stageName: stages.reviewRepairCollected,
    artifactId: context.artifactId,
    parentArtifactId: prepared.sourceArtifactId,
    threadId: lease.thread_id,
    turnId: started.turnId,
    appServer,
    activeTurnRuntime,
    rootDir,
    runStage,
    inputSummary: (attempt) => ({ role: reviewer.role, threadId: lease.thread_id, turnId: started.turnId, attempt, repairAttemptCount }),
    outputSummary: (result, attempt) => ({
      role: reviewer.role,
      threadId: result.threadId,
      turnId: result.turnId,
      status: result.status,
      attempt,
      repairAttemptCount,
      finalMessagePreview: safePreview(result.finalMessage),
    }),
    updateActiveThreadMessage,
    activeMessageOptions: {
      role: reviewer.role,
      fallbackMessage: "正在修复切镜转换结果",
    },
    maxAttempts: reviewer.reviewCollectMaxAttempts,
    intervalMs: reviewer.reviewPollIntervalMs,
    incompleteCode: "shot_boundary_transform_repair_turn_incomplete",
    incompleteMessage: "切镜结果转换修复 Agent 未完成",
  });
  const result = await runStage(context, stages.reviewRepairValidated, 94, {
    artifactId: context.artifactId,
    parentArtifactId: prepared.sourceArtifactId,
    inputSummary: { role: reviewer.role, threadId: lease.thread_id, turnId: collected.turnId, repairAttemptCount },
    action: () => reviewer.validateTransformResult(collected.finalMessage, prepared, collected),
    outputSummary: (value) => ({
      ...reviewer.summarizeTransformResult(value),
      repairAttemptCount,
    }),
  });
  return { result, collected, repairTurn };
}

function canAttemptTransformRepair(error, reviewer) {
  return typeof reviewer?.renderRepairTurnInputs === "function"
    && /^shot_boundary_transform_/.test(String(error?.code ?? ""));
}

async function collectTurn({
  context,
  stageName,
  artifactId,
  parentArtifactId,
  threadId,
  turnId,
  appServer,
  activeTurnRuntime,
  rootDir,
  runStage,
  inputSummary,
  outputSummary,
  updateActiveThreadMessage,
  activeMessageOptions,
  maxAttempts = 1800,
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
      action: () => collectActiveTurn({
        appServer,
        activeTurnRuntime,
        workspaceRoot: rootDir,
        threadId,
        turnId,
        timeoutSeconds: 120,
        traceContext: context.traceContext,
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

async function startTurn({ appServer, activeTurnRuntime, workspaceRoot, threadId, inputs, timeoutSeconds, binding }) {
  if (typeof activeTurnRuntime?.start === "function") {
    return activeTurnRuntime.start({ workspaceRoot, threadId, inputs, timeoutSeconds, binding });
  }
  const result = await appServer.startTurnWithInputs({ workspaceRoot, threadId, inputs, timeoutSeconds });
  if (typeof activeTurnRuntime?.register === "function" && result?.turnId && binding) {
    await activeTurnRuntime.register({
      ...binding,
      threadId: result.threadId ?? threadId,
      turnId: result.turnId,
      currentAttemptId: binding.currentAttemptId ?? result.turnId,
      status: result.status ?? "submitted",
    }).catch(() => null);
  }
  return result;
}

async function collectActiveTurn({ appServer, activeTurnRuntime, workspaceRoot, threadId, turnId, timeoutSeconds, traceContext }) {
  if (typeof activeTurnRuntime?.collect === "function") {
    return activeTurnRuntime.collect({ workspaceRoot, threadId, turnId, timeoutSeconds, traceContext });
  }
  const result = await appServer.collectTurnResult({ workspaceRoot, threadId, turnId, timeoutSeconds });
  await activeTurnRuntime?.markCollectResult?.({ turnId, result, traceContext }).catch(() => null);
  return result;
}

function buildActiveTurnBinding({ context, lease, stageName, role, prompt, sourceTurnId, attemptKind, parentArtifactId }) {
  const ownerId = context?.job?.jobId ?? context?.sampleVideoId ?? lease?.thread_id ?? null;
  if (!ownerId) return null;
  return {
    ownerType: "processing-job",
    ownerId,
    currentAttemptId: `${ownerId}:${stageName}:${attemptKind}:${context?.traceContext?.stageId ?? Date.now()}`,
    stageName,
    traceId: context?.traceContext?.traceId ?? null,
    runId: context?.traceContext?.runId ?? null,
    stageId: context?.traceContext?.stageId ?? null,
    artifactId: context?.artifactId ?? null,
    parentArtifactId: parentArtifactId ?? null,
    leaseId: lease?.lease_id ?? null,
    threadPoolOwnerId: `${context?.traceContext?.traceId ?? ownerId}:transform`,
    replayRef: {
      type: "processing-job-input",
      refId: ownerId,
      messageId: prompt?.promptTemplateId ?? null,
      sourceTurnId: sourceTurnId ?? null,
    },
  };
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
