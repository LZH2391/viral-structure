const crypto = require("crypto");

const HOST = "iat.xf-yun.com";
const PATHNAME = "/v1";
const DEFAULT_OPTIONS = { domain: "slm", language: "zh_cn", accent: "mandarin" };

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
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      try {
        ws.close();
      } catch {}
      fn(value);
    };
    ws.onopen = () => {
      ws.send(JSON.stringify({
        header: { app_id: credentials.appId, status: 0 },
        parameter: { iat: { ...options, result: { encoding: "utf8", compress: "raw", format: "json" } } },
        payload: { audio: { encoding: "raw", sample_rate: 16000, channels: 1, bit_depth: 16, status: 2, audio: Buffer.from(audioBuffer).toString("base64") } },
      }));
    };
    ws.onerror = () => finish(reject, configuredError("xfyun_iat_request_failed", "讯飞字幕识别请求失败", { retryable: true }));
    ws.onmessage = async (message) => {
      try {
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

function decodeResultText(value) {
  if (!value) return "";
  const json = JSON.parse(Buffer.from(value, "base64").toString("utf8"));
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

module.exports = { recognizeAudio, readCredentials, buildAuthorizedUrl, decodeResultText, mergeTextSegments };
