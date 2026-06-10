const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function sliceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `expected to find ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `expected to find ${end}`);
  return source.slice(startIndex, endIndex);
}

test("analysis workflow reveal key is stable across stage artifact updates", () => {
  const root = path.resolve(__dirname, "../..");
  const source = fs.readFileSync(path.join(root, "Apps/Workbench/src/components/new-ui/NewUiLayoutRoot.tsx"), "utf8");
  const match = source.match(/const analysisWorkflowRevealKey =[\s\S]*?: null;/);

  assert.ok(match);
  assert.match(match[0], /sampleVideoId/);
  assert.match(match[0], /workflowRunId/);
  assert.doesNotMatch(match[0], /artifactId/);
});

test("restructure plan actions prefer selected slot atom version paths", () => {
  const root = path.resolve(__dirname, "../..");
  const source = fs.readFileSync(path.join(root, "Apps/Workbench/src/components/new-ui/NewUiLayoutRoot.tsx"), "utf8");
  const planTraceHandler = sliceBetween(source, "const handleOpenPlanTraceFromRestructureMessage", "const handleConfirmPlanFromRestructureMessage");
  const confirmHandler = sliceBetween(source, "const handleConfirmPlanFromRestructureMessage", "const handleAutoAdvanceFromCurrentSlot");

  assert.match(planTraceHandler, /resolvePlanTracePreviewInput\(message\.slotAtomDisplay \?\? null/);
  assert.match(planTraceHandler, /activeSlotAtomDisplay\?\.rootRestructureFinalPath/);
  assert.match(planTraceHandler, /displayJsonPath: planTraceInput\.multiVersion \? null : displayJsonPath/);
  assert.match(confirmHandler, /activeSlotAtomDisplay\?\.sourceRestructureFinalPath \?\? resolveCurrentRestructureFinalPath/);
});

test("restructure confirmed state can match multi-version display paths", () => {
  const root = path.resolve(__dirname, "../..");
  const source = fs.readFileSync(path.join(root, "Apps/Workbench/src/components/new-ui/restructureWorkspaceStoryboard.ts"), "utf8");
  const resolver = sliceBetween(source, "export function resolveMessageConfirmedRestructurePath", "function normalizeComparablePath");
  const confirmedCheck = sliceBetween(source, "export function isMessagePlanConfirmed", "export function resolveMessageConfirmedRestructurePath");

  assert.match(confirmedCheck, /resolveMessageConfirmedRestructurePath\(message, confirmed\.sourceRestructurePath\)/);
  assert.match(resolver, /message\.slotAtomDisplay\?\.versionDisplays/);
  assert.match(resolver, /display\?\.sourceRestructureFinalPath/);
  assert.match(resolver, /displayPaths\.includes\(confirmed\)/);
});
