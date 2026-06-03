const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const sharp = require("sharp");
const {
  PDF_STAGE_NAME,
  buildPdfAgentInputPackage,
  runShotStoryboardPdfTurn,
  validatePdfAgentOutputs,
} = require("../../Apps/Api/lib/agent-chat/shot-storyboard-pdf-agent");

test("pdf agent input package includes manifest crops material frames reference svg and output contract", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "bd-shot-storyboard-pdf-input-"));
  try {
    const baseDir = path.join(rootDir, "Artifacts", "storyboard");
    await fs.mkdir(path.join(rootDir, "Runtime", "Temp"), { recursive: true });
    await fs.mkdir(baseDir, { recursive: true });
    const restructureFinalPath = path.join(baseDir, "restructure.final.md");
    const shotDesignFinalPath = path.join(baseDir, "shot-design.final.md");
    const manifestPath = path.join(baseDir, "shot-storyboard-manifest.json");
    const cropsManifestPath = path.join(baseDir, "shot-storyboard-frames", "shot-storyboard-crops.json");
    const referenceSvgPath = path.join(rootDir, "Runtime", "Temp", "pdf.svg");
    const generatedImagePath = path.join(baseDir, "shot-storyboard-frames", "generated_shot.png");
    const materialImagePath = path.join(baseDir, "material-frame.png");
    const materialMapPath = path.join(baseDir, "material-frame-map.json");

    await fs.mkdir(path.dirname(cropsManifestPath), { recursive: true });
    await fs.writeFile(restructureFinalPath, "# restructure\n", "utf8");
    await fs.writeFile(shotDesignFinalPath, "# shot design\n", "utf8");
    await fs.writeFile(referenceSvgPath, "<svg></svg>\n", "utf8");
    await writeSolidImage(generatedImagePath, 447, 797, "#336699");
    await writeSolidImage(materialImagePath, 240, 180, "#cc8844");
    await writeJson(manifestPath, {
      schemaVersion: "shot-storyboard-prep.manifest.v1",
      shots: [
        { shotId: "new_shot_01", slotKey: "HOOK", slotSubtype: "HOOK", shouldGenerate: true },
        { shotId: "new_shot_02", slotKey: "HOOK", slotSubtype: "HOOK", shouldGenerate: false, sourceRefs: ["shot_1"] },
      ],
      storyboardGroups: [],
      warnings: [],
    });
    await writeJson(cropsManifestPath, {
      schemaVersion: "shot-storyboard-crops.v1",
      crops: [{ shotId: "new_shot_01", path: generatedImagePath }],
      warnings: [],
    });
    await writeJson(materialMapPath, {
      shotRef: "shot_1",
      localImagePath: materialImagePath,
    });

    const prepared = await buildPdfAgentInputPackage({
      rootDir,
      resolved: { baseDir, restructureFinalPath, shotDesignFinalPath },
      prepare: {
        manifestPath,
        manifest: await readJson(manifestPath),
      },
      crop: { cropsManifestPath },
      options: {},
      traceContext: { runId: "run_1", traceId: "trace_1", stageId: "stage_1" },
      artifactId: "artifact_1",
      parentArtifactId: "artifact_parent",
      materialFrameMaps: [{ path: materialMapPath, required: true }],
      resolveInsideRoot: (value) => path.resolve(rootDir, value),
      safeRelative: (filePath) => path.relative(rootDir, filePath).replaceAll(path.sep, "/"),
      now: () => "2026-06-03T00:00:00.000Z",
    });

    assert.equal(prepared.inputPackage.schemaVersion, "shot-storyboard-pdf-input.v1");
    assert.equal(prepared.inputPackage.source.referenceSvgPath, "Runtime/Temp/pdf.svg");
    assert.equal(prepared.inputPackage.outputContract.layoutPath, "Artifacts/storyboard/shot-storyboard.layout.json");
    assert.equal(prepared.inputPackage.shots.length, 2);
    assert.equal(prepared.inputPackage.shots[0].mediaKind, "generated-image");
    assert.equal(prepared.inputPackage.shots[0].width, 447);
    assert.equal(prepared.inputPackage.shots[1].mediaKind, "material-frame");
    assert.equal(prepared.inputPackage.shots[1].height, 180);
    assert.equal(prepared.inputPackage.expectedWarnings.materialFrameMissingShotIds.length, 0);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test("pdf agent output validation enforces contain and missing material warnings", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "bd-shot-storyboard-pdf-validate-"));
  try {
    const pdfPath = path.join(rootDir, "shot-storyboard.pdf");
    const summaryPath = path.join(rootDir, "shot-storyboard.summary.json");
    const layoutPath = path.join(rootDir, "shot-storyboard.layout.json");
    const manifest = {
      shots: [
        { shotId: "new_shot_01", slotKey: "HOOK" },
        { shotId: "new_shot_02", slotKey: "HOOK" },
      ],
    };
    await fs.writeFile(pdfPath, "%PDF-1.4\n", "utf8");
    await writeJson(summaryPath, {
      schemaVersion: "shot-storyboard-pdf.v1",
      slotCount: 1,
      shotCount: 2,
      warnings: ["new_shot_02: 素材镜头缺少代表帧"],
    });
    await writeJson(layoutPath, {
      schemaVersion: "shot-storyboard-layout.v1",
      pageCount: 1,
      slots: [{ slotKey: "HOOK", pageIndexes: [0] }],
      shots: [
        { shotId: "new_shot_01", pageIndex: 0, mediaKind: "generated-image", imageFit: "contain" },
        { shotId: "new_shot_02", pageIndex: 0, mediaKind: "material-frame", imageFit: "contain" },
      ],
      warnings: [],
    });

    const valid = await validatePdfAgentOutputs({
      manifest,
      pdfPath,
      summaryPath,
      layoutPath,
      expectedWarnings: { materialFrameMissingShotIds: ["new_shot_02"] },
    });
    assert.equal(valid.summary.shotCount, 2);

    await writeJson(layoutPath, {
      schemaVersion: "shot-storyboard-layout.v1",
      pageCount: 1,
      slots: [{ slotKey: "HOOK", pageIndexes: [0] }],
      shots: [
        { shotId: "new_shot_01", pageIndex: 0, mediaKind: "generated-image", imageFit: "cover" },
        { shotId: "new_shot_02", pageIndex: 0, mediaKind: "material-frame", imageFit: "contain" },
      ],
      warnings: [],
    });
    await assert.rejects(
      () => validatePdfAgentOutputs({
        manifest,
        pdfPath,
        summaryPath,
        layoutPath,
        expectedWarnings: { materialFrameMissingShotIds: ["new_shot_02"] },
      }),
      /contain/,
    );

    await writeJson(layoutPath, {
      schemaVersion: "shot-storyboard-layout.v1",
      pageCount: 1,
      slots: [{ slotKey: "HOOK", pageIndexes: [0] }],
      shots: [
        { shotId: "new_shot_01", pageIndex: 0, mediaKind: "generated-image", imageFit: "contain" },
        { shotId: "new_shot_02", pageIndex: 0, mediaKind: "material-frame", imageFit: "contain" },
      ],
      warnings: [],
    });
    await writeJson(summaryPath, {
      schemaVersion: "shot-storyboard-pdf.v1",
      slotCount: 1,
      shotCount: 2,
      warnings: [],
    });
    await assert.rejects(
      () => validatePdfAgentOutputs({
        manifest,
        pdfPath,
        summaryPath,
        layoutPath,
        expectedWarnings: { materialFrameMissingShotIds: ["new_shot_02"] },
      }),
      /warnings/,
    );
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test("pdf turn prefers activeTurnRuntime and records job agentRun lifecycle", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "bd-shot-storyboard-pdf-turn-"));
  const jobUpdates = [];
  try {
    const inputPackagePath = path.join(rootDir, "shot-storyboard-pdf-input.json");
    await fs.writeFile(inputPackagePath, "{}\n", "utf8");
    const result = await runShotStoryboardPdfTurn({
      rootDir,
      threadPool: {
        ensureRoleReady: async () => ({ ok: true, status: { skillPath: "C:/ByteDanceFullStack/.agents/skills/shot-storyboard-prep/SKILL.md" } }),
        acquireLease: async () => ({ lease_id: "lease_1", thread_id: "thread_1" }),
        releaseLease: async () => ({ ok: true }),
      },
      appServer: {
        runTurnWithInputs: async () => {
          throw new Error("fallback should not run");
        },
      },
      activeTurnRuntime: {
        start: async (payload) => {
          assert.equal(payload.binding.stageName, PDF_STAGE_NAME);
          return { turnId: "turn_1", threadId: "thread_1", status: "submitted" };
        },
        collect: async () => ({
          turnId: "turn_1",
          threadId: "thread_1",
          status: "completed",
          finalMessage: "已写出",
        }),
      },
      jobStore: {
        updateJob: (_jobId, patch) => {
          jobUpdates.push(patch);
        },
      },
      jobId: "job_1",
      traceContext: { runId: "run_1", traceId: "trace_1", stageId: "stage_1" },
      artifactId: "artifact_1",
      parentArtifactId: "artifact_parent",
      inputPackagePath,
      pdfPath: path.join(rootDir, "shot-storyboard.pdf"),
      summaryPath: path.join(rootDir, "shot-storyboard.summary.json"),
      layoutPath: path.join(rootDir, "shot-storyboard.layout.json"),
      safeRelative: (filePath) => path.relative(rootDir, filePath).replaceAll(path.sep, "/"),
    });

    assert.equal(result.agent.turnId, "turn_1");
    assert.equal(result.agent.leaseId, "lease_1");
    assert.equal(jobUpdates[0].agentRun.status, "turn_submitted");
    assert.equal(jobUpdates[1].agentRun.status, "collecting");
    assert.equal(jobUpdates.at(-1).agentRun.status, "completed");
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test("pdf turn keeps collecting when active turn is still in progress", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "bd-shot-storyboard-pdf-turn-running-"));
  const collectStatuses = [];
  try {
    const inputPackagePath = path.join(rootDir, "shot-storyboard-pdf-input.json");
    await fs.writeFile(inputPackagePath, "{}\n", "utf8");
    let collectCount = 0;
    const result = await runShotStoryboardPdfTurn({
      rootDir,
      threadPool: {
        ensureRoleReady: async () => ({ ok: true, status: { skillPath: "C:/ByteDanceFullStack/.agents/skills/shot-storyboard-prep/SKILL.md" } }),
        acquireLease: async () => ({ lease_id: "lease_1", thread_id: "thread_1" }),
        releaseLease: async () => ({ ok: true }),
      },
      appServer: {
        runTurnWithInputs: async () => {
          throw new Error("fallback should not run");
        },
      },
      activeTurnRuntime: {
        start: async () => ({ turnId: "turn_1", threadId: "thread_1", status: "submitted" }),
        collect: async () => {
          collectCount += 1;
          const status = collectCount === 1 ? "inProgress" : "completed";
          collectStatuses.push(status);
          return {
            turnId: "turn_1",
            threadId: "thread_1",
            status,
            finalMessage: status === "completed" ? "已写出" : null,
          };
        },
      },
      jobStore: { updateJob: () => undefined },
      jobId: "job_1",
      traceContext: { runId: "run_1", traceId: "trace_1", stageId: "stage_1" },
      artifactId: "artifact_1",
      parentArtifactId: "artifact_parent",
      inputPackagePath,
      pdfPath: path.join(rootDir, "shot-storyboard.pdf"),
      summaryPath: path.join(rootDir, "shot-storyboard.summary.json"),
      layoutPath: path.join(rootDir, "shot-storyboard.layout.json"),
      safeRelative: (filePath) => path.relative(rootDir, filePath).replaceAll(path.sep, "/"),
    });

    assert.deepEqual(collectStatuses, ["inProgress", "completed"]);
    assert.equal(result.agent.turnId, "turn_1");
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

async function writeSolidImage(filePath, width, height, color) {
  await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: color,
    },
  }).png().toFile(filePath);
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}
