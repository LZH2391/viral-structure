const { test, assert, fs, os, path, crypto, createJobStore, DEFAULT_PYTHON_RUNTIME_ROOT, createAppServerBridge, createShotBoundaryService, prepareInput, buildTurnInputs, renderAnalyzeTurnInputs, STAGES, buildProcessedAnalysis, normalizeTimestampBoundaries, buildShotsFromBoundaries, buildShotBoundaryCacheParams, buildRepairTurnInputs, renderRepairTurnInputs, renderSummaryTurnInputs, resolveAnalysisSampling, selectAnalysisFramesByTargetGrid, stripPromptFingerprint, splitPredecessorCacheParams, resolveSkillHash, createArtifactCacheParamBuilders, createArtifactIndex, loadRoleProfileByRole, summarizeThreadConversation, createThreadPoolProxy, sanitizeRoleStatus, DEFAULT_ALLOWED_ROLES, planContactSheets, createArtifact, createShotHarness, isTransformTurnPayload, createContactSheets, rootRuntime, escapeRegExp, delay, hashText, response, structuredErrorForTest, createTransformMessage, createInvalidTransformMessage, createShotMessage, createCachedShotAnalysis, createValidCachedShotAnalysis } = require("./threadpool-shot-boundary.helpers");

test("shot boundary raw submit acquires raw analyzer lease and sends fixed mp4 path text", async () => {
  const harness = await createShotHarness({
    artifact: createArtifact({
      subtitleStatus: "processed",
      subtitleSegments: [
        { id: "subtitle_1", start: 0, end: 1.1, text: "这是包装上的鳗鱼", confidence: null },
        { id: "subtitle_2", start: 1.2, end: 2, text: "手里展示多袋包装", confidence: null },
      ],
    }),
    appServer: {
      startTurnWithInputs: async ({ threadId }) => ({ ok: true, threadId, turnId: "turn_raw_1", status: "submitted" }),
      collectTurnResult: async () => ({
        ok: false,
        threadId: "thread_1",
        turnId: "turn_raw_1",
        status: "running",
        finalMessage: "",
        turnActivity: {
          itemCount: 2,
          effectiveItemCount: 1,
          latestItemType: "tool_call",
          latestToolName: "view_image",
          latestMessagePreview: "读取视频帧",
          tokenUsage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
        },
      }),
    },
  });

  const result = await harness.service.enqueue({ sampleVideoId: "sample_1", analysisFps: 3 });
  await delay(20);
  const job = harness.jobStore.getJob(result.processingJobId);
  const rawTurn = harness.startedTurns.find((item) => item.kind === "shot");

  assert.equal(harness.startedThreads.length, 0);
  assert.equal(rawTurn != null, true);
  assert.equal(rawTurn.payload.threadId, "thread_1");
  assert.equal(rawTurn.payload.workspaceRoot, "C:/Users/Administrator/Documents/Codex");
  assert.equal(rawTurn.payload.inputs.length, 1);
  assert.equal(rawTurn.payload.inputs[0].type, "text");
  assert.match(rawTurn.payload.inputs[0].text, /请使用 Video-shot skill 执行原始视频切镜/);
  assert.match(rawTurn.payload.inputs[0].text, new RegExp(escapeRegExp(path.join(harness.store.runtimeRoot, "source.mp4"))));
  assert.match(rawTurn.payload.inputs[0].text, /不查仓库、不调用其他技能、不看工作区项目实现/);
  assert.match(rawTurn.payload.skillPath, /[\\\/]\.agents[\\\/]skills[\\\/]video-shot[\\\/]SKILL\.md$/);
  assert.equal(job.status, "processing");
  assert.equal(job.agentRun.role, "shot-boundary-raw-analyzer");
  assert.equal(job.agentRun.threadId, "thread_1");
  assert.equal(job.agentRun.leaseId, "lease_1");
  assert.equal(job.agentRun.turnId, "turn_raw_1");
  assert.equal(job.agentRun.workspaceRoot, "C:/Users/Administrator/Documents/Codex");
  assert.equal(job.agentRun.inputMode, "raw_video_path_text");
  assert.deepEqual(job.agentRun.rawVideoPathInfo, { resolved: true, basename: "source.mp4" });
  assert.equal(job.agentActivity.latestItemType, "tool_call");
  assert.equal(job.agentActivity.latestToolName, "view_image");
  assert.equal(job.agentActivity.tokenUsage.totalTokens, 120);
  assert.equal(harness.threadPool.released.length, 0);
});

