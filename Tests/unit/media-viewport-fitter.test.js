const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { fitMediaViewport } = require("../../Apps/Workbench/scripts/media-viewport-fitter");

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
