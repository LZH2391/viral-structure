const path = require("path");
const { contentHash } = require("../shot-boundary-analysis");

function badRequestError(codedError, code, message) {
  const error = codedError(code, message, null, false);
  error.statusCode = 400;
  return error;
}

function buildInitFingerprint(context) {
  return contentHash(JSON.stringify({
    profileVersion: context.reviewRoleProfile?.profileVersion ?? null,
    initTemplateHash: context.reviewRoleProfile?.init?.templateHash ?? null,
    skillHash: context.reviewSkillHash ?? null,
    readyText: context.reviewRoleProfile?.init?.readyText ?? null,
  }));
}

function buildTransformPromptTemplate(roleProfile) {
  const prompt = roleProfile?.turnTemplates?.transform ?? {};
  return {
    promptTemplateId: "transform",
    promptTemplateVersion: prompt.templateVersion ?? null,
    promptTemplateHash: prompt.templateHash ?? null,
  };
}

function round(value) {
  return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null;
}

function normalizeEnableReview(value) {
  if (value === false || value === "false" || value === "0" || value === 0) return false;
  return true;
}

function reviewMode(context) {
  return context?.enableReview === false ? "unreviewed" : "reviewed";
}

function resolveRawVideoPath(sampleArtifact, runtimeRoot, codedError) {
  const originalUri = sampleArtifact?.sampleVideo?.original?.uri ?? null;
  const normalizedUri = sampleArtifact?.sampleVideo?.normalized?.uri ?? null;
  const targetUri = originalUri || normalizedUri;
  if (!targetUri) {
    throw codedError("shot_boundary_video_path_missing", "未找到可用于切镜的本地视频路径", {
      validation: {
        validatorCode: "shot_boundary_video_path_missing",
      },
    }, false);
  }
  const localPath = targetUri.startsWith("/runtime/")
    ? path.join(runtimeRoot, ...targetUri.slice("/runtime/".length).split("/"))
    : targetUri;
  if (!path.isAbsolute(localPath)) {
    throw codedError("shot_boundary_video_path_invalid", "切镜视频路径解析失败", {
      validation: {
        validatorCode: "shot_boundary_video_path_invalid",
      },
    }, false);
  }
  return localPath;
}

module.exports = {
  badRequestError,
  buildInitFingerprint,
  buildTransformPromptTemplate,
  round,
  normalizeEnableReview,
  reviewMode,
  resolveRawVideoPath,
};
