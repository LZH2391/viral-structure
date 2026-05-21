const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { createJobStore } = require("../../Apps/Api/lib/job-store");
const { createShotBoundaryService, prepareInput, buildTurnInputs, STAGES } = require("../../Apps/Api/lib/shot-boundary-service");
const { normalizeBoundaryCandidates, buildShotsFromBoundaries } = require("../../Apps/Api/lib/shot-boundary-analysis");
const { createThreadPoolProxy, sanitizeRoleStatus } = require("../../Apps/Api/lib/threadpool-proxy");

test("shot boundary sampling computes stride and rejects oversampling", () => {
  const artifact = createArtifact();
  const input = prepareInput(artifact, 1, { runtimeRoot: "C:\\Runtime" });
  assert.equal(input.analysisSampling.stride, 3);
  assert.equal(input.frames.length, 2);
  assert.throws(() => prepareInput(artifact, 4), /高于抽帧采样率/);
});

test("shot boundary turn inputs remove invalid surrogate text and include multiple sheets", () => {
  const artifact = createArtifact();
  artifact.sampleVideoId = "sample_\uDCAA1";
  artifact.trace.traceId = "trace_\uDCAA1";
  artifact.sampleVideo.artifactId = "artifact_\uDCAAsample";
  artifact.frames[0] = {
    ...artifact.frames[0],
    frameId: "frame_\uDCAA0",
    artifactId: "artifact_\uDCAAframe_0",
    parentArtifactId: "artifact_\uDCAAparent",
    imageUri: "/runtime/Artifacts/sample_1/frames/frame-\uDCAA0.jpg",
  };

  const prepared = prepareInput(artifact, 1, { runtimeRoot: "C:\\Runtime" });
  const contactSheets = createContactSheets(prepared, path.join("C:\\Runtime", "Artifacts", "sample_1"));
  const turnInputs = buildTurnInputs({ prepared, contactSheets });
  const promptText = turnInputs[0].text;
  const textItems = turnInputs.filter((item) => item.type === "text");
  const imageItems = turnInputs.filter((item) => item.type === "localImage");

  assert.equal(/[\uD800-\uDFFF]/.test(JSON.stringify(prepared)), false);
  assert.equal(/[\uD800-\uDFFF]/.test(promptText), false);
  assert.equal(textItems.length, 1);
  assert.equal(imageItems.length, 2);
  assert.match(promptText, /多张 localImage 联表/);
  assert.doesNotMatch(promptText, /输入清单/);
  assert.doesNotMatch(promptText, /sampleVideoId/);
  assert.doesNotMatch(promptText, /frameIndexMap/);
  assert.match(promptText, /"beforeFrameId":"frame_example_047"/);
  assert.doesNotMatch(promptText, /runtime\/Artifacts/);
  assert.equal(imageItems[0].path, "C:\\Runtime\\Artifacts\\sample_1\\contact-sheets\\sheet-001.jpg");
  assert.equal(imageItems[1].path, "C:\\Runtime\\Artifacts\\sample_1\\contact-sheets\\sheet-002.jpg");
});

test("shot boundary normalizes adjacent boundary candidates and builds contiguous shots", () => {
  const frames = [
    { frameId: "frame_0", inputIndex: 0, timestamp: 0 },
    { frameId: "frame_1", inputIndex: 1, timestamp: 1 },
    { frameId: "frame_2", inputIndex: 2, timestamp: 2 },
    { frameId: "frame_3", inputIndex: 3, timestamp: 3.5 },
  ];
  const boundaries = normalizeBoundaryCandidates([
    { beforeFrameId: "frame_0", afterFrameId: "frame_1", confidence: 2, reason: "x".repeat(300), boundaryType: "", needReview: 1 },
    { beforeFrameId: "frame_0", afterFrameId: "frame_2", confidence: 0.9, reason: "invalid skip" },
  ], frames);
  const shots = buildShotsFromBoundaries(boundaries, frames, 4);

  assert.equal(boundaries.length, 1);
  assert.equal(boundaries[0].confidence, 1);
  assert.equal(boundaries[0].reason.length, 160);
  assert.equal(boundaries[0].boundaryType, "hard_cut");
  assert.equal(boundaries[0].needReview, true);
  assert.equal(shots.length, 2);
  assert.equal(shots[0].start, 0);
  assert.equal(shots.at(-1).end, 4);
  assert.equal(shots[0].shotNo, "S001");
});

