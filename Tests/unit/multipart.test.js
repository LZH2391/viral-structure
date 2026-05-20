const test = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("stream");
const { parseMultipartUpload } = require("../../Apps/Api/lib/multipart");

test("parses upload file and plain fields", async () => {
  const boundary = "----bd-test";
  const body = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="frameSampleRateFps"',
    "",
    "1",
    `--${boundary}`,
    'Content-Disposition: form-data; name="file"; filename="sample.mp4"',
    "Content-Type: video/mp4",
    "",
    "video-bytes",
    `--${boundary}--`,
    "",
  ].join("\r\n");

  const result = await parseMultipartUpload(Readable.from(Buffer.from(body, "utf8")), `multipart/form-data; boundary=${boundary}`);
  assert.equal(result.fields.frameSampleRateFps, "1");
  assert.equal(result.file.filename, "sample.mp4");
  assert.equal(result.file.mimeType, "video/mp4");
  assert.equal(result.file.buffer.toString("utf8"), "video-bytes");
});