test("shot boundary transform collect polls running turn and preserves active message", async () => {
  let transformCollectCount = 0;
  const transformMessages = [];
  const harness = await createShotHarness({
    appServer: {
      startTurnWithInputs: async (payload) => {
        if (isTransformTurnPayload(payload)) return { ok: true, threadId: "review_thread_1", turnId: "turn_transform_1", status: "submitted" };
        return { ok: true, threadId: "thread_raw_1", turnId: "turn_raw_1", status: "submitted" };
      },
      collectTurnResult: async ({ threadId, turnId }) => {
        if (turnId === "turn_raw_1") return { ok: true, threadId, turnId, status: "completed", finalMessage: "raw analyzer finished" };
        transformCollectCount += 1;
        if (transformCollectCount === 1) {
          return { ok: false, threadId, turnId, status: "running", finalMessage: "", activeThreadMessage: "transform 正在整理切镜结果" };
        }
        if (transformCollectCount === 2) {
          return { ok: false, threadId, turnId, status: "running", finalMessage: "", activeThreadMessage: "" };
        }
        return { ok: true, threadId, turnId, status: "completed", finalMessage: createTransformMessage() };
      },
    },
    reviewPollIntervalMs: 0,
  });

  const originalUpdateJob = harness.jobStore.updateJob;
  harness.jobStore.updateJob = (jobId, patch) => {
    const updated = originalUpdateJob(jobId, patch);
    if (Object.prototype.hasOwnProperty.call(patch, "activeThreadMessage")) {
      transformMessages.push(updated?.activeThreadMessage ?? null);
    }
    return updated;
  };

  const result = await harness.service.enqueue({ sampleVideoId: "sample_1", analysisFps: 3 });
  await delay(20);
  await harness.service.collectAgentRun(result.processingJobId);
  const job = harness.jobStore.getJob(result.processingJobId);
  const rawTurn = harness.startedTurns.find((item) => item.kind === "shot");
  const transformTurn = harness.startedTurns.find((item) => item.kind === "transform");
  const collectLogs = harness.logger.logs.filter((entry) => entry.stageName === STAGES.reviewCollected && entry.event === "stage.end");
  const visualCollectLogs = harness.logger.logs.filter((entry) => entry.stageName === STAGES.visualSummaryCollected && entry.event === "stage.end");

  assert.equal(rawTurn.payload.workspaceRoot, "C:/Users/Administrator/Documents/Codex");
  assert.equal(transformTurn.payload.workspaceRoot, harness.rootDir);
  assert.equal(transformCollectCount, 4);
  assert.equal(collectLogs.length, 3);
  assert.deepEqual(collectLogs.map((entry) => entry.outputSummary.attempt), [1, 2, 3]);
  assert.equal(visualCollectLogs.length, 1);
  assert.ok(transformMessages.some((message) => message?.text === "transform 正在整理切镜结果"));
  assert.equal(job.status, "processed");
  assert.equal(job.activeThreadMessage, null);
});

