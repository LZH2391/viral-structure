const fs = require("fs/promises");
const path = require("path");
const { randomUUID } = require("crypto");
const { loadRoleProfileByRole, renderTurnTemplate } = require("../gateways/threadpool/role-profile-loader");
const { assertFile, safePreview } = require("./shot-storyboard-pipeline-utils");

const REPAIR_ROLE = "shot-storyboard-prep";
const MAX_REPAIR_ATTEMPTS = 2;

function createShotStoryboardRepairRunner({
  rootDir,
  threadPool = null,
  appServer = null,
  resolveInputs,
  safeRelative,
} = {}) {
  async function runRepairTurn({ options, error, repairAttemptCount, shotDesignPathOverride, artifactId, parentArtifactId }) {
    if (!threadPool?.ensureRoleReady || !threadPool?.acquireLease || !threadPool?.releaseLease || !appServer?.runTurnWithInputs) {
      throw error;
    }
    const resolved = await resolveInputs(options, shotDesignPathOverride);
    const repairedPath = path.join(resolved.baseDir, `shot-design.final.repair-attempt-${repairAttemptCount}.md`);
    const repairRequestPath = path.join(resolved.baseDir, "shot-storyboard.repair-request.json");
    const repairRequest = buildRepairRequest({
      error,
      resolved,
      repairedPath,
      repairRequestPath,
      repairAttemptCount,
      artifactId,
      parentArtifactId,
      safeRelative,
    });
    await fs.writeFile(repairRequestPath, `${JSON.stringify(repairRequest, null, 2)}\n`, "utf8");
    const roleProfile = await loadRoleProfileByRole(REPAIR_ROLE);
    const prompt = renderTurnTemplate(roleProfile, "repairTurn", {
      repairAttemptCount,
      shotDesignFinalPath: safeRelative(resolved.shotDesignFinalPath),
      repairedPath: safeRelative(repairedPath),
      restructureFinalPath: safeRelative(resolved.restructureFinalPath),
      errorCode: repairRequest.error.code,
      errorMessage: repairRequest.error.safeMessage,
      validationErrorsJson: JSON.stringify(repairRequest.validationFailures ?? []),
      repairRequestJson: JSON.stringify(repairRequest, null, 2),
    });
    const ownerId = `shot-storyboard-repair-${repairRequest.runId}`;
    const readiness = await threadPool.ensureRoleReady(REPAIR_ROLE);
    if (!readiness?.ok) throw error;
    const lease = await threadPool.acquireLease({ role: REPAIR_ROLE, ownerId });
    const threadId = lease.thread_id ?? lease.threadId;
    const leaseId = lease.lease_id ?? lease.leaseId;
    if (!threadId || !leaseId) throw error;
    try {
      await appServer.runTurnWithInputs({
        workspaceRoot: rootDir,
        threadId,
        skillPath: readiness.status?.skillPath ?? roleProfile.skillPath ?? null,
        inputs: [{ type: "text", text: prompt.text, text_elements: [] }],
        timeoutSeconds: 180,
      });
      await assertFile(repairedPath, "storyboard_prep_repair_output_missing", true);
      return { repairedPath };
    } finally {
      await threadPool.releaseLease({ leaseId, ownerId }).catch(() => null);
    }
  }

  return { runRepairTurn };
}

function buildRepairRequest({ error, resolved, repairedPath, repairRequestPath, repairAttemptCount, artifactId, parentArtifactId, safeRelative }) {
  const validationFailures = Array.isArray(error.validationErrors) ? error.validationErrors : [];
  return {
    type: "shot-storyboard-prep-repair-request",
    schemaVersion: "shot-storyboard-prep.repair.v1",
    runId: `repair_${randomUUID()}`,
    failedStage: error.stageName ?? inferFailedStage(error.code),
    repairAttemptCount,
    maxRepairAttempts: MAX_REPAIR_ATTEMPTS,
    error: {
      code: error.code ?? "storyboard_prep_failed",
      safeMessage: safePreview(error.message, 300),
      retryable: error.retryable !== false,
    },
    source: {
      restructureFinalPath: safeRelative(resolved.restructureFinalPath),
      shotDesignFinalPath: safeRelative(resolved.shotDesignFinalPath),
      repairedPath: safeRelative(repairedPath),
      repairRequestPath: safeRelative(repairRequestPath),
      artifactId,
      parentArtifactId,
    },
    manifestSummary: summarizeManifest(error.debugPayload?.manifest),
    validationFailures,
    allowedRepairs: [
      "补齐或修正 shot-design.final.md 的 Shot 表字段。",
      "修正明显不合规的素材来源/处理策略。",
      "补齐可从上下文确定的 shot 字段。",
      "修复会导致 prompt/manifest 生成失败的格式问题。",
    ],
    forbiddenRepairs: [
      "不得修改已确认的 restructure.final.md 或槽位链核心结构。",
      "不得虚构素材事实、代表帧或 image-generation provider 结果。",
      "不得把 self-designed 以外的镜头强行改成自设计以绕过素材缺失。",
      "不得手工继续跑完整流水线；修复后交还后端重跑。",
    ],
    outputContract: {
      writeFile: safeRelative(repairedPath),
      finalMessage: "只返回简短中文状态，说明已写入 repairedPath。",
    },
  };
}

function inferFailedStage(code) {
  const text = String(code ?? "");
  if (text.includes("prepare")) return "function.slot.shot_storyboard_prep.prepare";
  if (text.includes("image_generation")) return "function.slot.shot_storyboard_prep.image_generation";
  if (text.includes("crop")) return "function.slot.shot_storyboard_prep.crop";
  if (text.includes("pdf")) return "function.slot.shot_storyboard_prep.pdf";
  return "function.slot.shot_storyboard_prep.pipeline";
}

function summarizeManifest(manifest) {
  if (!manifest || typeof manifest !== "object") return null;
  return {
    schemaVersion: manifest.schemaVersion ?? null,
    shotCount: Array.isArray(manifest.shots) ? manifest.shots.length : null,
    generatedShotCount: Array.isArray(manifest.shots) ? manifest.shots.filter((shot) => shot.shouldGenerate).length : null,
    groupCount: Array.isArray(manifest.storyboardGroups) ? manifest.storyboardGroups.length : null,
    warningCount: Array.isArray(manifest.warnings) ? manifest.warnings.length : null,
  };
}

module.exports = {
  MAX_REPAIR_ATTEMPTS,
  REPAIR_ROLE,
  buildRepairRequest,
  createShotStoryboardRepairRunner,
};
