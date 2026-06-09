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
  assert.equal(traceGraph.nodes.some((node) => node.type === "sourceReference"), false);
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
  assert.equal(traceGraph.nodes.some((node) => node.label === "Artifacts/FunctionSlotRestructure/spray-pump-floral-water/restructure.display.json"), false);
});

test("display overlay lazily rebuilds trace graph from existing confirmed plan index", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "display-overlay-lazy-trace-"));
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
    finalMessage: JSON.stringify(validDisplayJson("SUB_existing_plan")),
    restructureFinalPath: "Artifacts/FunctionSlotRestructure/existing-plan/restructure.final.md",
    sourceTurnId: "turn_existing",
    parentArtifactId: "parent_existing",
    traceContext: { runId: "run_1", traceId: "trace_1", stageId: "stage_1" },
  });
  assert.equal(result.ok, true);
  await fs.rm(path.join(rootDir, "Artifacts", "FunctionSlotRestructure", "_projections", "confirmed-plan-trace.graph.json"));

  const rebuilt = await service.readConfirmedPlanTraceGraph();

  assert.equal(rebuilt.schemaVersion, "confirmed_plan_trace_graph.v1");
  assert.equal(rebuilt.summary.planCount, 1);
  assert.ok(rebuilt.nodes.some((node) => node.type === "confirmedPlan" && node.data.planId === "existing-plan"));
  assert.ok(await exists(path.join(rootDir, "Artifacts", "FunctionSlotRestructure", "_projections", "confirmed-plan-trace.graph.json")));
});

