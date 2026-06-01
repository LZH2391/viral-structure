const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const {
  SCHEMA_VERSION,
  buildAgentRepairRequest,
  transformRestructureFinalMarkdown,
  validateRestructureDisplaySectionJson,
} = require("../../Infrastructure/FunctionSlotRestructureDisplay/markdown-transformer");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CLI = path.join(REPO_ROOT, "Apps", "Api", "scripts", "transform-restructure-display.js");

test("restructure display transformer converts fixed sections into display json", () => {
  const result = transformRestructureFinalMarkdown(sampleMarkdown(), {
    restructureFinalPath: "Artifacts/FunctionSlotRestructure/demo/restructure.final.md",
    restructureArtifactId: "artifact_restructure",
    convertedAt: () => "2026-06-01T00:00:00.000Z",
  });

  assert.equal(result.schemaVersion, SCHEMA_VERSION);
  assert.equal(result.source.restructureArtifactId, "artifact_restructure");
  assert.deepEqual(result.missingSections, []);
  assert.equal(result.sourceTextDigest.sectionCount, 6);
  assert.equal(result.sections.goalAndAssumptions.items[0].type, "heading");
  assert.equal(result.sections.goalAndAssumptions.items[1].type, "list");
  const slotTable = result.sections.finalSlotChain.items.find((item) => item.type === "table");
  assert.deepEqual(slotTable.columns, ["顺序", "需求", "slotSubtype"]);
  assert.equal(slotTable.rows[0].slotSubtype, "`SUB_demo` 可视 hook");
  assert.equal(slotTable.sourceLocation.sectionKey, "finalSlotChain");
  assert.equal(result.sections.scriptSegments.items[0].type, "table");
});

test("restructure display transformer marks missing sections without inventing content", () => {
  const result = transformRestructureFinalMarkdown("## 1. 重组目标与假设\n\n- 只存在目标\n", {
    convertedAt: () => "2026-06-01T00:00:00.000Z",
  });

  assert.deepEqual(result.missingSections, ["finalSlotChain", "atomLandingTable", "scriptSegments", "rhythmCurve", "packagingProof"]);
  assert.deepEqual(result.sections.finalSlotChain.items, []);
});

test("malformed markdown table is preserved as rawMarkdown with line location", () => {
  const result = transformRestructureFinalMarkdown(sampleMarkdown().replace("| 1 | 需求 | `SUB_demo` 可视 hook |", "| 1 | 需求 |"), {
    convertedAt: () => "2026-06-01T00:00:00.000Z",
  });

  const raw = result.sections.finalSlotChain.items.find((item) => item.type === "rawMarkdown");
  assert.ok(raw);
  assert.match(raw.parseError, /expected 3/);
  assert.equal(raw.sourceLocation.blockType, "table");
  assert.equal(typeof raw.sourceLocation.line, "number");
});

test("display section schema validation reports exact path for agent repair", () => {
  assert.throws(
    () => validateRestructureDisplaySectionJson({
      schemaVersion: SCHEMA_VERSION,
      source: {},
      sections: { goalAndAssumptions: { title: "1. 重组目标与假设", items: "bad" } },
      missingSections: [],
      sourceTextDigest: {},
    }),
    (error) => {
      assert.equal(error.code, "restructure_display_schema_invalid");
      assert.ok(error.validationErrors.some((item) => item.path === "sections.goalAndAssumptions.items"));
      return true;
    },
  );
});

test("agent repair request is constrained to format-only repair", () => {
  const error = new Error("bad table");
  error.code = "restructure_display_markdown_parse_failed";
  error.validationErrors = [{ sectionKey: "finalSlotChain", sectionTitle: "2. 最终功能槽位链", blockType: "table", line: 12, message: "row mismatch", snippet: "| a | b |" }];

  const request = buildAgentRepairRequest({
    error,
    inputPath: "Artifacts/FunctionSlotRestructure/demo/restructure.final.md",
    outputPath: "Artifacts/FunctionSlotRestructure/demo/restructure.display.json",
  });

  assert.equal(request.allowedRepairScope, "format_only");
  assert.match(request.constraints.join("\n"), /不得改写/);
  assert.equal(request.repairTargets[0].line, 12);
  assert.equal(request.repairTargets[0].snippet, "| a | b |");
});

test("restructure display CLI writes json and failure repair request", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bd-restructure-display-"));
  const planDir = path.join(tempRoot, "Artifacts", "FunctionSlotRestructure", "demo");
  await fs.mkdir(planDir, { recursive: true });
  await fs.writeFile(path.join(planDir, "restructure.final.md"), sampleMarkdown(), "utf8");

  const okRun = spawnSync(process.execPath, [
    CLI,
    "--root", tempRoot,
    "--input", "Artifacts/FunctionSlotRestructure/demo/restructure.final.md",
    "--restructure-artifact-id", "artifact_cli",
  ], { encoding: "utf8" });
  assert.equal(okRun.status, 0, okRun.stderr || okRun.stdout);
  const output = JSON.parse(await fs.readFile(path.join(planDir, "restructure.display.json"), "utf8"));
  assert.equal(output.source.restructureArtifactId, "artifact_cli");

  const badDir = path.join(tempRoot, "Artifacts", "FunctionSlotRestructure", "bad");
  await fs.mkdir(badDir, { recursive: true });
  await fs.writeFile(path.join(badDir, "restructure.final.md"), sampleMarkdown(), "utf8");
  const badRun = spawnSync(process.execPath, [
    CLI,
    "--root", tempRoot,
    "--input", "Artifacts/FunctionSlotRestructure/bad/restructure.final.md",
    "--output", "Artifacts/FunctionSlotRestructure/bad",
  ], { encoding: "utf8" });
  assert.notEqual(badRun.status, 0);
  const repairRequest = JSON.parse(await fs.readFile(path.join(badDir, "restructure.display.repair-request.json"), "utf8"));
  assert.equal(repairRequest.allowedRepairScope, "format_only");
  assert.match(repairRequest.errorMessage, /EISDIR|illegal operation|directory/i);
});

function sampleMarkdown() {
  return [
    "# 重组方案",
    "",
    "## 1. 重组目标与假设",
    "",
    "### 输入分层",
    "",
    "- brief：豆浆粉卖货短视频。",
    "- 素材：成品和包装可见。",
    "",
    "## 2. 最终功能槽位链",
    "",
    "| 顺序 | 需求 | slotSubtype |",
    "|---:|---|---|",
    "| 1 | 需求 | `SUB_demo` 可视 hook |",
    "",
    "### 槽位素材能力判断",
    "",
    "| 槽位 | 素材得分 |",
    "|---|---:|",
    "| slot_001 | 90 |",
    "",
    "## 3. Atoms 落地表",
    "",
    "来源短码：",
    "",
    "- `A=sample_demo`",
    "",
    "| 槽位 | 来源 |",
    "|---|---|",
    "| `SUB_demo` | `A::F001` |",
    "",
    "## 4. Adapter 方案",
    "",
    "不应被转换。",
    "",
    "## 5. 脚本段落方案",
    "",
    "| 脚本段落 | 段落任务 |",
    "|---|---|",
    "| 段落 1 | hook |",
    "",
    "## 6. 节奏曲线",
    "",
    "| 节奏区间 | 注意力状态 |",
    "|---|---|",
    "| 区间 1 | 首秒抓注意 |",
    "",
    "## 7. 包装与证明方案",
    "",
    "| 包装块 | 风险 |",
    "|---|---|",
    "| 包装块 1 | 无 |",
    "",
    "## 8. 校验",
    "",
    "不应被转换。",
  ].join("\n");
}
