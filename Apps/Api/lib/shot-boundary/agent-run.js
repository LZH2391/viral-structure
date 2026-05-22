function isShotStage(stageName, stages) {
  return Object.values(stages).includes(stageName);
}

function isInterruptedPreAgentJob(job, sampleStatus, stages) {
  if (!job || job.agentRun) return false;
  if (![sampleStatus.pending, sampleStatus.processing].includes(job.status)) return false;
  return isShotStage(job.stage, stages);
}

function buildAgentRun({ context, lease, turn, prepared, contactSheets, role, skillPath }) {
  const now = new Date().toISOString();
  return {
    provider: "codex-appserver",
    role,
    skillPath: context.skillPath ?? skillPath,
    skillHash: context.skillHash ?? null,
    leaseId: lease.lease_id,
    threadId: lease.thread_id,
    turnId: turn.turnId ?? null,
    traceId: context.traceContext.traceId,
    artifactId: context.artifactId,
    parentArtifactId: prepared.sourceArtifactId ?? null,
    sampleVideoId: context.sampleVideoId,
    analysisFps: context.analysisFps,
    status: "turn_submitted",
    contactSheets,
    preparedInputSummary: {
      frameCount: prepared.frames.length,
      requestedFps: prepared.analysisSampling.requestedFps,
      selectedFrameCount: prepared.analysisSampling.selectedFrameCount,
      effectiveFps: prepared.analysisSampling.effectiveFps,
      selectionPolicy: prepared.analysisSampling.selectionPolicy,
      sheetCount: contactSheets.length,
      subtitleSegmentCount: prepared.subtitleContextSummary?.subtitleSegmentCount ?? 0,
      subtitleTextHash: prepared.subtitleContextSummary?.subtitleTextHash ?? null,
      subtitleTruncated: Boolean(prepared.subtitleContextSummary?.truncated),
    },
    startedAt: now,
    updatedAt: now,
  };
}

function createRecoveredContext({ job, agentRun, sampleArtifact, skillPath }) {
  return {
    sampleVideoId: agentRun.sampleVideoId,
    analysisFps: agentRun.analysisFps,
    sampleArtifact,
    traceContext: {
      runId: agentRun.traceId,
      traceId: agentRun.traceId,
      stageId: `stage_recover_${Date.now()}`,
    },
    artifactId: agentRun.artifactId,
    skillPath: agentRun.skillPath ?? skillPath,
    skillHash: agentRun.skillHash ?? null,
    cacheDecision: "refresh",
    job,
    activeStage: null,
  };
}

function isRetryableCollectError(error) {
  const code = String(error?.code ?? "");
  return ["appserver_bridge_failed", "appserver_bridge_timeout", "appserver_turn_collect_failed"].includes(code);
}

module.exports = {
  isShotStage,
  isInterruptedPreAgentJob,
  buildAgentRun,
  createRecoveredContext,
  isRetryableCollectError,
};
