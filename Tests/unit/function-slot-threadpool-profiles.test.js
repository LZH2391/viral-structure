const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { loadRoleProfileByRole, renderTurnTemplate } = require("../../Apps/Api/lib/gateways/threadpool/role-profile-loader");
const { DEFAULT_ALLOWED_ROLES } = require("../../Apps/Api/lib/gateways/threadpool/proxy");

const ROLES = [
  {
    role: "function-slot-library-builder",
    templateId: "semanticGovernance",
    skill: "function-slot-library-builder",
  },
  {
    role: "function-slot-restructure",
    templateId: "manualReplacement",
    skill: "function-slot-restructure",
  },
  {
    role: "function-slot-restructure-display-transformer",
    templateId: "transform",
    skill: "function-slot-restructure-display-transformer",
  },
  {
    role: "function-slot-dialogue-robotic-reviewer",
    templateId: "review",
    skill: "function-slot-dialogue-robotic-reviewer",
  },
  {
    role: "shot-storyboard-prep",
    templateId: "prepareStoryboard",
    skill: "shot-storyboard-prep",
  },
];

test("function slot placeholder roles are registered for ThreadPool", () => {
  const root = path.resolve(__dirname, "../..");
  const config = JSON.parse(fs.readFileSync(path.join(root, "Infrastructure", "ThreadPool", "thread_roles.json"), "utf8"));
  for (const item of ROLES) {
    assert.ok(config.roles[item.role], `${item.role} should be in thread_roles.json`);
    assert.equal(config.roles[item.role].min_idle, 3);
    assert.ok(DEFAULT_ALLOWED_ROLES.includes(item.role), `${item.role} should be allowed by ThreadPool proxy`);
  }
  assert.equal(config.roles["function-slot-restructure"].discard_on_release, false);
});

