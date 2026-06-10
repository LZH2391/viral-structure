const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const {
  buildStoryboardResultProjection,
  resolveStoryboardImagePath,
} = require("../../Apps/Api/lib/agent-chat/storyboard-result-projection");
const { createShotStoryboardRepairRunner } = require("../../Apps/Api/lib/agent-chat/shot-storyboard-repair");

test("storyboard projection prefers current artifact run dir over legacy fixed outputs", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "storyboard-projection-run-dir-"));
  try {
    const planDir = path.join(rootDir, "Artifacts", "FunctionSlotRestructure", "case");
    const legacyFramesDir = path.join(planDir, "shot-storyboard-frames");
    const runDir = path.join(planDir, "storyboard-runs", "artifact_current");
    const runFramesDir = path.join(runDir, "shot-storyboard-frames");
    await fs.mkdir(legacyFramesDir, { recursive: true });
    await fs.mkdir(runFramesDir, { recursive: true });
    await fs.writeFile(path.join(planDir, "shot-design.final.md"), "# shot design\n", "utf8");
    await writeJson(path.join(planDir, "restructure.display.json"), slotDisplay("SUB_current", "当前槽位标题"));
    await writeStoryboardFiles({
      baseDir: planDir,
      framesDir: legacyFramesDir,
      shotId: "old_shot",
      slotKey: "SUB_old",
      imageBytes: "old",
      artifactId: "artifact_old_image",
    });
    await writeStoryboardFiles({
      baseDir: runDir,
      framesDir: runFramesDir,
      shotId: "current_shot",
      slotKey: "SUB_current",
      imageBytes: "current",
      artifactId: "artifact_current_image",
    });

    const conversation = conversationFor(planDir, {
      artifactId: "artifact_current",
      rootDir,
    });
    const projection = await buildStoryboardResultProjection({
      rootDir,
      conversation,
      imageBasePath: "/storyboard",
    });
    assert.equal(projection.status, "available");
    assert.equal(projection.source.manifestPath, "Artifacts/FunctionSlotRestructure/case/storyboard-runs/artifact_current/shot-storyboard-manifest.json");
    assert.equal(projection.groups.length, 1);
    assert.equal(projection.groups[0].title, "当前槽位标题");
    assert.equal(projection.groups[0].shots[0].id, "current_shot");

    const imagePath = await resolveStoryboardImagePath({
      rootDir,
      conversation,
      shotId: "current_shot",
    });
    assert.equal(await fs.readFile(imagePath, "utf8"), "current");
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test("storyboard projection does not fall back to previous fixed outputs while current run is processing", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "storyboard-projection-processing-"));
  try {
    const planDir = path.join(rootDir, "Artifacts", "FunctionSlotRestructure", "case");
    const legacyFramesDir = path.join(planDir, "shot-storyboard-frames");
    const currentRunDir = path.join(planDir, "storyboard-runs", "artifact_processing");
    await fs.mkdir(currentRunDir, { recursive: true });
    await fs.mkdir(legacyFramesDir, { recursive: true });
    await fs.writeFile(path.join(planDir, "shot-design.final.md"), "# shot design\n", "utf8");
    await writeStoryboardFiles({
      baseDir: planDir,
      framesDir: legacyFramesDir,
      shotId: "old_shot",
      slotKey: "SUB_old",
      imageBytes: "old",
      artifactId: "artifact_old_image",
    });

    const projection = await buildStoryboardResultProjection({
      rootDir,
      conversation: conversationFor(planDir, { artifactId: "artifact_processing", rootDir }),
      imageBasePath: "/storyboard",
    });
    assert.equal(projection.status, "missing");
    assert.equal(projection.reason, "storyboard_manifest_missing");
    assert.deepEqual(projection.groups, []);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test("storyboard projection keeps legacy fixed-path fallback for old results", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "storyboard-projection-legacy-"));
  try {
    const planDir = path.join(rootDir, "Artifacts", "FunctionSlotRestructure", "legacy");
    const framesDir = path.join(planDir, "shot-storyboard-frames");
    await fs.mkdir(framesDir, { recursive: true });
    await fs.writeFile(path.join(planDir, "shot-design.final.md"), "# shot design\n", "utf8");
    await writeStoryboardFiles({
      baseDir: planDir,
      framesDir,
      shotId: "legacy_shot",
      slotKey: "SUB_legacy",
      imageBytes: "legacy",
      artifactId: "artifact_legacy_image",
    });

    const projection = await buildStoryboardResultProjection({
      rootDir,
      conversation: conversationFor(planDir, { artifactId: "artifact_legacy", rootDir }),
      imageBasePath: "/storyboard",
    });
    assert.equal(projection.status, "available");
    assert.equal(projection.source.manifestPath, "Artifacts/FunctionSlotRestructure/legacy/shot-storyboard-manifest.json");
    assert.equal(projection.groups[0].shots[0].id, "legacy_shot");
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test("storyboard projection can resolve current output directory from runtime artifact files", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "storyboard-projection-runtime-artifact-"));
  try {
    const planDir = path.join(rootDir, "Artifacts", "FunctionSlotRestructure", "runtime");
    const runDir = path.join(planDir, "storyboard-runs", "artifact_runtime");
    const framesDir = path.join(runDir, "shot-storyboard-frames");
    const runtimeArtifactDir = path.join(rootDir, "Runtime", "Artifacts", "sample_runtime", "shot-storyboard-prep", "artifact_runtime");
    await fs.mkdir(framesDir, { recursive: true });
    await fs.mkdir(runtimeArtifactDir, { recursive: true });
    await fs.writeFile(path.join(planDir, "shot-design.final.md"), "# shot design\n", "utf8");
    await writeStoryboardFiles({
      baseDir: runDir,
      framesDir,
      shotId: "runtime_shot",
      slotKey: "SUB_runtime",
      imageBytes: "runtime",
      artifactId: "artifact_runtime_image",
    });
    await writeJson(path.join(runtimeArtifactDir, "artifact.json"), {
      artifactId: "artifact_runtime",
      artifactType: "shot-storyboard-prep",
      files: {
        manifestPath: "Artifacts/FunctionSlotRestructure/runtime/storyboard-runs/artifact_runtime/shot-storyboard-manifest.json",
        cropsManifestPath: "Artifacts/FunctionSlotRestructure/runtime/storyboard-runs/artifact_runtime/shot-storyboard-frames/shot-storyboard-crops.json",
      },
    });

    const projection = await buildStoryboardResultProjection({
      rootDir,
      conversation: conversationFor(planDir, { artifactId: "artifact_runtime", rootDir }),
      imageBasePath: "/storyboard",
    });
    assert.equal(projection.status, "available");
    assert.equal(projection.groups[0].shots[0].id, "runtime_shot");
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test("shot storyboard repair resolves paths with the current artifact id", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "storyboard-repair-artifact-dir-"));
  try {
    const baseDir = path.join(rootDir, "Artifacts", "FunctionSlotRestructure", "case", "storyboard-runs", "artifact_repair");
    await fs.mkdir(baseDir, { recursive: true });
    let capturedArtifactId = null;
    const runner = createShotStoryboardRepairRunner({
      rootDir,
      safeRelative: (filePath) => path.relative(rootDir, filePath).replaceAll(path.sep, "/"),
      resolveInputs: async (_options, _shotDesignPathOverride, artifactId) => {
        capturedArtifactId = artifactId;
        return {
          baseDir,
          restructureFinalPath: path.join(rootDir, "Artifacts", "FunctionSlotRestructure", "case", "restructure.final.md"),
          shotDesignFinalPath: path.join(rootDir, "Artifacts", "FunctionSlotRestructure", "case", "shot-design.final.md"),
        };
      },
      threadPool: {
        ensureRoleReady: async () => ({ ok: true, status: { skillPath: "C:/ByteDanceFullStack/.agents/skills/shot-storyboard-prep/SKILL.md" } }),
        acquireLease: async () => ({ thread_id: "thread_repair", lease_id: "lease_repair" }),
        releaseLease: async () => undefined,
      },
      appServer: {
        runTurnWithInputs: async () => {
          await fs.writeFile(path.join(baseDir, "shot-design.final.repair-attempt-1.md"), "# repaired\n", "utf8");
        },
      },
    });

    const result = await runner.runRepairTurn({
      options: {},
      error: Object.assign(new Error("prepare failed"), { code: "storyboard_prep_prepare_output_invalid", retryable: true }),
      repairAttemptCount: 1,
      artifactId: "artifact_repair",
      parentArtifactId: "artifact_parent",
    });
    assert.equal(capturedArtifactId, "artifact_repair");
    assert.equal(result.repairedPath, path.join(baseDir, "shot-design.final.repair-attempt-1.md"));
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

function conversationFor(planDir, { artifactId, rootDir }) {
  return {
    conversationId: "conversation_storyboard",
    title: "故事板会话",
    confirmedPlan: {
      status: "storyboard_processing",
      sourceShotDesignPath: path.relative(rootDir, path.join(planDir, "shot-design.final.md")).replaceAll(path.sep, "/"),
      storyboardArtifact: {
        artifactId,
        status: "processing",
      },
    },
  };
}

async function writeStoryboardFiles({ baseDir, framesDir, shotId, slotKey, imageBytes, artifactId }) {
  await writeJson(path.join(baseDir, "shot-storyboard-manifest.json"), {
    aspect: { ratio: "9:16", orientation: "竖屏" },
    shots: [{
      shotId,
      slotKey,
      slotSubtype: `\`${slotKey}\``,
      shouldGenerate: true,
      dialogue: `${shotId} dialogue`,
      duration: "1.0s",
    }],
  });
  const imagePath = path.join(framesDir, `${shotId}.png`);
  await fs.writeFile(imagePath, Buffer.from(imageBytes));
  await writeJson(path.join(framesDir, "shot-storyboard-crops.json"), {
    source: {
      artifactId,
      traceId: `trace_${artifactId}`,
    },
    crops: [{
      shotId,
      cropBox: [0, 0, 900, 1600],
      path: imagePath,
    }],
  });
}

function slotDisplay(slotSubtype, title) {
  return {
    sections: {
      finalSlotChain: {
        items: [{
          type: "table",
          rows: [{
            "顺序": "1",
            slotSubtype: `\`${slotSubtype}\` ${title}`,
          }],
        }],
      },
    },
  };
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
