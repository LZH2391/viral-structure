const fs = require("fs/promises");
const { randomUUID } = require("crypto");

const DEFAULT_WS_URL = "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_nostream";
const DEFAULT_RESOURCE_ID = "volc.bigasr.sauc.duration";
const DEFAULT_MODEL_NAME = "bigmodel";
const DEFAULT_PROTOCOL_VERSION = 1;
const DEFAULT_CHUNK_MS = 200;
const RESPONSE_TIMEOUT_MS = 30000;
const SUCCESS_CODES = new Set([1000, 20000000]);
const PCM_SAMPLE_RATE = 16000;
const PCM_CHANNELS = 1;
const PCM_BITS = 16;
const PCM_BYTES_PER_SECOND = PCM_SAMPLE_RATE * PCM_CHANNELS * (PCM_BITS / 8);

async function recognizeAudio({
  audioPath = null,
  audioBuffer = null,
  env = process.env,
  wsFactory = createWebSocket,
  connectId = randomUUID(),
  requestId = randomUUID(),
} = {}) {
  const credentials = readCredentials(env);
  if (!credentials.ok) throw configuredError("doubao_credentials_missing", "豆包字幕识别凭证未配置", { retryable: false });
  if (typeof WebSocket === "undefined") throw configuredError("websocket_unavailable", "当前 Node 运行时不支持 WebSocket", { retryable: false });
  const buffer = audioBuffer ? Buffer.from(audioBuffer) : await readAudioBuffer(audioPath);
  return requestRecognition({
    audioBuffer: buffer,
    credentials: credentials.value,
    wsFactory,
    connectId,
    requestId,
  });
}

function readCredentials(env = process.env) {
  const appId = env.DOUBAO_Api_App_Key || null;
  const accessToken = env.DOUBAO_Api_Access_Key || null;
  const resourceId = env.DOUBAO_SAUC_RESOURCE_ID || DEFAULT_RESOURCE_ID;
  const wsUrl = env.DOUBAO_SAUC_WS_URL || DEFAULT_WS_URL;
  const modelName = env.DOUBAO_SAUC_MODEL_NAME || DEFAULT_MODEL_NAME;
  if (!appId || !accessToken) return { ok: false };
  return {
    ok: true,
    value: {
      appId,
      accessToken,
      resourceId,
      wsUrl,
      modelName,
      protocolVersion: DEFAULT_PROTOCOL_VERSION,
      chunkMs: DEFAULT_CHUNK_MS,
      audio: {
        format: "pcm",
        codec: "raw",
        rate: PCM_SAMPLE_RATE,
        bits: PCM_BITS,
        channel: PCM_CHANNELS,
      },
    },
  };
}