test("threadpool role status removes init prompt and keeps safe summary", () => {
  const status = sanitizeRoleStatus({
    ok: true,
    role: "shot-boundary-analyzer",
    min_idle: 1,
    init_prompt: "very long prompt",
    skill_path: "C:\\x\\shot-boundary-analyzer\\SKILL.md",
    counts: { idle: 1, leased: 0 },
    seed_thread_id: "thread_seed",
    can_acquire: true,
    can_init: true,
    thread_entries: [{ thread_id: "thread_1", thread_status: "idle", lease_id: null, latest_input_tokens: 700, threshold_input_tokens: 1000, last_owner_id: "owner_1" }],
    active_leases: [],
  });
  assert.equal(status.config.skill_path, "SKILL.md");
  assert.equal("init_prompt" in status, false);
  assert.equal(status.threads[0].status, "idle");
  assert.equal(status.threads[0].latest_input_tokens, 700);
  assert.equal(status.threads[0].threshold_input_tokens, 1000);
  assert.equal(status.threads[0].last_owner_id, "owner_1");
  assert.equal(status.canInit, true);
});

test("threadpool proxy filters roles outside the workspace allowlist", async () => {
  const proxy = createThreadPoolProxy({
    allowedRoles: ["shot-boundary-analyzer"],
    fetchImpl: async (url) => {
      const pathname = new URL(url).pathname;
      if (pathname === "/health") {
        return response({ ok: true, roles: ["shot-boundary-analyzer", "ae-precomp-design-producer"], warming_roles: ["ae-precomp-design-producer"] });
      }
      if (pathname === "/roles/shot-boundary-analyzer/status") {
        return response({ ok: true, role: "shot-boundary-analyzer", min_idle: 1, counts: { idle: 1, leased: 0 }, can_acquire: true, thread_entries: [{ thread_id: "thread_1", thread_status: "idle" }], active_leases: [] });
      }
      if (pathname === "/threads/thread_1/discard") return response({ ok: true, thread_id: "thread_1", status: "discarded" });
      return response({ ok: false, detail: "unexpected" }, 404);
    },
  });
  const roles = await proxy.roles();
  assert.deepEqual(roles.roles.map((role) => role.role), ["shot-boundary-analyzer"]);
  assert.deepEqual(roles.health.warming_roles, []);
  const blocked = await proxy.roleStatus("ae-precomp-design-producer");
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error, "threadpool_role_not_allowed");
  const discarded = await proxy.discardThread({ threadId: "thread_1", reason: "test" });
  assert.equal(discarded.status, "discarded");
});

test("threadpool proxy timeout becomes unavailable payload", async () => {
  const proxy = createThreadPoolProxy({
    allowedRoles: ["shot-boundary-analyzer"],
    requestTimeoutMs: 10,
    fetchImpl: async (_url, options = {}) => new Promise((resolve, reject) => {
      options.signal?.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      });
    }),
  });

  const health = await proxy.health();

  assert.equal(health.ok, false);
  assert.equal(health.unavailable, true);
  assert.equal(health.error, "threadpool_unavailable");
  assert.match(health.message, /超时/);
});

test("shot boundary warming fails before acquire and writes failed job", async () => {
  const harness = await createShotHarness({
    threadPoolOverrides: {
      ensureRoleReady: async () => ({
        ok: false,
        error: "threadpool_warming",
        message: "ThreadPool 正在 warming，请稍后再试",
        retryable: true,
        detail: { warming: true, canAcquire: false, readyForLeases: false },
      }),
      acquireLease: async () => {
        throw new Error("should not acquire");
      },
    },
  });

  const result = await harness.service.enqueue({ sampleVideoId: "sample_1", analysisFps: 3 });
  await delay(30);
  const job = harness.jobStore.getJob(result.processingJobId);
  const artifact = await harness.store.readJson(path.join(harness.store.sampleDir("sample_1"), "artifact.json"));
  const failLog = harness.logger.logs.find((entry) => entry.event === "stage.fail");

  assert.equal(job.status, "failed");
  assert.equal(job.errorSummary.code, "threadpool_warming");
  assert.equal(artifact.shotBoundaryAnalysis.status, "failed");
  assert.equal(failLog.stageName, STAGES.threadAcquired);
  assert.equal(harness.threadPool.discarded.length, 0);
});

