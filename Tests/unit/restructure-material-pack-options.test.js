const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const vm = require("node:vm");

function loadNewUiLayoutHelpers() {
  const root = path.resolve(__dirname, "../..");
  const source = fs.readFileSync(path.join(root, "Apps/Workbench/src/components/new-ui/NewUiLayout.tsx"), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  });
  const module = { exports: {} };
  vm.runInNewContext(compiled.outputText, {
    module,
    exports: module.exports,
    require: () => ({}),
    Map,
    Set,
  });
  return module.exports;
}

const {
  mergeMaterialPackOptions,
  replacePendingMaterialPackSelection,
  upsertMaterialPackOption,
} = loadNewUiLayoutHelpers();

test("material pack option merge keeps completed result over pending placeholder", () => {
  const pending = {
    sampleVideoId: "pending:batch_1:batch_item_1",
    artifactId: null,
    title: "缺失6 - 副本 - 副本",
    pending: true,
  };
  const ready = {
    sampleVideoId: "sample_missing_6_copy_copy",
    artifactId: "artifact_user_material_pack",
    title: "缺失6_-_副本_-_副本",
    resultUri: "/runtime/user-material-pack.stable.json",
  };

  const upserted = upsertMaterialPackOption([ready], pending);
  assert.equal(upserted.length, 1);
  assert.equal(upserted[0].artifactId, "artifact_user_material_pack");
  assert.equal(upserted[0].pending, undefined);

  const merged = mergeMaterialPackOptions([pending], [ready]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].artifactId, "artifact_user_material_pack");
  assert.equal(merged[0].pending, undefined);
  assert.equal(replacePendingMaterialPackSelection(pending, [ready]), ready);
});
