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
    requestImpl: async ({ mode, body, headers }) => {
      assert.equal(mode, "generations");
      assert.equal(body.model, "gpt-image-2");
      assert.equal(body.prompt, "draw a clean storyboard");
      assert.match(headers.Authorization, /^Bearer /);
      return { data: [{ b64_json: Buffer.from("fake-image").toString("base64") }] };
    },
  });

  const result = await provider.request({ prompt: "draw a clean storyboard" }, { timeoutSeconds: 1 });

  assert.equal(result.meta.imageCount, 1);
  assert.equal(result.meta.model, "gpt-image-2");
  assert.equal(result.meta.requestMode, "generations");
  assert.equal(result.payload.data.length, 1);
});

test("ppapi provider uploads a reference image through edits endpoint", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bd-image-reference-"));
  const referenceImagePath = path.join(root, "layout.png");
  await fs.writeFile(referenceImagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const provider = createPPAPIProvider({
    apiKey: "test-key",
    editsUrl: "https://api.pptoken.cc/v1/images/edits",
    requestImpl: async ({ mode, url, fields, files, headers }) => {
      assert.equal(mode, "edits");
      assert.equal(url, "https://api.pptoken.cc/v1/images/edits");
      assert.equal(fields.model, "gpt-image-2");
      assert.equal(fields.prompt, "draw inside the four cells");
      assert.equal(fields.output_format, "png");
      assert.equal(files.image.path, referenceImagePath);
      assert.equal(files.image.filename, "layout.png");
      assert.equal(files.image.contentType, "image/png");
      assert.match(headers.Authorization, /^Bearer /);
      assert.equal(headers["Content-Type"], undefined);
      return { data: [{ b64_json: Buffer.from("edited-image").toString("base64") }] };
    },
  });

  const result = await provider.request({ prompt: "draw inside the four cells", referenceImagePath }, { timeoutSeconds: 1 });

  assert.equal(result.meta.imageCount, 1);
  assert.equal(result.meta.requestMode, "edits");
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
referenceImagePath: C:/layout/storyboard-layout-9x16-4grid.png

## Storyboard Group 01

以故事板呈现以下镜头，比例为9:16，竖屏。
referenceImagePath: C:/layout/group-01.png

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
  assert.equal(parsed.referenceImagePath, "C:/layout/storyboard-layout-9x16-4grid.png");
  assert.equal(parsed.groups[0].referenceImagePath, "C:/layout/group-01.png");
  assert.equal(parsed.groups[0].shots.length, 2);
  assert.match(parsed.groups[0].prompt, /每组固定四格/);
  assert.match(parsed.groups[0].prompt, /参考上传的四格布局图/);
  assert.match(parsed.groups[0].prompt, /最终成图必须去掉红线/);
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
  const referenceImagePath = path.join(root, "storyboard-layout-9x16-4grid.png");
  await fs.writeFile(referenceImagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  await fs.writeFile(promptFile, `# Shot Storyboard Prompts

画幅：9:16 竖屏
referenceImagePath: ${referenceImagePath}

## Storyboard Group 01

以故事板呈现以下镜头，比例为9:16，竖屏。
referenceImagePath: ${referenceImagePath}

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
    storyboardConcurrency: 1,
    timeoutSeconds: 12,
  });
  const job = await waitForJob(jobStore, started.processingJobId, "processed");

  assert.equal(calls.length, 2);
  assert.equal(calls[0].referenceImagePath, referenceImagePath);
  assert.equal(calls[1].referenceImagePath, referenceImagePath);
  assert.match(calls[0].prompt, /第一镜画面/);
  assert.match(calls[0].prompt, /最终成图必须去掉红线/);
  assert.match(calls[0].prompt, /包装覆盖层：第一镜包装/);
  assert.match(calls[1].prompt, /第五镜画面/);
  assert.equal(job.imageGenerationArtifact.mode, "storyboard-prompt-file");
  assert.equal(job.imageGenerationArtifact.aspect.ratio, "9:16");
  assert.equal(job.imageGenerationArtifact.storyboardRun.concurrency, 1);
  assert.equal(job.imageGenerationArtifact.storyboardRun.referenceImage, "storyboard-layout-9x16-4grid.png");
  assert.equal(job.imageGenerationArtifact.storyboardRun.timeoutSeconds, 12);
  assert.equal(job.imageGenerationArtifact.storyboardRun.timeoutBudgetSeconds, 24);
  assert.equal(job.imageGenerationArtifact.storyboardRun.groups.every((group) => group.status === "completed"), true);
  assert.equal(job.imageGenerationArtifact.storyboardGroups.length, 2);
  assert.equal(job.imageGenerationArtifact.storyboardGroups[0].images[0].uri.endsWith("storyboard_storyboard-group-01.png"), true);
  assert.equal(job.imageGenerationArtifact.storyboardGroups[1].images[0].uri.endsWith("storyboard_storyboard-group-02.png"), true);
  const firstImagePath = path.join(root, "Runtime", "Artifacts", "sample_storyboard_1", "image-generation", started.artifactId, "storyboard_storyboard-group-01.png");
  const secondImagePath = path.join(root, "Runtime", "Artifacts", "sample_storyboard_1", "image-generation", started.artifactId, "storyboard_storyboard-group-02.png");
  assert.equal(await fs.readFile(firstImagePath, "utf8"), "storyboard-1");
  assert.equal(await fs.readFile(secondImagePath, "utf8"), "storyboard-2");
});

test("image-generation service retries only failed retryable storyboard groups", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bd-image-generation-storyboard-retry-"));
  const store = createLocalStore(root);
  await store.ensureRuntimeDirs();
  const jobStore = createJobStore();
  const stageLogs = [];
  const logger = {
    writeStageLog: async (entry) => {
      stageLogs.push(entry);
      return entry;
    },
    writeDebugSnapshot: async (entry) => ({ ...entry, uri: `/runtime/DebugSnapshots/${entry.inputSummary?.groupId ?? "group"}.json` }),
  };
  const calls = [];
  const provider = {
    providerName: "pptoken",
    request: async (request) => {
      const groupId = /第\s*2\s*组画面/.test(request.prompt)
        ? "storyboard-group-02"
        : /第\s*3\s*组画面/.test(request.prompt)
          ? "storyboard-group-03"
          : "storyboard-group-01";
      const attempt = calls.filter((call) => call.groupId === groupId).length + 1;
      calls.push({ groupId, attempt });
      if (groupId === "storyboard-group-02" && attempt === 1) {
        const error = new Error("PPAPI 服务暂时失败");
        error.code = "server_error";
        error.retryable = true;
        throw error;
      }
      return {
        payload: { data: [{ b64_json: Buffer.from(`${groupId}-attempt-${attempt}`).toString("base64") }] },
        meta: { imageCount: 1, responseBytes: 42, durationMs: 7, model: "gpt-image-2" },
      };
    },
  };
  const promptFile = path.join(root, "retry-groups.md");
  await fs.writeFile(promptFile, buildStoryboardPromptMarkdown(3), "utf8");
  const service = createImageGenerationService({ store, logger, jobStore, provider });

  const started = await service.enqueue({
    sampleVideoId: "sample_storyboard_retry",
    storyboardPromptFile: promptFile,
    storyboardConcurrency: 1,
    storyboardRetryAttempts: 2,
    timeoutSeconds: 5,
  });
  const job = await waitForJob(jobStore, started.processingJobId, "processed");

  assert.deepEqual(calls.map((call) => `${call.groupId}:${call.attempt}`), [
    "storyboard-group-01:1",
    "storyboard-group-02:1",
    "storyboard-group-03:1",
    "storyboard-group-02:2",
  ]);
  assert.equal(job.imageGenerationArtifact.storyboardRun.retryMaxAttempts, 2);
  assert.equal(job.imageGenerationArtifact.storyboardRun.retryAttemptCount, 1);
  assert.equal(job.imageGenerationArtifact.storyboardRun.groups.find((group) => group.groupId === "storyboard-group-02").attempt, 2);
  assert.equal(job.imageGenerationArtifact.storyboardRun.groups.every((group) => group.status === "completed"), true);
  assert.equal(job.imageGenerationArtifact.storyboardGroups.length, 3);
  assert.equal(job.imageGenerationArtifact.storyboardGroups[1].images[0].uri.endsWith("storyboard_storyboard-group-02.png"), true);
  assert.ok(stageLogs.some((entry) => entry.event === "stage.fail" && entry.inputSummary?.groupId === "storyboard-group-02" && entry.errorSummary?.retryable === true));
  const retryImagePath = path.join(root, "Runtime", "Artifacts", "sample_storyboard_retry", "image-generation", started.artifactId, "storyboard_storyboard-group-02.png");
  assert.equal(await fs.readFile(retryImagePath, "utf8"), "storyboard-group-02-attempt-2");
});

test("image-generation module definition exposes start options", () => {
  const definition = createImageGenerationModuleDefinition();
  const options = definition.startOptionsFromBody({
    sampleVideoId: "sample_1",
    body: { prompt: "hello", storyboardPromptFile: "C:/storyboard.md", referenceImagePath: "C:/layout.png", groupId: "001", selectedShots: [1], parentArtifactId: "artifact_parent", storyboardConcurrency: 3, storyboardRetryAttempts: 2 },
  });

  assert.equal(definition.moduleId, "image-generation");
  assert.equal(definition.executorKind, "local-service");
  assert.equal(options.sampleVideoId, "sample_1");
  assert.equal(options.prompt, "hello");
  assert.equal(options.storyboardPromptFile, "C:/storyboard.md");
  assert.equal(options.referenceImagePath, "C:/layout.png");
  assert.equal(options.storyboardConcurrency, 3);
  assert.equal(options.storyboardRetryAttempts, 2);
  assert.deepEqual(options.selectedShots, [1]);
});

test("image-generation storyboard concurrency caps at 10 groups", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bd-image-generation-concurrency-"));
  const store = createLocalStore(root);
  await store.ensureRuntimeDirs();
  const jobStore = createJobStore();
  const logger = {
    writeStageLog: async (entry) => entry,
    writeDebugSnapshot: async (entry) => ({ ...entry, uri: "/runtime/DebugSnapshots/test.json" }),
  };
  let active = 0;
  let maxActive = 0;
  const provider = {
    providerName: "pptoken",
    request: async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return {
        payload: { data: [{ b64_json: Buffer.from("storyboard").toString("base64") }] },
        meta: { imageCount: 1, responseBytes: 42, durationMs: 7, model: "gpt-image-2" },
      };
    },
  };
  const promptFile = path.join(root, "many-groups.md");
  await fs.writeFile(promptFile, buildStoryboardPromptMarkdown(12), "utf8");
  const service = createImageGenerationService({ store, logger, jobStore, provider });

  const started = await service.enqueue({
    sampleVideoId: "sample_storyboard_many",
    storyboardPromptFile: promptFile,
    storyboardConcurrency: 99,
    timeoutSeconds: 5,
  });
  const job = await waitForJob(jobStore, started.processingJobId, "processed");

  assert.equal(job.imageGenerationArtifact.storyboardRun.concurrency, 10);
  assert.equal(job.imageGenerationArtifact.storyboardRun.timeoutBudgetSeconds, 10);
  assert.equal(job.imageGenerationArtifact.storyboardGroups.length, 12);
  assert.ok(maxActive <= 10);
});

function buildStoryboardPromptMarkdown(groupCount) {
  const lines = ["# Shot Storyboard Prompts", "", "画幅：9:16 竖屏", ""];
  for (let index = 1; index <= groupCount; index += 1) {
    lines.push(`## Storyboard Group ${String(index).padStart(2, "0")}`, "");
    lines.push("以故事板呈现以下镜头，比例为9:16，竖屏。", "");
    lines.push(`### new_shot_${String(index).padStart(2, "0")}`);
    lines.push(`- imagePrompt: 第 ${index} 组画面`);
    lines.push("- overlayPackaging: 无", "");
  }
  return lines.join("\n");
}

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
