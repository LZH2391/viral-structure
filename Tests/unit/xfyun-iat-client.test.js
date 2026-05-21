const test = require("node:test");
const assert = require("node:assert/strict");
const { decodeResultSegments, decodeResultText, mergeTextSegments, readCredentials, recognitionTimeoutMs } = require("../../Infrastructure/ModelGateway/xfyun-iat-client");

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

test("xfyun result decoder keeps word timing when available", () => {
  const payload = Buffer.from(JSON.stringify({
    ws: [
      { bg: 0, cw: [{ w: "你", sc: 0.9 }] },
      { bg: 120, cw: [{ w: "好", sc: 0.8 }] },
      { bg: 260, cw: [{ w: "。", sc: 0.7 }] },
      { bg: 420, cw: [{ w: "再", sc: 0.9 }] },
      { bg: 520, cw: [{ w: "见", sc: 0.9 }] },
    ],
  }), "utf8").toString("base64");

  assert.deepEqual(decodeResultSegments(payload), [
    { start: 0, end: 2.6, text: "你好。", confidence: 0.775 },
    { start: 4.2, end: 5.2, text: "再见", confidence: 0.9 },
  ]);
});

test("xfyun text segments merge into timed subtitle segments", () => {
  assert.deepEqual(mergeTextSegments([{ start: 0, end: 0.4, text: "你" }, { start: 0.5, end: 0.9, text: "好" }]), [{ start: 0, end: 0.9, text: "你好", confidence: null }]);
  assert.deepEqual(mergeTextSegments([{ start: 0, end: 1, text: "你好。" }, { start: 2, end: 3, text: "再见" }]), [
    { start: 0, end: 1, text: "你好。", confidence: null },
    { start: 2, end: 3, text: "再见", confidence: null },
  ]);
  assert.deepEqual(mergeTextSegments([{ text: "" }]), []);
});

test("xfyun timeout includes streaming duration plus response budget", () => {
  assert.equal(recognitionTimeoutMs(0), 30000);
  assert.equal(recognitionTimeoutMs(16000 * 2 * 42), 72000);
});
