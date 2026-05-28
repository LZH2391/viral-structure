const { test, assert, fs, os, path, crypto, createJobStore, DEFAULT_PYTHON_RUNTIME_ROOT, createAppServerBridge, createShotBoundaryService, prepareInput, buildTurnInputs, renderAnalyzeTurnInputs, STAGES, buildProcessedAnalysis, normalizeTimestampBoundaries, buildShotsFromBoundaries, buildShotBoundaryCacheParams, buildRepairTurnInputs, renderRepairTurnInputs, renderSummaryTurnInputs, resolveAnalysisSampling, selectAnalysisFramesByTargetGrid, stripPromptFingerprint, splitPredecessorCacheParams, resolveSkillHash, createArtifactCacheParamBuilders, createArtifactIndex, loadRoleProfileByRole, summarizeThreadConversation, createThreadPoolProxy, sanitizeRoleStatus, DEFAULT_ALLOWED_ROLES, planContactSheets, createArtifact, createShotHarness, isTransformTurnPayload, createContactSheets, rootRuntime, escapeRegExp, delay, hashText, response, structuredErrorForTest, createTransformMessage, createInvalidTransformMessage, createShotMessage, createCachedShotAnalysis, createValidCachedShotAnalysis } = require("./threadpool-shot-boundary.helpers");

test("shot boundary history appends for refresh and cache reuse without overwriting prior entries", async () => {
  const cacheEntries = new Map();
  const harness = await createShotHarness({
    artifactIndex: {
      getItem: async () => ({ fileHash: "hash_1" }),
      findCacheEntry: async ({ fileHash, stageName, params }) => cacheEntries.get(JSON.stringify({ fileHash, stageName, params })) ?? null,
      loadItem: async () => ({ ...createArtifact(), sampleVideoId: "sample_cached", shotBoundaryAnalysis: createValidCachedShotAnalysis() }),
      registerSampleArtifact: async ({ artifact }) => {
        const params = buildShotBoundaryCacheParams({
          sourceArtifactId: artifact.shotBoundaryAnalysis.parentArtifactId,
          extractSampling: artifact.shotBoundaryAnalysis.extractSampling,
          analysisSampling: artifact.shotBoundaryAnalysis.analysisSampling,
          frameDimensions: { width: artifact.metadata.width, height: artifact.metadata.height },
          contactSheets: artifact.shotBoundaryAnalysis.contactSheets,
          profileVersion: artifact.shotBoundaryAnalysis.agent.profileVersion,
          promptTemplateId: artifact.shotBoundaryAnalysis.agent.promptTemplateId,
          promptTemplateVersion: artifact.shotBoundaryAnalysis.agent.promptTemplateVersion,
          promptTemplateHash: artifact.shotBoundaryAnalysis.agent.promptTemplateHash,
          initFingerprint: artifact.shotBoundaryAnalysis.agent.initFingerprint,
          skillHash: artifact.shotBoundaryAnalysis.agent.skillHash,
        });
        cacheEntries.set(JSON.stringify({ fileHash: "hash_1", stageName: STAGES.resultWritten, params }), { sampleVideoId: "sample_cached", cacheKey: "cache_registered" });
        return { ok: true };
      },
    },
    appServer: {
      startTurnWithInputs: async () => ({ ok: true, threadId: "thread_1", turnId: `turn_${Date.now()}`, status: "submitted" }),
      collectTurnResult: async () => ({
        ok: true,
        threadId: "thread_1",
        turnId: "turn_history_1",
        status: "completed",
        finalMessage: JSON.stringify({ boundaries: [{ timestamp: 1.2, confidence: 0.8, boundaryType: "hard_cut", reason: "cut", needReview: false }] }),
      }),
    },
  });

  const first = await harness.service.enqueue({ sampleVideoId: "sample_1", analysisFps: 1, cacheDecision: "refresh" });
  await delay(20);
  await harness.service.collectAgentRun(first.processingJobId);
  const second = await harness.service.enqueue({ sampleVideoId: "sample_1", analysisFps: 1, cacheDecision: "ask" });
  await delay(20);
  await harness.service.resolveCacheDecision({ jobId: second.processingJobId, decision: "reuse" });
  await delay(20);
  const artifact = await harness.store.readJson(path.join(harness.store.sampleDir("sample_1"), "artifact.json"));

  assert.equal(second.processingJobId != null, true);
  assert.equal(Array.isArray(artifact.shotBoundaryAnalysisHistory), true);
  assert.equal(artifact.shotBoundaryAnalysisHistory.length >= 2, true);
  assert.equal(artifact.shotBoundaryAnalysisHistory.at(-2).resultOrigin, "transformed_turn");
  assert.equal(artifact.shotBoundaryAnalysisHistory.at(-1).resultOrigin, "cache_reuse");
  assert.equal(artifact.shotBoundaryAnalysisHistory.at(-2).traceId, first.traceId);
  assert.equal(artifact.shotBoundaryAnalysisHistory.at(-1).traceId, second.traceId);
  assert.equal(artifact.shotBoundaryAnalysisHistory.at(-1).sourceTraceId, "trace_1");
});