test("function slot placeholder role profiles load init and task prompts", async () => {
  for (const item of ROLES) {
    const profile = await loadRoleProfileByRole(item.role);

    assert.equal(profile.role, item.role);
    assert.equal(profile.skillPath?.split(/[\\/]/).slice(-2).join("/"), `${item.skill}/SKILL.md`);
    assert.match(profile.init.templateBody, /已就绪/);
    const rendered = renderTurnTemplate(profile, item.templateId, defaultTemplateValues(item.role));
    if (item.role === "shot-storyboard-prep") {
      assert.match(rendered.text, /后处理任务/);
      assert.match(rendered.text, /restructure\.final\.md/);
      assert.match(rendered.text, /image-generation/);
      const repairTurn = renderTurnTemplate(profile, "repairTurn", {
        repairAttemptCount: 1,
        restructureFinalPath: "Artifacts/FunctionSlotRestructure/demo/restructure.final.md",
        shotDesignFinalPath: "Artifacts/FunctionSlotRestructure/demo/shot-design.final.md",
        repairedPath: "Artifacts/FunctionSlotRestructure/demo/shot-design.final.repair-attempt-1.md",
        errorCode: "storyboard_prep_manifest_count_mismatch",
        errorMessage: "generatedShotCount 与 manifest 不一致",
        validationErrorsJson: JSON.stringify([{ code: "missing_strategy", shotId: "new_shot_01" }]),
        repairRequestJson: JSON.stringify({
          schemaVersion: "shot-storyboard-prep.repair.v1",
          allowedRepairs: ["补齐 Shot 表字段"],
          forbiddenRepairs: ["不得修改已确认的 restructure.final.md"],
        }),
      });
      assert.match(repairTurn.text, /agentRepair/);
      assert.match(repairTurn.text, /shot-design\.final\.repair-attempt-1\.md/);
      assert.match(repairTurn.text, /generatedShotCount 与 manifest 不一致/);
      assert.match(repairTurn.text, /不得修改已确认的 `restructure\.final\.md`/);
      assert.match(repairTurn.text, /不得手工调用 image-generation/);
      assert.equal(repairTurn.promptTemplateVersion, "repair-storyboard.v1");
    } else if (item.role === "function-slot-restructure-display-transformer") {
      assert.match(rendered.text, /后处理任务/);
      assert.match(rendered.text, /restructure\.final\.md/);
      assert.match(rendered.text, /第 1、2、3、5、6、7 节/);
      const repairValues = {
        repairAttemptCount: 1,
        restructureFinalPath: "Artifacts/FunctionSlotRestructure/spray-pump-floral-water/restructure.final.md",
        restructureArtifactId: "turn_1",
        parentArtifactId: "parent_1",
        sourceTurnId: "display_turn_1",
        stageName: "function.slot.restructure_display.materialize",
        errorCode: "display_json_schema_invalid",
        errorMessage: "展示转换 JSON 校验失败",
        debugSnapshotUri: "/runtime/DebugSnapshots/snapshot.json",
        validationErrorsJson: JSON.stringify(["table row has 3 cells, expected 4"]),
        repairTargetsJson: JSON.stringify([{ sectionKey: "finalSlotChain", line: 12, blockType: "table" }]),
        repairedPath: "Artifacts/FunctionSlotRestructure/spray-pump-floral-water/restructure.final.repair-attempt-1.md",
        scriptInputJson: JSON.stringify({
          restructureFinalPath: "Artifacts/FunctionSlotRestructure/spray-pump-floral-water/restructure.final.md",
          repairedPath: "Artifacts/FunctionSlotRestructure/spray-pump-floral-water/restructure.final.repair-attempt-1.md",
        }),
        sourceSnippet: "| 顺序 | 需求 |\n|---|---|\n| 1 | 喷泵亮相 | 多余列 |",
      };
      const repairTurn = renderTurnTemplate(profile, "repairTurn", repairValues);
      const repairAlias = renderTurnTemplate(profile, "repair", repairValues);
      assert.match(repairTurn.text, /agentRepair/);
      assert.match(repairTurn.text, /展示转换 JSON 校验失败/);
      assert.match(repairTurn.text, /display_json_schema_invalid/);
      assert.match(repairTurn.text, /table row has 3 cells/);
      assert.match(repairTurn.text, /只做格式修复/);
      assert.match(repairTurn.text, /直接修改或创建/);
      assert.match(repairTurn.text, /finalMessage 只返回简短中文状态/);
      assert.match(repairTurn.text, /restructure\.final\.repair-attempt-1\.md/);
      assert.match(repairTurn.text, /snapshot\.json/);
      assert.match(repairTurn.text, /spray-pump-floral-water/);
      assert.equal(repairTurn.promptTemplateVersion, "repair-turn.v2");
      assert.equal(repairAlias.promptTemplateVersion, "repair-turn.v2");
    } else if (item.role === "function-slot-dialogue-robotic-reviewer") {
      assert.match(rendered.text, /台词机器人感审查任务/);
      assert.match(rendered.text, /shot-design\.final\.md/);
      assert.match(rendered.text, /finalMessage 只返回 JSON object/);
      assert.match(rendered.text, /不判断素材是否够用/);
      assert.equal(rendered.promptTemplateVersion, "review.v1");
    } else if (item.role === "function-slot-restructure") {
      assert.match(rendered.text, /手动 Slot\/Atom 替换返工任务/);
      assert.match(rendered.text, /低门槛价值锚点/);
      assert.match(rendered.text, /强痛点场景进入/);
      assert.match(rendered.text, /先说明影响并请求用户确认/);
      assert.match(rendered.text, /不要直接编辑 `restructure\.display\.json`/);
      assert.equal(rendered.promptTemplateVersion, "manual-replacement.v1");
    } else if (item.role === "function-slot-library-builder") {
      assert.match(rendered.text, /FunctionSlotLibrary 语义治理 Agent/);
      assert.match(rendered.text, /slot_index/);
      assert.match(rendered.text, /semantic-governance\.v1\.json/);
    } else {
      assert.match(rendered.text, /ThreadPool 占位任务/);
      assert.match(rendered.text, /占位语义/);
    }
    if (!["function-slot-library-builder", "function-slot-restructure", "function-slot-dialogue-robotic-reviewer"].includes(item.role)) {
      assert.equal(rendered.promptTemplateVersion.endsWith(".placeholder.v1"), true);
    }
  }
});

