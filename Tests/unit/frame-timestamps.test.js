const test = require("node:test");
const assert = require("node:assert/strict");
const { planFrameTimestamps } = require("../../Core/Workspace/frame-timestamps");

test("plans timestamps with stable min and max frame count", () => {
  assert.deepEqual(planFrameTimestamps(8), [0, 2.667, 5.333, 7.9]);
  assert.equal(planFrameTimestamps(120).length, 12);
});

test("handles invalid duration", () => {
  assert.deepEqual(planFrameTimestamps(0), [0]);
});
