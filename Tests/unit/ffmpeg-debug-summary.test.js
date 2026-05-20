const test = require("node:test");
const assert = require("node:assert/strict");
const { structuredMediaError } = require("../../Infrastructure/MediaProcessing/media-processor");
const { summarizeCommand, summarizeStderr } = require("../../Infrastructure/MediaProcessing/ffmpeg-runner");
const { PROCESSING_ERRORS } = require("../../Core/Workspace/sample-video-contracts");

test("ffmpeg failures expose safe media debug summaries", () => {
  const cause = new Error("ffprobe failed");
  cause.commandSummary = summarizeCommand("ffprobe", ["-show_streams", "C:\\Users\\me\\Videos\\secret-sample.mp4"]);
  cause.stderrSummary = summarizeStderr("Invalid data found in C:\\Users\\me\\Videos\\secret-sample.mp4");
  cause.exitCode = 1;

  const error = structuredMediaError(PROCESSING_ERRORS.metadataProbeFailed, "视频元信息读取失败", cause, "metadata.probe");
  assert.equal(error.mediaDebug.mediaOperation, "metadata.probe");
  assert.equal(error.mediaDebug.exitCode, 1);
  assert.equal(error.mediaDebug.retryable, false);
  assert.deepEqual(error.mediaDebug.commandSummary, {
    command: "ffprobe",
    args: ["-show_streams", "<path:secret-sample.mp4>"],
  });
  assert.equal(error.mediaDebug.stderrSummary, "Invalid data found in <path:secret-sample.mp4>");
});