test("display overlay traces confirmed plan slots to source samples and variants", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "display-overlay-source-trace-"));
  await fs.mkdir(path.join(rootDir, "Artifacts", "FunctionSlotLibrary", "_governance"), { recursive: true });
  await fs.writeFile(path.join(rootDir, "Artifacts", "FunctionSlotLibrary", "_governance", "semantic-governance.v1.json"), JSON.stringify({
    slotFamilies: [{
      id: "FAM_attention",
      name: "观看理由类",
    }],
    slotArchetypes: [{
      id: "ARCH_problem_activation",
      familyId: "FAM_attention",
      name: "问题激活原型",
    }],
    slotSubtypes: [{
      id: "SUB_scene_problem_activation",
      archetypeId: "ARCH_problem_activation",
      name: "场景问题激活",
      sourceVariantIds: ["sample_793ce355-f3e6-4a76-8b25-98ee829dd3d7::F001"],
    }, {
      id: "SUB_product_mechanism_proof",
      archetypeId: "ARCH_problem_activation",
      name: "机制证明",
      sourceVariantIds: ["sample_793ce355-f3e6-4a76-8b25-98ee829dd3d7::F002"],
    }],
    atomArchetypes: [{
      id: "ATOM_ARCH_script_demand_establishment",
      name: "需求建立脚本原型",
      atomLayer: "script",
      sourcePatternIds: ["SCRIPT_pattern_problem_to_need"],
      sourceVariantIds: [
        "sample_793ce355-f3e6-4a76-8b25-98ee829dd3d7::script::S001",
        "sample_other::script::S009",
      ],
    }],
    atomPatterns: [{
      id: "SCRIPT_pattern_problem_to_need",
      name: "可见问题建立需求脚本模式",
      atomLayer: "script",
      parentAtomArchetype: "ATOM_ARCH_script_demand_establishment",
      sourceVariantIds: [
        "sample_793ce355-f3e6-4a76-8b25-98ee829dd3d7::script::S001",
        "sample_other::script::S009",
      ],
    }],
    sourceVariants: [{
      variantId: "sample_793ce355-f3e6-4a76-8b25-98ee829dd3d7::F001",
      sampleId: "sample_793ce355-f3e6-4a76-8b25-98ee829dd3d7",
      kind: "slot",
      sourceId: "F001",
      label: "牙渍问题槽位",
    }, {
      variantId: "sample_793ce355-f3e6-4a76-8b25-98ee829dd3d7::F002",
      sampleId: "sample_793ce355-f3e6-4a76-8b25-98ee829dd3d7",
      kind: "slot",
      sourceId: "F002",
      label: "机制证明槽位",
    }, {
      variantId: "sample_793ce355-f3e6-4a76-8b25-98ee829dd3d7::script::S001",
      sampleId: "sample_793ce355-f3e6-4a76-8b25-98ee829dd3d7",
      kind: "script",
      sourceId: "S001",
      label: "问题对象直冲与执行动作入口",
    }, {
      variantId: "sample_fcf2e190-dbfc-478d-b327-854948b792eb::rhythm::R002",
      sampleId: "sample_fcf2e190-dbfc-478d-b327-854948b792eb",
      kind: "rhythm",
      sourceId: "R002",
      label: "多场景问题堆叠",
    }, {
      variantId: "sample_other::script::S009",
      sampleId: "sample_other",
      kind: "script",
      sourceId: "S009",
      label: "未使用脚本",
    }],
  }, null, 2), "utf8");
  const service = createRestructureDisplayOverlayService({
    rootDir,
    logger: {
      writeStageLog: async () => undefined,
      writeDebugSnapshot: async () => ({ uri: "runtime://debug.json" }),
    },
    now: () => "2026-05-30T00:00:00.000Z",
  });
  const displayJson = {
    ...validDisplayJson("SUB_scene_problem_activation"),
    slotChain: [
      { slotSubtype: "SUB_scene_problem_activation", slotArchetype: "ARCH_problem_activation", name: "痛点激活" },
      { slotSubtype: "SUB_product_mechanism_proof", slotArchetype: "ARCH_problem_activation", name: "机制证明" },
    ],
    atoms: [
      { id: "source aliases", name: "来源短码：`A=sample_793ce355-f3e6-4a76-8b25-98ee829dd3d7`，`C=sample_fcf2e190-dbfc-478d-b327-854948b792eb`。" },
      {
        value: "A::F001` + `C::rhythm::R002",
        scriptAtom: "A::script::S001`：问题对象直冲与执行动作入口",
      },
      {
        value: "A::F002",
      },
    ],
  };
  const result = await service.materializeFromTurn({
    finalMessage: JSON.stringify(displayJson),
    restructureFinalPath: "Artifacts/FunctionSlotRestructure/plan-source/restructure.final.md",
    sourceTurnId: "turn_source",
    parentArtifactId: "parent_source",
    traceContext: { runId: "run_1", traceId: "trace_1", stageId: "stage_1" },
  });
  assert.equal(result.ok, true);

  const traceGraph = await service.readConfirmedPlanTraceGraph();

  assert.equal(traceGraph.nodes.some((node) => node.type === "sourceExample"), false);
  assert.equal(traceGraph.nodes.some((node) => node.type === "sourceVariant" && node.data.variantId === "sample_793ce355-f3e6-4a76-8b25-98ee829dd3d7::F001"), false);
  assert.equal(traceGraph.nodes.some((node) => node.type === "sourceVariant" && node.data.variantId === "sample_793ce355-f3e6-4a76-8b25-98ee829dd3d7::F002"), false);
  assert.ok(traceGraph.nodes.some((node) => node.type === "sourceVariant" && node.data.variantId === "sample_793ce355-f3e6-4a76-8b25-98ee829dd3d7::script::S001" && node.label === "问题对象直冲与执行动作入口"));
  assert.ok(traceGraph.nodes.some((node) => node.type === "sourceVariant" && node.data.variantId === "sample_fcf2e190-dbfc-478d-b327-854948b792eb::rhythm::R002" && node.label === "多场景问题堆叠"));
  assert.equal(traceGraph.nodes.some((node) => node.type === "sourceVariant" && String(node.data.variantId).includes("F001` + `C::rhythm::R002")), false);
  assert.equal(traceGraph.nodes.some((node) => node.type === "sourceVariant" && node.data.variantId === "sample_other::script::S009"), false);
  assert.equal(traceGraph.nodes.some((node) => node.type === "sourceVariant" && String(node.label).includes("::")), false);
  assert.equal(traceGraph.nodes.some((node) => node.type === "slotFamily"), false);
  assert.equal(traceGraph.nodes.some((node) => node.type === "slotArchetype"), false);
  assert.ok(traceGraph.nodes.some((node) => node.type === "slotSubtype" && node.label === "场景问题激活"));
  assert.ok(traceGraph.nodes.some((node) => node.type === "slotSubtype" && node.data.slotOrder === 1));
  assert.equal(traceGraph.nodes.some((node) => node.type === "atomLayer"), false);
  assert.equal(traceGraph.nodes.some((node) => node.type === "atomArchetype"), false);
  assert.ok(traceGraph.nodes.some((node) => node.type === "sourceSample" && node.data.sampleVideoId === "sample_793ce355-f3e6-4a76-8b25-98ee829dd3d7"));
  assert.equal(traceGraph.nodes.some((node) => node.type === "atomPattern"), false);
  assert.ok(traceGraph.edges.some((edge) => edge.type === "plan_uses_slot_subtype"));
  assert.ok(traceGraph.edges.some((edge) => edge.type === "plan_slot_next"));
  assert.equal(traceGraph.edges.some((edge) => edge.type === "source_slot_next"), false);
  assert.ok(traceGraph.edges.some((edge) => edge.type === "traced_to_source_variant"));
  assert.ok(traceGraph.edges.some((edge) => edge.type === "source_variant_to_sample"));
  assert.equal(traceGraph.nodes.some((node) => String(node.label).includes("{\"value\"")), false);
});

