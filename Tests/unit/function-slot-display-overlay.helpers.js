const fs = require("fs/promises");
const path = require("path");

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

function unstableSlotSectionDisplayJson() {
  return {
    schemaVersion: "function_slot_restructure_display.v1",
    source: {
      restructureFinalPath: "Artifacts/FunctionSlotRestructure/soy-powder-15s-sell-video/restructure.final.md",
      restructureArtifactId: "artifact_unstable_slots",
    },
    slotChain: [
      { slotSubtype: { value: "`SUB_scene_problem_activation`" }, name: "旧缓存槽位 1" },
      { slotSubtype: { value: "`SUB_solution_object_entry`" }, name: "旧缓存槽位 2" },
    ],
    sections: {
      goalAndAssumptions: {
        title: "1. 重组目标与假设",
        items: [{ type: "paragraph", text: "品类：豆浆粉卖货短视频。" }],
      },
      finalSlotChain: {
        title: "2. 最终功能槽位链",
        items: [{
          type: "table",
          columns: ["供给类型", "关键 shot/group", "后续 shotDesign 注意事项"],
          rows: [{
            "供给类型": "`material_insufficient_for_full_video`",
            "关键 shot/group": "`shot_1`, `shot_2`",
            "后续 shotDesign 注意事项": "素材不足，不应作为槽位链",
          }],
        }, {
          type: "table",
          columns: ["顺序", "功能槽位", "槽位原型", "观众状态变化", "选择理由"],
          rows: [
            { "顺序": "1", "功能槽位": "`SUB_scene_problem_activation`", "槽位原型": "`ARCH_problem_activation`", "观众状态变化": "未进入早餐语境 -> 识别需求", "选择理由": "建立观看理由" },
            { "顺序": "2", "功能槽位": "`SUB_solution_object_entry`", "槽位原型": "`ARCH_solution_object_entry`", "观众状态变化": "需求 -> 商品", "选择理由": "商品对象进入" },
            { "顺序": "3", "功能槽位": "`SUB_attribute_state_sensing`", "槽位原型": "`ARCH_attribute_state_sensing`", "观众状态变化": "商品 -> 状态", "选择理由": "状态感知" },
            { "顺序": "4", "功能槽位": "`SUB_immediate_usage_demonstration`", "槽位原型": "`ARCH_operation_barrier_reduction`", "观众状态变化": "状态 -> 用法", "选择理由": "降低使用门槛" },
            { "顺序": "5", "功能槽位": "`SUB_usage_result_confirmation`", "槽位原型": "`ARCH_result_closure`", "观众状态变化": "用法 -> 结果", "选择理由": "结果确认" },
            { "顺序": "6", "功能槽位": "`SUB_conversion_reason_close`", "槽位原型": "`ARCH_conversion_motivation_close`", "观众状态变化": "结果 -> 转化", "选择理由": "轻转化收口" },
          ],
        }],
      },
      atomLandingTable: {
        title: "3. Atoms 落地表",
        items: [{
          type: "list",
          items: ["`A = sample_a`", "`B = sample_b`"],
        }, {
          type: "table",
          columns: ["对应槽位", "Script atom：原标签 -> 本方案落地"],
          rows: [
            { "对应槽位": "`SUB_scene_problem_activation`", "Script atom：原标签 -> 本方案落地": "`A::script::S001` 痛点开场" },
            { "对应槽位": "`SUB_attribute_state_sensing`", "Script atom：原标签 -> 本方案落地": "`B::script::S003` 状态感知" },
          ],
        }],
      },
      scriptSegments: { title: "5. 脚本段落方案", items: [{ type: "paragraph", text: "脚本。" }] },
      rhythmCurve: { title: "6. 节奏曲线", items: [{ type: "paragraph", text: "节奏。" }] },
      packagingProof: { title: "7. 包装与证明方案", items: [{ type: "paragraph", text: "包装。" }] },
    },
    missingSections: [],
  };
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

module.exports = { validDisplayJson, sectionDisplayJson, exists, unstableSlotSectionDisplayJson, writeRestructureMarkdown };