test("shot boundary keeps Chinese reason text without mojibake", async () => {
  const harness = await createShotHarness({
    autoTransformFallback: false,
    appServer: {
      startTurnWithInputs: async (payload) => {
        if (isTransformTurnPayload(payload)) return { ok: true, threadId: "review_thread_1", turnId: "turn_transform_1", status: "submitted" };
        return { ok: true, threadId: "thread_1", turnId: "turn_raw_1", status: "submitted" };
      },
      collectTurnResult: async ({ threadId, turnId }) => {
        if (turnId === "turn_raw_1") return { ok: true, threadId, turnId, status: "completed", finalMessage: "raw analyzer finished" };
        return {
          ok: true,
          threadId,
          turnId,
          status: "completed",
          finalMessage: JSON.stringify({
            shots: [
              {
                summary: "镜头一",
                start: 0,
                end: 1.2,
                endBoundary: { timestamp: 1.2, confidence: 0.8, boundaryType: "hard_cut", reason: "未检测到明显视觉变化", needReview: false },
              },
              {
                summary: "镜头二",
                start: 1.2,
                end: 2,
                endBoundary: null,
              },
            ],
            commerceBrief: {
              sellingObject: "产品样例",
              proofApproach: "画面展示",
              promisedOutcome: "快速理解卖点",
              persuasionTarget: "潜在购买用户",
              conversionAction: "未观察到明显转化动作",
              uncertainties: [],
            },
          }),
        };
      },
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

test("appserver bridge structured error payload is surfaced", async () => {
  const error = new Error("missing-content-type");
  const payload = structuredErrorForTest("appserver_bridge_failed", error, {
    operation: "readThread",
    threadId: "thread_1",
    turnId: "turn_1",
  });

  assert.deepEqual(payload, {
    ok: false,
    error: "appserver_bridge_failed",
    message: "Error: missing-content-type",
    operation: "readThread",
    threadId: "thread_1",
    turnId: "turn_1",
  });
});

test("threadpool readiness detail exposes ready_for_leases and recovering gate", async () => {
  const harness = await createShotHarness({
    threadPoolOverrides: {
      roleStatus: async () => ({
        ok: true,
        role: "shot-boundary-transformer",
        counts: { idle: 0, leased: 0 },
        minIdle: 1,
        canAcquire: false,
        canInit: false,
        warming: true,
        readyForLeases: false,
        recovering: true,
        warmupError: null,
        startupError: null,
        threads: [],
        leases: [],
      }),
    },
  });
  const status = await harness.threadPool.roleStatus("shot-boundary-transformer");

  assert.equal(status.readyForLeases, false);
  assert.equal(status.recovering, true);
  assert.equal(status.warming, true);
});

test("shot boundary parse failure writes failed artifact and debug snapshot", async () => {
  const harness = await createShotHarness({
    autoTransformFallback: false,
    appServer: {
      startTurnWithInputs: async (payload) => {
        if (isTransformTurnPayload(payload)) return { ok: true, threadId: "review_thread_1", turnId: "turn_transform_1", status: "submitted" };
        return { ok: true, threadId: "thread_1", turnId: "turn_raw_1", status: "submitted" };
      },
      collectTurnResult: async ({ threadId, turnId }) => {
        if (turnId === "turn_raw_1") return { ok: true, threadId, turnId, status: "completed", finalMessage: "raw analyzer finished" };
        return { ok: true, threadId, turnId, status: "completed", finalMessage: "not-json" };
      },
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
  assert.equal(artifact.shotBoundaryAnalysis.contactSheets.length, 0);
  assert.equal(harness.logger.snapshots.length, 1);
  assert.deepEqual(harness.threadPool.discarded, []);
  assert.deepEqual(harness.threadPool.released, [
    { leaseId: "lease_1", ownerId: result.traceId, thread_status: "idle" },
    { leaseId: "review_lease_1", ownerId: `${result.traceId}:transform`, thread_status: "idle" },
  ]);
  assert.deepEqual(harness.threadPool.ownerReleased, []);
});

test("shot boundary mojibake reason fails quality gate and writes debug snapshot", async () => {
  const harness = await createShotHarness({
    autoTransformFallback: false,
    appServer: {
      startTurnWithInputs: async (payload) => {
        if (isTransformTurnPayload(payload)) return { ok: true, threadId: "review_thread_1", turnId: "turn_transform_1", status: "submitted" };
        return { ok: true, threadId: "thread_1", turnId: "turn_raw_1", status: "submitted" };
      },
      collectTurnResult: async ({ threadId, turnId }) => {
        if (turnId === "turn_raw_1") return { ok: true, threadId, turnId, status: "completed", finalMessage: "raw analyzer finished" };
        return {
          ok: true,
          threadId,
          turnId,
          status: "completed",
          finalMessage: JSON.stringify({
            shots: [
              {
                summary: "镜头一",
                start: 0,
                end: 1.2,
                endBoundary: { timestamp: 1.2, confidence: 0.8, boundaryType: "hard_cut", reason: "鏈娴嬪埌鏄庢樉瑙嗚鍙樺寲", needReview: false },
              },
              {
                summary: "镜头二",
                start: 1.2,
                end: 2,
                endBoundary: null,
              },
            ],
            commerceBrief: {
              sellingObject: "产品样例",
              proofApproach: "画面展示",
              promisedOutcome: "快速理解卖点",
              persuasionTarget: "潜在购买用户",
              conversionAction: "未观察到明显转化动作",
              uncertainties: [],
            },
          }),
        };
      },
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
  assert.equal(failLog.stageName, STAGES.turnCollected);
  assert.equal(harness.logger.snapshots[0].debugPayload.turnId, "turn_transform_1");
  assert.match(harness.logger.snapshots[0].debugPayload.parseFailureReason, /mojibake/);
});