test("shot boundary start turn persists inflight without waiting for final message", async () => {
  const harness = await createShotHarness({
    appServer: {
      startTurnWithInputs: async () => ({ ok: true, threadId: "thread_1", turnId: "turn_1", status: "submitted" }),
      collectTurnResult: async () => ({ ok: false, threadId: "thread_1", turnId: "turn_1", status: "running", finalMessage: "" }),
    },
  });
  const result = await harness.service.enqueue({ sampleVideoId: "sample_1", analysisFps: 3 });
  await delay(20);
  const job = harness.jobStore.getJob(result.processingJobId);

  assert.equal(job.agentRun.threadId, "thread_1");
  assert.equal(job.agentRun.leaseId, "lease_1");
  assert.equal(job.agentRun.turnId, "turn_1");
  assert.equal(job.agentRun.contactSheets.length, 2);
  assert.equal(job.status, "processing");
  assert.equal(harness.threadPool.released.length, 0);
});

test("shot boundary collect completed writes artifact and releases lease", async () => {
  const harness = await createShotHarness({
    appServer: {
      startTurnWithInputs: async () => ({ ok: true, threadId: "thread_1", turnId: "turn_1", status: "submitted" }),
      collectTurnResult: async () => ({
        ok: true,
        threadId: "thread_1",
        turnId: "turn_1",
        status: "completed",
        finalMessage: `补充说明\n${JSON.stringify({ boundaries: [{ beforeFrameId: "frame_2", afterFrameId: "frame_3", confidence: 0.8, boundaryType: "hard_cut", reason: "cut", needReview: false }] })}\n已完成`,
      }),
    },
  });
  const result = await harness.service.enqueue({ sampleVideoId: "sample_1", analysisFps: 3 });
  await delay(20);
  await harness.service.collectAgentRun(result.processingJobId);
  const artifact = await harness.store.readJson(path.join(harness.store.sampleDir("sample_1"), "artifact.json"));
  const job = harness.jobStore.getJob(result.processingJobId);

  assert.equal(job.status, "processed");
  assert.equal(artifact.shotBoundaryAnalysis.status, "processed");
  assert.equal(artifact.shotBoundaryAnalysis.agent.turnId, "turn_1");
  assert.equal(artifact.shotBoundaryAnalysis.contactSheets.length, 2);
  assert.equal(artifact.shotBoundaryAnalysis.boundaries.length, 1);
  assert.equal(artifact.shotBoundaryAnalysis.boundaryCandidateArtifacts.length, 2);
  assert.equal(artifact.shotBoundaryAnalysis.shots[0].shotNo, "S001");
  assert.deepEqual(harness.threadPool.released, [{ leaseId: "lease_1", ownerId: result.traceId }]);
});

test("shot boundary skill content change misses old shot cache", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "shot-skill-hash-"));
  const skillPath = path.join(tempRoot, "SKILL.md");
  await fs.writeFile(skillPath, "new skill content", "utf8");
  const oldSkillHash = hashText("old skill content");
  let startTurnCount = 0;
  const cacheLookups = [];
  const harness = await createShotHarness({
    skillPath,
    artifactIndex: {
      findCacheEntry: async ({ params }) => {
        cacheLookups.push(params);
        return params.skillHash === oldSkillHash ? { sampleVideoId: "sample_cached", cacheKey: "old_cache" } : null;
      },
    },
    appServer: {
      startTurnWithInputs: async () => {
        startTurnCount += 1;
        return { ok: true, threadId: "thread_1", turnId: "turn_1", status: "submitted" };
      },
    },
  });

  await harness.service.enqueue({ sampleVideoId: "sample_1", analysisFps: 3 });
  await delay(20);

  assert.equal(cacheLookups.length, 1);
  assert.equal(cacheLookups[0].skillHash, hashText("new skill content"));
  assert.notEqual(cacheLookups[0].skillHash, oldSkillHash);
  assert.equal(startTurnCount, 1);
});

