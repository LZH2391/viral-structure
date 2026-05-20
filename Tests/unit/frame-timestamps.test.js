const test = require("node:test");
const assert = require("node:assert/strict");
const { planFrameTimestamps } = require("../../Core/Workspace/frame-timestamps");

test("plans timestamps with stable min and max frame count", () => {
  assert.deepEqual(planFrameTimestamps(8), [0, 7.9]);
  assert.equal(planFrameTimestamps(120).length, 30);
  assert.equal(planFrameTimestamps(5, { frameSampleRateFps: 1 }).length, 5);
  assert.equal(planFrameTimestamps(1000, { frameSampleRateFps: 2 }).length, 120);
});

test("handles invalid duration", () => {
  assert.deepEqual(planFrameTimestamps(0), [0]);
});