test("shot boundary collect completed writes transformed artifact and releases raw and transformer leases", async () => {
  const harness = await createShotHarness({
    artifact: createArtifact({
      subtitleStatus: "processed",
      subtitleSegments: [
        { id: "subtitle_1", start: 0, end: 1.1, text: "这是包装上的鳗鱼", confidence: null },
        { id: "subtitle_2", start: 1.2, end: 2, text: "手里展示多袋包装", confidence: null },
      ],
    }),
    appServer: {
      startTurnWithInputs: async (payload) => {
        if (isTransformTurnPayload(payload)) return { ok: true, threadId: "review_thread_1", turnId: "turn_transform_1", status: "submitted" };
        return { ok: true, threadId: "thread_raw_1", turnId: "turn_raw_1", status: "submitted" };
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
  const artifact = await harness.store.readJson(path.join(harness.store.sampleDir("sample_1"), "artifact.json"));
  const job = harness.jobStore.getJob(result.processingJobId);
  const transformTurns = harness.startedTurns.filter((item) => item.kind === "transform");
  const transformTurn = transformTurns[0];
  const visualSummaryTurn = transformTurns[1];

  assert.equal(job.status, "processed");
  assert.equal(artifact.shotBoundaryAnalysis.status, "processed");
  assert.equal(artifact.shotBoundaryAnalysis.resultOrigin, "transformed_turn");
  assert.equal(artifact.shotBoundaryAnalysis.agent.role, "shot-boundary-transformer");
  assert.equal(artifact.shotBoundaryAnalysis.agent.threadId, "review_thread_1");
  assert.equal(artifact.shotBoundaryAnalysis.agent.leaseId, "review_lease_1");
  assert.equal(artifact.shotBoundaryAnalysis.agent.turnId, "turn_transform_1");
  assert.equal(artifact.shotBoundaryAnalysis.agent.promptTemplateId, "transform");
  assert.equal(artifact.shotBoundaryAnalysis.agent.profileVersion, "2026-05-24.2");
  assert.equal(artifact.shotBoundaryAnalysis.agent.inputMode, "raw_video_path_text");
  assert.equal(artifact.shotBoundaryAnalysis.agent.rawAnalyzer.phase, "shot-boundary-raw-analyzer");
  assert.equal(artifact.shotBoundaryAnalysis.agent.rawAnalyzer.threadId, "thread_1");
  assert.equal(artifact.shotBoundaryAnalysis.agent.rawAnalyzer.turnId, "turn_raw_1");
  assert.equal(artifact.shotBoundaryAnalysis.agent.rawAnalyzer.leaseId, "lease_1");
  assert.equal(artifact.shotBoundaryAnalysis.agent.rawAnalyzer.inputMode, "raw_video_path_text");
  assert.equal(artifact.shotBoundaryAnalysis.contactSheets.length, 4);
  assert.equal(artifact.shotBoundaryAnalysis.contactSheets.some((sheet) => sheet.sheetPurpose === "shot_boundary_result_sheet"), true);
  assert.equal(artifact.shotBoundaryAnalysis.contactSheets.every((sheet) => sheet.localImagePath === undefined), true);
  assert.equal(artifact.shotBoundaryAnalysis.contactSheets.every((sheet) => (sheet.gridItems ?? []).every((item) => item.filePath === undefined)), true);
  assert.equal(artifact.shotBoundaryAnalysis.boundaries.length, 1);
  assert.equal(artifact.shotBoundaryAnalysis.shots[0].summary, "turn_transform 人物半身面对镜头");
  assert.equal(artifact.shotBoundaryAnalysis.shots[1].summary, "turn_transform 产品包装特写");
  assert.equal(Object.prototype.hasOwnProperty.call(artifact.shotBoundaryAnalysis.commerceBrief, "videoSummary"), false);
  assert.equal(transformTurns.length, 2);
  assert.equal(transformTurn.payload.inputs.length, 1);
  assert.equal(transformTurn.payload.inputs[0].type, "text");
  assert.equal(transformTurn.payload.inputs.filter((item) => item.type === "localImage").length, 0);
  assert.equal(visualSummaryTurn.payload.inputs.length, 5);
  assert.equal(visualSummaryTurn.payload.inputs[0].type, "text");
  assert.equal(visualSummaryTurn.payload.inputs.filter((item) => item.type === "localImage").length, 4);
  assert.match(transformTurn.payload.inputs[0].text, /结果转换 agent/);
  assert.match(transformTurn.payload.inputs[0].text, /rawAnalyzerResult/);
  assert.doesNotMatch(transformTurn.payload.inputs[0].text, /subtitleContext/);
  assert.doesNotMatch(transformTurn.payload.inputs[0].text, /这是包装上的鳗鱼/);
  assert.match(visualSummaryTurn.payload.inputs[0].text, /script-segment-analyzer/);
  assert.match(visualSummaryTurn.payload.inputs[0].text, /只写视觉画面内容/);
  assert.match(visualSummaryTurn.payload.inputs[0].text, /commerceBrief/);
  assert.doesNotMatch(visualSummaryTurn.payload.inputs[0].text, /subtitleText/);
  assert.doesNotMatch(visualSummaryTurn.payload.inputs[0].text, /subtitleContextText/);
  assert.doesNotMatch(visualSummaryTurn.payload.inputs[0].text, /这是包装上的鳗鱼/);
  assert.doesNotMatch(visualSummaryTurn.payload.inputs[0].text, /手里展示多袋包装/);
  assert.doesNotMatch(visualSummaryTurn.payload.inputs[0].text, /"sheets"/);
  assert.doesNotMatch(transformTurn.payload.inputs[0].text, /shots\[\]\.endBoundary\.reason/);
  assert.doesNotMatch(transformTurn.payload.inputs[0].text, /analysisSampling/);
  assert.doesNotMatch(transformTurn.payload.inputs[0].text, /schemaVersion/);
  assert.doesNotMatch(transformTurn.payload.inputs[0].text, /textLength/);
  assert.doesNotMatch(transformTurn.payload.inputs[0].text, /inputIndex/);
  assert.doesNotMatch(transformTurn.payload.inputs[0].text, /sourceFrameIndex/);
  assert.doesNotMatch(transformTurn.payload.inputs[0].text, /fileName/);
  assert.equal(harness.threadPool.released.length, 2);
  assert.deepEqual(harness.threadPool.released.map((entry) => entry.ownerId), [result.traceId, `${result.traceId}:transform`]);
  assert.deepEqual(harness.threadPool.ownerReleased, []);
  assert.deepEqual(harness.threadPool.discarded, []);
});

test("shot boundary skill content change misses old shot cache", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "shot-skill-hash-"));
  const skillPath = path.join(tempRoot, "SKILL.md");
  await fs.writeFile(skillPath, "new skill content", "utf8");
  const oldSkillHash = hashText("old skill content");
  let shotStartTurnCount = 0;
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
      startTurnWithInputs: async (payload) => {
        if (!isTransformTurnPayload(payload)) shotStartTurnCount += 1;
        return { ok: true, threadId: "thread_1", turnId: "turn_1", status: "submitted" };
      },
    },
  });

  await harness.service.enqueue({ sampleVideoId: "sample_1", analysisFps: 3 });
  await delay(20);

  assert.ok(cacheLookups.length >= 1);
  const currentLookup = cacheLookups[0];
  assert.equal(currentLookup.profileVersion, "2026-05-24.2");
  assert.equal(currentLookup.promptTemplateId, "transform");
  assert.equal(currentLookup.promptTemplateVersion, "transform.v1");
  assert.ok(currentLookup.promptTemplateHash);
  assert.equal("initFingerprint" in currentLookup, false);
  assert.ok(currentLookup.skillHash);
  assert.notEqual(currentLookup.skillHash, oldSkillHash);
  assert.equal(shotStartTurnCount, 1);
});