test("shot boundary cache hit skips turn and writes cache reuse log", async () => {
  let startTurnCount = 0;
  const cachedAnalysis = createCachedShotAnalysis();
  const harness = await createShotHarness({
    artifactIndex: {
      findCacheEntry: async () => ({ sampleVideoId: "sample_cached", cacheKey: "cache_1" }),
      loadItem: async () => ({ ...createArtifact(), sampleVideoId: "sample_cached", shotBoundaryAnalysis: cachedAnalysis }),
    },
    appServer: {
      startTurnWithInputs: async () => {
        startTurnCount += 1;
        return { ok: true, threadId: "thread_1", turnId: "turn_1", status: "submitted" };
      },
    },
  });

  const result = await harness.service.enqueue({ sampleVideoId: "sample_1", analysisFps: 3 });
  await delay(20);
  const artifact = await harness.store.readJson(path.join(harness.store.sampleDir("sample_1"), "artifact.json"));
  const job = harness.jobStore.getJob(result.processingJobId);
  const cacheReuseLog = harness.logger.logs.find((entry) => entry.stageName === STAGES.cacheReuse && entry.event === "stage.end");

  assert.equal(startTurnCount, 0);
  assert.equal(job.status, "processed");
  assert.equal(artifact.shotBoundaryAnalysis.agent.turnId, "turn_cached");
  assert.equal(cacheReuseLog.outputSummary.sourceSampleVideoId, "sample_cached");
  assert.equal(cacheReuseLog.outputSummary.cacheKey, "cache_1");
  assert.equal(cacheReuseLog.outputSummary.sourceTurnId, "turn_cached");
  assert.equal(cacheReuseLog.outputSummary.boundaryCount, 0);
  assert.equal(cacheReuseLog.outputSummary.shotCount, 1);
});

test("shot boundary keeps Chinese reason text without mojibake", async () => {
  const harness = await createShotHarness({
    appServer: {
      startTurnWithInputs: async () => ({ ok: true, threadId: "thread_1", turnId: "turn_1", status: "submitted" }),
      collectTurnResult: async () => ({
        ok: true,
        threadId: "thread_1",
        turnId: "turn_1",
        status: "completed",
        finalMessage: JSON.stringify({ boundaries: [{ beforeFrameId: "frame_2", afterFrameId: "frame_3", confidence: 0.8, boundaryType: "hard_cut", reason: "未检测到明显视觉变化", needReview: false }] }),
      }),
    },
  });
  const result = await harness.service.enqueue({ sampleVideoId: "sample_1", analysisFps: 3 });
  await delay(20);
  await harness.service.collectAgentRun(result.processingJobId);
  const artifact = await harness.store.readJson(path.join(harness.store.sampleDir("sample_1"), "artifact.json"));

  assert.equal(artifact.shotBoundaryAnalysis.status, "processed");
  assert.equal(artifact.shotBoundaryAnalysis.boundaries[0].reason, "未检测到明显视觉变化");
});

test("shot boundary collect retryable error keeps inflight processing", async () => {
  const error = new Error("missing-content-type");
  error.code = "appserver_bridge_failed";
  const harness = await createShotHarness({
    appServer: {
      startTurnWithInputs: async () => ({ ok: true, threadId: "thread_1", turnId: "turn_1", status: "submitted" }),
      collectTurnResult: async () => { throw error; },
    },
  });
  const result = await harness.service.enqueue({ sampleVideoId: "sample_1", analysisFps: 3 });
  await delay(20);
  await harness.service.collectAgentRun(result.processingJobId);
  const job = harness.jobStore.getJob(result.processingJobId);

  assert.equal(job.status, "processing");
  assert.equal(job.agentRun.status, "collecting");
  assert.equal(job.errorSummary.retryable, true);
  assert.equal(harness.threadPool.discarded.length, 0);
});

