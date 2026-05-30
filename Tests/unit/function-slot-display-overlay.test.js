const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const {
  parseDisplayTransformerFinalMessage,
  validateRestructureDisplayJson,
  createRestructureDisplayOverlayService,
} = require("../../Apps/Api/lib/function-slot-workflow/display-overlay-service");

test("display overlay parser extracts fenced json and validates required fields", () => {
  const parsed = parseDisplayTransformerFinalMessage(`ok\n\n\`\`\`json\n${JSON.stringify(validDisplayJson())}\n\`\`\``);
  assert.equal(parsed.targetAssumption.title, "test");
  assert.equal(validateRestructureDisplayJson(parsed), true);
});

test("display overlay validation rejects missing required arrays", () => {
  assert.throws(
    () => validateRestructureDisplayJson({ targetAssumption: {} }),
    /展示转换 JSON 校验失败/,
  );
});

test("display overlay materializes display json, index, and multi-plan overlay", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "display-overlay-"));
  const logs = [];
  const logger = {
    writeStageLog: async (entry) => logs.push(entry),
    writeDebugSnapshot: async () => ({ uri: "runtime://debug.json" }),
  };
  const service = createRestructureDisplayOverlayService({
    rootDir,
    logger,
    now: () => "2026-05-30T00:00:00.000Z",
  });
  const traceContext = { runId: "run_1", traceId: "trace_1", stageId: "stage_1" };
  const first = await service.materializeFromTurn({
    finalMessage: JSON.stringify(validDisplayJson("SUB_scene_problem_activation")),
    restructureFinalPath: "Artifacts/FunctionSlotRestructure/plan-a/restructure.final.md",
    sourceTurnId: "turn_a",
    parentArtifactId: "parent_a",
    traceContext,
  });
  const second = await service.materializeFromTurn({
    finalMessage: JSON.stringify(validDisplayJson("SUB_scene_problem_activation")),
    restructureFinalPath: "Artifacts/FunctionSlotRestructure/plan-b/restructure.final.md",
    sourceTurnId: "turn_b",
    parentArtifactId: "parent_b",
    traceContext,
  });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  const overlay = await service.readOverlays();
  assert.equal(overlay.summary.planCount, 2);
  assert.deepEqual(overlay.sharedUsage["slotSubtype:SUB_scene_problem_activation"].sort(), ["plan-a", "plan-b"]);
  assert.ok(await exists(path.join(rootDir, "Artifacts", "FunctionSlotRestructure", "plan-a", "restructure.display.json")));
  assert.ok(logs.some((entry) => entry.event === "stage.end"));
});

function validDisplayJson(slotSubtype = "SUB_solution_object_entry") {
  return {
    targetAssumption: { title: "test" },
    slotChain: [{ slotSubtype, slotArchetype: "ARCH_problem_activation", name: "痛点激活" }],
    atoms: [{ atomId: "PATTERN_1", slotSubtype }],
    scriptSegments: [{ id: "P1", slotSubtype, title: "脚本段落" }],
    rhythmCurve: [{ id: "R1", slotSubtype, title: "节奏" }],
    packagingProof: [{ id: "PK1", slotSubtype, title: "包装" }],
  };
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
