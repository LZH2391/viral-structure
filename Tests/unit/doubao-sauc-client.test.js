const test = require("node:test");
const assert = require("node:assert/strict");
const {
  readCredentials,
  buildHandshakeHeaders,
  buildFullClientPayload,
  buildAudioOnlyPayload,
  encodeClientRequest,
  decodeServerMessage,
  decodeResultText,
  decodeResultSegments,
  parseRecognitionPayload,
  recognitionTimeoutMs,
  isSuccessCode,
  splitUtteranceIntoSegments,
  sanitizeHeaders,
} = require("../../Infrastructure/ModelGateway/doubao-sauc-client");

test("doubao credentials keep app id and access token in separate fields", () => {
  const credentials = readCredentials({ DOUBAO_Api_App_Key: "app", DOUBAO_Api_Access_Key: "token" });
  assert.equal(credentials.ok, true);
  assert.equal(credentials.value.appId, "app");
  assert.equal(credentials.value.accessToken, "token");
  assert.equal(credentials.value.resourceId, "volc.bigasr.sauc.duration");
});

test("doubao handshake headers include required auth fields", () => {
  const headers = buildHandshakeHeaders({
    appId: "app",
    accessToken: "token",
    resourceId: "resource",
  }, "connect_1", "request_1");
  assert.equal(headers.Authorization, "Bearer; token");
  assert.equal(headers["X-Api-App-Key"], "app");
  assert.equal(headers["X-Api-Access-Key"], "token");
  assert.equal(headers["X-Api-Resource-Id"], "resource");
  assert.equal(headers["X-Api-Connect-Id"], "connect_1");
  assert.equal(headers["X-Api-Request-Id"], "request_1");
  assert.equal(headers["X-Api-Sequence"], "-1");
});

test("doubao request payloads include utterance and sequence settings", () => {
  const credentials = readCredentials({ DOUBAO_Api_App_Key: "app", DOUBAO_Api_Access_Key: "token" }).value;
  const full = buildFullClientPayload({
    connectId: "connect_1",
    requestId: "request_1",
    credentials,
    audioChunk: Buffer.from([1, 2, 3]),
    isLast: false,
  });
  const audioOnly = buildAudioOnlyPayload({ audioChunk: Buffer.from([4, 5]), isLast: true });
  assert.equal(full.request.reqid, "request_1");
  assert.equal(full.request.show_utterances, true);
  assert.equal(full.request.enable_nonstream, false);
  assert.equal(full.request.sequence, 1);
  assert.deepEqual(audioOnly, { audioChunk: Buffer.from([4, 5]), isLast: true });
});

test("doubao parser extracts text utterances and words in seconds", () => {
  const payload = {
    result: {
      text: "你好再见",
      utterances: [
        {
          start_time: 0,
          end_time: 1200,
          text: "你好",
          definite: true,
          words: [
            { start_time: 0, end_time: 400, text: "你" },
            { start_time: 400, end_time: 1200, text: "好" },
          ],
        },
        {
          start_time: 2200,
          end_time: 3000,
          text: "再见",
          definite: false,
          words: [
            { start_time: 2200, end_time: 2500, text: "再" },
            { start_time: 2500, end_time: 3000, text: "见" },
          ],
        },
      ],
    },
  };

  assert.equal(decodeResultText(payload), "你好再见");
  assert.deepEqual(decodeResultSegments(payload), [
    { start: 0, end: 1.2, text: "你好", confidence: null },
    { start: 2.2, end: 3, text: "再见", confidence: null },
  ]);
  assert.deepEqual(parseRecognitionPayload(payload), {
    text: "你好再见",
    utterances: [
      {
        start: 0,
        end: 1.2,
        text: "你好",
        definite: true,
        words: [
          { start: 0, end: 0.4, text: "你" },
          { start: 0.4, end: 1.2, text: "好" },
        ],
      },
      {
        start: 2.2,
        end: 3,
        text: "再见",
        definite: false,
        words: [
          { start: 2.2, end: 2.5, text: "再" },
          { start: 2.5, end: 3, text: "见" },
        ],
      },
    ],
  });
});

test("doubao timeout includes streaming duration plus response budget", () => {
  assert.equal(recognitionTimeoutMs(0), 30000);
  assert.equal(recognitionTimeoutMs(16000 * 2 * 42), 72000);
});

test("doubao binary client request uses official 4-byte header layout", () => {
  const credentials = readCredentials({ DOUBAO_Api_App_Key: "app", DOUBAO_Api_Access_Key: "token" }).value;
  const packet = encodeClientRequest({
    event: "full_client_request",
    connectId: "connect_1",
    requestId: "request_1",
    credentials,
    audioChunk: Buffer.from([1, 2, 3]),
    isLast: false,
  });
  assert.equal(packet.readUInt8(0), 0x11);
  assert.equal(packet.readUInt8(1), 0x10);
  assert.equal(packet.readUInt8(2), 0x11);
});

test("doubao server error frame decodes protocol error payload", () => {
  const payloadBytes = Buffer.from(JSON.stringify({ error: "decode ws request failed: unsupported protocol version 0" }), "utf8");
  const gzipped = require("zlib").gzipSync(payloadBytes);
  const header = Buffer.from([0x11, 0xf0, 0x11, 0x00]);
  const errorCode = Buffer.alloc(4);
  errorCode.writeUInt32BE(45000001, 0);
  const payloadSize = Buffer.alloc(4);
  payloadSize.writeUInt32BE(gzipped.length, 0);
  const decoded = decodeServerMessage(Buffer.concat([header, errorCode, payloadSize, gzipped]));
  assert.equal(decoded.messageType, 15);
  assert.equal(decoded.errorCode, 45000001);
  assert.equal(decoded.payload.error, "decode ws request failed: unsupported protocol version 0");
  assert.equal(decoded.isFinal, true);
});

test("doubao subtitle segments split on comma-like pauses while preserving timings", () => {
  const segments = splitUtteranceIntoSegments({
    start: 0,
    end: 4,
    text: "睡觉枕头一定要定期除螨，不要像我这样。",
    words: [
      { start: 0, end: 0.4, text: "睡觉" },
      { start: 0.4, end: 0.8, text: "枕头" },
      { start: 0.8, end: 1.2, text: "一定要" },
      { start: 1.2, end: 1.6, text: "定期" },
      { start: 1.6, end: 2, text: "除螨" },
      { start: 2, end: 3, text: "不要像我这样" },
    ],
  });
  assert.deepEqual(segments, [
    { start: 0, end: 1.6, text: "睡觉枕头一定要定期除螨，", confidence: null },
    { start: 1.6, end: 3, text: "不要像我这样。", confidence: null },
  ]);
});

test("doubao success code accepts official and legacy success codes", () => {
  assert.equal(isSuccessCode(20000000), true);
  assert.equal(isSuccessCode(1000), true);
  assert.equal(isSuccessCode(45000001), false);
});

test("doubao handshake debug headers redact sensitive values", () => {
  assert.deepEqual(
    sanitizeHeaders({
      "content-type": "application/json",
      "x-tt-logid": "log_1",
      authorization: "Bearer secret",
      "x-api-app-key": "app_secret",
      "set-cookie": ["a=1"],
    }),
    {
      "content-type": "application/json",
      "x-tt-logid": "log_1",
    },
  );
});
