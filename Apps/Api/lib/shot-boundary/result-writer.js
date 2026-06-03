const { runTransformTurn } = require("./result-writer-transform-turn");

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
  jobAgentRun = agentRun,
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
    agentRun: { ...jobAgentRun, status: "completed", updatedAt: new Date().toISOString() },
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

function safePreview(value, maxLength = 200) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, maxLength) : null;
}

module.exports = {
  writeCompletedAnalysis,
};
