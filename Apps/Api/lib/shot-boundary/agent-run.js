function isShotStage(stageName, stages) {
  return Object.values(stages).includes(stageName);
}

function isInterruptedPreAgentJob(job, sampleStatus, stages) {
  if (!job || job.agentRun) return false;
  if (![sampleStatus.pending, sampleStatus.processing].includes(job.status)) return false;
  return isShotStage(job.stage, stages);
}

function buildAgentRun({ context, lease, turn, prepared, contactSheets, role, skillPath, roleProfile, promptTemplate, initFingerprint }) {
  const now = new Date().toISOString();
  const resolvedRoleProfile = roleProfile === undefined ? context.roleProfile : roleProfile;
  const resolvedPromptTemplate = promptTemplate === undefined ? context.promptTemplate : promptTemplate;
  const resolvedInitFingerprint = initFingerprint === undefined ? context.initFingerprint : initFingerprint;
  return {
    provider: "codex-appserver",
    role,
    profilePath: resolvedRoleProfile?.profilePath ?? null,
    profileVersion: resolvedRoleProfile?.profileVersion ?? null,
    promptTemplateId: resolvedPromptTemplate?.promptTemplateId ?? null,
    promptTemplateVersion: resolvedPromptTemplate?.promptTemplateVersion ?? null,
    promptTemplateHash: resolvedPromptTemplate?.promptTemplateHash ?? null,
    initFingerprint: resolvedInitFingerprint ?? null,
    skillPath: context.skillPath ?? skillPath,
    skillHash: context.skillHash ?? null,
    workspaceRoot: context.rawWorkspaceRoot ?? context.roleProfile?.workspaceRoot ?? null,
    leaseId: lease?.lease_id ?? null,
    threadId: lease?.thread_id ?? turn.threadId ?? null,
    turnId: turn.turnId ?? null,
    traceId: context.traceContext.traceId,
    artifactId: context.artifactId,
    parentArtifactId: prepared.sourceArtifactId ?? null,
    sampleVideoId: context.sampleVideoId,
    analysisFps: context.analysisFps,
    enableReview: context.enableReview !== false,
    reviewMode: context.enableReview === false ? "unreviewed" : "reviewed",
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
    inputMode: context.inputMode ?? "multi_contact_sheet",
    rawVideoPathInfo: context.rawVideoPathInfo ?? null,
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
    roleProfile: {
      profilePath: agentRun.profilePath ?? null,
      profileVersion: agentRun.profileVersion ?? null,
    },
    promptTemplate: {
      promptTemplateId: agentRun.promptTemplateId ?? null,
      promptTemplateVersion: agentRun.promptTemplateVersion ?? null,
      promptTemplateHash: agentRun.promptTemplateHash ?? null,
    },
    initFingerprint: agentRun.initFingerprint ?? null,
    skillPath: agentRun.skillPath ?? skillPath,
    skillHash: agentRun.skillHash ?? null,
    rawWorkspaceRoot: agentRun.workspaceRoot ?? null,
    enableReview: agentRun.enableReview !== false,
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
