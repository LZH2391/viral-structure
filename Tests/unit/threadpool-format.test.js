const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

test("threadpool context usage formatting covers empty, normal, warn, and danger", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../../Apps/Workbench/src/utils/threadpoolFormat.ts"), "utf8");
  assert.match(source, /ctx -/);
  assert.match(source, /percent >= 90 \? "danger" : percent >= 70 \? "warn" : "normal"/);
  assert.match(source, /ctx \$\{Number\(latest\)\} \/ \$\{Number\(threshold\)\} \(\$\{percent\}%\)/);
});
