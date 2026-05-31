const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { createLocalStore } = require("../../Infrastructure/Storage/local-store");
const { createStageLogger } = require("../../Infrastructure/Observability/stage-logger");
const { createJobStore } = require("../../Apps/Api/lib/stores/job-store");
const { createFunctionSlotGovernanceService } = require("../../Apps/Api/lib/function-slot-library/governance-service");

test("function slot governance service runs evidence refresh, agent turn, validation, and materialize", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bd-function-slot-governance-"));
  await writeSampleLibrary(root);
  const store = createLocalStore(root);
  const logger = createStageLogger(store);
  const jobStore = createJobStore({ filePath: path.join(store.runtimeRoot, "Jobs", "active-jobs.json") });
  const service = createFunctionSlotGovernanceService({
    rootDir: root,
    store,
    logger,
    jobStore,
    threadPool: createFakeThreadPool(),
    appServer: createFakeAppServer(root),
    pollIntervalMs: 1,
    collectIdleTimeoutMs: 5000,
    collectHardTimeoutMs: 5000,
  });

  const started = await service.enqueue();
  const job = await waitForJob(jobStore, started.processingJobId);
  const governance = JSON.parse(await fs.readFile(path.join(root, "Artifacts", "FunctionSlotLibrary", "_governance", "semantic-governance.v1.json"), "utf8"));
  const logText = await fs.readFile(path.join(root, "Runtime", "DebugSnapshots", `${started.traceId}.log.jsonl`), "utf8");

  assert.equal(job.status, "processed");
  assert.equal(job.governance.validationOk, true);
  assert.equal(job.agentRun.role, "function-slot-library-builder");
  assert.equal(job.agentTraceCards[0].turnId, "turn_semantic_governance");
  assert.equal(governance.coverage.sampleCount, 1);
  assert.equal(governance.unmappedAtomVariants.length, 3);
  assert.equal(governance.unmappedBindingVariants.length, 1);
  assert.equal(governance.unmappedRuleVariants.length, 1);
  assert.match(logText, /function_slot_library\.semantic_governance\.evidence_refresh/);
  assert.match(logText, /function_slot_library\.semantic_governance\.materialize/);
});

test("function slot governance service restores previous governance when validation fails", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bd-function-slot-governance-fail-"));
  await writeSampleLibrary(root);
  const store = createLocalStore(root);
  const logger = createStageLogger(store);
  const jobStore = createJobStore({ filePath: path.join(store.runtimeRoot, "Jobs", "active-jobs.json") });
  const service = createFunctionSlotGovernanceService({
    rootDir: root,
    store,
    logger,
    jobStore,
    threadPool: createFakeThreadPool(),
    appServer: createInvalidAppServer(root),
    pollIntervalMs: 1,
    collectIdleTimeoutMs: 5000,
    collectHardTimeoutMs: 5000,
    maxRepairAttempts: 0,
  });

  const started = await service.enqueue();
  const job = await waitForJob(jobStore, started.processingJobId);
  const governance = JSON.parse(await fs.readFile(path.join(root, "Artifacts", "FunctionSlotLibrary", "_governance", "semantic-governance.v1.json"), "utf8"));
  const logText = await fs.readFile(path.join(root, "Runtime", "DebugSnapshots", `${started.traceId}.log.jsonl`), "utf8");

  assert.equal(job.status, "failed");
  assert.equal(job.errorSummary.code, "function_slot_governance_validation_failed");
  assert.equal(governance.schemaVersion, "function_slot_semantic_governance.v1");
  assert.notEqual(governance.governanceId, "invalid_candidate_should_rollback");
  assert.match(job.errorSummary.debugSnapshotUri, /DebugSnapshots/);
  assert.equal(job.errorSummary.stageName, "function_slot_library.semantic_governance.validate");
  assert.match(logText, /function_slot_library\.semantic_governance\.validate/);
  assert.match(logText, /"e":"f"/);
});

function createFakeThreadPool() {
  return {
    async ensureRoleReady() {
      return { ok: true, status: { role: "function-slot-library-builder", ready: true } };
    },
    async acquireLease() {
      return { lease_id: "lease_governance", thread_id: "thread_governance" };
    },
    async releaseLease() {
      return { ok: true };
    },
  };
}

function createFakeAppServer(root) {
  return {
    async startTurnWithInputs() {
      return { turnId: "turn_semantic_governance" };
    },
    async collectTurnResult() {
      return {
        status: "completed",
        threadId: "thread_governance",
        turnId: "turn_semantic_governance",
        finalMessage: JSON.stringify(await buildValidGovernance(root)),
        turnActivity: {
          threadId: "thread_governance",
          turnId: "turn_semantic_governance",
          status: "completed",
          itemCount: 1,
          effectiveItemCount: 1,
          latestItemType: "agent_message",
          latestMessagePreview: "治理完成",
          latestToolName: null,
          tokenUsage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
          updatedAt: new Date().toISOString(),
        },
      };
    },
  };
}