test("shot design skill does not expose dialogue reviewer role identity", () => {
  const root = path.resolve(__dirname, "../..");
  const shotDesignSkillDir = path.join(root, ".agents", "skills", "function-slot-shot-design");
  const files = [
    path.join(shotDesignSkillDir, "SKILL.md"),
    path.join(shotDesignSkillDir, "references", "output-contract.md"),
    path.join(shotDesignSkillDir, "references", "dialogue-and-packaging.md"),
  ];
  const content = files.map((file) => fs.readFileSync(file, "utf8")).join("\n");

  assert.doesNotMatch(content, /function-slot-dialogue-robotic-reviewer/);
  assert.doesNotMatch(content, /dialogue-robotic-reviewer/);
});

test("shot design packaging contract requires real main subtitle text", () => {
  const root = path.resolve(__dirname, "../..");
  const shotDesignSkillDir = path.join(root, ".agents", "skills", "function-slot-shot-design");
  const content = [
    path.join(shotDesignSkillDir, "SKILL.md"),
    path.join(shotDesignSkillDir, "references", "output-contract.md"),
    path.join(shotDesignSkillDir, "references", "dialogue-and-packaging.md"),
  ].map((file) => fs.readFileSync(file, "utf8")).join("\n");

  assert.match(content, /主字幕样式/);
  assert.match(content, /真实会出现的主字幕文案/);
  assert.match(content, /不能只写纯样式|没有字幕内容的样式描述/);
});

function defaultTemplateValues(role) {
  if (role === "function-slot-library-builder") {
    return {
      slotIndexPath: "Runtime/Temp/FunctionSlotLibrary/slot_index.json",
      governancePath: "Artifacts/FunctionSlotLibrary/_governance/semantic-governance.v1.json",
      semanticProtocolPath: "Docs/Architecture/FunctionSlotSemanticGovernance.md",
      atomBindingRuleProtocolPath: "Docs/Architecture/FunctionSlotAtomBindingRuleGovernance.md",
      outputFormatPath: "Docs/Architecture/FunctionSlotSemanticGovernanceOutput.md",
      coverageSummaryJson: JSON.stringify({ slotCount: 1 }),
    };
  }
  if (role === "function-slot-restructure") {
    return {
      sourceRestructureFinalPath: "Artifacts/FunctionSlotRestructure/demo/restructure.final.md",
      sourceDisplayJsonPath: "Artifacts/FunctionSlotRestructure/demo/restructure.display.json",
      displayFingerprintJson: JSON.stringify({ path: "Artifacts/FunctionSlotRestructure/demo/restructure.final.md", sha256: "abc" }),
      replacementSummary: "Slot 1 低门槛价值锚点 -> 强痛点场景进入",
      replacementsJson: JSON.stringify([{ type: "slot", fromSlotLabel: "低门槛价值锚点", toSlotLabel: "强痛点场景进入" }]),
      userInstruction: "用户手动替换了上述 Slot/Atom。请根据替换后的结构重新设计；如果替换破坏链路逻辑、素材能力、binding rule 或证明路径，必须先说明影响并请求用户确认，不要直接重写最终方案。",
    };
  }
  if (role === "function-slot-dialogue-robotic-reviewer") {
    return {
      shotDesignFinalPath: "Artifacts/FunctionSlotRestructure/demo/shot-design.final.md",
      reviewOutputPath: "Artifacts/FunctionSlotRestructure/demo/dialogue-robotic-review.final.json",
      artifactId: "artifact_review",
      parentArtifactId: "turn_shot_design",
      sourceTurnId: "turn_shot_design",
      stageName: "function.slot.dialogue_robotic_review.auto_review",
      fileFingerprintJson: JSON.stringify({ path: "Artifacts/FunctionSlotRestructure/demo/shot-design.final.md", sha256: "abc" }),
    };
  }
  return {};
}
