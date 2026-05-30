const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

test("restructure path helpers extract and normalize relative paths", () => {
  const helpers = loadTsModule("Apps/Workbench/src/utils/restructurePath.ts");
  assert.equal(
    helpers.normalizeRestructureFinalPath("C:/ByteDanceFullStack/Artifacts/FunctionSlotRestructure/spray-pump-floral-water/restructure.final.md"),
    "Artifacts/FunctionSlotRestructure/spray-pump-floral-water/restructure.final.md",
  );
  assert.equal(
    helpers.extractRestructureFinalPath("已生成：[restructure.final.md](/C:/ByteDanceFullStack/Artifacts/FunctionSlotRestructure/spray-pump-floral-water/restructure.final.md)"),
    "C:/ByteDanceFullStack/Artifacts/FunctionSlotRestructure/spray-pump-floral-water/restructure.final.md",
  );
});

function loadTsModule(relativePath) {
  const sourcePath = path.join(process.cwd(), relativePath);
  const source = fs.readFileSync(sourcePath, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} };
  const execute = new Function("module", "exports", compiled);
  execute(module, module.exports);
  return module.exports;
}
