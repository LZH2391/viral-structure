const test = require("node:test");
const assert = require("node:assert/strict");
const { validateUploadFile, validateDuration, normalizeFrameSampleRateFps } = require("../../Core/Workspace/sample-video-validation");

test("accepts common video upload", () => {
  const result = validateUploadFile({ extension: ".mp4", mimeType: "video/mp4", size: 1024 });
  assert.equal(result.ok, true);
});

test("rejects invalid file type", () => {
  const result = validateUploadFile({ extension: ".txt", mimeType: "text/plain", size: 1024 });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "invalid_file_type");
});

test("rejects duration above limit", () => {
  const result = validateDuration(601);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "duration_too_long");
});

test("normalizes frame sample rate", () => {
  assert.equal(normalizeFrameSampleRateFps(undefined).value, 0.25);
  assert.equal(normalizeFrameSampleRateFps("1").value, 1);
  assert.equal(normalizeFrameSampleRateFps("0.05").error.code, "invalid_frame_sample_rate");
  assert.equal(normalizeFrameSampleRateFps("2.5").error.code, "invalid_frame_sample_rate");
  assert.equal(normalizeFrameSampleRateFps("bad").error.code, "invalid_frame_sample_rate");
});
