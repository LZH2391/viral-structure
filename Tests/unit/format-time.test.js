const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

function loadFormatModule(root) {
  const file = path.join(root, "Apps/Workbench/src/utils/format.ts");
  const source = fs.readFileSync(file, "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const module = { exports: {} };
  new Function("exports", "module", output)(module.exports, module);
  return module.exports;
}

test("precise time keeps sub-second detail for audio marker inspection", () => {
  const root = path.resolve(__dirname, "../..");
  const { formatPreciseTime } = loadFormatModule(root);

  assert.equal(formatPreciseTime(7.4304, 3), "00:07.430");
  assert.equal(formatPreciseTime(67.987, 2), "01:07.98");
  assert.equal(formatPreciseTime(null, 2), "00:00.00");
});
