const test = require("node:test");
const assert = require("node:assert/strict");
const { planFrameTimestamps, planFrameTimestampSampling } = require("../../Core/Workspace/frame-timestamps");

test("plans timestamps from zero with a fixed interval", () => {
  assert.deepEqual(planFrameTimestamps(2, { frameSampleRateFps: 1 }), [0, 1]);
  assert.deepEqual(planFrameTimestamps(2, { frameSampleRateFps: 3 }), [0, 0.333, 0.667, 1, 1.333, 1.667]);
  assert.equal(planFrameTimestamps(5, { frameSampleRateFps: 1 }).length, 5);
  assert.equal(planFrameTimestamps(1000, { frameSampleRateFps: 10 }).length, 6000);
});

test("covers the full duration explicitly when maxFrames caps fixed fps extraction", () => {
  const sampling = planFrameTimestampSampling(60, { frameSampleRateFps: 3, maxFrames: 120 });
  assert.equal(sampling.timestamps.length, 120);
  assert.equal(sampling.cappedByMaxFrames, true);
  assert.equal(sampling.samplingPolicy, "capped_target_grid_cover_full_duration");
  assert.equal(sampling.timestamps[0], 0);
  assert.equal(sampling.timestamps.at(-1), 59.999);
});

test("default maxFrames no longer caps moderate high-fps uploads to 120", () => {
  const sampling = planFrameTimestampSampling(18.9, { frameSampleRateFps: 10 });
  assert.equal(sampling.maxFrames, 6000);
  assert.equal(sampling.cappedByMaxFrames, false);
  assert.equal(sampling.targetFrameCount, 189);
  assert.equal(sampling.timestamps.length, 189);
  assert.equal(sampling.timestamps.at(-1), 18.8);
});

test("handles invalid duration", () => {
  assert.deepEqual(planFrameTimestamps(0), [0]);
});
