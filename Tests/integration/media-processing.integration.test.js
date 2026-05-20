const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { hasCommand, runCommand } = require("../../Infrastructure/MediaProcessing/ffmpeg-runner");
const { createLocalStore } = require("../../Infrastructure/Storage/local-store");
const { processMedia } = require("../../Infrastructure/MediaProcessing/media-processor");

test("runs ffprobe, cover, frames and audio when ffmpeg exists", async (t) => {
  if (!(await hasCommand("ffmpeg")) || !(await hasCommand("ffprobe"))) {
    t.skip("ffmpeg/ffprobe not installed");
    return;
  }
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bd-fs-"));
  const inputPath = path.join(tempRoot, "sample.mp4");
  await runCommand("ffmpeg", ["-y", "-f", "lavfi", "-i", "testsrc=duration=1:size=160x90:rate=12", "-pix_fmt", "yuv420p", inputPath]);
  const store = createLocalStore(tempRoot);
  const sampleDir = await store.ensureSampleDirs("sample_test");
  const media = await processMedia({
    inputPath,
    sampleVideoId: "sample_test",
    sampleArtifactId: "artifact_sample",
    sampleDir,
    store,
  });
  assert.ok(media.metadata.durationSeconds > 0);
  assert.ok(media.cover.parentArtifactId);
  assert.ok(media.frames[0].timestamp >= 0);
  assert.equal(media.frames[0].parentArtifactId, "artifact_sample");
});