async function requestRecognition({ audioBuffer, credentials, wsFactory, connectId, requestId }) {
  return new Promise((resolve, reject) => {
    const buffer = Buffer.from(audioBuffer ?? Buffer.alloc(0));
    const timeoutMs = recognitionTimeoutMs(buffer.length);
    const utterances = [];
    let finalText = "";
    let settled = false;
    let sendTimer = null;
    let messageCount = 0;
    let logId = null;
    let opened = false;
    let unexpectedResponseSummary = null;
    const timeout = setTimeout(() => {
      finish(reject, configuredError("doubao_sauc_timeout", "豆包字幕识别响应超时", {
        retryable: true,
        detail: `opened=${opened};messages=${messageCount};bytes=${buffer.length};timeoutMs=${timeoutMs}`,
        handshake: unexpectedResponseSummary,
        providerMeta: { connectId, requestId, logId, resourceId: credentials.resourceId },
      }));
    }, timeoutMs);
    const ws = wsFactory({
      url: credentials.wsUrl,
      headers: buildHandshakeHeaders(credentials, connectId, requestId),
      onUnexpectedResponse(response, request) {
        logId = response?.headers?.["x-tt-logid"] ?? response?.headers?.["X-Tt-Logid"] ?? logId ?? null;
        summarizeUnexpectedResponse(response, request)
          .then((summary) => {
            unexpectedResponseSummary = summary;
            if (summary?.logId) logId = summary.logId;
          })
          .catch(() => {
            unexpectedResponseSummary = {
              statusCode: response?.statusCode ?? null,
              statusMessage: response?.statusMessage ?? null,
              headers: sanitizeHeaders(response?.headers ?? null),
              bodySnippet: null,
              requestPath: request?.path ?? null,
              requestMethod: request?.method ?? null,
              logId,
            };
          });
      },
    });

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (sendTimer) clearTimeout(sendTimer);
      try {
        ws.close();
      } catch {}
      fn(value);
    };

    ws.onopen = () => {
      opened = true;
      sendTimer = sendClientRequests(ws, buffer, credentials, connectId, requestId);
    };

    ws.onerror = (event) => finish(reject, configuredError("doubao_sauc_request_failed", "豆包字幕识别请求失败", {
      retryable: true,
      detail: event?.message || event?.error?.message || "websocket error",
      handshake: unexpectedResponseSummary,
      providerMeta: { connectId, requestId, logId, resourceId: credentials.resourceId },
    }));

    ws.onclose = (event) => {
      if (settled) return;
      if (utterances.length || finalText) {
        finish(resolve, finalizeRecognition({ utterances, finalText, providerMeta: { connectId, requestId, logId, resourceId: credentials.resourceId } }));
        return;
      }
      finish(reject, configuredError("doubao_sauc_closed", "豆包字幕识别连接提前关闭", {
        retryable: true,
        detail: `code=${event?.code ?? "unknown"};reason=${event?.reason ?? ""};messages=${messageCount}`,
        handshake: unexpectedResponseSummary,
        providerMeta: { connectId, requestId, logId, resourceId: credentials.resourceId },
      }));
    };

    ws.onmessage = async (message) => {
      try {
        messageCount += 1;
        const packet = decodeServerMessage(await resolveMessageBuffer(message.data));
        logId = packet.headers?.["x-tt-logid"] ?? packet.headers?.["X-Tt-Logid"] ?? packet.payload?.addition?.logid ?? packet.payload?.result?.logid ?? logId ?? null;
        if (packet.payload?.code && !isSuccessCode(packet.payload.code)) {
          finish(reject, configuredError("doubao_sauc_failed", "豆包字幕识别失败", {
            retryable: true,
            detail: packet.payload.message || packet.payload.msg || packet.payload.code,
            upstreamCode: packet.payload.code,
            providerMeta: { connectId, requestId, logId, resourceId: credentials.resourceId },
          }));
          return;
        }
        const parsed = parseRecognitionPayload(packet.payload);
        if (parsed.text) finalText = parsed.text;
        if (parsed.utterances.length) {
          utterances.length = 0;
          utterances.push(...parsed.utterances);
        }
        if (packet.isFinal) {
          finish(resolve, finalizeRecognition({
            utterances,
            finalText,
            providerMeta: { connectId, requestId, logId, resourceId: credentials.resourceId },
          }));
        }
      } catch (error) {
        finish(reject, configuredError("doubao_sauc_parse_failed", "豆包字幕识别结果解析失败", {
          retryable: false,
          detail: error.message,
          handshake: unexpectedResponseSummary,
          providerMeta: { connectId, requestId, logId, resourceId: credentials.resourceId },
        }));
      }
    };
  });
}

function buildHandshakeHeaders(credentials, connectId, requestId) {
  return {
    Authorization: `Bearer; ${credentials.accessToken}`,
    "X-Api-App-Key": credentials.appId,
    "X-Api-Access-Key": credentials.accessToken,
    "X-Api-Resource-Id": credentials.resourceId,
    "X-Api-Connect-Id": connectId,
    "X-Api-Request-Id": requestId,
    "X-Api-Sequence": "-1",
  };
}

function createWebSocket({ url, headers, onUnexpectedResponse }) {
  return new WebSocket(url, { headers, perMessageDeflate: false, followRedirects: false, onUnexpectedResponse });
}

function sendClientRequests(ws, audioBuffer, credentials, connectId, requestId) {
  let offset = 0;
  const chunkBytes = Math.max(1, Math.round(PCM_BYTES_PER_SECOND * (credentials.chunkMs / 1000)));
  let first = true;

  const sendNext = () => {
    if (ws.readyState !== WebSocket.OPEN) return null;
    const chunk = audioBuffer.subarray(offset, Math.min(audioBuffer.length, offset + chunkBytes));
    offset += chunk.length;
    if (first) {
      ws.send(encodeClientRequest({
        event: "full_client_request",
        connectId,
        requestId,
        credentials,
        audioChunk: chunk,
        isLast: offset >= audioBuffer.length,
      }));
      first = false;
    } else {
      ws.send(encodeClientRequest({
        event: "audio_only_request",
        connectId,
        requestId,
        credentials,
        audioChunk: chunk,
        isLast: offset >= audioBuffer.length,
      }));
    }
    if (offset < audioBuffer.length) return setTimeout(sendNext, credentials.chunkMs);
    return null;
  };

  return sendNext();
}

function encodeClientRequest({ event, connectId, requestId, credentials, audioChunk, isLast }) {
  const payload = event === "full_client_request"
    ? buildFullClientPayload({ connectId, requestId, credentials, audioChunk, isLast })
    : buildAudioOnlyPayload({ audioChunk, isLast });
  const payloadBytes = Buffer.from(JSON.stringify(payload), "utf8");
  const header = Buffer.alloc(8);
  header.writeUInt8(DEFAULT_PROTOCOL_VERSION, 0);
  header.writeUInt8(event === "full_client_request" ? 1 : 2, 1);
  header.writeUInt16BE(0, 2);
  header.writeUInt32BE(payloadBytes.length, 4);
  return Buffer.concat([header, payloadBytes]);
}