test("shot boundary cache hit skips turn and writes cache reuse log", async () => {
  let shotStartTurnCount = 0;
  const cachedAnalysis = createCachedShotAnalysis();
  const harness = await createShotHarness({
    artifactIndex: {
      findCacheEntry: async () => ({ sampleVideoId: "sample_cached", cacheKey: "cache_1" }),
      loadItem: async () => ({ ...createArtifact(), sampleVideoId: "sample_cached", shotBoundaryAnalysis: cachedAnalysis }),
    },
    appServer: {
      startTurnWithInputs: async (payload) => {
        if (!isTransformTurnPayload(payload)) shotStartTurnCount += 1;
        return { ok: true, threadId: "thread_1", turnId: "turn_1", status: "submitted" };
      },
    },
  });

  const result = await harness.service.enqueue({ sampleVideoId: "sample_1", analysisFps: 3, cacheDecision: "ask" });
  await delay(20);
  const artifact = await harness.store.readJson(path.join(harness.store.sampleDir("sample_1"), "artifact.json"));
  const job = harness.jobStore.getJob(result.processingJobId);
  const cacheLookupLog = harness.logger.logs.find((entry) => entry.stageName === STAGES.cacheLookup && entry.event === "stage.end" && entry.outputSummary?.cacheLookup === "miss");

  assert.equal(shotStartTurnCount, 1);
  assert.equal(job.status, "processing");
  assert.equal(artifact.shotBoundaryAnalysis, undefined);
  assert.equal(cacheLookupLog.outputSummary.reason, "eligibility_rejected");
});

