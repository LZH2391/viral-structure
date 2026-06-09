const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const vm = require("node:vm");

function loadAnalysisHomeHelpers() {
  const root = path.resolve(__dirname, "../..");
  const source = fs.readFileSync(path.join(root, "Apps/Workbench/src/components/new-ui/AnalysisHome.tsx"), "utf8");
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
    Set,
  });
  return module.exports;
}

const { createUploadingQueueItems, mergeLocalQueueItems } = loadAnalysisHomeHelpers();

test("analysis upload queue shows local uploading items with file names", () => {
  const localItems = createUploadingQueueItems([
    { name: "缺失6 - 副本.mp4" },
    { name: "缺失3.mp4" },
  ], "materialRecognition", 7);

  assert.equal(localItems.length, 2);
  assert.equal(localItems[0].title, "缺失6 - 副本");
  assert.equal(localItems[0].badgeLabel, "上传中");
  assert.equal(localItems[0].workflowKey, "material-recognition");

  const merged = mergeLocalQueueItems(localItems, [{
    key: "existing",
    status: "done",
    thumbnailUrl: null,
    ratio: "cinema",
    badgeLabel: "已完成",
    title: "缺失1",
    historyItem: null,
  }]);

  assert.equal(merged[0].key, "local_upload_7_0");
  assert.equal(merged[1].key, "local_upload_7_1");
  assert.equal(merged[2].key, "existing");
});
