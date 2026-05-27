const { test, assert, fs, os, path, crypto, createJobStore, DEFAULT_PYTHON_RUNTIME_ROOT, createAppServerBridge, createShotBoundaryService, prepareInput, buildTurnInputs, renderAnalyzeTurnInputs, STAGES, buildProcessedAnalysis, normalizeTimestampBoundaries, buildShotsFromBoundaries, buildShotBoundaryCacheParams, buildRepairTurnInputs, renderRepairTurnInputs, renderSummaryTurnInputs, resolveAnalysisSampling, selectAnalysisFramesByTargetGrid, stripPromptFingerprint, splitPredecessorCacheParams, resolveSkillHash, createArtifactCacheParamBuilders, createArtifactIndex, loadRoleProfileByRole, summarizeThreadConversation, createThreadPoolProxy, sanitizeRoleStatus, DEFAULT_ALLOWED_ROLES, planContactSheets, createArtifact, createShotHarness, isTransformTurnPayload, createContactSheets, rootRuntime, escapeRegExp, delay, hashText, response, structuredErrorForTest, createTransformMessage, createInvalidTransformMessage, createShotMessage, createCachedShotAnalysis, createValidCachedShotAnalysis } = require("./threadpool-shot-boundary.helpers");

test("shot boundary recovery completes active inflight", async () => {
  const harness = await createShotHarness({
    appServer: {
      collectTurnResult: async ({ threadId, turnId }) => {
        if (turnId === "turn_1") {
          return { ok: true, threadId, turnId, status: "completed", finalMessage: "raw analyzer finished" };
        }
        return { ok: true, threadId, turnId, status: "completed", finalMessage: createTransformMessage() };
      },
    },
  });
  const job = harness.jobStore.createJob({ sampleVideoId: "sample_1", traceId: "trace_recover" });
  harness.jobStore.updateJob(job.jobId, {
    status: "processing",
    stage: STAGES.turnStarted,
    progress: 80,
    agentRun: {
      provider: "codex-appserver",
      role: "raw_video_analyze",
      leaseId: null,
      threadId: "thread_1",
      turnId: "turn_1",
      traceId: "trace_recover",
      artifactId: "artifact_recover",
      parentArtifactId: "artifact_sample",
      sampleVideoId: "sample_1",
      analysisFps: 3,
      contactSheets: [],
      status: "turn_submitted",
      inputMode: "raw_video_path_text",
      rawVideoPathInfo: { resolved: true, basename: "source.mp4" },
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  });
  const recovered = await harness.service.recoverActiveAgentRuns();

  assert.equal(recovered.recovered, 1);
  assert.equal(harness.jobStore.getJob(job.jobId).status, "processed");
});

test("shot boundary startup interrupt fails active inflight without collecting old turn", async () => {
  let collectCalls = 0;
  const harness = await createShotHarness({
    appServer: {
      collectTurnResult: async () => {
        collectCalls += 1;
        throw new Error("should not collect during startup interrupt");
      },
    },
  });
  const job = harness.jobStore.createJob({ sampleVideoId: "sample_1", traceId: "trace_restart" });
  harness.jobStore.updateJob(job.jobId, {
    status: "processing",
    stage: STAGES.turnStarted,
    progress: 80,
    agentRun: {
      provider: "codex-appserver",
      role: "raw_video_analyze",
      leaseId: null,
      threadId: "thread_restart",
      turnId: "turn_restart",
      traceId: "trace_restart",
      artifactId: "artifact_restart",
      parentArtifactId: "artifact_sample",
      sampleVideoId: "sample_1",
      analysisFps: 3,
      contactSheets: [],
      status: "turn_submitted",
      inputMode: "raw_video_path_text",
      rawVideoPathInfo: { resolved: true, basename: "source.mp4" },
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  });

  const interrupted = await harness.service.interruptActiveAgentRuns("server-startup");
  const failed = harness.jobStore.getJob(job.jobId);
  const artifact = await harness.store.readJson(path.join(harness.store.sampleDir("sample_1"), "artifact.json"));

  assert.equal(interrupted.interruptedAgentRuns, 1);
  assert.equal(interrupted.interrupted, 0);
  assert.equal(collectCalls, 0);
  assert.equal(failed.status, "failed");
  assert.equal(failed.errorSummary.code, "shot_boundary_job_interrupted");
  assert.equal(failed.errorSummary.retryable, true);
  assert.equal(failed.errorSummary.stageName, STAGES.turnCollected);
  assert.equal(artifact.shotBoundaryAnalysis.status, "failed");
  assert.deepEqual(harness.cancelledTurns, [{
    workspaceRoot: "C:\\Users\\Administrator\\Documents\\Codex",
    threadId: "thread_restart",
    turnId: "turn_restart",
    timeoutSeconds: 30,
  }]);
  assert.deepEqual(harness.threadPool.released, []);
  assert.deepEqual(harness.threadPool.ownerReleased, ["trace_restart"]);
  assert.deepEqual(harness.startedTurns.filter((item) => item.kind === "transform"), []);
});

test("shot boundary fails before raw submit when mp4 path cannot be resolved", async () => {
  const harness = await createShotHarness({
    artifact: createArtifact({ originalVideoUri: "relative/source.mp4", normalizedVideoUri: "relative/source-normalized.mp4" }),
  });

  const result = await harness.service.enqueue({ sampleVideoId: "sample_1", analysisFps: 3 });
  await delay(20);
  const job = harness.jobStore.getJob(result.processingJobId);
  const artifact = await harness.store.readJson(path.join(harness.store.sampleDir("sample_1"), "artifact.json"));
  const failLog = harness.logger.logs.find((entry) => entry.event === "stage.fail");

  assert.equal(job.status, "failed");
  assert.equal(job.errorSummary.code, "shot_boundary_video_path_invalid");
  assert.equal(artifact.shotBoundaryAnalysis.status, "failed");
  assert.equal(harness.startedThreads.length, 0);
  assert.equal(harness.startedTurns.length, 0);
  assert.equal(failLog.stageName, STAGES.turnStarted);
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

test("threadpool owner release sends owner_id only", async () => {
  const requests = [];
  const proxy = createThreadPoolProxy({
    allowedRoles: ["shot-boundary-transformer"],
    fetchImpl: async (url, options = {}) => {
      requests.push({ pathname: new URL(url).pathname, body: options.body ? JSON.parse(options.body) : null });
      return response({ ok: true, released: 1 });
    },
  });
  await proxy.releaseOwnerLeases("trace_1");

  assert.equal(requests[0].pathname, "/leases/release-owner");
  assert.deepEqual(requests[0].body, { owner_id: "trace_1" });
});

test("shot boundary success releases lease and thread returns idle", async () => {
  const harness = await createShotHarness({
    threadPoolConfig: { ok: true, discardOnRelease: false },
    appServer: {
      startTurnWithInputs: async (payload) => {
        if (isTransformTurnPayload(payload)) return { ok: true, threadId: "review_thread_1", turnId: "turn_transform_1", status: "submitted" };
        return { ok: true, threadId: "thread_1", turnId: "turn_raw_1", status: "submitted" };
      },
      collectTurnResult: async ({ threadId, turnId }) => {
        if (turnId === "turn_raw_1") return { ok: true, threadId, turnId, status: "completed", finalMessage: "raw analyzer finished" };
        return { ok: true, threadId, turnId, status: "completed", finalMessage: createTransformMessage() };
      },
    },
  });
  const result = await harness.service.enqueue({ sampleVideoId: "sample_1", analysisFps: 3 });
  await delay(20);
  await harness.service.collectAgentRun(result.processingJobId);
  for (let attempt = 0; attempt < 10 && harness.threadPool.released.length === 0; attempt += 1) {
    await delay(10);
  }

  assert.deepEqual(harness.threadPool.released.map((entry) => entry.ownerId), [`${result.traceId}:transform`]);
  assert.deepEqual(harness.threadPool.discarded, []);
  assert.deepEqual(harness.threadPool.ownerReleased, []);
});

test("shot boundary raw empty final message fails before transform", async () => {
  const harness = await createShotHarness({
    autoTransformFallback: false,
    appServer: {
      startTurnWithInputs: async () => ({ ok: true, threadId: "thread_1", turnId: "turn_raw_1", status: "submitted" }),
      collectTurnResult: async () => ({ ok: true, threadId: "thread_1", turnId: "turn_raw_1", status: "completed", finalMessage: "   " }),
    },
  });
  const result = await harness.service.enqueue({ sampleVideoId: "sample_1", analysisFps: 3, cacheDecision: "refresh" });
  await delay(20);
  await harness.service.collectAgentRun(result.processingJobId);
  const job = harness.jobStore.getJob(result.processingJobId);
  const artifact = await harness.store.readJson(path.join(harness.store.sampleDir("sample_1"), "artifact.json"));

  assert.equal(job.status, "failed");
  assert.equal(artifact.shotBoundaryAnalysis.status, "failed");
  assert.equal(job.errorSummary.code, "shot_raw_video_analyze_empty_result");
  assert.equal(harness.startedTurns.filter((item) => item.kind === "transform").length, 0);
});

test("shot boundary transform repairs invalid shot-centric output once", async () => {
  const harness = await createShotHarness({
    autoTransformFallback: false,
    appServer: {
      startTurnWithInputs: async (payload) => {
        if (isTransformTurnPayload(payload)) {
          const turnIndex = harness.startedTurns.filter((item) => item.kind === "transform").length + 1;
          return { ok: true, threadId: "review_thread_1", turnId: `turn_transform_${turnIndex}`, status: "submitted" };
        }
        return { ok: true, threadId: "thread_1", turnId: "turn_raw_1", status: "submitted" };
      },
      collectTurnResult: async ({ threadId, turnId }) => {
        if (turnId === "turn_raw_1") return { ok: true, threadId, turnId, status: "completed", finalMessage: "raw analyzer finished" };
        if (turnId === "turn_transform_1") {
          return { ok: true, threadId, turnId, status: "completed", finalMessage: createInvalidTransformMessage() };
        }
        return { ok: true, threadId, turnId, status: "completed", finalMessage: createTransformMessage() };
      },
    },
  });

  const result = await harness.service.enqueue({ sampleVideoId: "sample_1", analysisFps: 3, cacheDecision: "refresh" });
  await delay(20);
  await harness.service.collectAgentRun(result.processingJobId);
  const job = harness.jobStore.getJob(result.processingJobId);
  const artifact = await harness.store.readJson(path.join(harness.store.sampleDir("sample_1"), "artifact.json"));
  const transformTurns = harness.startedTurns.filter((item) => item.kind === "transform");
  const repairTurn = transformTurns[1];
  const repairPrompt = repairTurn.payload.inputs[0].text;

  assert.equal(job.status, "processed");
  assert.equal(transformTurns.length, 3);
  assert.equal(artifact.shotBoundaryAnalysis.validation.repairAttemptCount, 1);
  assert.equal(artifact.shotBoundaryAnalysis.agent.turnId, "turn_transform_2");
  assert.equal(artifact.shotBoundaryAnalysis.agent.promptTemplateId, "repair");
  assert.equal(artifact.shotBoundaryAnalysis.agent.promptTemplateVersion, "repair.v1");
  assert.match(repairPrompt, /校验失败摘要/);
  assert.match(repairPrompt, /shot_boundary_shot_not_contiguous/);
  assert.match(repairPrompt, /shots\[1\]/);
  assert.equal(harness.logger.logs.some((entry) => entry.stageName === STAGES.reviewRepairStarted && entry.event === "stage.end"), true);
  assert.equal(harness.logger.logs.some((entry) => entry.stageName === STAGES.reviewRepairValidated && entry.event === "stage.end"), true);
});

test("shot boundary transform legacy reviewer contract stays failed", async () => {
  const harness = await createShotHarness({
    autoTransformFallback: false,
    appServer: {
      startTurnWithInputs: async (payload) => {
        if (isTransformTurnPayload(payload)) return { ok: true, threadId: "review_thread_1", turnId: "turn_transform_1", status: "submitted" };
        return { ok: true, threadId: "thread_1", turnId: "turn_raw_1", status: "submitted" };
      },
      collectTurnResult: async ({ threadId, turnId }) => {
        if (turnId === "turn_raw_1") return { ok: true, threadId, turnId, status: "completed", finalMessage: "raw analyzer finished" };
        return { ok: true, threadId, turnId, status: "completed", finalMessage: JSON.stringify({ decision: "pass", issues: [] }) };
      },
    },
  });
  const result = await harness.service.enqueue({ sampleVideoId: "sample_1", analysisFps: 3, cacheDecision: "refresh" });
  await delay(20);
  await harness.service.collectAgentRun(result.processingJobId);
  const job = harness.jobStore.getJob(result.processingJobId);
  const artifact = await harness.store.readJson(path.join(harness.store.sampleDir("sample_1"), "artifact.json"));

  assert.equal(job.status, "failed");
  assert.equal(job.errorSummary.code, "shot_boundary_transform_legacy_review_result");
  assert.equal(artifact.shotBoundaryAnalysis.status, "failed");
  assert.equal(artifact.shotBoundaryAnalysis.validation.validatorCode, "shot_boundary_transform_legacy_review_result");
});
