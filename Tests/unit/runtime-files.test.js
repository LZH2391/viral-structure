const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { once } = require("events");
const { Writable } = require("stream");
const { parseRangeHeader, sendRuntimeFile } = require("../../Apps/Api/lib/runtime-files");

test("runtime files support byte ranges for media seeking", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bd-runtime-range-"));
  await fs.writeFile(path.join(root, "media.mp4"), "0123456789");
  const res = new CollectingResponse();

  sendRuntimeFile({ headers: { range: "bytes=2-5" } }, res, root, "/runtime/media.mp4");
  await once(res, "finish");

  assert.equal(res.statusCode, 206);
  assert.equal(res.headers["accept-ranges"], "bytes");
  assert.equal(res.headers["content-range"], "bytes 2-5/10");
  assert.equal(res.headers["content-length"], 4);
  assert.equal(Buffer.concat(res.chunks).toString("utf8"), "2345");
});

test("runtime range parser handles open, suffix, and invalid ranges", () => {
  assert.deepEqual(parseRangeHeader("bytes=4-", 10), { start: 4, end: 9 });
  assert.deepEqual(parseRangeHeader("bytes=-3", 10), { start: 7, end: 9 });
  assert.equal(parseRangeHeader("", 10), null);
  assert.deepEqual(parseRangeHeader("items=0-1", 10), { invalid: true });
  assert.deepEqual(parseRangeHeader("bytes=20-30", 10), { invalid: true });
});

class CollectingResponse extends Writable {
  constructor() {
    super();
    this.statusCode = null;
    this.headers = {};
    this.chunks = [];
  }

  writeHead(statusCode, headers) {
    this.statusCode = statusCode;
    this.headers = headers;
    return this;
  }

  _write(chunk, _encoding, callback) {
    this.chunks.push(Buffer.from(chunk));
    callback();
  }
}
