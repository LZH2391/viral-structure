const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const PYTHON = process.env.PYTHON || "python";
const SCRIPTS_DIR = path.join(REPO_ROOT, ".agents", "skills", "function-slot-restructure", "scripts");

test("slot restructure scripts resolve repo roots to the local FunctionSlotLibrary corpus", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bd-slot-restructure-"));
  const sampleDir = path.join(tempRoot, "Artifacts", "FunctionSlotLibrary", "artifact_local");
  await writeSampleLibrary(sampleDir);

  const validation = runPython(["validate_corpus.py", tempRoot], { cwd: tempRoot });
  assert.equal(validation.status, 0, validation.stderr || validation.stdout);
  assert.match(validation.stdout, /Runtime\/Temp\/FunctionSlotLibrary\/validation\.json/);

  const indexRun = runPython(["build_slot_index.py", tempRoot], { cwd: tempRoot });
  assert.equal(indexRun.status, 0, indexRun.stderr || indexRun.stdout);
  assert.match(indexRun.stdout, /Runtime\/Temp\/FunctionSlotLibrary\/slot_index\.json/);

  const validationReport = await readJson(path.join(tempRoot, "Runtime", "Temp", "FunctionSlotLibrary", "validation.json"));
  const index = await readJson(path.join(tempRoot, "Runtime", "Temp", "FunctionSlotLibrary", "slot_index.json"));

  assert.equal(validationReport.corpusRoot, "Artifacts/FunctionSlotLibrary");
  assert.equal(validationReport.sampleCount, 1);
  assert.equal(validationReport.sampleResults[0].artifactId, "artifact_local");
  assert.equal(validationReport.sampleResults[0].lineage.traceId, "trace_local");
  assert.equal(index.sourceRoot, "Artifacts/FunctionSlotLibrary");
  assert.equal(index.summary.sampleCount, 1);
  assert.equal(index.samples[0].lineage.parentArtifactId, "artifact_parent");
  assert.equal(index.samples[0].lineage.contentHash, "hash_local");
  assert.equal(index.slotVariants[0].artifactId, "artifact_local");
});

test("slot restructure corpus discovery skips bundled seed samples unless explicitly requested", async () => {
  const skillRoot = path.join(REPO_ROOT, ".agents", "skills", "function-slot-restructure");
  const seedRoot = path.join(skillRoot, "references", "sample-libraries");

  const skillRootRun = runPython(["validate_corpus.py", skillRoot, "--out", path.join(os.tmpdir(), `bd-skill-root-${Date.now()}.json`)]);
  assert.notEqual(skillRootRun.status, 0);

  const seedRun = runPython(["validate_corpus.py", seedRoot]);
  assert.equal(seedRun.status, 0, seedRun.stderr || seedRun.stdout);
  assert.match(seedRun.stdout, /"sampleCount": 1/);
});

async function writeSampleLibrary(sampleDir) {
  await fs.mkdir(sampleDir, { recursive: true });
  await writeJson(path.join(sampleDir, "manifest.json"), {
    schemaVersion: "function_slot_library.v1",
    artifactId: "artifact_local",
    sampleVideoId: "sample_local",
    traceId: "trace_local",
    parentArtifactId: "artifact_parent",
    sourceScriptSegmentArtifactId: "artifact_script",
    sourceRhythmStructureArtifactId: "artifact_rhythm",
    sourcePackagingStructureArtifactId: "artifact_packaging",
    sourceShotBoundaryArtifactId: "artifact_shot",
    status: "processed",
    createdAt: "2026-05-27T00:00:00.000Z",
    exportedAt: "2026-05-27T00:00:01.000Z",
    contentHash: "hash_local",
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
  await writeJson(path.join(sampleDir, "slots.json"), [{
    slotId: "F001",
    slotOrder: 1,
    slotName: "痛点激活槽",
    slotType: "problem_activation",
    viewerStateBefore: "before",
    viewerStateAfter: "after",
    persuasionTask: "task",
    scriptAtomIds: ["S001"],
    rhythmAtomIds: ["R001"],
    packagingAtomIds: ["P001"],
    confidence: 0.9,
    needReview: false,
  }]);
  await writeJson(path.join(sampleDir, "atoms.script.json"), [{
    id: "S001",
    slot: "problem_activation",
    label: "script",
    function: "script function",
    claimType: "problem_to_action",
    proofNeed: "visual proof",
    confidence: 0.9,
    needReview: false,
  }]);
  await writeJson(path.join(sampleDir, "atoms.rhythm.json"), [{
    id: "R001",
    slot: "problem_activation",
    label: "rhythm",
    function: "rhythm function",
    pace: "fast",
    densityType: "dense",
    confidence: 0.9,
    needReview: false,
  }]);
  await writeJson(path.join(sampleDir, "atoms.packaging.json"), [{
    id: "P001",
    slot: "problem_activation",
    label: "packaging",
    packagingFunction: "object focus",
    visualHierarchy: "problem first",
    confidence: 0.9,
    needReview: false,
  }]);
  await writeJson(path.join(sampleDir, "bindings.json"), [{
    id: "B001",
    type: "sync",
    slotIds: ["F001"],
    atomIds: ["S001", "R001", "P001"],
    rule: "sync objects",
  }]);
  await writeJson(path.join(sampleDir, "rules.json"), {
    conflictChecks: [],
    recombinationRules: [{ id: "RULE001", appliesTo: ["problem_activation"], reason: "keep proof" }],
  });
  await writeJson(path.join(sampleDir, "templates.json"), [{
    templateId: "T001",
    templateName: "single",
    sequence: ["problem_activation"],
  }]);
}

function runPython(args, { cwd = REPO_ROOT } = {}) {
  const [script, ...rest] = args;
  return spawnSync(PYTHON, [path.join(SCRIPTS_DIR, script), ...rest], {
    cwd,
    encoding: "utf8",
  });
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}
