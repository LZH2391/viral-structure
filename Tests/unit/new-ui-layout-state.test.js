const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("analysis workflow reveal key is stable across stage artifact updates", () => {
  const root = path.resolve(__dirname, "../..");
  const source = fs.readFileSync(path.join(root, "Apps/Workbench/src/components/new-ui/NewUiLayout.tsx"), "utf8");
  const match = source.match(/const analysisWorkflowRevealKey =[\s\S]*?: null;/);

  assert.ok(match);
  assert.match(match[0], /sampleVideoId/);
  assert.match(match[0], /workflowRunId/);
  assert.doesNotMatch(match[0], /artifactId/);
});
