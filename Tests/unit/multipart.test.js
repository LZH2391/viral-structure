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

test("preserves utf8 Chinese upload filenames", async () => {
  const boundary = "----bd-test";
  const body = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="file"; filename="螨虫_亲测分享.mp4"',
    "Content-Type: video/mp4",
    "",
    "video-bytes",
    `--${boundary}--`,
    "",
  ].join("\r\n");

  const result = await parseMultipartUpload(Readable.from(Buffer.from(body, "utf8")), `multipart/form-data; boundary=${boundary}`);
  assert.equal(result.file.filename, "螨虫_亲测分享.mp4");
  assert.equal(result.file.extension, ".mp4");
});

test("preserves rfc5987 encoded utf8 upload filenames", async () => {
  const boundary = "----bd-test";
  const body = [
    `--${boundary}`,
    "Content-Disposition: form-data; name=\"file\"; filename*=UTF-8''%E8%9E%A8%E8%99%AB_%E4%BA%B2%E6%B5%8B%E5%88%86%E4%BA%AB.mp4",
    "Content-Type: video/mp4",
    "",
    "video-bytes",
    `--${boundary}--`,
    "",
  ].join("\r\n");

  const result = await parseMultipartUpload(Readable.from(Buffer.from(body, "utf8")), `multipart/form-data; boundary=${boundary}`);
  assert.equal(result.file.filename, "螨虫_亲测分享.mp4");
});