test("shot boundary valid cache can be reused", async () => {
  let shotStartTurnCount = 0;
  const cachedAnalysis = createValidCachedShotAnalysis();
  const harness = await createShotHarness({
    artifactIndex: {
      findCacheEntry: async () => ({ sampleVideoId: "sample_cached", cacheKey: "cache_1" }),
      loadItem: async () => ({ ...createArtifact(), sampleVideoId: "sample_cached", shotBoundaryAnalysis: cachedAnalysis }),
    },
    appServer: {
      startTurnWithInputs: async (payload) => {
        if (!isTransformTurnPayload(payload)) shotStartTurnCount += 1;
        return { ok: true, threadId: "thread_1", turnId: "turn_1", status: "submitted" };
      },
    },
  });

  const result = await harness.service.enqueue({ sampleVideoId: "sample_1", analysisFps: 3, cacheDecision: "ask" });
  await delay(20);
  const waitingJob = harness.jobStore.getJob(result.processingJobId);
  assert.equal(waitingJob.status, "cache_waiting");
  assert.equal(waitingJob.cachePrompt.cachedItem.analysisFps, 3);
  assert.equal(waitingJob.cachePrompt.profileVersion, "2026-05-24.2");
  assert.equal(waitingJob.cachePrompt.promptTemplateId, "transform");
  assert.equal(waitingJob.cachePrompt.promptTemplateVersion, "transform.v1");
  assert.ok(waitingJob.cachePrompt.promptTemplateHash);
  assert.ok(waitingJob.cachePrompt.initFingerprint);
  await harness.service.resolveCacheDecision({ jobId: result.processingJobId, decision: "reuse" });
  await delay(20);
  const artifact = await harness.store.readJson(path.join(harness.store.sampleDir("sample_1"), "artifact.json"));
  const job = harness.jobStore.getJob(result.processingJobId);
  const cacheReuseLog = harness.logger.logs.find((entry) => entry.stageName === STAGES.cacheReuse && entry.event === "stage.end");

  assert.equal(shotStartTurnCount, 0);
  assert.equal(job.status, "processed");
  assert.equal(artifact.shotBoundaryAnalysis.resultOrigin, "cache_reuse");
  assert.equal(artifact.shotBoundaryAnalysis.agent.turnId, "turn_transform_cached");
  assert.equal(cacheReuseLog.outputSummary.sourceSampleVideoId, "sample_cached");
  assert.equal(cacheReuseLog.outputSummary.cacheKey, "cache_1");
  assert.equal(cacheReuseLog.outputSummary.sourceTurnId, "turn_transform_cached");
  assert.equal(cacheReuseLog.outputSummary.analysisFps, 3);
  assert.equal(cacheReuseLog.outputSummary.boundaryCount, 1);
  assert.equal(cacheReuseLog.outputSummary.shotCount, 2);
});

test("shot boundary registers reusable cache for the same service run", async () => {
  let shotStartTurnCount = 0;
  const harness = await createShotHarness({
    useRealArtifactIndex: true,
    appServer: {
      startTurnWithInputs: async (payload) => {
        if (isTransformTurnPayload(payload)) return { ok: true, threadId: "review_thread_1", turnId: "turn_transform_1", status: "submitted" };
        shotStartTurnCount += 1;
        return { ok: true, threadId: "thread_1", turnId: `turn_${shotStartTurnCount}`, status: "submitted" };
      },
      collectTurnResult: async ({ turnId }) => {
        if (turnId === "turn_1") return { ok: true, threadId: "thread_1", turnId, status: "completed", finalMessage: "raw analyzer finished" };
        return {
          ok: true,
          threadId: "review_thread_1",
          turnId,
          status: "completed",
          finalMessage: createTransformMessage(),
        };
      },
    },
  });

  const first = await harness.service.enqueue({ sampleVideoId: "sample_1", analysisFps: 3, cacheDecision: "refresh" });
  await delay(20);
  await harness.service.collectAgentRun(first.processingJobId);
  const second = await harness.service.enqueue({ sampleVideoId: "sample_1", analysisFps: 3, cacheDecision: "ask" });
  await delay(20);
  const secondJob = harness.jobStore.getJob(second.processingJobId);

  assert.equal(secondJob.status, "cache_waiting");
  assert.equal(secondJob.cachePrompt.cachedItem.analysisFps, 3);
  assert.equal(shotStartTurnCount, 1);
});

