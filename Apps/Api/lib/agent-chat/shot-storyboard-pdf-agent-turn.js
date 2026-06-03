const { loadRoleProfileByRole, renderTurnTemplate } = require("../gateways/threadpool/role-profile-loader");
const { normalizeText } = require("./shot-storyboard-pipeline-utils");
const { PDF_ROLE, PDF_STAGE_NAME, pdfAgentError } = require("./shot-storyboard-pdf-agent-shared");

async function runShotStoryboardPdfTurn({
  rootDir,
  threadPool,
  appServer,
  activeTurnRuntime,
  jobStore,
  jobId,
  traceContext,
  artifactId,
  parentArtifactId,
  inputPackagePath,
  pdfPath,
  summaryPath,
  layoutPath,
  safeRelative,
  retryContext = null,
} = {}) {
  if (!threadPool?.ensureRoleReady || !threadPool?.acquireLease || !threadPool?.releaseLease) {
    throw pdfAgentError("storyboard_prep_pdf_agent_runtime_unavailable", "PDF agent 缺少 ThreadPool 运行时", false);
  }
  if (!canRunPdfTurn({ appServer, activeTurnRuntime })) {
    throw pdfAgentError("storyboard_prep_pdf_agent_runtime_unavailable", "PDF agent 缺少 AppServer turn 运行能力", false);
  }
  const roleProfile = await loadRoleProfileByRole(PDF_ROLE);
  const prompt = renderTurnTemplate(roleProfile, "pdfTurn", {
    pdfInputPackagePath: safeRelative(inputPackagePath),
    pdfOutputPath: safeRelative(pdfPath),
    summaryOutputPath: safeRelative(summaryPath),
    layoutOutputPath: safeRelative(layoutPath),
    retryContextJson: JSON.stringify(retryContext ?? null, null, 2),
  });
  const ownerId = `shot-storyboard-pdf-${traceContext.runId}`;
  const readiness = await threadPool.ensureRoleReady(PDF_ROLE);
  if (!readiness?.ok) {
    throw pdfAgentError(
      readiness?.error ?? "storyboard_prep_pdf_agent_role_unavailable",
      readiness?.message || "PDF agent role 不可用",
      false,
      { readiness },
    );
  }
  const lease = await threadPool.acquireLease({ role: PDF_ROLE, ownerId });
  const threadId = lease.thread_id ?? lease.threadId;
  const leaseId = lease.lease_id ?? lease.leaseId;
  if (lease?.ok === false || !threadId || !leaseId) {
    throw pdfAgentError(
      lease?.error ?? lease?.code ?? "storyboard_prep_pdf_agent_lease_invalid",
      lease?.message ?? "PDF agent lease 缺少 threadId 或 leaseId",
      true,
      { lease },
    );
  }
  try {
    const binding = {
      ownerType: "processing-job",
      ownerId: jobId,
      currentAttemptId: `${jobId}:${traceContext.stageId}`,
      stageName: PDF_STAGE_NAME,
      traceId: traceContext.traceId,
      runId: traceContext.runId,
      stageId: traceContext.stageId,
      artifactId,
      parentArtifactId: parentArtifactId ?? null,
      leaseId,
      threadPoolOwnerId: ownerId,
      replayRef: {
        type: "shot-storyboard-pdf-input",
        refId: safeRelative(inputPackagePath),
      },
    };
    const turn = await startAndCollectPdfTurn({
      appServer,
      activeTurnRuntime,
      workspaceRoot: rootDir,
      threadId,
      skillPath: readiness.status?.skillPath ?? roleProfile.skillPath ?? null,
      inputs: [{ type: "text", text: prompt.text, text_elements: [] }],
      timeoutSeconds: 240,
      binding,
      traceContext,
      jobStore,
      jobId,
      agentRunBase: {
        provider: "codex-appserver",
        role: PDF_ROLE,
        profilePath: roleProfile.profilePath,
        profileVersion: roleProfile.profileVersion,
        promptTemplateId: prompt.promptTemplateId,
        promptTemplateVersion: prompt.promptTemplateVersion,
        promptTemplateHash: prompt.promptTemplateHash,
        skillPath: readiness.status?.skillPath ?? roleProfile.skillPath ?? null,
        leaseId,
        threadId,
        traceId: traceContext.traceId,
        artifactId,
        parentArtifactId: parentArtifactId ?? null,
      },
    });
    const terminalStatus = String(turn?.status ?? "").trim().toLowerCase();
    if (!["completed", "complete"].includes(terminalStatus)) {
      throw pdfAgentError("storyboard_prep_pdf_agent_turn_failed", "PDF agent turn 未成功完成", true, {
        status: turn?.status ?? null,
        finalMessage: turn?.finalMessage ?? turn?.message ?? null,
      });
    }
    return {
      agent: {
        role: PDF_ROLE,
        threadId,
        turnId: turn.turnId ?? turn.turn?.id ?? null,
        profilePath: roleProfile.profilePath,
        profileVersion: roleProfile.profileVersion,
        promptTemplateId: prompt.promptTemplateId,
        promptTemplateVersion: prompt.promptTemplateVersion,
        promptTemplateHash: prompt.promptTemplateHash,
        leaseId,
        finalMessage: normalizeText(turn.finalMessage ?? turn.message),
      },
    };
  } finally {
    await threadPool.releaseLease({ leaseId, ownerId }).catch(() => null);
  }
}

