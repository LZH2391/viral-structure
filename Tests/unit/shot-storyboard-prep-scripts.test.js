const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const PYTHON = process.env.PYTHON || "python";
const SCRIPTS_DIR = path.join(REPO_ROOT, ".agents", "skills", "shot-storyboard-prep", "scripts");

test("shot storyboard prep routes only self-designed shots into prompts and downstream PDF", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bd-shot-storyboard-prep-"));
  const restructurePath = path.join(root, "restructure.final.md");
  const shotDesignPath = path.join(root, "shot-design.final.md");
  const promptPath = path.join(root, "shot-storyboard-prompts.md");
  const manifestPath = path.join(root, "shot-storyboard-manifest.json");
  await fs.writeFile(restructurePath, "# restructure\n\n## 2. 槽位链\n", "utf8");
  await fs.writeFile(shotDesignPath, sampleShotDesign(), "utf8");

  const prepare = runPython(["prepare_storyboard.py", "--input", shotDesignPath, "--output", promptPath, "--manifest-output", manifestPath, "--no-write-back"]);
  assert.equal(prepare.status, 0, prepare.stderr || prepare.stdout);
  const prepareResult = JSON.parse(prepare.stdout);
  assert.equal(prepareResult.shotCount, 5);
  assert.equal(prepareResult.generatedShotCount, 3);
  assert.equal(prepareResult.materialShotCount, 2);
  assert.equal(prepareResult.groupCount, 1);

  const prompt = await fs.readFile(promptPath, "utf8");
  assert.match(prompt, /### new_shot_02/);
  assert.match(prompt, /### new_shot_03/);
  assert.match(prompt, /### new_shot_05/);
  assert.doesNotMatch(prompt, /### new_shot_01/);
  assert.doesNotMatch(prompt, /### new_shot_04/);
  assert.match(prompt, /### storyboard_blank_pad_04/);

  const manifest = await readJson(manifestPath);
  assert.equal(manifest.shots.find((shot) => shot.shotId === "new_shot_01").shouldGenerate, false);
  assert.equal(manifest.shots.find((shot) => shot.shotId === "new_shot_02").slotKey, "SUB_demo");
  assert.equal(manifest.storyboardGroups[0].shots.length, 4);
  assert.equal(manifest.storyboardGroups[0].shots[3].isPad, true);

  const artifactPath = await writeStoryboardArtifact(root);
  const cropsDir = path.join(root, "crops");
  const crop = runPython(["crop_storyboard_groups.py", "--artifact", artifactPath, "--manifest", manifestPath, "--output-dir", cropsDir, "--root", root]);
  assert.equal(crop.status, 0, crop.stderr || crop.stdout);
  const cropResult = JSON.parse(crop.stdout);
  assert.equal(cropResult.croppedCount, 3);
  assert.equal(cropResult.crops.some((item) => item.shotId === "storyboard_blank_pad_04"), false);
  assert.equal(cropResult.crops[0].cropBox.join(","), "0,0,447,797");

  const materialMapPath = path.join(root, "material-frame-map.json");
  await writeJson(materialMapPath, {
    shotCards: [
      { shotRef: "shot_1", representativeFrame: path.join(cropsDir, "new_shot_02.png") },
    ],
  });

  const pdfPath = path.join(root, "shot-storyboard.pdf");
  const pdf = runPython([
    "build_storyboard_pdf.py",
    "--restructure", restructurePath,
    "--shot-design", shotDesignPath,
    "--manifest", manifestPath,
    "--crops-manifest", path.join(cropsDir, "shot-storyboard-crops.json"),
    "--material-frame-map", materialMapPath,
    "--output", pdfPath,
    "--root", root,
  ]);
  assert.equal(pdf.status, 0, pdf.stderr || pdf.stdout);
  const pdfResult = JSON.parse(pdf.stdout);
  assert.equal(pdfResult.shotCount, 5);
  assert.equal(pdfResult.slotCount, 1);
  assert.equal(pdfResult.warnings.length, 0);
  assert.equal((await fs.stat(pdfPath)).size > 0, true);
});

function sampleShotDesign() {
  return `# Shot 设计方案

画幅：9:16 竖屏

## Shot 设计

| shot | slotSubtype 对齐 | 素材来源/处理策略 | 脚本段落 | 节奏区间 | 包装块 | 分镜画面 | 包装说明 | 台词/字幕（若有） | 预计时长 | 必须同步点 | 证明功能 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| new_shot_01 | \`SUB_demo\` hook | \`existing_material: shot_1\` | P1 | R1 | PK1 | 素材画面一 | 沿用素材 | 原字幕一 | 1.0s | 同步一 | 证明一 |
| new_shot_02 | \`SUB_demo\` fragment 1 | \`self_designed_by_shot_design: 自设计镜头\` | P1 | R1 | PK1 | 自设计画面二 | 包装二 | 字幕二 | 1.0s | 同步二 | 证明二 |
| new_shot_03 | \`SUB_demo\` fragment 2 | \`self_designed_by_shot_design: 自设计镜头\` | P1 | R1 | PK1 | 自设计画面三 | 包装三 | 字幕三 | 1.0s | 同步三 | 证明三 |
| new_shot_04 | \`SUB_demo\` payoff | \`existing_material_packaging_caption: shot_1\` | P1 | R1 | PK1 | 素材画面四 | 包装补强四 | 后期字幕四 | 1.0s | 同步四 | 证明四 |
| new_shot_05 | \`SUB_demo\` close | \`self_designed_by_shot_design: 自设计镜头\` | P1 | R1 | PK1 | 自设计画面五 | 包装五 | 字幕五 | 1.0s | 同步五 | 证明五 |
`;
}

async function writeStoryboardArtifact(root) {
  const artifactDir = path.join(root, "Runtime", "Artifacts", "sample_storyboard", "image-generation", "artifact_storyboard");
  await fs.mkdir(artifactDir, { recursive: true });
  const imagePath = path.join(artifactDir, "storyboard_storyboard-group-01.png");
  const imageScript = `
from PIL import Image, ImageDraw
im = Image.new("RGB", (900, 1600), "white")
d = ImageDraw.Draw(im)
for color, box in [
  ("red", (0, 0, 450, 800)),
  ("green", (450, 0, 900, 800)),
  ("blue", (0, 800, 450, 1600)),
  ("yellow", (450, 800, 900, 1600)),
]:
    d.rectangle(box, fill=color)
im.save(r"${imagePath.replace(/\\/g, "\\\\")}")
`;
  const imageRun = spawnSync(PYTHON, ["-c", imageScript], { cwd: REPO_ROOT, encoding: "utf8" });
  assert.equal(imageRun.status, 0, imageRun.stderr || imageRun.stdout);
  const artifactPath = path.join(artifactDir, "artifact.json");
  await writeJson(artifactPath, {
    artifactId: "artifact_storyboard",
    parentArtifactId: "artifact_parent",
    traceId: "trace_storyboard",
    aspect: { ratio: "9:16", orientation: "竖屏" },
    storyboardRun: { referenceImage: "storyboard-layout-9x16-4grid.png" },
    storyboardGroups: [{
      groupId: "storyboard-group-01",
      referenceImage: "storyboard-layout-9x16-4grid.png",
      images: [{ uri: "/runtime/Artifacts/sample_storyboard/image-generation/artifact_storyboard/storyboard_storyboard-group-01.png" }],
    }],
  });
  return artifactPath;
}

function runPython(args) {
  const [script, ...rest] = args;
  return spawnSync(PYTHON, [path.join(SCRIPTS_DIR, script), ...rest], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}
