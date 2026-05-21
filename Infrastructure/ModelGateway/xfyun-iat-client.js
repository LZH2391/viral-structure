const crypto = require("crypto");

const HOST = "iat.xf-yun.com";
const PATHNAME = "/v1";
const DEFAULT_OPTIONS = { domain: "slm", language: "zh_cn", accent: "mandarin" };
const RESPONSE_TIMEOUT_MS = 30000;
const PCM_BYTES_PER_SECOND = 16000 * 2;
const FRAME_INTERVAL_MS = 40;
const FRAME_BYTES = PCM_BYTES_PER_SECOND * FRAME_INTERVAL_MS / 1000;

async function recognizeAudio({ audioBuffer, env = process.env, options = DEFAULT_OPTIONS }) {
  const credentials = readCredentials(env);
  if (!credentials.ok) throw configuredError("xfyun_credentials_missing", "讯飞字幕识别凭证未配置", { retryable: false });
  if (typeof WebSocket === "undefined") throw configuredError("websocket_unavailable", "当前 Node 运行时不支持 WebSocket", { retryable: false });
  return requestRecognition({ audioBuffer, credentials: credentials.value, options });
}

function readCredentials(env = process.env) {
  const appId = env.XFYUN_APP_ID;
  const apiKey = env.XFYUN_API_KEY;
  const apiSecret = env.XFYUN_API_SECRET;
  if (!appId || !apiKey || !apiSecret) return { ok: false };
  return { ok: true, value: { appId, apiKey, apiSecret } };
}

function buildAuthorizedUrl({ apiKey, apiSecret }, date = new Date().toUTCString()) {
  const signatureOrigin = `host: ${HOST}\ndate: ${date}\nGET ${PATHNAME} HTTP/1.1`;
  const signature = crypto.createHmac("sha256", apiSecret).update(signatureOrigin).digest("base64");
  const authorizationOrigin = `api_key="${apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`;
  const params = new URLSearchParams({
    authorization: Buffer.from(authorizationOrigin).toString("base64"),
    date,
    host: HOST,
  });
  return `wss://${HOST}${PATHNAME}?${params.toString()}`;
}

function requestRecognition({ audioBuffer, credentials, options }) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(buildAuthorizedUrl(credentials));
    const segments = [];
    const buffer = Buffer.from(audioBuffer ?? Buffer.alloc(0));
    let settled = false;
    let opened = false;
    let receivedMessages = 0;
    let sendTimer = null;
    const timeoutMs = recognitionTimeoutMs(buffer.length);
    const timeout = setTimeout(() => {
      finish(reject, configuredError("xfyun_iat_timeout", "讯飞字幕识别响应超时", {
        retryable: true,
        detail: `opened=${opened};messages=${receivedMessages};bytes=${buffer.length};timeoutMs=${timeoutMs}`,
      }));
    }, timeoutMs);
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
      sendAudioFrames(ws, buffer, credentials, options, (timer) => {
        sendTimer = timer;
      });
    };
    ws.onerror = (event) => finish(reject, configuredError("xfyun_iat_request_failed", "讯飞字幕识别请求失败", {
      retryable: true,
      detail: event?.message || event?.error?.message || "websocket error",
    }));
    ws.onclose = (event) => {
      if (settled) return;
      const hasText = segments.some((segment) => segment.text);
      if (hasText) {
        finish(resolve, mergeTextSegments(segments));
        return;
      }
      finish(reject, configuredError("xfyun_iat_closed", "讯飞字幕识别连接提前关闭", {
        retryable: true,
        detail: `code=${event?.code ?? "unknown"};reason=${event?.reason ?? ""};messages=${receivedMessages}`,
      }));
    };
    ws.onmessage = async (message) => {
      try {
        receivedMessages += 1;
        const raw = typeof message.data === "string" ? message.data : await message.data.text();
        const data = JSON.parse(raw);
        if (data.header?.code && data.header.code !== 0) {
          finish(reject, configuredError("xfyun_iat_failed", "讯飞字幕识别失败", { retryable: true, detail: data.header?.message }));
          return;
        }
        const text = decodeResultText(data.payload?.result?.text);
        if (text) segments.push({ text });
        if (data.header?.status === 2) finish(resolve, mergeTextSegments(segments));
      } catch (error) {
        finish(reject, configuredError("xfyun_iat_parse_failed", "讯飞字幕识别结果解析失败", { retryable: false, detail: error.message }));
      }
    };
  });
}

function recognitionTimeoutMs(byteLength) {
  const streamMs = Math.ceil(Math.max(0, byteLength) / PCM_BYTES_PER_SECOND * 1000);
  return Math.max(RESPONSE_TIMEOUT_MS, streamMs + RESPONSE_TIMEOUT_MS);
}

function sendAudioFrames(ws, audioBuffer, credentials, options, onTimer) {
  let offset = 0;
  let seq = 1;
  let first = true;
  const sendNext = () => {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (offset >= audioBuffer.length) {
      ws.send(JSON.stringify({
        header: { app_id: credentials.appId, status: 2 },
        payload: { audio: { encoding: "raw", sample_rate: 16000, channels: 1, bit_depth: 16, seq: seq++, status: 2, audio: "" } },
      }));
      return;
    }
    const chunk = audioBuffer.subarray(offset, Math.min(audioBuffer.length, offset + FRAME_BYTES));
    offset += chunk.length;
    const frame = {
      header: { app_id: credentials.appId, status: first ? 0 : 1 },
      payload: { audio: { encoding: "raw", sample_rate: 16000, channels: 1, bit_depth: 16, seq: seq++, status: first ? 0 : 1, audio: chunk.toString("base64") } },
    };
    if (first) frame.parameter = { iat: { ...options, result: { encoding: "utf8", compress: "raw", format: "json" } } };
    first = false;
    ws.send(JSON.stringify(frame));
    const timer = setTimeout(sendNext, FRAME_INTERVAL_MS);
    onTimer(timer);
  };
  sendNext();
}

function decodeResultText(value) {
  if (!value) return "";
  const json = typeof value === "string" ? JSON.parse(Buffer.from(value, "base64").toString("utf8")) : value;
  const words = json?.ws ?? [];
  return words.map((word) => (word.cw ?? []).map((item) => item.w ?? "").join("")).join("").trim();
}

function mergeTextSegments(items) {
  const text = items.map((item) => item.text).filter(Boolean).join("");
  return text ? [{ start: 0, end: 0, text, confidence: null }] : [];
}

function configuredError(code, message, options = {}) {
  const error = new Error(message);
  error.code = code;
  error.safeSummary = message;
  error.retryable = options.retryable ?? false;
  error.modelDebug = {
    provider: "xfyun",
    stage: "sample.subtitle.recognized",
    templateVersion: "xfyun-iat-v1",
    inputSummary: { audioEncoding: "pcm_s16le", sampleRate: 16000, maxSegmentSeconds: 60 },
    outputSummary: options.detail ? { detail: sanitizeDetail(options.detail) } : null,
    retryable: error.retryable,
  };
  return error;
}

function sanitizeDetail(value) {
  return String(value ?? "").replace(/[A-Za-z]:\\[^\s]+/g, "[path]").slice(0, 180);
}

module.exports = { recognizeAudio, readCredentials, buildAuthorizedUrl, decodeResultText, mergeTextSegments, recognitionTimeoutMs };
