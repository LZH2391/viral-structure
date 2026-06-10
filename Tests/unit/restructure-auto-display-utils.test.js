const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  buildSlotAtomDisplaySummary,
  hydrateSlotAtomDisplay,
} = require("../../Apps/Api/lib/agent-chat/restructure-auto-display-utils");

test("slot atom display summary reads slot chain after legacy paragraph heading", () => {
  const summary = buildSlotAtomDisplaySummary({
    schemaVersion: "function_slot_restructure_display.v1",
    sections: {
      finalSlotChain: {
        title: "2. 最终功能槽位链",
        items: [
          {
            type: "paragraph",
            text: "## 槽位链",
          },
          {
            type: "table",
            columns: ["顺序", "slotSubtype", "slotArchetype", "选择理由"],
            rows: [
              {
                "顺序": "1",
                slotSubtype: "`SUB_demo` 可视 hook",
                slotArchetype: "`ARCH_demo`",
                "选择理由": "用于测试旧 display JSON。",
              },
            ],
          },
        ],
      },
      atomLandingTable: {
        title: "3. Atoms 落地表",
        items: [
          {
            type: "table",
            columns: ["槽位", "script atom 原标签 -> 本方案落地"],
            rows: [
              {
                "槽位": "`SUB_demo`",
                "script atom 原标签 -> 本方案落地": "`A::script::S001` 脚本",
              },
            ],
          },
        ],
      },
    },
  });

  assert.equal(summary.status, "available");
  assert.equal(summary.slotCount, 1);
  assert.equal(summary.atomBindingCount, 1);
  assert.equal(summary.selectedSlotSubtypeId, "SUB_demo");
  assert.equal(summary.slots[0].slotSubtypeId, "SUB_demo");
  assert.equal(summary.slots[0].archetypeId, "ARCH_demo");
});

test("slot atom display summary prefers atom landing text over raw atom id columns", () => {
  const summary = buildSlotAtomDisplaySummary({
    schemaVersion: "function_slot_restructure_display.v1",
    sections: {
      finalSlotChain: {
        title: "2. 最终功能槽位链",
        items: [
          { type: "paragraph", text: "## 槽位链" },
          {
            type: "table",
            rows: [{ "顺序": "1", slotSubtype: "`SUB_demo` 转化利益收束槽" }],
          },
        ],
      },
      atomLandingTable: {
        title: "3. Atoms 落地表",
        items: [
          {
            type: "table",
            columns: [
              "槽位",
              "script atom",
              "script atom 原标签 -> 本方案落地",
              "rhythm atom",
              "rhythm atom 原标签 -> 本方案落地",
              "packaging atom",
              "packaging atom 原标签 -> 本方案落地",
            ],
            rows: [{
              "槽位": "`SUB_demo`",
              "script atom": "`A::script::S001`",
              "script atom 原标签 -> 本方案落地": "`A::script::S001` 熟悉经验钩子槽 -> 本方案落地为早餐豆浆熟悉需求入口",
              "rhythm atom": "`A::rhythm::R001`",
              "rhythm atom 原标签 -> 本方案落地": "`A::rhythm::R001` 高密度快速入场 -> 本方案落地为首段快入但不塞复杂信任信息",
              "packaging atom": "`A::packaging::P001`",
              "packaging atom 原标签 -> 本方案落地": "`A::packaging::P001` 首屏使用状态加品类入口 -> 本方案落地为豆浆品类和观看动机同屏提示",
            }],
          },
        ],
      },
    },
  });

  assert.equal(summary.atoms[0].scriptAtom, "`A::script::S001` 熟悉经验钩子槽 -> 本方案落地为早餐豆浆熟悉需求入口");
  assert.equal(summary.atoms[0].rhythmAtom, "`A::rhythm::R001` 高密度快速入场 -> 本方案落地为首段快入但不塞复杂信任信息");
  assert.equal(summary.atoms[0].packagingAtom, "`A::packaging::P001` 首屏使用状态加品类入口 -> 本方案落地为豆浆品类和观看动机同屏提示");
});

