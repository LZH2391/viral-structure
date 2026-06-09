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
