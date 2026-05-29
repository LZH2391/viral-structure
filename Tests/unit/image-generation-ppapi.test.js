const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { createLocalStore } = require("../../Infrastructure/Storage/local-store");
const { createJobStore } = require("../../Apps/Api/lib/stores/job-store");
const { createImageGenerationService } = require("../../Apps/Api/lib/image-generation/service");
const { createPPAPIProvider, classifyHTTPError, normalizePPAPIResponse } = require("../../Apps/Api/lib/image-generation/ppapi-provider");
const { createImageGenerationModuleDefinition } = require("../../Apps/Api/lib/image-generation/module-definition");
const { parseStoryboardPromptMarkdown } = require("../../Apps/Api/lib/image-generation/storyboard-prompt-parser");

test("ppapi provider builds requests and normalizes image responses", async () => {
  const provider = createPPAPIProvider({
    apiKey: "test-key",
    requestImpl: async ({ body, headers }) => {
      assert.equal(body.model, "gpt-image-2");
      assert.equal(body.prompt, "draw a clean storyboard");
      assert.match(headers.Authorization, /^Bearer /);
      return { data: [{ b64_json: Buffer.from("fake-image").toString("base64") }] };
    },
  });

  const result = await provider.request({ prompt: "draw a clean storyboard" }, { timeoutSeconds: 1 });

  assert.equal(result.meta.imageCount, 1);
  assert.equal(result.meta.model, "gpt-image-2");
  assert.equal(result.payload.data.length, 1);
});

test("ppapi response parsing and http classification expose stable error codes", () => {
  const parsed = normalizePPAPIResponse(JSON.stringify({ images: [{ base64: "ZmFrZQ==" }] }), 12);
  assert.equal(parsed.meta.imageCount, 1);

  const limited = classifyHTTPError(429, JSON.stringify({ error: { code: "rate_limit", message: "slow down" } }));
  assert.equal(limited.code, "rate_limited");
  assert.equal(limited.retryable, true);

  const rejected = classifyHTTPError(400, JSON.stringify({ error: { message: "blocked by safety policy" } }));
  assert.equal(rejected.code, "prompt_rejected");
  assert.equal(rejected.retryable, false);
});

test("image-generation service writes images, artifact json, and stage logs", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bd-image-generation-"));
  const store = createLocalStore(root);
  await store.ensureRuntimeDirs();
  const jobStore = createJobStore();
  const stageLogs = [];
  const logger = {
    writeStageLog: async (entry) => {
      stageLogs.push(entry);
      return entry;
    },
    writeDebugSnapshot: async (entry) => ({ ...entry, uri: "/runtime/DebugSnapshots/test.json" }),
  };
  const provider = {
    providerName: "pptoken",
    request: async () => ({
      payload: { data: [{ b64_json: Buffer.from("fake-png").toString("base64") }] },
      meta: { imageCount: 1, responseBytes: 42, durationMs: 7, model: "gpt-image-2" },
    }),
  };
  const service = createImageGenerationService({ store, logger, jobStore, provider });

  const started = await service.enqueue({
    sampleVideoId: "sample_img_1",
    prompt: "one polished storyboard frame",
    groupId: "001",
    parentArtifactId: "artifact_parent",
  });
  const job = await waitForJob(jobStore, started.processingJobId, "processed");

  assert.equal(job.imageGenerationArtifact.artifactType, "image-generation");
  assert.equal(job.imageGenerationArtifact.parentArtifactId, "artifact_parent");
  assert.equal(job.imageGenerationArtifact.images.length, 1);
  const imagePath = path.join(root, "Runtime", "Artifacts", "sample_img_1", "image-generation", started.artifactId, "image_001.png");
  assert.equal(await fs.readFile(imagePath, "utf8"), "fake-png");
  const artifactPath = path.join(root, "Runtime", "Artifacts", "sample_img_1", "image-generation", started.artifactId, "artifact.json");
  const artifact = JSON.parse(await fs.readFile(artifactPath, "utf8"));
  assert.equal(artifact.provider, "pptoken");
  assert.equal(artifact.traceId, started.traceId);
  assert.deepEqual(stageLogs.map((entry) => entry.event).filter(Boolean), [
    "stage.start",
    "stage.end",
    "stage.start",
    "stage.end",
    "stage.start",
    "stage.end",
    "stage.start",
    "stage.end",
  ]);
});