test("shot boundary cache lookup no longer falls back to legacy promptless cache params", async () => {
  const cacheEntries = new Map();
  const stableKey = (fileHash, stageName, params) => JSON.stringify({ fileHash, stageName, params });
  const cachedAnalysis = createValidCachedShotAnalysis();
  const harness = await createShotHarness({
    artifactIndex: {
      getItem: async () => ({ fileHash: "hash_1" }),
      findCacheEntry: async ({ fileHash, stageName, params }) => cacheEntries.get(stableKey(fileHash, stageName, params)) ?? null,
      loadItem: async () => ({ ...createArtifact(), sampleVideoId: "sample_cached", shotBoundaryAnalysis: cachedAnalysis }),
      registerSampleArtifact: async () => ({ ok: true }),
    },
  });
  const artifact = await harness.store.readJson(path.join(harness.store.sampleDir("sample_1"), "artifact.json"));
  const prepared = prepareInput(artifact, 3, { runtimeRoot: harness.store.runtimeRoot });
  const contactSheets = createContactSheets(prepared, harness.store.sampleDir("sample_1"));
  const legacyParams = stripPromptFingerprint(buildShotBoundaryCacheParams({
    sourceArtifactId: prepared.sourceArtifactId,
    extractSampling: prepared.extractSampling,
    analysisSampling: prepared.analysisSampling,
    frameDimensions: prepared.frameDimensions,
    contactSheets,
    subtitleContextSummary: prepared.subtitleContextSummary,
    skillHash: await resolveSkillHash(),
  }));
  cacheEntries.set(stableKey("hash_1", STAGES.resultWritten, legacyParams), { sampleVideoId: "sample_cached", cacheKey: "legacy_cache" });

  const result = await harness.service.enqueue({ sampleVideoId: "sample_1", analysisFps: 3, cacheDecision: "ask" });
  await delay(20);
  const job = harness.jobStore.getJob(result.processingJobId);
  const cacheLookupLog = harness.logger.logs.find((entry) => entry.stageName === STAGES.cacheLookup && entry.event === "stage.end");

  assert.notEqual(job.status, "cache_waiting");
  assert.equal(cacheLookupLog.outputSummary.cacheLookup, "miss");
  assert.equal(cacheLookupLog.outputSummary.reason, "key_miss");
});

test("shot boundary cache decision refresh continues same job and trace", async () => {
  let shotStartTurnCount = 0;
  const harness = await createShotHarness({
    artifactIndex: {
      findCacheEntry: async () => ({ sampleVideoId: "sample_cached", cacheKey: "cache_1" }),
      loadItem: async () => ({ ...createArtifact(), sampleVideoId: "sample_cached", shotBoundaryAnalysis: createValidCachedShotAnalysis() }),
    },
    appServer: {
      startTurnWithInputs: async (payload) => {
        if (!isTransformTurnPayload(payload)) shotStartTurnCount += 1;
        return { ok: true, threadId: "thread_1", turnId: "turn_1", status: "submitted" };
      },
    },
  });

  const result = await harness.service.enqueue({ sampleVideoId: "sample_1", analysisFps: 3, cacheDecision: "ask" });
  await delay(20);
  const waitingJob = harness.jobStore.getJob(result.processingJobId);
  await harness.service.resolveCacheDecision({ jobId: result.processingJobId, decision: "refresh" });
  await delay(20);
  const refreshedJob = harness.jobStore.getJob(result.processingJobId);

  assert.equal(waitingJob.status, "cache_waiting");
  assert.equal(refreshedJob.traceId, result.traceId);
  assert.equal(refreshedJob.jobId, result.processingJobId);
  assert.equal(refreshedJob.status, "processing");
  assert.equal(shotStartTurnCount, 1);
});

