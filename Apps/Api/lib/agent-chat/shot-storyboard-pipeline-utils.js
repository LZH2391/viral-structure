const fs = require("fs/promises");
const path = require("path");

function createPathHelpers({ rootDir, store }) {
  function resolveInsideRoot(value) {
    const text = normalizeText(value);
    if (!text) return null;
    const resolved = path.isAbsolute(text) || /^[A-Za-z]:[\\/]/.test(text)
      ? path.resolve(text)
      : path.resolve(rootDir, text);
    const root = path.resolve(rootDir);
    if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
      throw pipelineError("storyboard_prep_path_outside_workspace", "路径不在工作区内", { retryable: false, debugPayload: { value } });
    }
    return resolved;
  }

  function resolveRuntimeUri(uri) {
    const text = normalizeText(uri);
    if (!text) return null;
    if (text.startsWith("/runtime/")) return path.join(store.runtimeRoot, text.slice("/runtime/".length));
    if (text.startsWith("runtime/")) return path.join(store.runtimeRoot, text.slice("runtime/".length));
    return resolveInsideRoot(text);
  }

  function safeRelative(filePath) {
    if (!filePath) return null;
    return path.relative(rootDir, path.resolve(filePath)).replaceAll(path.sep, "/");
  }

  return { resolveInsideRoot, resolveRuntimeUri, safeRelative };
}

function validatePrepareResult(parsed, manifest) {
  if (manifest?.schemaVersion !== "shot-storyboard-prep.manifest.v1") {
    throw pipelineError("storyboard_prep_manifest_schema_invalid", "manifest schemaVersion 不正确", { retryable: true });
  }
  const manifestShots = Array.isArray(manifest.shots) ? manifest.shots : [];
  const groups = Array.isArray(manifest.storyboardGroups) ? manifest.storyboardGroups : [];
  const generatedShots = manifestShots.filter((shot) => shot.shouldGenerate);
  if (Number(parsed.generatedShotCount ?? 0) !== generatedShots.length) {
    throw pipelineError("storyboard_prep_manifest_count_mismatch", "generatedShotCount 与 manifest 不一致", {
      retryable: true,
      debugPayload: { parsedGeneratedShotCount: parsed.generatedShotCount, manifestGeneratedShotCount: generatedShots.length },
    });
  }
  const generatedPromptShots = new Set(groups
    .flatMap((group) => group.shots ?? [])
    .filter((shot) => !shot.isPad)
    .map((shot) => shot.shotId));
  const missingShotIds = generatedShots.map((shot) => shot.shotId).filter((shotId) => !generatedPromptShots.has(shotId));
  if (missingShotIds.length) {
    throw pipelineError("storyboard_prep_prompt_group_missing_shot", "自设计 shot 未进入 storyboard group", {
      retryable: true,
      validationErrors: missingShotIds.map((shotId) => ({ code: "missing_prompt_group_shot", shotId })),
    });
  }
  const leakedPads = groups.flatMap((group) => group.shots ?? []).filter((shot) => shot.isPad && !String(shot.shotId ?? "").startsWith("storyboard_blank_pad_"));
  if (leakedPads.length) {
    throw pipelineError("storyboard_prep_pad_marker_invalid", "pad 标记不规范", {
      retryable: true,
      validationErrors: leakedPads.map((shot) => ({ code: "invalid_pad_marker", shotId: shot.shotId ?? null })),
    });
  }
}

function validateImageArtifact(artifact, manifest) {
  const expected = manifest.storyboardGroups?.length ?? 0;
  const actual = artifact.storyboardGroups?.length ?? 0;
  if (expected !== actual) {
    throw pipelineError("storyboard_prep_image_group_count_mismatch", "生图 group 数和 manifest 不一致", {
      retryable: true,
      debugPayload: { expected, actual },
    });
  }
  for (const group of artifact.storyboardGroups ?? []) {
    if (!group.images?.length) {
      throw pipelineError("storyboard_prep_image_group_missing_image", "storyboard group 缺少图片", {
        retryable: true,
        debugPayload: { groupId: group.groupId },
      });
    }
  }
}

function validateCropResult(parsed, manifest) {
  const expected = (manifest.storyboardGroups ?? [])
    .flatMap((group) => group.shots ?? [])
    .filter((shot) => !shot.isPad).length;
  if (parsed.croppedCount !== expected) {
    throw pipelineError("storyboard_prep_crop_count_mismatch", "裁切数量和自设计 shot 数不一致", {
      retryable: true,
      debugPayload: { expected, actual: parsed.croppedCount },
    });
  }
}

async function assertFile(filePath, code, retryable) {
  try {
    await fs.access(filePath);
  } catch (error) {
    throw pipelineError(code, `${path.basename(filePath)} 不存在`, { retryable, cause: error, debugPayload: { filePath } });
  }
}

function parseJsonStdout(stdout, code, retryable) {
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw pipelineError(code, "脚本输出不是合法 JSON", { retryable, cause: error, debugPayload: { stdout: safePreview(stdout, 800) } });
  }
}

function pipelineError(code, message, { retryable = true, debugPayload = null, cause = null, validationErrors = null } = {}) {
  const error = new Error(message);
  error.code = code;
  error.retryable = retryable;
  error.debugPayload = debugPayload;
  error.validationErrors = validationErrors;
  if (cause) error.cause = cause;
  return error;
}

function safeError(error, stageName) {
  return {
    code: error?.code ?? "shot_storyboard_pipeline_failed",
    message: safePreview(error?.message ?? "Shot Storyboard Prep 失败", 300),
    stageName,
    retryable: typeof error?.retryable === "boolean" ? error.retryable : true,
    repairAttemptCount: error?.repairAttemptCount ?? null,
    debugSnapshotUri: null,
  };
}

function isRepairable(error) {
  return error?.retryable !== false && String(error?.code ?? "").includes("prepare");
}

function buildInputSummary(options) {
  return {
    sampleVideoId: normalizeText(options.sampleVideoId) || "function-slot-workflow",
    parentArtifactId: normalizeText(options.parentArtifactId || options.restructureArtifactId),
    restructureFinalPath: normalizeText(options.restructureFinalPath),
    shotDesignFinalPath: normalizeText(options.shotDesignFinalPath),
    userMaterialPackPath: normalizeText(options.userMaterialPackPath),
    confirmationId: normalizeText(options.confirmationId),
    runImageGeneration: options.runImageGeneration !== false,
    runPdfAgent: options.runPdfAgent !== false,
  };
}

function normalizeText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function safePreview(value, limit = 500) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length <= limit ? text : `${text.slice(0, limit)}...`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

module.exports = {
  assertFile,
  buildInputSummary,
  createPathHelpers,
  isRepairable,
  normalizeText,
  parseJsonStdout,
  pipelineError,
  readJson,
  safeError,
  safePreview,
  sleep,
  validateCropResult,
  validateImageArtifact,
  validatePrepareResult,
};
