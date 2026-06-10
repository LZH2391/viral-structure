const fs = require("fs/promises");
const path = require("path");
const { loadRoleProfileByRole, renderTurnTemplate } = require("../gateways/threadpool/role-profile-loader");
const {
  buildAgentRepairRequest,
  transformRestructureFinalFile,
} = require("../../../../Infrastructure/FunctionSlotRestructureDisplay/markdown-transformer");
const { buildRepairSnippet, safeRelative } = require("./restructure-auto-display-utils");

const AUTO_STAGE_NAME = "function.slot.restructure_display.auto_transform";
const REPAIR_ROLE = "function-slot-restructure-display-transformer";
const MAX_REPAIR_ATTEMPTS = 2;

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

module.exports = {
  MAX_REPAIR_ATTEMPTS,
  REPAIR_ROLE,
  transformWithRepair,
};