test("shot boundary parse failure writes failed artifact and debug snapshot", async () => {
  const harness = await createShotHarness({
    appServer: {
      startTurnWithInputs: async () => ({ ok: true, threadId: "thread_1", turnId: "turn_1", status: "submitted" }),
      collectTurnResult: async () => ({ ok: true, threadId: "thread_1", turnId: "turn_1", status: "completed", finalMessage: "not-json" }),
    },
  });
  const result = await harness.service.enqueue({ sampleVideoId: "sample_1", analysisFps: 3 });
  await delay(20);
  await harness.service.collectAgentRun(result.processingJobId);
  const artifact = await harness.store.readJson(path.join(harness.store.sampleDir("sample_1"), "artifact.json"));
  const job = harness.jobStore.getJob(result.processingJobId);

  assert.equal(job.status, "failed");
  assert.equal(artifact.shotBoundaryAnalysis.status, "failed");
  assert.equal(artifact.shotBoundaryAnalysis.agent.threadId, "thread_1");
  assert.equal(artifact.shotBoundaryAnalysis.contactSheets.length, 2);
  assert.equal(harness.logger.snapshots.length, 1);
  assert.deepEqual(harness.threadPool.discarded, [{ threadId: "thread_1", reason: "shot-boundary-analysis-failed" }]);
  assert.deepEqual(harness.threadPool.ownerReleased, [result.traceId]);
});

test("shot boundary mojibake reason fails quality gate and writes debug snapshot", async () => {
  const harness = await createShotHarness({
    appServer: {
      startTurnWithInputs: async () => ({ ok: true, threadId: "thread_1", turnId: "turn_1", status: "submitted" }),
      collectTurnResult: async () => ({
        ok: true,
        threadId: "thread_1",
        turnId: "turn_1",
        status: "completed",
        finalMessage: JSON.stringify({ boundaries: [{ beforeFrameId: "frame_2", afterFrameId: "frame_3", confidence: 0.8, boundaryType: "hard_cut", reason: "鏈娴嬪埌鏄庢樉瑙嗚鍙樺寲", needReview: false }] }),
      }),
    },
  });
  const result = await harness.service.enqueue({ sampleVideoId: "sample_1", analysisFps: 3 });
  await delay(20);
  await harness.service.collectAgentRun(result.processingJobId);
  const artifact = await harness.store.readJson(path.join(harness.store.sampleDir("sample_1"), "artifact.json"));
  const job = harness.jobStore.getJob(result.processingJobId);
  const failLog = harness.logger.logs.find((entry) => entry.event === "stage.fail");

  assert.equal(job.status, "failed");
  assert.equal(job.errorSummary.code, "agent_output_quality_failed");
  assert.equal(artifact.shotBoundaryAnalysis.status, "failed");
  assert.equal(harness.logger.snapshots.length, 1);
  assert.equal(failLog.stageName, STAGES.resultWritten);
  assert.equal(harness.logger.snapshots[0].debugPayload.turnId, "turn_1");
  assert.match(harness.logger.snapshots[0].debugPayload.parseFailureReason, /mojibake/);
});