test("slot atom display summary prefixes raw atom id when landing column omits it", () => {
  const summary = buildSlotAtomDisplaySummary({
    schemaVersion: "function_slot_restructure_display.v1",
    sections: {
      finalSlotChain: {
        title: "2. 最终功能槽位链",
        items: [
          { type: "paragraph", text: "## 槽位链" },
          {
            type: "table",
            rows: [{ "顺序": "1", slotSubtype: "`SUB_demo` 熟悉经验钩子槽" }],
          },
        ],
      },
      atomLandingTable: {
        title: "3. Atoms 落地表",
        items: [
          {
            type: "table",
            columns: [
              "槽位",
              "script atom",
              "script atom 原标签 -> 本方案落地",
              "rhythm atom",
              "rhythm atom 原标签 -> 本方案落地",
              "packaging atom",
              "packaging atom 原标签 -> 本方案落地",
            ],
            rows: [{
              "槽位": "`SUB_demo`",
              "script atom": "`A::script::S001`",
              "script atom 原标签 -> 本方案落地": "熟悉经验转新组合入口 -> 早餐店豆浆熟悉经验转家用豆浆粉入口",
              "rhythm atom": "`A::rhythm::R001`",
              "rhythm atom 原标签 -> 本方案落地": "高密度快速入场 -> 以早餐需求和商品对象快速入场",
              "packaging atom": "`A::packaging::P001`",
              "packaging atom 原标签 -> 本方案落地": "首屏使用状态加品类入口 -> 成品豆浆/商品身份作为首屏品类锚点",
            }],
          },
        ],
      },
    },
  });

  assert.equal(summary.atoms[0].scriptAtom, "`A::script::S001` 熟悉经验转新组合入口 -> 早餐店豆浆熟悉经验转家用豆浆粉入口");
  assert.equal(summary.atoms[0].rhythmAtom, "`A::rhythm::R001` 高密度快速入场 -> 以早餐需求和商品对象快速入场");
  assert.equal(summary.atoms[0].packagingAtom, "`A::packaging::P001` 首屏使用状态加品类入口 -> 成品豆浆/商品身份作为首屏品类锚点");
});

test("slot atom display summary resolves atom slot ids from unstable slot labels", () => {
  const summary = buildSlotAtomDisplaySummary({
    schemaVersion: "function_slot_restructure_display.v1",
    sections: {
      finalSlotChain: {
        title: "2. 最终功能槽位链",
        items: [
          {
            type: "table",
            rows: [
              {
                "顺序": "1",
                slotSubtype: "`SUB_familiarity_bridge_hook` 熟悉经验钩子槽",
                "链路功能": "用熟悉经验降低理解成本",
              },
              {
                "顺序": "2",
                slotSubtype: "`SUB_combination_claim_peak` 组合承诺峰值槽",
                "链路功能": "将组合卖点推到第一轮注意力峰值",
              },
            ],
          },
        ],
      },
      atomLandingTable: {
        title: "3. Atoms 落地表",
        items: [
          {
            type: "table",
            rows: [
              {
                "槽位": "熟悉经验钩子槽",
                "来源": "`A::F001`",
                "script atom（原标签 → 本方案落地）": "`A::script::S001`：熟悉经验转新组合入口",
                "rhythm atom（原标签 → 本方案落地）": "`A::rhythm::R001`：高密度快速入场",
                "packaging atom（原标签 → 本方案落地）": "`A::packaging::P001`：首屏使用状态加品类入口",
              },
              {
                "槽位": "组合承诺峰值槽",
                "来源": "`A::F002`",
                "script atom（原标签 → 本方案落地）": "`A::script::S002`：组合卖点压缩成峰值",
                "rhythm atom（原标签 → 本方案落地）": "`A::rhythm::R002`：短促压缩到首轮峰值",
                "packaging atom（原标签 → 本方案落地）": "`A::packaging::P002`：包装身份与实物组合绑定",
              },
            ],
          },
        ],
      },
    },
  });

  assert.equal(summary.selectedSlotSubtypeId, "SUB_familiarity_bridge_hook");
  assert.equal(summary.atoms[0].slotSubtypeId, "SUB_familiarity_bridge_hook");
  assert.equal(summary.atoms[1].slotSubtypeId, "SUB_combination_claim_peak");
  assert.equal(summary.atoms[0].scriptAtom, "`A::script::S001`：熟悉经验转新组合入口");
});

