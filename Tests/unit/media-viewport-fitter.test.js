const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

function fitMediaViewport(input) {
  const viewportWidth = positive(input.viewportWidth);
  const viewportHeight = positive(input.viewportHeight);
  const leftPanelWidth = nonNegative(input.leftPanelWidth);
  const rightPanelWidth = nonNegative(input.rightPanelWidth);
  const timelineHeight = nonNegative(input.timelineHeight);
  const mediaWidth = positive(input.mediaWidth, 16);
  const mediaHeight = positive(input.mediaHeight, 9);
  const stageWidth = Math.max(1, viewportWidth - leftPanelWidth - rightPanelWidth);
  const stageHeight = Math.max(1, viewportHeight - timelineHeight);
  const stageRatio = stageWidth / stageHeight;
  const mediaRatio = mediaWidth / mediaHeight;
  const contentWidth = mediaRatio > stageRatio ? stageWidth : stageHeight * mediaRatio;
  const contentHeight = mediaRatio > stageRatio ? stageWidth / mediaRatio : stageHeight;
  const horizontal = Math.max(0, (stageWidth - contentWidth) / 2);
  const vertical = Math.max(0, (stageHeight - contentHeight) / 2);
  return {
    stageWidth: round(stageWidth),
    stageHeight: round(stageHeight),
    contentWidth: round(contentWidth),
    contentHeight: round(contentHeight),
    letterboxInsets: {
      top: round(vertical),
      right: round(horizontal),
      bottom: round(vertical),
      left: round(horizontal),
    },
  };
}

test("fits 9:16, 16:9, 1:1 and ultra-tall media without cropping", () => {
  const baselinePath = path.resolve(__dirname, "../fixtures/media-viewport-screenshot-baselines.json");
  const baselines = JSON.parse(fs.readFileSync(baselinePath, "utf8"));

  for (const baseline of baselines) {
    const fit = fitMediaViewport(baseline);
    assert.equal(fit.stageWidth, baseline.expected.stageWidth, baseline.name);
    assert.equal(fit.stageHeight, baseline.expected.stageHeight, baseline.name);
    assert.equal(fit.contentWidth, baseline.expected.contentWidth, baseline.name);
    assert.equal(fit.contentHeight, baseline.expected.contentHeight, baseline.name);
    assert.ok(fit.contentWidth <= fit.stageWidth, baseline.name);
    assert.ok(fit.contentHeight <= fit.stageHeight, baseline.name);
    assert.ok(fit.letterboxInsets.left >= 0, baseline.name);
    assert.ok(fit.letterboxInsets.top >= 0, baseline.name);
  }
});

test("keeps media visible when panels and timeline consume space", () => {
  const fit = fitMediaViewport({
    viewportWidth: 760,
    viewportHeight: 620,
    leftPanelWidth: 0,
    rightPanelWidth: 0,
    timelineHeight: 132,
    mediaWidth: 1080,
    mediaHeight: 1920,
  });

  assert.equal(fit.stageWidth, 760);
  assert.equal(fit.stageHeight, 488);
  assert.equal(fit.contentHeight, 488);
  assert.equal(fit.contentWidth, 274.5);
});

test("React media viewport utility keeps the same fitter contract", () => {
  const root = path.resolve(__dirname, "../..");
  const source = fs.readFileSync(path.join(root, "Apps/Workbench/src/utils/mediaViewport.ts"), "utf8");
  const preview = fs.readFileSync(path.join(root, "Apps/Workbench/src/components/PreviewPanel.tsx"), "utf8");

  assert.match(source, /export function fitMediaViewport/);
  assert.match(source, /letterboxInsets/);
  assert.match(preview, /fitMediaViewport/);
  assert.match(preview, /useElementSize/);
});

function positive(value, fallback = 1) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function nonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function round(value) {
  return Math.round(value * 100) / 100;
}
