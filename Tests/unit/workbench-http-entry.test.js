const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

test("workbench pages force HTTP entry points", () => {
  const root = path.resolve(__dirname, "../..");
  const index = fs.readFileSync(path.join(root, "Apps/Workbench/index.html"), "utf8");
  const debug = fs.readFileSync(path.join(root, "Apps/Workbench/debug.html"), "utf8");
  const fullAnalysis = fs.readFileSync(path.join(root, "Apps/Workbench/full-analysis.html"), "utf8");
  const library = fs.readFileSync(path.join(root, "Apps/Workbench/library.html"), "utf8");
  const threadpool = fs.readFileSync(path.join(root, "Apps/Workbench/threadpool.html"), "utf8");

  assert.match(index, /location\.protocol === "file:"/);
  assert.match(index, /http:\/\/127\.0\.0\.1:5177\//);
  assert.match(index, /\/src\/main\.tsx/);
  assert.match(debug, /location\.protocol === "file:"/);
  assert.match(debug, /http:\/\/127\.0\.0\.1:5177\//);
  assert.match(debug, /\/src\/debug\.tsx/);
  assert.match(fullAnalysis, /location\.protocol === "file:"/);
  assert.match(fullAnalysis, /http:\/\/127\.0\.0\.1:5177\/full-analysis\.html/);
  assert.match(fullAnalysis, /\/src\/full-analysis\.tsx/);
  assert.match(library, /location\.protocol === "file:"/);
  assert.match(library, /http:\/\/127\.0\.0\.1:5177\/library\.html/);
  assert.match(library, /\/src\/library\.tsx/);
  assert.match(threadpool, /location\.protocol === "file:"/);
  assert.match(threadpool, /http:\/\/127\.0\.0\.1:5177\/threadpool\.html/);
  assert.match(threadpool, /\/src\/threadpool\.tsx/);
  assert.doesNotMatch(index, /href="\/debug"/);
  assert.doesNotMatch(debug, /href="\/"/);
});