test("slot atom display summary accepts alternate headers and unquoted ids", () => {
  const summary = buildSlotAtomDisplaySummary({
    schemaVersion: "function_slot_restructure_display.v1",
    sections: {
      finalSlotChain: {
        title: "2. 最终功能槽位链",
        items: [
          {
            type: "table",
            rows: [{
              order: "1",
              "功能槽位": "SUB_demo_entry 熟悉经验钩子槽",
              parentArchetype: "ARCH_demo_entry",
              function: "快速建立商品对象",
            }],
          },
        ],
      },
      atomLandingTable: {
        title: "3. Atoms 落地表",
        items: [
          {
            type: "table",
            rows: [{
              "对应槽位": "熟悉经验钩子槽",
              source: "F001",
              "脚本原子迁移后": "A::script::S001 熟悉经验转新组合入口",
              "节奏原子应用": "A::rhythm::R001 高密度快速入场",
              "证明包装改写后": "A::packaging::P001 首屏使用状态加品类入口",
            }],
          },
        ],
      },
    },
  });

  assert.equal(summary.slots[0].slotSubtypeId, "SUB_demo_entry");
  assert.equal(summary.slots[0].archetypeId, "ARCH_demo_entry");
  assert.equal(summary.atoms[0].slotSubtypeId, "SUB_demo_entry");
  assert.equal(summary.atoms[0].scriptAtom, "A::script::S001 熟悉经验转新组合入口");
  assert.equal(summary.atoms[0].rhythmAtom, "A::rhythm::R001 高密度快速入场");
  assert.equal(summary.atoms[0].packagingAtom, "A::packaging::P001 首屏使用状态加品类入口");
});

test("slot atom display summary falls back to source order when labels drift", () => {
  const summary = buildSlotAtomDisplaySummary({
    schemaVersion: "function_slot_restructure_display.v1",
    sections: {
      finalSlotChain: {
        title: "2. 最终功能槽位链",
        items: [
          {
            type: "table",
            rows: [
              { "顺序": "1", slotSubtype: "`SUB_first` 第一槽" },
              { "顺序": "2", slotSubtype: "`SUB_second` 第二槽" },
            ],
          },
        ],
      },
      atomLandingTable: {
        title: "3. Atoms 落地表",
        items: [
          {
            type: "table",
            rows: [{
              "槽位": "表达不同但带顺序",
              "来源": "Slot 2 / source F002",
              "script atom 原标签 -> 本方案落地": "落地文本",
              "script atom": "A::script::S002",
            }],
          },
        ],
      },
    },
  });

  assert.equal(summary.atoms[0].slotSubtypeId, "SUB_second");
  assert.equal(summary.atoms[0].scriptAtom, "`A::script::S002` 落地文本");
});