test("same fps lookup reuses registered shot cache params while different fps misses", async () => {
  const cacheEntries = new Map();
  const stableKey = (fileHash, stageName, params) => JSON.stringify({
    fileHash,
    stageName,
    params,
  });
  let shotStartTurnCount = 0;
  const harness = await createShotHarness({
    artifactIndex: {
      getItem: async () => ({ fileHash: "hash_1" }),
      findCacheEntry: async ({ fileHash, stageName, params }) => cacheEntries.get(stableKey(fileHash, stageName, params)) ?? null,
      loadItem: async (sampleVideoId) => sampleVideoId === "sample_cached" ? { ...createArtifact(), sampleVideoId, shotBoundaryAnalysis: createValidCachedShotAnalysis({ analysisFps: 1 }) } : null,
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
        cacheEntries.set(stableKey("hash_1", STAGES.resultWritten, params), { sampleVideoId: "sample_cached", cacheKey: "cache_registered" });
        return { ok: true };
      },
    },
    appServer: {
      startTurnWithInputs: async (payload) => {
        if (!isTransformTurnPayload(payload)) shotStartTurnCount += 1;
        return { ok: true, threadId: "thread_1", turnId: "turn_1", status: "submitted" };
      },
      collectTurnResult: async ({ turnId }) => {
        if (turnId === "turn_1") {
          return { ok: true, threadId: "thread_1", turnId, status: "completed", finalMessage: "raw analyzer finished" };
        }
        return { ok: true, threadId: "review_thread_1", turnId, status: "completed", finalMessage: createTransformMessage() };
      },
    },
  });

  const first = await harness.service.enqueue({ sampleVideoId: "sample_1", analysisFps: 1, cacheDecision: "refresh" });
  await delay(20);
  await harness.service.collectAgentRun(first.processingJobId);
  const second = await harness.service.enqueue({ sampleVideoId: "sample_1", analysisFps: 1, cacheDecision: "ask" });
  await delay(20);
  const third = await harness.service.enqueue({ sampleVideoId: "sample_1", analysisFps: 2, cacheDecision: "ask" });
  await delay(20);
  const secondJob = harness.jobStore.getJob(second.processingJobId);
  const thirdJob = harness.jobStore.getJob(third.processingJobId);

  assert.equal(shotStartTurnCount, 2);
  assert.equal(secondJob.status, "cache_waiting");
  assert.equal(secondJob.cachePrompt.cachedItem.analysisFps, 1);
  assert.notEqual(thirdJob.status, "cache_waiting");
});

test("cache miss log distinguishes key miss from eligibility rejection", async () => {
  const harness = await createShotHarness({
    artifactIndex: {
      getItem: async () => ({ fileHash: "hash_1" }),
      findCacheEntry: async ({ params }) => (params.analysisFps === 1 ? { sampleVideoId: "sample_cached", cacheKey: "cache_bad" } : null),
      loadItem: async () => ({ ...createArtifact(), sampleVideoId: "sample_cached", shotBoundaryAnalysis: createCachedShotAnalysis() }),
    },
  });

  await harness.service.enqueue({ sampleVideoId: "sample_1", analysisFps: 1, cacheDecision: "ask" });
  await delay(20);
  await harness.service.enqueue({ sampleVideoId: "sample_1", analysisFps: 2, cacheDecision: "ask" });
  await delay(20);
  const cacheLogs = harness.logger.logs.filter((entry) => entry.stageName === STAGES.cacheLookup && entry.event === "stage.end");

  assert.equal(cacheLogs.some((entry) => entry.outputSummary?.reason === "eligibility_rejected"), true);
  assert.equal(cacheLogs.some((entry) => entry.outputSummary?.reason === "key_miss"), true);
});
