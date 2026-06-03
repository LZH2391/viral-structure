const { contentHash } = require("../shot-boundary-analysis");
const { codedError } = require("../shot-boundary-analysis/shared");
const { buildActiveTurnBinding, collectTurn, safePreview, startTurn } = require("./result-writer-active-turn");

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
        codedError: codedError,
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
        initFingerprint: context.initFingerprint ?? contentHash(JSON.stringify({
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

module.exports = { runTransformTurn };