test("shot boundary recovery completes active inflight", async () => {
  const harness = await createShotHarness({
    appServer: {
      collectTurnResult: async () => ({
        ok: true,
        threadId: "thread_1",
        turnId: "turn_1",
        status: "completed",
        finalMessage: JSON.stringify({ boundaries: [] }),
      }),
    },
  });
  const job = harness.jobStore.createJob({ sampleVideoId: "sample_1", traceId: "trace_recover" });
  harness.jobStore.updateJob(job.jobId, {
    status: "processing",
    stage: STAGES.turnStarted,
    progress: 80,
    agentRun: {
      provider: "codex-appserver",
      role: "shot-boundary-analyzer",
      leaseId: "lease_1",
      threadId: "thread_1",
      turnId: "turn_1",
      traceId: "trace_recover",
      artifactId: "artifact_recover",
      parentArtifactId: "artifact_sample",
      sampleVideoId: "sample_1",
      analysisFps: 3,
      contactSheets: createContactSheets(prepareInput(createArtifact(), 3, { runtimeRoot: rootRuntime("recover") }), rootRuntime("recover")),
      status: "turn_submitted",
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  });
  const recovered = await harness.service.recoverActiveAgentRuns();

  assert.equal(recovered.recovered, 1);
  assert.equal(harness.jobStore.getJob(job.jobId).status, "processed");
});

test("shot boundary recovery fails interrupted pre-agent job", async () => {
  const harness = await createShotHarness();
  const job = harness.jobStore.createJob({ sampleVideoId: "sample_1", traceId: "trace_interrupted" });
  harness.jobStore.updateJob(job.jobId, {
    status: "processing",
    stage: STAGES.threadAcquired,
    progress: 60,
  });
  const recovered = await harness.service.recoverActiveAgentRuns();
  const failed = harness.jobStore.getJob(job.jobId);
  const artifact = await harness.store.readJson(path.join(harness.store.sampleDir("sample_1"), "artifact.json"));
  const failLog = harness.logger.logs.find((entry) => entry.event === "stage.fail");

  assert.equal(recovered.recovered, 0);
  assert.equal(recovered.interrupted, 1);
  assert.equal(failed.status, "failed");
  assert.equal(failed.errorSummary.code, "shot_boundary_job_interrupted");
  assert.equal(failed.errorSummary.retryable, true);
  assert.equal(failed.errorSummary.stageName, STAGES.threadAcquired);
  assert.equal(artifact.shotBoundaryAnalysis.status, "failed");
  assert.equal(failLog.stageName, STAGES.threadAcquired);
  assert.deepEqual(harness.threadPool.ownerReleased, ["trace_interrupted"]);
});

test("threadpool owner release stays within allowed role payload", async () => {
  const requests = [];
  const proxy = createThreadPoolProxy({
    allowedRoles: ["shot-boundary-analyzer"],
    fetchImpl: async (url, options = {}) => {
      requests.push({ pathname: new URL(url).pathname, body: options.body ? JSON.parse(options.body) : null });
      return response({ ok: true, released: 1 });
    },
  });
  await proxy.releaseOwnerLeases("trace_1");

  assert.equal(requests[0].pathname, "/leases/release-owner");
  assert.deepEqual(requests[0].body, { owner_id: "trace_1", roles: ["shot-boundary-analyzer"] });
});

test("shot boundary graceful discard replaces release when discard_on_release is enabled", async () => {
  const harness = await createShotHarness({
    threadPoolConfig: { ok: true, discardOnRelease: true },
    appServer: {
      startTurnWithInputs: async () => ({ ok: true, threadId: "thread_1", turnId: "turn_1", status: "submitted" }),
      collectTurnResult: async () => ({
        ok: true,
        threadId: "thread_1",
        turnId: "turn_1",
        status: "completed",
        finalMessage: JSON.stringify({ boundaries: [{ beforeFrameId: "frame_2", afterFrameId: "frame_3", confidence: 0.8, boundaryType: "hard_cut", reason: "cut", needReview: false }] }),
      }),
    },
  });
  const result = await harness.service.enqueue({ sampleVideoId: "sample_1", analysisFps: 3 });
  await delay(20);
  await harness.service.collectAgentRun(result.processingJobId);

  assert.deepEqual(harness.threadPool.released, []);
  assert.deepEqual(harness.threadPool.discarded, [{ threadId: "thread_1", reason: "graceful-successful-release" }]);
  assert.deepEqual(harness.threadPool.ownerReleased, [result.traceId]);
});

function createArtifact() {
  return {
    sampleVideoId: "sample_1",
    trace: { traceId: "trace_1" },
    processingOptions: { frameSampleRateFps: 3 },
    sampleVideo: { artifactId: "artifact_sample" },
    metadata: { durationSeconds: 2, width: 1280, height: 720 },
    frameOutputSummary: { frameSampleRateFps: 3, targetFrameCount: 6, actualFrameCount: 6, maxFrames: 120 },
    frames: Array.from({ length: 6 }, (_, index) => ({
      frameId: `frame_${index}`,
      artifactId: `artifact_frame_${index}`,
      parentArtifactId: "artifact_sample",
      timestamp: index / 3,
      imageUri: `/runtime/Artifacts/sample_1/frames/frame-${index}.jpg`,
    })),
  };
}

async function createShotHarness({ appServer, threadPoolConfig, threadPoolOverrides, skillPath, artifactIndex: artifactIndexOverrides } = {}) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "shot-boundary-"));
  const runtimeRoot = path.join(rootDir, "Runtime");
  const store = {
    runtimeRoot,
    sampleDir: (sampleVideoId) => path.join(runtimeRoot, "Artifacts", sampleVideoId),
    ensureRuntimeDirs: async () => {
      await fs.mkdir(path.join(runtimeRoot, "Artifacts"), { recursive: true });
      await fs.mkdir(path.join(runtimeRoot, "DebugSnapshots"), { recursive: true });
    },
    writeJson: async (filePath, value) => {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
    },
    readJson: async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8")),
    runtimeUri: (filePath) => `/runtime/${path.relative(runtimeRoot, filePath).split(path.sep).join("/")}`,
  };
  await store.ensureRuntimeDirs();
  await store.writeJson(path.join(store.sampleDir("sample_1"), "artifact.json"), createArtifact());
  const logger = {
    logs: [],
    snapshots: [],
    writeStageLog: async (entry) => {
      logger.logs.push(entry);
      return entry;
    },
    writeDebugSnapshot: async (entry) => {
      const snapshot = { ...entry, uri: `/runtime/debug-${logger.snapshots.length}.json` };
      logger.snapshots.push(snapshot);
      return snapshot;
    },
  };
  const jobStore = createJobStore();
  const threadPool = {
    released: [],
    discarded: [],
    ownerReleased: [],
    config: async () => threadPoolConfig ?? { ok: true, discardOnRelease: false },
    roleStatus: async () => ({
      ok: true,
      role: "shot-boundary-analyzer",
      counts: { idle: 1, leased: 0 },
      minIdle: 1,
      canAcquire: true,
      canInit: true,
      warming: false,
      readyForLeases: true,
      recovering: false,
      warmupError: null,
      startupError: null,
      threads: [],
      leases: [],
    }),
    ensureRoleReady: async () => ({ ok: true, role: "shot-boundary-analyzer", status: { role: "shot-boundary-analyzer", canAcquire: true, readyForLeases: true, warming: false, warmupError: null, startupError: null } }),
    acquireLease: async () => ({ lease_id: "lease_1", thread_id: "thread_1" }),
    releaseLease: async (payload) => {
      threadPool.released.push(payload);
      return { ok: true };
    },
    discardThread: async (payload) => {
      threadPool.discarded.push(payload);
      return { ok: true };
    },
    releaseOwnerLeases: async (ownerId) => {
      threadPool.ownerReleased.push(ownerId);
      return { ok: true };
    },
    ...threadPoolOverrides,
  };
  const artifactIndex = {
    findCacheEntry: async () => null,
    getItem: async () => ({ fileHash: "hash_1" }),
    registerSampleArtifact: async () => ({ ok: true }),
    loadItem: async () => null,
    ...artifactIndexOverrides,
  };
  const contactSheetGenerator = {
    generateContactSheets: async ({ frames, parentArtifactId, sampleDir }) => createContactSheets({ frames, sourceArtifactId: parentArtifactId }, sampleDir),
  };
  const service = createShotBoundaryService({
    rootDir,
    store,
    logger,
    jobStore,
    artifactIndex,
    threadPool,
    contactSheetGenerator,
    skillPath,
    appServer: {
      startTurnWithInputs: async () => ({ ok: true, threadId: "thread_1", turnId: "turn_1", status: "submitted" }),
      collectTurnResult: async () => ({ ok: false, threadId: "thread_1", turnId: "turn_1", status: "running", finalMessage: "" }),
      ...appServer,
    },
    pollIntervalMs: 60_000,
  });
  return { rootDir, store, logger, jobStore, threadPool, artifactIndex, service };
}

