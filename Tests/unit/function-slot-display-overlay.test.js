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

test("display overlay materializes display json, index, and multi-plan trace graph", async () => {
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
  const traceGraph = await service.readConfirmedPlanTraceGraph();
  assert.equal(traceGraph.schemaVersion, "confirmed_plan_trace_graph.v1");
  assert.equal(traceGraph.summary.planCount, 2);
  assert.ok(traceGraph.nodes.some((node) => node.type === "sourceReference" && node.data.governanceNodeId === "slotSubtype:SUB_scene_problem_activation"));
  assert.ok(await exists(path.join(rootDir, "Artifacts", "FunctionSlotRestructure", "plan-a", "restructure.display.json")));
  assert.ok(await exists(path.join(rootDir, "Artifacts", "FunctionSlotRestructure", "_projections", "confirmed-plan-trace.graph.json")));
  assert.ok(logs.some((entry) => entry.event === "stage.end"));
});

test("display overlay rematerializes the same plan by replacing the prior confirmation", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "display-overlay-reconfirm-"));
  const logger = {
    writeStageLog: async () => undefined,
    writeDebugSnapshot: async () => ({ uri: "runtime://debug.json" }),
  };
  const service = createRestructureDisplayOverlayService({
    rootDir,
    logger,
    now: () => "2026-05-30T00:00:00.000Z",
  });
  const traceContext = { runId: "run_1", traceId: "trace_1", stageId: "stage_1" };
  const restructureFinalPath = "Artifacts/FunctionSlotRestructure/plan-a/restructure.final.md";
  const first = await service.materializeFromTurn({
    finalMessage: JSON.stringify(validDisplayJson("SUB_old_toothpaste")),
    restructureFinalPath,
    sourceTurnId: "turn_old",
    parentArtifactId: "parent_old",
    confirmationId: "confirm_old",
    traceContext,
  });
  const second = await service.materializeFromTurn({
    finalMessage: JSON.stringify(validDisplayJson("SUB_new_floral_water")),
    restructureFinalPath,
    sourceTurnId: "turn_new",
    parentArtifactId: "parent_new",
    confirmationId: "confirm_new",
    traceContext,
  });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.planId, second.planId);
  const traceGraph = await service.readConfirmedPlanTraceGraph();
  assert.equal(traceGraph.summary.planCount, 1);
  const planNode = traceGraph.nodes.find((node) => node.type === "confirmedPlan");
  assert.equal(planNode.data.confirmationId, "confirm_new");
  assert.ok(traceGraph.nodes.some((node) => node.data.governanceNodeId === "slotSubtype:SUB_new_floral_water"));
  assert.equal(traceGraph.nodes.some((node) => node.data.governanceNodeId === "slotSubtype:SUB_old_toothpaste"), false);
  const stored = JSON.parse(await fs.readFile(path.join(rootDir, "Artifacts", "FunctionSlotRestructure", "plan-a", "restructure.display.json"), "utf8"));
  assert.equal(stored.confirmationId, "confirm_new");
  assert.equal(stored.sourceTurnId, "turn_new");
});

test("display overlay materializes display transformer section schema", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "display-overlay-sections-"));
  const logger = {
    writeStageLog: async () => undefined,
    writeDebugSnapshot: async () => ({ uri: "runtime://debug.json" }),
  };
  const service = createRestructureDisplayOverlayService({
    rootDir,
    logger,
    now: () => "2026-05-30T00:00:00.000Z",
  });
  const result = await service.materializeFromTurn({
    finalMessage: JSON.stringify(sectionDisplayJson()),
    restructureFinalPath: "Artifacts/FunctionSlotRestructure/spray-pump-floral-water/restructure.final.md",
    sourceTurnId: "turn_sections",
    parentArtifactId: "parent_sections",
    traceContext: { runId: "run_1", traceId: "trace_1", stageId: "stage_1" },
  });
  assert.equal(result.ok, true);
  assert.equal(result.planId, "spray-pump-floral-water");
  const traceGraph = await service.readConfirmedPlanTraceGraph();
  assert.equal(traceGraph.summary.planCount, 1);
  assert.ok(traceGraph.nodes.some((node) => node.data.sourceRestructurePath === "Artifacts/FunctionSlotRestructure/spray-pump-floral-water/restructure.final.md"));
  assert.ok(traceGraph.nodes.some((node) => node.data.governanceNodeId === "slotSubtype:SUB_spray_pump_entry"));
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

function sectionDisplayJson() {
  return {
    schemaVersion: "function_slot_restructure_display.v1",
    source: {
      restructureFinalPath: "Artifacts/FunctionSlotRestructure/spray-pump-floral-water/restructure.final.md",
      restructureArtifactId: "turn_sections",
    },
    sections: {
      goalAndAssumptions: {
        title: "1. 重组目标与假设",
        items: [{ type: "paragraph", text: "品类：喷泵花露水卖货短视频。" }],
      },
      finalSlotChain: {
        title: "2. 最终功能槽位链",
        items: [{
          type: "table",
          columns: ["顺序", "需求", "slotSubtype", "parent archetype"],
          rows: [{ "顺序": "1", "需求": "喷泵亮相", "slotSubtype": "`SUB_spray_pump_entry`", "parent archetype": "`ARCH_solution_entry`" }],
        }],
      },
      atomLandingTable: {
        title: "3. Atoms 落地表",
        items: [{
          type: "table",
          columns: ["slotSubtype", "atom"],
          rows: [{ "slotSubtype": "`SUB_spray_pump_entry`", "atom": "`ATOM_spray_demo`" }],
        }],
      },
      scriptSegments: { title: "5. 脚本段落方案", items: [{ type: "paragraph", text: "喷泵出场。" }] },
      rhythmCurve: { title: "6. 节奏曲线", items: [{ type: "paragraph", text: "快速进入。" }] },
      packagingProof: { title: "7. 包装与证明方案", items: [{ type: "paragraph", text: "喷雾证明。" }] },
    },
    missingSections: [],
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
