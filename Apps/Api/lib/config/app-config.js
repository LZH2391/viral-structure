const fs = require("fs");
const path = require("path");

const CONFIG_DIR_NAME = "Config";
const DEFAULT_CONFIG_FILES = ["app.config.jsonc", "app.config.json"];
const DEFAULT_DOUBAO_SAUC_RESOURCE_ID = "volc.bigasr.sauc.duration";
const DEFAULT_RAW_ANALYSIS_WORKSPACE_ROOT = "C:\\Users\\Administrator\\Documents\\Codex";

function loadAppConfig({ rootDir, env = process.env } = {}) {
  if (!rootDir) throw new Error("rootDir is required for app config");
  const explicitConfigPath = normalizeText(env.APP_CONFIG_PATH);
  const config = {};

  for (const fileName of DEFAULT_CONFIG_FILES) mergeInto(config, readJsonIfExists(path.join(rootDir, CONFIG_DIR_NAME, fileName)));
  if (explicitConfigPath) mergeInto(config, readJsonIfExists(path.resolve(explicitConfigPath), { required: true }));

  return normalizeAppConfig(config, env);
}

function normalizeAppConfig(config, env) {
  const imageGeneration = config.imageGeneration && typeof config.imageGeneration === "object" ? config.imageGeneration : {};
  const subtitleRecognition = config.subtitleRecognition && typeof config.subtitleRecognition === "object" ? config.subtitleRecognition : {};
  const media = config.media && typeof config.media === "object" ? config.media : {};
  const shotBoundary = config.shotBoundary && typeof config.shotBoundary === "object" ? config.shotBoundary : {};
  const provider = normalizeText(env.IMAGE_GENERATION_PROVIDER) ?? normalizeText(imageGeneration.provider) ?? "pptoken";
  const rawAnalysisWorkspaceRoot = normalizeText(env.SHOT_RAW_ANALYSIS_WORKSPACE_ROOT)
    ?? normalizeText(shotBoundary.rawAnalysisWorkspaceRoot)
    ?? DEFAULT_RAW_ANALYSIS_WORKSPACE_ROOT;
  return {
    imageGeneration: {
      provider,
      apiKey: normalizeText(env.IMAGE_GENERATION_API_KEY)
        ?? normalizeText(imageGeneration.apiKey)
        ?? (provider === "openai" ? normalizeText(env.OPENAI_API_KEY) : null),
      generationsUrl: normalizeText(env.IMAGE_GENERATION_GENERATIONS_URL)
        ?? normalizeText(imageGeneration.generationsUrl)
        ?? "https://api.pptoken.cc/v1/images/generations",
      editsUrl: normalizeText(env.IMAGE_GENERATION_EDITS_URL)
        ?? normalizeText(imageGeneration.editsUrl)
        ?? "https://api.pptoken.cc/v1/images/edits",
    },
    subtitleRecognition: {
      provider: "doubao-sauc",
      appKey: normalizeText(env.DOUBAO_SAUC_APP_KEY)
        ?? normalizeText(env.DOUBAO_Api_App_Key)
        ?? normalizeText(subtitleRecognition.appKey)
        ?? null,
      accessKey: normalizeText(env.DOUBAO_SAUC_ACCESS_KEY)
        ?? normalizeText(env.DOUBAO_Api_Access_Key)
        ?? normalizeText(subtitleRecognition.accessKey)
        ?? null,
      resourceId: normalizeText(env.DOUBAO_SAUC_RESOURCE_ID)
        ?? normalizeText(subtitleRecognition.resourceId)
        ?? DEFAULT_DOUBAO_SAUC_RESOURCE_ID,
      wsUrl: normalizeText(env.DOUBAO_SAUC_WS_URL) ?? normalizeText(subtitleRecognition.wsUrl) ?? null,
      modelName: normalizeText(env.DOUBAO_SAUC_MODEL_NAME) ?? normalizeText(subtitleRecognition.modelName) ?? null,
    },
    media: {
      ffmpegBinDir: normalizeText(env.FFMPEG_BIN_DIR) ?? normalizeText(media.ffmpegBinDir) ?? null,
    },
    shotBoundary: {
      rawAnalysisWorkspaceRoot,
      videoShotSkillPath: normalizeText(env.SHOT_VIDEO_SKILL_PATH)
        ?? normalizeText(shotBoundary.videoShotSkillPath)
        ?? path.join(rawAnalysisWorkspaceRoot, ".agents", "skills", "video-shot", "SKILL.md"),
    },
  };
}

function readJsonIfExists(filePath, { required = false } = {}) {
  try {
    if (!fs.existsSync(filePath)) {
      if (required) throw new Error(`Config file not found: ${filePath}`);
      return {};
    }
    const parsed = JSON.parse(stripJsonComments(fs.readFileSync(filePath, "utf8")));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`Config file must be a JSON object: ${filePath}`);
    return parsed;
  } catch (error) {
    if (required || fs.existsSync(filePath)) {
      error.message = `Failed to load app config ${filePath}: ${error.message}`;
      throw error;
    }
    return {};
  }
}

function mergeInto(target, source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) return target;
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      if (!target[key] || typeof target[key] !== "object" || Array.isArray(target[key])) target[key] = {};
      mergeInto(target[key], value);
      continue;
    }
    target[key] = value;
  }
  return target;
}

function normalizeText(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || null;
}

function stripJsonComments(text) {
  return String(text ?? "")
    .replace(/^\uFEFF/, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/(^|[^:])\/\/.*$/g, "$1"))
    .join("\n");
}

module.exports = {
  loadAppConfig,
  normalizeAppConfig,
  stripJsonComments,
};
