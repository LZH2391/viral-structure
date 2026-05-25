const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { resolveWorkbenchPath, contentType } = require("../../Apps/Api/lib/static-files");

test("serves workbench and debug pages from HTTP routes", () => {
  const root = path.resolve(__dirname, "../../Apps/Workbench");
  assert.equal(resolveWorkbenchPath(root, "/"), path.join(root, "index.html"));
  assert.equal(resolveWorkbenchPath(root, "/full-analysis"), path.join(root, "index.html"));
  assert.equal(resolveWorkbenchPath(root, "/full-analysis/"), path.join(root, "index.html"));
  assert.equal(resolveWorkbenchPath(root, "/full-analysis.html"), path.join(root, "full-analysis.html"));
  assert.equal(resolveWorkbenchPath(root, "/debug"), path.join(root, "debug.html"));
  assert.equal(resolveWorkbenchPath(root, "/library"), path.join(root, "index.html"));
  assert.equal(resolveWorkbenchPath(root, "/library/"), path.join(root, "index.html"));
  assert.equal(resolveWorkbenchPath(root, "/library.html"), path.join(root, "library.html"));
  assert.equal(resolveWorkbenchPath(root, "/threadpool"), path.join(root, "index.html"));
  assert.equal(resolveWorkbenchPath(root, "/threadpool/"), path.join(root, "index.html"));
  assert.equal(resolveWorkbenchPath(root, "/threadpool.html"), path.join(root, "threadpool.html"));
  assert.equal(resolveWorkbenchPath(root, "/assets/index-abc.js"), path.join(root, "assets", "index-abc.js"));
  assert.equal(resolveWorkbenchPath(root, "/src/main.tsx"), path.join(root, "src", "main.tsx"));
  assert.equal(resolveWorkbenchPath(root, "/app.js"), null);
  assert.equal(resolveWorkbenchPath(root, "/scripts/debug-page.js"), null);
  assert.equal(resolveWorkbenchPath(root, "/../AGENTS.md"), null);
});

test("sets browser content types for workbench assets", () => {
  assert.equal(contentType("index.html"), "text/html; charset=utf-8");
  assert.equal(contentType("styles.css"), "text/css; charset=utf-8");
  assert.equal(contentType("debug-page.js"), "application/javascript; charset=utf-8");
});
