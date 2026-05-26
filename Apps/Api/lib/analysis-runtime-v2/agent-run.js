function createAgentRunBuilders({ role, skillPath, buildPreparedInputSummary }) {
  function buildAgentRun({ context, lease, turn, input }) {
    const now = new Date().toISOString();
    return {
      provider: "codex-appserver",
      role,
      profilePath: context.roleProfile?.profilePath ?? null,
      profileVersion: context.roleProfile?.profileVersion ?? null,
      promptTemplateId: context.promptTemplate?.promptTemplateId ?? null,
      promptTemplateVersion: context.promptTemplate?.promptTemplateVersion ?? null,
      promptTemplateHash: context.promptTemplate?.promptTemplateHash ?? null,
      skillPath: context.skillPath ?? skillPath,
      skillHash: context.skillHash ?? null,
      leaseId: lease.lease_id,
      threadId: lease.thread_id,
      turnId: turn.turnId ?? null,
      traceId: context.traceContext.traceId,
      artifactId: context.artifactId,
      parentArtifactId: input.parentArtifactId ?? null,
      sampleVideoId: context.sampleVideoId,
      status: "turn_submitted",
      preparedInputSummary: buildPreparedInputSummary({ context, input }),
      startedAt: now,
      updatedAt: now,
    };
  }

  function updateAgentRun(agentRun, context, turn) {
    return {
      ...(agentRun ?? {}),
      provider: "codex-appserver",
      role,
      profilePath: context.roleProfile?.profilePath ?? agentRun?.profilePath ?? null,
      profileVersion: context.roleProfile?.profileVersion ?? agentRun?.profileVersion ?? null,
      promptTemplateId: context.promptTemplate?.promptTemplateId ?? agentRun?.promptTemplateId ?? null,
      promptTemplateVersion: context.promptTemplate?.promptTemplateVersion ?? agentRun?.promptTemplateVersion ?? null,
      promptTemplateHash: context.promptTemplate?.promptTemplateHash ?? agentRun?.promptTemplateHash ?? null,
      skillPath: context.skillPath ?? agentRun?.skillPath ?? skillPath,
      skillHash: context.skillHash ?? agentRun?.skillHash ?? null,
      threadId: agentRun?.threadId ?? null,
      leaseId: agentRun?.leaseId ?? null,
      turnId: turn.turnId ?? agentRun?.turnId ?? null,
      traceId: context.traceContext.traceId,
      status: "completed",
      updatedAt: new Date().toISOString(),
    };
  }

  return {
    buildAgentRun,
    updateAgentRun,
  };
}

module.exports = {
  createAgentRunBuilders,
};