function createContactSheets(prepared, sampleDir) {
  const frames = prepared.frames ?? prepared;
  const parentArtifactId = prepared.sourceArtifactId ?? "artifact_sample";
  return [
    {
      artifactId: "artifact_sheet_1",
      parentArtifactId,
      type: "contact_sheet",
      artifactType: "contact_sheet",
      status: "processed",
      sheetPurpose: "shot_boundary_analysis",
      sheetId: "sheet-001",
      sheetIndex: 0,
      uri: "/runtime/Artifacts/sample_1/contact-sheets/sheet-001.jpg",
      imagePath: "/runtime/Artifacts/sample_1/contact-sheets/sheet-001.jpg",
      localImagePath: path.join(sampleDir, "contact-sheets", "sheet-001.jpg"),
      frameCount: Math.min(4, frames.length),
      overlapFrameIds: [],
      gridItems: frames.slice(0, 4).map((frame, index) => ({
        frameId: frame.frameId,
        artifactId: frame.artifactId,
        parentArtifactId: frame.parentArtifactId,
        timestamp: frame.timestamp,
        inputIndex: frame.inputIndex,
        sourceFrameIndex: frame.sourceFrameIndex,
        filePath: frame.filePath,
        gridIndex: index,
        row: 0,
        col: index,
      })),
      layout: { rows: 2, cols: 2, width: 600, height: 480, cellWidth: 300, cellHeight: 240, visibleFrameWidth: 300, visibleFrameHeight: 168, labelHeight: 28 },
      constraints: { maxDimension: 4096, minFrameShortSide: 144, minFrameLongSide: 256, labelHeight: 28, overlapFrameCount: 1 },
      compression: { format: "jpeg", quality: 88 },
      createdAt: new Date().toISOString(),
    },
    {
      artifactId: "artifact_sheet_2",
      parentArtifactId,
      type: "contact_sheet",
      artifactType: "contact_sheet",
      status: "processed",
      sheetPurpose: "shot_boundary_analysis",
      sheetId: "sheet-002",
      sheetIndex: 1,
      uri: "/runtime/Artifacts/sample_1/contact-sheets/sheet-002.jpg",
      imagePath: "/runtime/Artifacts/sample_1/contact-sheets/sheet-002.jpg",
      localImagePath: path.join(sampleDir, "contact-sheets", "sheet-002.jpg"),
      frameCount: Math.max(0, Math.min(3, Math.max(0, frames.length - 3))),
      overlapFrameIds: [frames[3]?.frameId].filter(Boolean),
      gridItems: frames.slice(3, 6).map((frame, index) => ({
        frameId: frame.frameId,
        artifactId: frame.artifactId,
        parentArtifactId: frame.parentArtifactId,
        timestamp: frame.timestamp,
        inputIndex: frame.inputIndex,
        sourceFrameIndex: frame.sourceFrameIndex,
        filePath: frame.filePath,
        gridIndex: index,
        row: 0,
        col: index,
      })),
      layout: { rows: 2, cols: 2, width: 600, height: 480, cellWidth: 300, cellHeight: 240, visibleFrameWidth: 300, visibleFrameHeight: 168, labelHeight: 28 },
      constraints: { maxDimension: 4096, minFrameShortSide: 144, minFrameLongSide: 256, labelHeight: 28, overlapFrameCount: 1 },
      compression: { format: "jpeg", quality: 88 },
      createdAt: new Date().toISOString(),
    },
  ];
}