function buildFullClientPayload({ connectId, requestId, credentials, audioChunk, isLast }) {
  return {
    user: { uid: connectId },
    audio: {
      format: credentials.audio.format,
      codec: credentials.audio.codec,
      rate: credentials.audio.rate,
      bits: credentials.audio.bits,
      channel: credentials.audio.channel,
      data: Buffer.from(audioChunk ?? Buffer.alloc(0)).toString("base64"),
    },
    request: {
      reqid: requestId,
      model_name: credentials.modelName,
      show_utterances: true,
      enable_nonstream: false,
      sequence: isLast ? -1 : 1,
    },
  };
}

function buildAudioOnlyPayload({ audioChunk, isLast }) {
  return {
    audio: {
      data: Buffer.from(audioChunk ?? Buffer.alloc(0)).toString("base64"),
    },
    request: {
      sequence: isLast ? -1 : 1,
    },
  };
}

function decodeServerMessage(buffer) {
  const bytes = Buffer.from(buffer ?? Buffer.alloc(0));
  if (bytes.length < 8) throw new Error("server packet too short");
  const payloadSize = bytes.readUInt32BE(4);
  const body = bytes.subarray(8, 8 + payloadSize);
  const payload = body.length ? JSON.parse(body.toString("utf8")) : {};
  return {
    payload,
    headers: payload?.header || payload?.headers || null,
    isFinal: isFinalResponse(payload),
  };
}

function isFinalResponse(payload) {
  if (!payload || typeof payload !== "object") return false;
  if (payload.is_final === true || payload.is_final === 1) return true;
  if (payload.result?.is_final === true || payload.result?.is_final === 1) return true;
  if (payload.result?.sequence === -1 || payload.sequence === -1) return true;
  return false;
}

function parseRecognitionPayload(payload) {
  const result = payload?.result ?? payload ?? {};
  const additions = payload?.addition ?? result?.addition ?? {};
  const rawUtterances = Array.isArray(result.utterances) ? result.utterances : Array.isArray(additions.utterances) ? additions.utterances : [];
  const utterances = rawUtterances.map(normalizeUtterance).filter((item) => item.text);
  const text = String(result.text ?? additions.text ?? utterances.map((item) => item.text).join("")).trim();
  return { text, utterances };
}

function normalizeUtterance(value) {
  const words = normalizeWords(value?.words ?? value?.word_infos ?? []);
  return {
    start: normalizeTimestamp(value?.start_time ?? value?.start ?? value?.begin_time),
    end: normalizeTimestamp(value?.end_time ?? value?.end),
    text: String(value?.text ?? value?.utterance ?? words.map((item) => item.text).join("")).trim(),
    definite: typeof value?.definite === "boolean" ? value.definite : null,
    words,
  };
}

function normalizeWords(items) {
  return (Array.isArray(items) ? items : []).map((item) => ({
    start: normalizeTimestamp(item?.start_time ?? item?.start ?? item?.begin_time),
    end: normalizeTimestamp(item?.end_time ?? item?.end),
    text: String(item?.text ?? item?.word ?? item?.content ?? "").trim(),
  })).filter((item) => item.text);
}

function normalizeTimestamp(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return 0;
  return number >= 100 ? number / 1000 : number;
}

function finalizeRecognition({ utterances, finalText, providerMeta }) {
  const normalizedUtterances = utterances.map((item) => ({
    start: roundTime(item.start),
    end: roundTime(item.end),
    text: item.text,
    definite: item.definite ?? null,
    words: (item.words ?? []).map((word) => ({
      start: roundTime(word.start),
      end: roundTime(word.end),
      text: word.text,
    })),
  })).filter((item) => item.text);
  return {
    text: String(finalText ?? normalizedUtterances.map((item) => item.text).join("")).trim(),
    segments: normalizedUtterances.map((item) => ({
      start: item.start,
      end: item.end,
      text: item.text,
      confidence: null,
    })),
    timing: {
      utterances: normalizedUtterances,
      words: normalizedUtterances.flatMap((item) => item.words),
    },
    providerMeta: {
      provider: "doubao-sauc",
      resourceId: providerMeta?.resourceId ?? DEFAULT_RESOURCE_ID,
      connectId: providerMeta?.connectId ?? null,
      requestId: providerMeta?.requestId ?? null,
      logId: providerMeta?.logId ?? null,
    },
  };
}

