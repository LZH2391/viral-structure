const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

test("workbench pages force HTTP entry points", () => {
  const root = path.resolve(__dirname, "../..");
  const index = fs.readFileSync(path.join(root, "Apps/Workbench/index.html"), "utf8");
  const debug = fs.readFileSync(path.join(root, "Apps/Workbench/debug.html"), "utf8");

  assert.match(index, /location\.protocol === "file:"/);
  assert.match(index, /http:\/\/127\.0\.0\.1:5177\//);
  assert.match(index, /\/src\/main\.tsx/);
  assert.match(debug, /location\.protocol === "file:"/);
  assert.match(debug, /http:\/\/127\.0\.0\.1:5177\//);
  assert.match(debug, /\/src\/debug\.tsx/);
  assert.doesNotMatch(index, /href="\/debug"/);
  assert.doesNotMatch(debug, /href="\/"/);
});
