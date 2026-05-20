const test = require("node:test");
const assert = require("node:assert/strict");
const { validateUploadFile, validateDuration } = require("../../Core/Workspace/sample-video-validation");

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