function createInvalidAppServer(root) {
  return {
    async startTurnWithInputs() {
      return { turnId: "turn_invalid_semantic_governance" };
    },
    async collectTurnResult() {
      const governance = await buildValidGovernance(root);
      governance.governanceId = "invalid_candidate_should_rollback";
      governance.unmappedAtomVariants = [];
      governance.unmappedBindingVariants = [];
      governance.unmappedRuleVariants = [];
      return {
        status: "completed",
        threadId: "thread_governance",
        turnId: "turn_invalid_semantic_governance",
        finalMessage: JSON.stringify(governance),
        turnActivity: {
          threadId: "thread_governance",
          turnId: "turn_invalid_semantic_governance",
          status: "completed",
          itemCount: 1,
          effectiveItemCount: 1,
          latestItemType: "agent_message",
          latestMessagePreview: "治理失败候选",
          latestToolName: null,
          tokenUsage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
          updatedAt: new Date().toISOString(),
        },
      };
    },
  };
}

async function buildValidGovernance(root) {
  const governancePath = path.join(root, "Artifacts", "FunctionSlotLibrary", "_governance", "semantic-governance.v1.json");
  const indexPath = path.join(root, "Runtime", "Temp", "FunctionSlotLibrary", "slot_index.json");
  const governance = JSON.parse(await fs.readFile(governancePath, "utf8"));
  const index = JSON.parse(await fs.readFile(indexPath, "utf8"));
  governance.unmappedAtomVariants = index.atomVariants.map((item) => unmapped(item.variantId, "test_pending_atom_governance"));
  governance.unmappedBindingVariants = index.bindings.map((item) => unmapped(item.variantId, "test_pending_binding_governance"));
  governance.unmappedRuleVariants = index.rules.map((item) => unmapped(item.variantId, "test_pending_rule_governance"));
  return governance;
}

function unmapped(variantId, reason) {
  return {
    variantId,
    reason,
    suggestedAction: "keep_as_unmapped_until_real_agent_semantic_governance_reviews_this_variant",
  };
}

async function writeSampleLibrary(root) {
  const dir = path.join(root, "Artifacts", "FunctionSlotLibrary", "artifact_test_governance");
  await fs.mkdir(dir, { recursive: true });
  await writeJson(path.join(dir, "manifest.json"), {
    schemaVersion: "function_slot_library.v1",
    artifactId: "artifact_test_governance",
    sampleVideoId: "sample_test_governance",
    traceId: "trace_test_governance",
    status: "processed",
    counts: {
      slotCount: 1,
      scriptAtomCount: 1,
      rhythmAtomCount: 1,
      packagingAtomCount: 1,
      atomCount: 3,
      bindingCount: 1,
      ruleCount: 1,
      templateCount: 1,
    },
    files: {
      manifest: "manifest.json",
      slots: "slots.json",
      scriptAtoms: "atoms.script.json",
      rhythmAtoms: "atoms.rhythm.json",
      packagingAtoms: "atoms.packaging.json",
      bindings: "bindings.json",
      rules: "rules.json",
      templates: "templates.json",
    },
  });
  await writeJson(path.join(dir, "slots.json"), [{
    slotId: "F001",
    slotType: "problem_activation",
    slotName: "问题激活",
    slotOrder: 1,
    viewerStateBefore: "未意识到问题",
    viewerStateAfter: "接受问题",
    persuasionTask: "建立观看理由",
    scriptAtomIds: ["S001"],
    rhythmAtomIds: ["R001"],
    packagingAtomIds: ["P001"],
  }]);
  await writeJson(path.join(dir, "atoms.script.json"), [{ id: "S001", slot: "problem_activation", label: "问题提出", function: "建立问题" }]);
  await writeJson(path.join(dir, "atoms.rhythm.json"), [{ id: "R001", slot: "problem_activation", label: "开场停顿", function: "聚焦注意" }]);
  await writeJson(path.join(dir, "atoms.packaging.json"), [{ id: "P001", slot: "problem_activation", label: "问题字幕", packagingFunction: "定位问题" }]);
  await writeJson(path.join(dir, "bindings.json"), [{ id: "B001", type: "require", slotIds: ["F001"], atomIds: ["S001", "R001"], rule: "问题提出需要节奏停顿" }]);
  await writeJson(path.join(dir, "rules.json"), { conflictChecks: [{ id: "C001", reason: "不能只讲抽象问题" }], recombinationRules: [] });
  await writeJson(path.join(dir, "templates.json"), [{ templateId: "T001", name: "问题激活模板", sequence: ["problem_activation"] }]);
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function waitForJob(jobStore, jobId) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const job = jobStore.getJob(jobId);
    if (job?.status === "processed" || job?.status === "failed") return job;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("governance job did not finish");
}