async function startAndCollectPdfTurn({
  appServer,
  activeTurnRuntime,
  workspaceRoot,
  threadId,
  skillPath,
  inputs,
  timeoutSeconds,
  binding,
  traceContext,
  jobStore,
  jobId,
  agentRunBase,
}) {
  if (activeTurnRuntime?.start && activeTurnRuntime?.collect) {
    try {
      const started = await activeTurnRuntime.start({
        workspaceRoot,
        threadId,
        skillPath,
        inputs,
        timeoutSeconds,
        binding,
        enforceThreadId: true,
      });
      const turnId = started.turnId ?? started.turn?.id ?? null;
      const currentAttemptId = binding.currentAttemptId ?? (turnId ? `${jobId}:${turnId}` : null);
      const submittedAgentRun = {
        ...agentRunBase,
        turnId,
        currentAttemptId,
        status: "turn_submitted",
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      jobStore?.updateJob?.(jobId, { agentRun: submittedAgentRun });
      jobStore?.updateJob?.(jobId, { agentRun: { ...submittedAgentRun, status: "collecting", updatedAt: new Date().toISOString() } });
      const collected = await activeTurnRuntime.collect({
        workspaceRoot,
        threadId: started.threadId ?? threadId,
        turnId,
        timeoutSeconds,
        traceContext,
        skipOwnerHandler: true,
      });
      const status = String(collected?.status ?? "").trim().toLowerCase();
      jobStore?.updateJob?.(jobId, {
        agentRun: {
          ...submittedAgentRun,
          status: ["completed", "complete"].includes(status) ? "completed" : "failed",
          updatedAt: new Date().toISOString(),
        },
      });
      return collected;
    } catch (error) {
      if (error?.code !== "appserver_turn_start_unavailable" || !appServer?.runTurnWithInputs) {
        throw pdfAgentError("storyboard_prep_pdf_agent_turn_failed", "PDF agent turn 执行失败", true, {
          code: error?.code ?? null,
          message: error?.message ?? null,
          debugPayload: error?.debugPayload ?? null,
        });
      }
    }
  }
  return startAndCollectWithFallback({
    appServer,
    workspaceRoot,
    threadId,
    skillPath,
    inputs,
    timeoutSeconds,
    binding,
    jobStore,
    jobId,
    agentRunBase,
  });
}

async function startAndCollectWithFallback({
  appServer,
  workspaceRoot,
  threadId,
  skillPath,
  inputs,
  timeoutSeconds,
  binding,
  jobStore,
  jobId,
  agentRunBase,
}) {
  const startedAt = new Date().toISOString();
  jobStore?.updateJob?.(jobId, {
    agentRun: {
      ...agentRunBase,
      turnId: null,
      currentAttemptId: binding.currentAttemptId,
      status: "collecting",
      startedAt,
      updatedAt: startedAt,
    },
  });
  try {
    const result = await appServer.runTurnWithInputs({
      workspaceRoot,
      threadId,
      skillPath,
      inputs,
      timeoutSeconds,
    });
    jobStore?.updateJob?.(jobId, {
      agentRun: {
        ...agentRunBase,
        turnId: result.turnId ?? result.turn?.id ?? null,
        currentAttemptId: binding.currentAttemptId,
        status: "completed",
        startedAt,
        updatedAt: new Date().toISOString(),
      },
    });
    return result;
  } catch (error) {
    jobStore?.updateJob?.(jobId, {
      agentRun: {
        ...agentRunBase,
        turnId: null,
        currentAttemptId: binding.currentAttemptId,
        status: "failed",
        startedAt,
        updatedAt: new Date().toISOString(),
      },
    });
    throw pdfAgentError("storyboard_prep_pdf_agent_turn_failed", "PDF agent turn 执行失败", true, {
      code: error?.code ?? null,
      message: error?.message ?? null,
      debugPayload: error?.debugPayload ?? null,
    });
  }
}

function canRunPdfTurn({ appServer, activeTurnRuntime }) {
  if (activeTurnRuntime?.start && activeTurnRuntime?.collect) return true;
  return Boolean(appServer?.runTurnWithInputs);
}

module.exports = {
  runShotStoryboardPdfTurn,
};
