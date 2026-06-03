function createShotBoundaryCollector({
  collectingJobs,
  jobStore,
  sampleStatus,
  loadSampleArtifact,
  createRecoveredContext,
  skillPath,
  rawAnalyzerRole,
  role,
  reviewRole,
  reviewSkillPath,
  loadRoleProfileByRole,
  buildTransformPromptTemplate,
  resolveSkillHash,
  orphanTtlMs,
  codedError,
  failAgentRun,
  executorRegistry,
  stages,
  rawWorkspaceRoot,
  runStage,
  updateActiveThreadMessage,
  isRetryableCollectError,
  markRetryableCollectFailure,
  scheduleCollect,
  finalizeLease,
  threadPool,
  markAgentRunLeaseReleased,
  writeCompletedAnalysis,
  prepareInput,
  store,
  buildProcessedAnalysis,
  attachAnalysis,
  artifactIndex,
  resolveExistingFileHash,
  appServer,
  activeTurnRuntime,
  rootDir,
  reviewer,
}) {
  return async function collectAgentRun(jobId) {
    if (collectingJobs.has(jobId)) return collectingJobs.get(jobId);
    const task = (async () => {
      const job = jobStore.getJob(jobId);
      const agentRun = job?.agentRun;
      if (job?.status === sampleStatus.processed || job?.status === sampleStatus.failed) return { status: job.status };
      if (!job || !agentRun || !agentRun.threadId || !agentRun.turnId) return null;
      const sampleArtifact = await loadSampleArtifact(agentRun.sampleVideoId);
      const context = createRecoveredContext({ job, agentRun, sampleArtifact, skillPath });
      context.roleProfile = agentRun.role === rawAnalyzerRole ? await loadRoleProfileByRole(rawAnalyzerRole) : null;
      context.reviewRoleProfile = await loadRoleProfileByRole(reviewRole);
      context.promptTemplate = buildTransformPromptTemplate(context.reviewRoleProfile);
      context.reviewSkillHash = await resolveSkillHash(reviewSkillPath);
      if (Date.now() - Date.parse(agentRun.startedAt) > orphanTtlMs) {
        const error = codedError("shot_boundary_turn_orphaned", "切镜 Agent 长时间未完成，已清理遗留 lease");
        await failAgentRun(context, error);
        return { status: sampleStatus.failed };
      }
      try {
        jobStore.updateJob(job.jobId, {
          agentRun: { ...agentRun, status: "collecting", updatedAt: new Date().toISOString() },
          stage: stages.turnCollected,
          status: sampleStatus.processing,
          progress: 88,
        });
        const turnExecution = await executorRegistry.execute("appserver-turn", {
          action: "collect-turn",
          stageName: stages.turnCollected,
          progress: 88,
          artifactId: agentRun.artifactId,
          parentArtifactId: agentRun.parentArtifactId,
          inputSummary: { role: agentRun.role ?? role, threadId: agentRun.threadId, leaseId: agentRun.leaseId ?? null, turnId: agentRun.turnId, sheetCount: agentRun.contactSheets?.length ?? 0 },
          workspaceRoot: context.roleProfile?.workspaceRoot ?? rawWorkspaceRoot,
          threadId: agentRun.threadId,
          turnId: agentRun.turnId,
          timeoutSeconds: 60,
          role: agentRun.role ?? role,
          ownerType: "processing-job",
          ownerId: job.jobId,
          currentAttemptId: `${job.jobId}:${stages.turnStarted}`,
        }, { runStage: (stageName, progress, options) => runStage(context, stageName, progress, options) });
        const turn = turnExecution.result;
        updateActiveThreadMessage(context, turn, {
          role: agentRun.role ?? role,
          fallbackMessage: "正在分析镜头边界",
        });
        if (turn.status !== "completed") {
          jobStore.updateJob(job.jobId, {
            agentRun: { ...agentRun, status: "collecting", updatedAt: new Date().toISOString() },
            stage: stages.turnCollected,
            status: sampleStatus.processing,
            progress: 88,
            errorSummary: null,
          });
          scheduleCollect(job.jobId);
          return turn;
        }
        if (!String(turn.finalMessage ?? "").trim()) {
          throw codedError("shot_raw_video_analyze_empty_result", "原始切镜分析未返回有效结果", {
            turnId: turn.turnId,
            status: turn.status,
            validation: { validatorCode: "shot_raw_video_analyze_empty_result" },
          }, false);
        }
        if (agentRun.leaseId) {
          await finalizeLease(threadPool, agentRun);
          const releasedAgentRun = markAgentRunLeaseReleased(agentRun);
          jobStore.updateJob(context.job.jobId, { agentRun: releasedAgentRun });
          context.job.agentRun = releasedAgentRun;
        }
        await writeCompletedAnalysis({
          context,
          agentRun,
          jobAgentRun: context.job.agentRun ?? agentRun,
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
          codedError,
          role: agentRun.role ?? rawAnalyzerRole,
          jobStore,
          sampleStatus,
          updateActiveThreadMessage: (threadId, turnId, message, status, options) => updateActiveThreadMessage(context, threadId, turnId, message, status, options),
        });
        return turn;
      } catch (error) {
        if (isRetryableCollectError(error)) {
          await markRetryableCollectFailure(context, error);
          scheduleCollect(job.jobId);
          return { status: "retrying" };
        }
        await failAgentRun(context, error);
        return { status: sampleStatus.failed };
      }
    })();
    collectingJobs.set(jobId, task);
    try {
      return await task;
    } finally {
      collectingJobs.delete(jobId);
    }
  };
}

module.exports = { createShotBoundaryCollector };
