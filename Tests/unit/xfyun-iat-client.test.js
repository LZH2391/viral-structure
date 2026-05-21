const test = require("node:test");
const assert = require("node:assert/strict");
const { decodeResultText, mergeTextSegments, readCredentials } = require("../../Infrastructure/ModelGateway/xfyun-iat-client");

test("xfyun credentials keep APIKey and APISecret in separate fields", () => {
  const credentials = readCredentials({ XFYUN_APP_ID: "app", XFYUN_API_KEY: "key", XFYUN_API_SECRET: "secret" });
  assert.equal(credentials.ok, true);
  assert.deepEqual(credentials.value, { appId: "app", apiKey: "key", apiSecret: "secret" });
});

test("xfyun result decoder accepts base64 result text", () => {
  const payload = Buffer.from(JSON.stringify({
    ws: [
      { cw: [{ w: "你" }] },
      { cw: [{ w: "好" }] },
    ],
  }), "utf8").toString("base64");

  assert.equal(decodeResultText(payload), "你好");
});

test("xfyun text segments merge into a subtitle segment", () => {
  assert.deepEqual(mergeTextSegments([{ text: "你" }, { text: "好" }]), [{ start: 0, end: 0, text: "你好", confidence: null }]);
  assert.deepEqual(mergeTextSegments([{ text: "" }]), []);
});
