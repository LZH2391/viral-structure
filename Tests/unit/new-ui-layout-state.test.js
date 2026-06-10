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

test("restructure plan actions prefer selected slot atom version paths", () => {
  const root = path.resolve(__dirname, "../..");
  const source = fs.readFileSync(path.join(root, "Apps/Workbench/src/components/new-ui/NewUiLayout.tsx"), "utf8");
  const planTraceHandler = source.match(/const handleOpenPlanTraceFromRestructureMessage =[\s\S]*?\n  \}, \[[^\n]+\]\);/);
  const confirmHandler = source.match(/const handleConfirmPlanFromRestructureMessage =[\s\S]*?\n  \}, \[[^\n]+\]\);/);

  assert.ok(planTraceHandler);
  assert.ok(confirmHandler);
  assert.match(planTraceHandler[0], /resolvePlanTracePreviewInput\(message\.slotAtomDisplay \?\? null/);
  assert.match(planTraceHandler[0], /activeSlotAtomDisplay\?\.rootRestructureFinalPath/);
  assert.match(planTraceHandler[0], /displayJsonPath: planTraceInput\.multiVersion \? null : displayJsonPath/);
  assert.match(confirmHandler[0], /activeSlotAtomDisplay\?\.sourceRestructureFinalPath \?\? resolveCurrentRestructureFinalPath/);
});

test("restructure confirmed state can match multi-version display paths", () => {
  const root = path.resolve(__dirname, "../..");
  const source = fs.readFileSync(path.join(root, "Apps/Workbench/src/components/new-ui/NewUiRestructureWorkspace.tsx"), "utf8");
  const resolver = source.match(/function resolveMessageConfirmedRestructurePath[\s\S]*?\n}\n\nfunction normalizeComparablePath/);
  const confirmedCheck = source.match(/function isMessagePlanConfirmed[\s\S]*?\n}\n\nfunction resolveMessageConfirmedRestructurePath/);

  assert.ok(resolver);
  assert.ok(confirmedCheck);
  assert.match(confirmedCheck[0], /resolveMessageConfirmedRestructurePath\(message, confirmed\.sourceRestructurePath\)/);
  assert.match(resolver[0], /message\.slotAtomDisplay\?\.versionDisplays/);
  assert.match(resolver[0], /display\?\.sourceRestructureFinalPath/);
  assert.match(resolver[0], /displayPaths\.includes\(confirmed\)/);
});