function roundTime(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.round(number * 1000) / 1000;
}

function decodeResultText(value) {
  return parseRecognitionPayload(typeof value === "string" ? JSON.parse(value) : value).text;
}

function decodeResultSegments(value) {
  const parsed = parseRecognitionPayload(typeof value === "string" ? JSON.parse(value) : value);
  return parsed.utterances.map((item) => ({
    start: item.start,
    end: item.end,
    text: item.text,
    confidence: null,
  }));
}

function recognitionTimeoutMs(byteLength) {
  const streamMs = Math.ceil(Math.max(0, byteLength) / PCM_BYTES_PER_SECOND * 1000);
  return Math.max(RESPONSE_TIMEOUT_MS, streamMs + RESPONSE_TIMEOUT_MS);
}

function isSuccessCode(code) {
  const normalized = Number(code);
  return Number.isFinite(normalized) && SUCCESS_CODES.has(normalized);
}

function configuredError(code, message, options = {}) {
  const error = new Error(message);
  error.code = code;
  error.safeSummary = message;
  error.retryable = options.retryable ?? false;
  error.modelDebug = {
    provider: "doubao-sauc",
    stage: "sample.subtitle.recognized",
    templateVersion: "doubao-sauc-v1",
    inputSummary: {
      audioEncoding: "pcm_s16le",
      sampleRate: PCM_SAMPLE_RATE,
      chunkMs: DEFAULT_CHUNK_MS,
      protocolVersion: DEFAULT_PROTOCOL_VERSION,
      resourceId: options.providerMeta?.resourceId ?? DEFAULT_RESOURCE_ID,
    },
    outputSummary: {
      detail: options.detail ? sanitizeDetail(options.detail) : null,
      connectId: options.providerMeta?.connectId ?? null,
      requestId: options.providerMeta?.requestId ?? null,
      logId: options.providerMeta?.logId ?? null,
      upstreamCode: options.upstreamCode ?? null,
      handshake: options.handshake ?? null,
    },
    retryable: error.retryable,
  };
  return error;
}

function sanitizeDetail(value) {
  return String(value ?? "").replace(/[A-Za-z]:\\[^\s]+/g, "[path]").slice(0, 180);
}

async function readAudioBuffer(audioPath) {
  if (!audioPath) return Buffer.alloc(0);
  return fs.readFile(audioPath);
}

async function resolveMessageBuffer(data) {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (typeof Blob !== "undefined" && data instanceof Blob) return Buffer.from(await data.arrayBuffer());
  if (typeof data === "string") return Buffer.from(data, "utf8");
  return Buffer.alloc(0);
}

async function summarizeUnexpectedResponse(response, request) {
  const bodyBuffer = await readUnexpectedResponseBody(response);
  const headers = sanitizeHeaders(response?.headers ?? null);
  return {
    statusCode: response?.statusCode ?? null,
    statusMessage: response?.statusMessage ?? null,
    headers,
    bodySnippet: bodyBuffer.length ? sanitizeDetail(bodyBuffer.toString("utf8")) : null,
    requestPath: request?.path ?? null,
    requestMethod: request?.method ?? null,
    logId: headers?.["x-tt-logid"] ?? headers?.["X-Tt-Logid"] ?? null,
  };
}

async function readUnexpectedResponseBody(response) {
  if (!response || typeof response.on !== "function") return Buffer.alloc(0);
  return new Promise((resolve) => {
    const chunks = [];
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    response.on("data", (chunk) => {
      if (chunks.reduce((sum, item) => sum + item.length, 0) >= 4096) return;
      chunks.push(Buffer.from(chunk));
    });
    response.on("end", () => finish(Buffer.concat(chunks).subarray(0, 4096)));
    response.on("error", () => finish(Buffer.concat(chunks).subarray(0, 4096)));
    response.on("close", () => finish(Buffer.concat(chunks).subarray(0, 4096)));
  });
}

function sanitizeHeaders(headers) {
  if (!headers || typeof headers !== "object") return null;
  const safe = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = String(key).toLowerCase();
    if (lower === "authorization" || lower === "x-api-app-key" || lower === "x-api-access-key" || lower === "cookie" || lower === "set-cookie") continue;
    safe[key] = Array.isArray(value) ? value.map((item) => sanitizeDetail(String(item))) : sanitizeDetail(String(value));
  }
  return safe;
}

module.exports = {
  recognizeAudio,
  readCredentials,
  buildHandshakeHeaders,
  buildFullClientPayload,
  buildAudioOnlyPayload,
  decodeServerMessage,
  decodeResultText,
  decodeResultSegments,
  parseRecognitionPayload,
  normalizeTimestamp,
  recognitionTimeoutMs,
  isSuccessCode,
  sanitizeHeaders,
};
