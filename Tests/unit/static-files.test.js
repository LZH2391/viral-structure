const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { resolveWorkbenchPath, contentType } = require("../../Apps/Api/lib/static-files");

test("serves workbench and debug pages from HTTP routes", () => {
  const root = path.resolve(__dirname, "../../Apps/Workbench");
  assert.equal(resolveWorkbenchPath(root, "/"), path.join(root, "index.html"));
  assert.equal(resolveWorkbenchPath(root, "/debug"), path.join(root, "debug.html"));
  assert.equal(resolveWorkbenchPath(root, "/scripts/debug-page.js"), path.join(root, "scripts", "debug-page.js"));
  assert.equal(resolveWorkbenchPath(root, "/../AGENTS.md"), null);
});

test("sets browser content types for workbench assets", () => {
  assert.equal(contentType("index.html"), "text/html; charset=utf-8");
  assert.equal(contentType("styles.css"), "text/css; charset=utf-8");
  assert.equal(contentType("debug-page.js"), "application/javascript; charset=utf-8");
});
