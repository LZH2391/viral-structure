const test = require("node:test");
const assert = require("node:assert/strict");
const { structuredMediaError, normalizeMetadata } = require("../../Infrastructure/MediaProcessing/media-processor");
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

test("metadata duration prefers video stream and falls back to format duration", () => {
  const preferred = normalizeMetadata({
    streams: [{ codec_type: "video", duration: "18.9", width: 1920, height: 1080 }],
    format: { duration: "19.4", format_name: "mov,mp4", bit_rate: "1000" },
  });
  assert.equal(preferred.durationSeconds, 18.9);
  assert.equal(preferred.durationSource, "video_stream");

  const fallback = normalizeMetadata({
    streams: [{ codec_type: "video", duration: "N/A", width: 1920, height: 1080 }],
    format: { duration: "19.4", format_name: "mov,mp4", bit_rate: "1000" },
  });
  assert.equal(fallback.durationSeconds, 19.4);
  assert.equal(fallback.durationSource, "format_fallback");
});
