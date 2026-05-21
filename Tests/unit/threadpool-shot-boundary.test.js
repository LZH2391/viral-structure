const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createJobStore } = require("../../Apps/Api/lib/job-store");
const { createShotBoundaryService, prepareInput, buildTurnInputs, normalizeShots, STAGES } = require("../../Apps/Api/lib/shot-boundary-service");
const { createThreadPoolProxy, sanitizeRoleStatus } = require("../../Apps/Api/lib/threadpool-proxy");

test("shot boundary sampling computes stride and rejects oversampling", () => {
  const artifact = createArtifact();
  const input = prepareInput(artifact, 1);
  assert.equal(input.analysisSampling.stride, 3);
  assert.equal(input.frames.length, 2);
  assert.throws(() => prepareInput(artifact, 4), /高于抽帧采样率/);
});

test("shot boundary turn inputs remove invalid surrogate text", () => {
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

  const input = prepareInput(artifact, 1);
  const turnInputs = buildTurnInputs(input);
  const manifestText = turnInputs[0].text.split("\n").at(-1);
  const parsed = JSON.parse(manifestText);

  assert.equal(/[\uD800-\uDFFF]/.test(JSON.stringify(input)), false);
  assert.equal(/[\uD800-\uDFFF]/.test(turnInputs[0].text), false);
  assert.equal(parsed.frames.length, 2);
  assert.equal(parsed.analysisSampling.stride, 3);
  assert.equal(parsed.frames[0].fileName, "frame-0.jpg");
  assert.equal(parsed.frames[0].filePath, "/runtime/Artifacts/sample_1/frames/frame-0.jpg");
});

test("shot boundary normalizes agent shots to frame ids and safe ranges", () => {
  const frames = [
    { frameId: "frame_1" },
    { frameId: "frame_2" },
  ];
  const shots = normalizeShots([{ start: -1, end: 9, representativeFrameId: "missing", confidence: 2, reason: "x".repeat(300) }], frames, 6);
  assert.equal(shots[0].start, 0);
  assert.equal(shots[0].end, 6);
  assert.equal(shots[0].representativeFrameId, "frame_1");
  assert.equal(shots[0].confidence, 1);
  assert.equal(shots[0].reason.length, 160);
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

test("shot boundary start turn persists inflight without waiting for final message", async () => {
  const harness = await createShotHarness({
    appServer: {
      startTurnWithInputs: async () => ({ ok: true, threadId: "thread_1", turnId: "turn_1", status: "submitted" }),
      collectTurnResult: async () => ({ ok: false, threadId: "thread_1", turnId: "turn_1", status: "running", finalMessage: "" }),
    },
  });
  const result = await harness.service.enqueue({ sampleVideoId: "sample_1", analysisFps: 1 });
  await delay(20);
  const job = harness.jobStore.getJob(result.processingJobId);

  assert.equal(job.agentRun.threadId, "thread_1");
  assert.equal(job.agentRun.leaseId, "lease_1");
  assert.equal(job.agentRun.turnId, "turn_1");
  assert.equal(job.status, "processing");
  assert.equal(harness.threadPool.released.length, 0);
});

test("shot boundary collect completed writes artifact and releases lease", async () => {
  const harness = await createShotHarness({
    appServer: {
      startTurnWithInputs: async () => ({ ok: true, threadId: "thread_1", turnId: "turn_1", status: "submitted" }),
      collectTurnResult: async () => ({ ok: true, threadId: "thread_1", turnId: "turn_1", status: "completed", finalMessage: JSON.stringify({ shots: [{ start: 0, end: 2, representativeFrameId: "frame_0", confidence: 0.8, reason: "cut" }] }) }),
    },
  });
  const result = await harness.service.enqueue({ sampleVideoId: "sample_1", analysisFps: 1 });
  await delay(20);
  await harness.service.collectAgentRun(result.processingJobId);
  const artifact = await harness.store.readJson(path.join(harness.store.sampleDir("sample_1"), "artifact.json"));
  const job = harness.jobStore.getJob(result.processingJobId);

  assert.equal(job.status, "processed");
  assert.equal(artifact.shotBoundaryAnalysis.status, "processed");
  assert.equal(artifact.shotBoundaryAnalysis.agent.turnId, "turn_1");
  assert.deepEqual(harness.threadPool.released, [{ leaseId: "lease_1", ownerId: result.traceId }]);
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
  const result = await harness.service.enqueue({ sampleVideoId: "sample_1", analysisFps: 1 });
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
  const result = await harness.service.enqueue({ sampleVideoId: "sample_1", analysisFps: 1 });
  await delay(20);
  await harness.service.collectAgentRun(result.processingJobId);
  const artifact = await harness.store.readJson(path.join(harness.store.sampleDir("sample_1"), "artifact.json"));
  const job = harness.jobStore.getJob(result.processingJobId);

  assert.equal(job.status, "failed");
  assert.equal(artifact.shotBoundaryAnalysis.status, "failed");
  assert.equal(artifact.shotBoundaryAnalysis.agent.threadId, "thread_1");
  assert.equal(harness.logger.snapshots.length, 1);
  assert.deepEqual(harness.threadPool.discarded, [{ threadId: "thread_1", reason: "shot-boundary-analysis-failed" }]);
});

test("shot boundary recovery completes active inflight", async () => {
  const harness = await createShotHarness({
    appServer: {
      collectTurnResult: async () => ({ ok: true, threadId: "thread_1", turnId: "turn_1", status: "completed", finalMessage: JSON.stringify({ shots: [] }) }),
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
      analysisFps: 1,
      status: "turn_submitted",
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  });
  const recovered = await harness.service.recoverActiveAgentRuns();

  assert.equal(recovered.recovered, 1);
  assert.equal(harness.jobStore.getJob(job.jobId).status, "processed");
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

function createArtifact() {
  return {
    sampleVideoId: "sample_1",
    trace: { traceId: "trace_1" },
    processingOptions: { frameSampleRateFps: 3 },
    sampleVideo: { artifactId: "artifact_sample" },
    metadata: { durationSeconds: 2 },
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

async function createShotHarness({ appServer } = {}) {
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
  };
  const artifactIndex = {
    findCacheEntry: async () => null,
    getItem: async () => ({ fileHash: "hash_1" }),
    registerSampleArtifact: async () => ({ ok: true }),
  };
  const service = createShotBoundaryService({
    rootDir,
    store,
    logger,
    jobStore,
    artifactIndex,
    threadPool,
    appServer: {
      startTurnWithInputs: async () => ({ ok: true, threadId: "thread_1", turnId: "turn_1", status: "submitted" }),
      collectTurnResult: async () => ({ ok: false, threadId: "thread_1", turnId: "turn_1", status: "running", finalMessage: "" }),
      ...appServer,
    },
    pollIntervalMs: 60_000,
  });
  return { rootDir, store, logger, jobStore, threadPool, artifactIndex, service };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  };
}