function createCachedShotAnalysis() {
  return {
    artifactId: "artifact_cached_shot",
    parentArtifactId: "artifact_sample",
    type: "shot-boundary-analysis",
    status: "processed",
    sourceFrameArtifactIds: [],
    extractSampling: { requestedFps: 3, targetFrameCount: 6, actualFrameCount: 6, maxFrames: 120 },
    analysisSampling: { fps: 3, stride: 1 },
    contactSheets: [],
    boundaryCandidateArtifacts: [],
    boundaries: [],
    agent: {
      provider: "codex-appserver",
      role: "shot-boundary-analyzer",
      skillPath: "C:\\ByteDanceFullStack\\.agents\\skills\\shot-boundary-analyzer\\SKILL.md",
      skillHash: "cached_hash",
      threadId: "thread_cached",
      leaseId: "lease_cached",
      turnId: "turn_cached",
      sheetCount: 2,
      inputMode: "multi_contact_sheet",
    },
    shots: [{ id: "shot_1", index: 0, shotNo: "S001", start: 0, end: 2, representativeFrameId: "frame_0", confidence: 0.4, reason: "未检测到明确切镜边界" }],
    createdAt: new Date().toISOString(),
  };
}

function rootRuntime(name) {
  return path.join("C:\\Runtime", name);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hashText(value) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  };
}