test("slot atom display hydration rebuilds stale zero-slot summary from display json", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "bd-slot-display-"));
  try {
    const displayPath = path.join(rootDir, "Artifacts", "FunctionSlotRestructure", "demo", "restructure.display.json");
    await fs.mkdir(path.dirname(displayPath), { recursive: true });
    await fs.writeFile(displayPath, JSON.stringify({
      schemaVersion: "function_slot_restructure_display.v1",
      sections: {
        finalSlotChain: {
          title: "2. 最终功能槽位链",
          items: [
            { type: "paragraph", text: "## 槽位链" },
            {
              type: "table",
              columns: ["顺序", "slotSubtype", "slotArchetype"],
              rows: [{ "顺序": "1", slotSubtype: "`SUB_demo` 可视 hook", slotArchetype: "`ARCH_demo`" }],
            },
          ],
        },
        atomLandingTable: {
          title: "3. Atoms 落地表",
          items: [
            {
              type: "table",
              columns: ["槽位", "script atom"],
              rows: [{ "槽位": "`SUB_demo`", "script atom": "`A::script::S001` 脚本" }],
            },
          ],
        },
      },
    }), "utf8");

    const hydrated = await hydrateSlotAtomDisplay({
      schemaVersion: "function_slot_restructure_slot_atom_display.v1",
      status: "available",
      displayJsonPath: "Artifacts/FunctionSlotRestructure/demo/restructure.display.json",
      slotCount: 0,
      atomBindingCount: 1,
      selectedSlotSubtypeId: null,
      slots: [],
      atoms: [{ slotSubtypeId: "SUB_demo", scriptAtom: "`A::script::S001` 脚本" }],
    }, { rootDir });

    assert.equal(hydrated.slotCount, 1);
    assert.equal(hydrated.atomBindingCount, 1);
    assert.equal(hydrated.selectedSlotSubtypeId, "SUB_demo");
    assert.equal(hydrated.slots[0].slotSubtypeId, "SUB_demo");
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test("slot atom display hydration rebuilds summaries with missing atom slot bindings", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "bd-slot-display-missing-atom-slot-"));
  try {
    const displayPath = path.join(rootDir, "Artifacts", "FunctionSlotRestructure", "demo", "restructure.display.json");
    await fs.mkdir(path.dirname(displayPath), { recursive: true });
    await fs.writeFile(displayPath, JSON.stringify({
      schemaVersion: "function_slot_restructure_display.v1",
      sections: {
        finalSlotChain: {
          title: "2. 最终功能槽位链",
          items: [
            {
              type: "table",
              rows: [{ "顺序": "1", slotSubtype: "`SUB_demo` 熟悉经验钩子槽" }],
            },
          ],
        },
        atomLandingTable: {
          title: "3. Atoms 落地表",
          items: [
            {
              type: "table",
              rows: [{
                "槽位": "熟悉经验钩子槽",
                "来源": "`A::F001`",
                "script atom 原标签 -> 本方案落地": "`A::script::S001` 熟悉经验钩子槽 -> 本方案落地",
              }],
            },
          ],
        },
      },
    }), "utf8");

    const hydrated = await hydrateSlotAtomDisplay({
      schemaVersion: "function_slot_restructure_slot_atom_display.v1",
      status: "available",
      displayJsonPath: "Artifacts/FunctionSlotRestructure/demo/restructure.display.json",
      slotCount: 1,
      atomBindingCount: 1,
      selectedSlotSubtypeId: "SUB_demo",
      slots: [{ slotSubtypeId: "SUB_demo", slotSubtype: "`SUB_demo` 熟悉经验钩子槽" }],
      atoms: [{ slotSubtype: "熟悉经验钩子槽", slotSubtypeId: null, scriptAtom: "`A::script::S001` 熟悉经验钩子槽 -> 本方案落地" }],
    }, { rootDir });

    assert.equal(hydrated.atoms[0].slotSubtypeId, "SUB_demo");
    assert.equal(hydrated.atoms[0].scriptAtom, "`A::script::S001` 熟悉经验钩子槽 -> 本方案落地");
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test("slot atom display hydration rebuilds stale bare atom id summary from display json", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "bd-slot-display-bare-atom-"));
  try {
    const displayPath = path.join(rootDir, "Artifacts", "FunctionSlotRestructure", "demo", "restructure.display.json");
    await fs.mkdir(path.dirname(displayPath), { recursive: true });
    await fs.writeFile(displayPath, JSON.stringify({
      schemaVersion: "function_slot_restructure_display.v1",
      sections: {
        finalSlotChain: {
          title: "2. 最终功能槽位链",
          items: [
            { type: "paragraph", text: "## 槽位链" },
            {
              type: "table",
              rows: [{ "顺序": "1", slotSubtype: "`SUB_demo` 熟悉经验钩子槽" }],
            },
          ],
        },
        atomLandingTable: {
          title: "3. Atoms 落地表",
          items: [
            {
              type: "table",
              rows: [{
                "槽位": "`SUB_demo`",
                "script atom": "`A::script::S001`",
                "script atom 原标签 -> 本方案落地": "`A::script::S001` 熟悉经验钩子槽 -> 本方案落地为早餐豆浆熟悉需求入口",
              }],
            },
          ],
        },
      },
    }), "utf8");

    const hydrated = await hydrateSlotAtomDisplay({
      schemaVersion: "function_slot_restructure_slot_atom_display.v1",
      status: "available",
      displayJsonPath: "Artifacts/FunctionSlotRestructure/demo/restructure.display.json",
      slotCount: 1,
      atomBindingCount: 1,
      selectedSlotSubtypeId: "SUB_demo",
      slots: [{ slotSubtypeId: "SUB_demo", slotSubtype: "`SUB_demo` 熟悉经验钩子槽" }],
      atoms: [{ slotSubtypeId: "SUB_demo", scriptAtom: "`A::script::S001`" }],
    }, { rootDir });

    assert.equal(hydrated.slotCount, 1);
    assert.equal(hydrated.atoms[0].scriptAtom, "`A::script::S001` 熟悉经验钩子槽 -> 本方案落地为早餐豆浆熟悉需求入口");
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});
