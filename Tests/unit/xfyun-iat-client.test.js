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
    { start: 0, end: 1.2, text: "你", confidence: 0.9 },
    { start: 1.2, end: 2.6, text: "好。", confidence: 0.75 },
    { start: 4.2, end: 5.2, text: "再见", confidence: 0.9 },
  ]);
});

test("xfyun text segments merge into timed subtitle segments", () => {
  assert.deepEqual(mergeTextSegments([{ start: 0, end: 0.4, text: "你" }, { start: 0.5, end: 0.9, text: "好" }]), [{ start: 0, end: 0.9, text: "你好", confidence: null }]);
  assert.deepEqual(mergeTextSegments([{ start: 0, end: 1, text: "你好。" }, { start: 2, end: 3, text: "再见" }]), [
    { start: 0, end: 1, text: "你好。", confidence: null },
    { start: 2, end: 3, text: "再见", confidence: null },
  ]);
  assert.deepEqual(mergeTextSegments([
    { start: 0, end: 0.6, text: "就这个" },
    { start: 0.7, end: 1.2, text: "两块多一" },
    { start: 1.25, end: 1.35, text: "条" },
    { start: 1.4, end: 1.5, text: "的" },
    { start: 1.55, end: 1.8, text: "辣卤鳗鱼" },
    { start: 1.85, end: 1.95, text: "，" },
    { start: 2.1, end: 2.5, text: "彻底让" },
    { start: 2.55, end: 3.1, text: "我实现了" },
  ]), [
    { start: 0, end: 1.5, text: "就这个两块多一条的", confidence: null },
    { start: 1.55, end: 1.95, text: "辣卤鳗鱼，", confidence: null },
    { start: 2.1, end: 3.1, text: "彻底让我实现了", confidence: null },
  ]);
  assert.deepEqual(mergeTextSegments([
    { start: 0, end: 0.3, text: "一" },
    { start: 0.9, end: 1.2, text: "二" },
    { start: 1.3, end: 1.6, text: "三" },
  ]), [
    { start: 0, end: 0.3, text: "一", confidence: null },
    { start: 0.9, end: 1.6, text: "二三", confidence: null },
  ]);
  assert.deepEqual(mergeTextSegments([
    { start: 0, end: 0.4, text: "现" },
    { start: 0.4, end: 0.8, text: "在" },
    { start: 0.8, end: 1.1, text: "到" },
    { start: 1.1, end: 1.4, text: "手" },
    { start: 1.4, end: 1.7, text: "8" },
    { start: 1.7, end: 1.9, text: "袋" },
  ]), [
    { start: 0, end: 1.9, text: "现在到手8袋", confidence: null },
  ]);
  assert.deepEqual(mergeTextSegments([{ text: "" }]), []);
});

test("xfyun timeout includes streaming duration plus response budget", () => {
  assert.equal(recognitionTimeoutMs(0), 30000);
  assert.equal(recognitionTimeoutMs(16000 * 2 * 42), 72000);
});
