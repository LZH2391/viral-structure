const test = require("node:test");
const assert = require("node:assert/strict");
const { planFrameTimestamps } = require("../../Core/Workspace/frame-timestamps");

test("plans timestamps from zero with a fixed interval", () => {
  assert.deepEqual(planFrameTimestamps(2, { frameSampleRateFps: 1 }), [0, 1]);
  assert.deepEqual(planFrameTimestamps(2, { frameSampleRateFps: 3 }), [0, 0.333, 0.667, 1, 1.333, 1.667]);
  assert.equal(planFrameTimestamps(5, { frameSampleRateFps: 1 }).length, 5);
  assert.equal(planFrameTimestamps(1000, { frameSampleRateFps: 10 }).length, 120);
});

test("handles invalid duration", () => {
  assert.deepEqual(planFrameTimestamps(0), [0]);
});