test("storyboard prompt parser extracts aspect, groups, shots and group prompts", () => {
  const parsed = parseStoryboardPromptMarkdown(`# Shot Storyboard Prompts

画幅：9:16 竖屏

## Storyboard Group 01

以故事板呈现以下镜头，比例为9:16，竖屏。

### new_shot_01
- imagePrompt: 真实浴室半脸对比
- overlayPackaging: 左右对比线

### storyboard_blank_pad_02
- imagePrompt: 纯白空白画面
- overlayPackaging: 无
`);

  assert.equal(parsed.aspect.ratio, "9:16");
  assert.equal(parsed.aspect.orientation, "竖屏");
  assert.equal(parsed.groups.length, 1);
  assert.equal(parsed.groups[0].groupId, "storyboard-group-01");
  assert.equal(parsed.groups[0].shots.length, 2);
  assert.match(parsed.groups[0].prompt, /每组固定四格/);
  assert.match(parsed.groups[0].prompt, /镜头 new_shot_01：真实浴室半脸对比/);
  assert.match(parsed.groups[0].prompt, /包装覆盖层：左右对比线/);
});

test("image-generation service generates storyboard prompt file groups", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bd-image-generation-storyboard-"));
  const store = createLocalStore(root);
  await store.ensureRuntimeDirs();
  const jobStore = createJobStore();
  const logger = {
    writeStageLog: async (entry) => entry,
    writeDebugSnapshot: async (entry) => ({ ...entry, uri: "/runtime/DebugSnapshots/test.json" }),
  };
  const calls = [];
  const provider = {
    providerName: "pptoken",
    request: async (request) => {
      calls.push(request);
      return {
        payload: { data: [{ b64_json: Buffer.from(`storyboard-${calls.length}`).toString("base64") }] },
        meta: { imageCount: 1, responseBytes: 42, durationMs: 7, model: "gpt-image-2" },
      };
    },
  };
  const promptFile = path.join(root, "shot-storyboard-prompts.md");
  await fs.writeFile(promptFile, `# Shot Storyboard Prompts

画幅：9:16 竖屏

## Storyboard Group 01

以故事板呈现以下镜头，比例为9:16，竖屏。

### new_shot_01
- imagePrompt: 第一镜画面
- overlayPackaging: 第一镜包装

### new_shot_02
- imagePrompt: 第二镜画面
- overlayPackaging: 第二镜包装

## Storyboard Group 02

以故事板呈现以下镜头，比例为9:16，竖屏。

### new_shot_05
- imagePrompt: 第五镜画面
- overlayPackaging: 第五镜包装
`, "utf8");
  const service = createImageGenerationService({ store, logger, jobStore, provider });

  const started = await service.enqueue({
    sampleVideoId: "sample_storyboard_1",
    storyboardPromptFile: promptFile,
    parentArtifactId: "artifact_parent",
  });
  const job = await waitForJob(jobStore, started.processingJobId, "processed");

  assert.equal(calls.length, 2);
  assert.match(calls[0].prompt, /第一镜画面/);
  assert.match(calls[0].prompt, /包装覆盖层：第一镜包装/);
  assert.match(calls[1].prompt, /第五镜画面/);
  assert.equal(job.imageGenerationArtifact.mode, "storyboard-prompt-file");
  assert.equal(job.imageGenerationArtifact.aspect.ratio, "9:16");
  assert.equal(job.imageGenerationArtifact.storyboardGroups.length, 2);
  assert.equal(job.imageGenerationArtifact.storyboardGroups[0].images[0].uri.endsWith("storyboard_storyboard-group-01.png"), true);
  assert.equal(job.imageGenerationArtifact.storyboardGroups[1].images[0].uri.endsWith("storyboard_storyboard-group-02.png"), true);
  const firstImagePath = path.join(root, "Runtime", "Artifacts", "sample_storyboard_1", "image-generation", started.artifactId, "storyboard_storyboard-group-01.png");
  const secondImagePath = path.join(root, "Runtime", "Artifacts", "sample_storyboard_1", "image-generation", started.artifactId, "storyboard_storyboard-group-02.png");
  assert.equal(await fs.readFile(firstImagePath, "utf8"), "storyboard-1");
  assert.equal(await fs.readFile(secondImagePath, "utf8"), "storyboard-2");
});

test("image-generation module definition exposes start options", () => {
  const definition = createImageGenerationModuleDefinition();
  const options = definition.startOptionsFromBody({
    sampleVideoId: "sample_1",
    body: { prompt: "hello", groupId: "001", selectedShots: [1], parentArtifactId: "artifact_parent" },
  });

  assert.equal(definition.moduleId, "image-generation");
  assert.equal(definition.executorKind, "local-service");
  assert.equal(options.sampleVideoId, "sample_1");
  assert.equal(options.prompt, "hello");
  assert.equal(options.storyboardPromptFile, undefined);
  assert.deepEqual(options.selectedShots, [1]);
});

async function waitForJob(jobStore, jobId, status) {
  let lastJob = null;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const job = jobStore.getJob(jobId);
    lastJob = job;
    if (job?.status === status) return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`job ${jobId} did not reach ${status}: ${JSON.stringify(lastJob)}`);
}