test("plan trace records expose multi-version graph without indexing the root plan", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "plan-trace-multi-"));
  const planDir = path.join(rootDir, "Artifacts", "FunctionSlotRestructure", "multi-demo");
  await fs.mkdir(planDir, { recursive: true });
  await fs.writeFile(path.join(planDir, "restructure.final.md"), [
    "# 多版本索引",
    "",
    "| versionId | versionName | path |",
    "| --- | --- | --- |",
    "| `V1_click` | 高点击版 | [restructure.final.md](versions/V1_click/restructure.final.md) |",
    "| `V2_conversion` | 高转化版 | [restructure.final.md](versions/V2_conversion/restructure.final.md) |",
    "",
  ].join("\n"), "utf8");
  await writeRestructureMarkdown(path.join(planDir, "versions", "V1_click", "restructure.final.md"), "V1_click", "SUB_click_hook");
  await writeRestructureMarkdown(path.join(planDir, "versions", "V2_conversion", "restructure.final.md"), "V2_conversion", "SUB_conversion_close");
  const service = createRestructureDisplayOverlayService({
    rootDir,
    logger: { writeStageLog: async () => undefined, writeDebugSnapshot: async () => ({ uri: "runtime://debug.json" }) },
  });

  const records = await service.listPlanTraceRecords({ bucket: "recent" });
  const record = records.records.find((item) => item.recordId === "multi-demo");
  assert.equal(record?.mode, "multiVersion");
  assert.deepEqual(record.variants.map((item) => item.versionId), ["V1_click", "V2_conversion"]);

  const graph = await service.readPlanTraceRecordGraph("multi-demo");
  assert.equal(graph.summary.planCount, 2);
  assert.deepEqual(graph.nodes.filter((node) => node.type === "confirmedPlan").map((node) => node.data.versionId), ["V1_click", "V2_conversion"]);
  assert.equal(graph.nodes.some((node) => node.type === "slotSubtype" && node.label === "素材供给判断"), false);
  assert.ok(graph.nodes.some((node) => node.type === "slotSubtype" && node.data.governanceNodeId === "slotSubtype:SUB_click_hook"));
  assert.ok(graph.nodes.some((node) => node.type === "slotSubtype" && node.data.governanceNodeId === "slotSubtype:SUB_conversion_close"));
});

test("plan trace records split recent and history by rolling 24 hours", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "plan-trace-buckets-"));
  const recentPath = path.join(rootDir, "Artifacts", "FunctionSlotRestructure", "recent-plan", "restructure.final.md");
  const historyPath = path.join(rootDir, "Artifacts", "FunctionSlotRestructure", "history-plan", "restructure.final.md");
  await writeRestructureMarkdown(recentPath, "recent", "SUB_recent");
  await writeRestructureMarkdown(historyPath, "history", "SUB_history");
  const old = new Date(Date.now() - (48 * 60 * 60 * 1000));
  await fs.utimes(historyPath, old, old);
  const service = createRestructureDisplayOverlayService({
    rootDir,
    logger: { writeStageLog: async () => undefined, writeDebugSnapshot: async () => ({ uri: "runtime://debug.json" }) },
  });

  const recent = await service.listPlanTraceRecords({ bucket: "recent" });
  const history = await service.listPlanTraceRecords({ bucket: "history" });

  assert.ok(recent.records.some((record) => record.recordId === "recent-plan"));
  assert.equal(recent.records.some((record) => record.recordId === "history-plan"), false);
  assert.ok(history.records.some((record) => record.recordId === "history-plan"));
});

test("plan trace preview builds graph without writing confirmed index", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "plan-trace-preview-"));
  const finalPath = path.join(rootDir, "Artifacts", "FunctionSlotRestructure", "preview-plan", "restructure.final.md");
  await writeRestructureMarkdown(finalPath, "preview", "SUB_preview");
  const service = createRestructureDisplayOverlayService({
    rootDir,
    logger: { writeStageLog: async () => undefined, writeDebugSnapshot: async () => ({ uri: "runtime://debug.json" }) },
  });

  const result = await service.previewPlanTraceGraph({
    restructureFinalPath: "Artifacts/FunctionSlotRestructure/preview-plan/restructure.final.md",
  });

  assert.equal(result.ok, true);
  assert.equal(result.graph.summary.planCount, 1);
  assert.equal(await exists(path.join(rootDir, "Artifacts", "FunctionSlotRestructure", "_index", "confirmed-plan-displays.json")), false);
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

async function writeRestructureMarkdown(filePath, title = "demo", slotSubtype = "SUB_demo_slot") {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, [
    `# ${title}`,
    "",
    "## 1. 重组目标与假设",
    "",
    "品类：测试。",
    "",
    "## 2. 最终功能槽位链",
    "",
    "| 顺序 | 需求 | slotSubtype | parent archetype |",
    "| --- | --- | --- | --- |",
    `| 1 | 测试需求 | \`${slotSubtype}\` | \`ARCH_test\` |`,
    "",
    "## 3. Atoms 落地表",
    "",
    "| slotSubtype | atom |",
    "| --- | --- |",
    `| \`${slotSubtype}\` | \`ATOM_test\` |`,
    "",
    "## 5. 脚本段落方案",
    "",
    "脚本段落。",
    "",
    "## 6. 节奏曲线",
    "",
    "节奏。",
    "",
    "## 7. 包装与证明方案",
    "",
    "包装。",
    "",
  ].join("\n"), "utf8");
}
