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
    skill: "function-slot-restructure",
    chatOnly: true,
  },
  {
    role: "function-slot-restructure-display-transformer",
    templateId: "transform",
    skill: "function-slot-restructure-display-transformer",
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
    if (item.chatOnly) {
      assert.equal(profile.turnTemplates?.restructure, undefined);
      continue;
    }

    const rendered = renderTurnTemplate(profile, item.templateId, {});
    if (item.role === "shot-storyboard-prep") {
      assert.match(rendered.text, /后处理任务/);
      assert.match(rendered.text, /restructure\.final\.md/);
    } else if (item.role === "function-slot-restructure-display-transformer") {
      assert.match(rendered.text, /后处理任务/);
      assert.match(rendered.text, /restructure\.final\.md/);
      assert.match(rendered.text, /第 1、2、3、5、6、7 节/);
    } else {
      assert.match(rendered.text, /ThreadPool 占位任务/);
      assert.match(rendered.text, /占位语义/);
    }
    assert.equal(rendered.promptTemplateVersion.endsWith(".placeholder.v1"), true);
  }
});
