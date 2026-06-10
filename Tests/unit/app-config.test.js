const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { loadAppConfig, normalizeAppConfig } = require("../../Apps/Api/lib/config/app-config");

test("app config loads commented app config", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bd-app-config-"));
  const configDir = path.join(root, "Config");
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, "app.config.jsonc"), `{
    // single user config
    "imageGeneration": {
      "provider": "pptoken",
      "apiKey": "file-key",
      "generationsUrl": "https://example.test/v1/images/generations",
      "editsUrl": "https://example.test/v1/images/edits"
    },
    "subtitleRecognition": {
      "appKey": "file-app-key",
      "accessKey": "file-access-key",
      "resourceId": "resource-from-default"
    }
  }`, "utf8");

  const config = loadAppConfig({ rootDir: root, env: {} });

  assert.equal(config.imageGeneration.provider, "pptoken");
  assert.equal(config.imageGeneration.apiKey, "file-key");
  assert.equal(config.imageGeneration.generationsUrl, "https://example.test/v1/images/generations");
  assert.equal(config.imageGeneration.editsUrl, "https://example.test/v1/images/edits");
  assert.equal(config.subtitleRecognition.resourceId, "resource-from-default");
  assert.equal(config.subtitleRecognition.appKey, "file-app-key");
  assert.equal(config.subtitleRecognition.accessKey, "file-access-key");
});

test("app config uses new image generation env names as overrides", () => {
  const config = normalizeAppConfig({
    imageGeneration: {
      provider: "pptoken",
      apiKey: "file-key",
      generationsUrl: "https://file.test/generations",
      editsUrl: "https://file.test/edits",
    },
  }, {
    IMAGE_GENERATION_PROVIDER: "openai",
    IMAGE_GENERATION_API_KEY: "env-key",
    IMAGE_GENERATION_GENERATIONS_URL: "https://env.test/generations",
    IMAGE_GENERATION_EDITS_URL: "https://env.test/edits",
  });

  assert.deepEqual(config.imageGeneration, {
    provider: "openai",
    apiKey: "env-key",
    generationsUrl: "https://env.test/generations",
    editsUrl: "https://env.test/edits",
  });
});

test("openai image generation config can fall back to OPENAI_API_KEY", () => {
  const config = normalizeAppConfig({
    imageGeneration: {
      provider: "openai",
    },
  }, {
    OPENAI_API_KEY: "openai-key",
  });

  assert.equal(config.imageGeneration.apiKey, "openai-key");
});

test("app config normalizes media and shot boundary overrides", () => {
  const config = normalizeAppConfig({
    media: {
      ffmpegBinDir: "C:/ffmpeg/bin",
    },
    shotBoundary: {
      rawAnalysisWorkspaceRoot: "D:/CodexWorkspace",
    },
  }, {});

  assert.equal(config.media.ffmpegBinDir, "C:/ffmpeg/bin");
  assert.equal(config.shotBoundary.rawAnalysisWorkspaceRoot, "D:/CodexWorkspace");
  assert.equal(config.shotBoundary.videoShotSkillPath, path.join("D:/CodexWorkspace", ".agents", "skills", "video-shot", "SKILL.md"));
});
