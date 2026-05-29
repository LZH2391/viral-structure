const { request: httpRequest } = require("http");
const { request: httpsRequest } = require("https");

const DEFAULT_PPAPI_IMAGE_URL = process.env.PPAPI_IMAGE_GENERATIONS_URL || "https://api.pptoken.cc/v1/images/generations";

function createPPAPIProvider({ apiKey = null, url = DEFAULT_PPAPI_IMAGE_URL, requestImpl = null } = {}) {
  return {
    providerName: "pptoken",
    request: async (requestPayload = {}, options = {}) => {
      const token = resolveApiKey(apiKey);
      const body = buildPPAPIRequestBody(requestPayload);
      const startedAt = Date.now();
      const rawPayload = requestImpl
        ? await requestImpl({ url, body, headers: ppapiHeaders(token), timeoutSeconds: options.timeoutSeconds })
        : await postJson(url, body, ppapiHeaders(token), options.timeoutSeconds);
      return normalizePPAPIResponse(rawPayload, Date.now() - startedAt);
    },
  };
}

function buildPPAPIRequestBody({ prompt, size = "auto", quality = "auto", background = "auto", outputFormat = "png", n = 1 } = {}) {
  const text = String(prompt ?? "").trim();
  if (!text) throw ppapiError("prompt_empty", "生图 prompt 为空", { promptChars: 0 }, false);
  return {
    model: "gpt-image-2",
    prompt: text,
    size,
    quality,
    background,
    output_format: outputFormat,
    moderation: "auto",
    n,
  };
}

function resolveApiKey(explicitKey) {
  const value = explicitKey || process.env.PPAPI || process.env.PPTOKEN_API_KEY || process.env.PPTOKEN;
  const token = String(value ?? "").trim();
  if (!token) throw ppapiError("missing_api_key", "PPAPI 环境变量未配置", null, false);
  return token;
}

function ppapiHeaders(apiKey) {
  const token = String(apiKey ?? "").trim();
  const rawToken = token.toLowerCase().startsWith("bearer ") ? token.slice(7).trim() : token;
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: token.toLowerCase().startsWith("bearer ") ? token : `Bearer ${token}`,
    "x-api-key": rawToken,
  };
}

function postJson(url, body, headers, timeoutSeconds) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const transport = target.protocol === "http:" ? httpRequest : httpsRequest;
    const data = JSON.stringify(body);
    const req = transport({
      method: "POST",
      hostname: target.hostname,
      port: target.port || undefined,
      path: `${target.pathname}${target.search}`,
      headers,
      timeout: Number(timeoutSeconds) > 0 ? Number(timeoutSeconds) * 1000 : 300000,
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(raw);
          return;
        }
        reject(classifyHTTPError(res.statusCode, raw));
      });
    });
    req.on("timeout", () => {
      req.destroy(ppapiError("network_timeout", "PPAPI 生图请求超时", { timeoutSeconds }, true));
    });
    req.on("error", (error) => {
      reject(error?.code ? error : ppapiError("network_error", "PPAPI 生图网络请求失败", { message: error.message }, true));
    });
    req.write(data, "utf8");
    req.end();
  });
}

function normalizePPAPIResponse(rawPayload, durationMs) {
  let payload = rawPayload;
  if (typeof rawPayload === "string") {
    try {
      payload = JSON.parse(rawPayload || "{}");
    } catch (error) {
      throw ppapiError("invalid_json", "PPAPI 生图响应不是合法 JSON", { detail: rawPayload.slice(0, 500) }, false);
    }
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw ppapiError("invalid_response", "PPAPI 生图响应格式不正确", null, false);
  }
  return {
    payload,
    meta: {
      durationMs,
      responseBytes: Buffer.byteLength(JSON.stringify(payload), "utf8"),
      imageCount: extractImageItems(payload).length,
      model: "gpt-image-2",
    },
  };
}

function extractImageItems(payload) {
  if (Array.isArray(payload?.data)) return payload.data.filter((item) => item && typeof item === "object");
  if (Array.isArray(payload?.images)) return payload.images.filter((item) => item && typeof item === "object");
  if (payload && typeof payload === "object" && ["url", "image_url", "b64_json", "base64", "image"].some((key) => payload[key])) return [payload];
  return [];
}

function classifyHTTPError(statusCode, rawBody) {
  const { providerErrorCode, providerMessage } = providerErrorFields(rawBody);
  const combined = `${providerErrorCode ?? ""} ${providerMessage ?? ""} ${rawBody ?? ""}`.toLowerCase();
  if ([401, 403].includes(statusCode) || combined.includes("api_key") || combined.includes("authorization")) return ppapiError("auth_error", "PPAPI 鉴权失败", errorPayload(statusCode, providerErrorCode, providerMessage, rawBody), false);
  if (statusCode === 413) return ppapiError("file_too_large", "PPAPI 请求体过大", errorPayload(statusCode, providerErrorCode, providerMessage, rawBody), false);
  if (statusCode === 429) return ppapiError("rate_limited", "PPAPI 请求被限流", errorPayload(statusCode, providerErrorCode, providerMessage, rawBody), true);
  if ([400, 422].includes(statusCode) && ["policy", "moderation", "safety", "content_filter", "blocked", "rejected"].some((token) => combined.includes(token))) return ppapiError("prompt_rejected", "PPAPI 拒绝了当前 prompt", errorPayload(statusCode, providerErrorCode, providerMessage, rawBody), false);
  if ([400, 422].includes(statusCode)) return ppapiError("bad_request", "PPAPI 请求参数不合法", errorPayload(statusCode, providerErrorCode, providerMessage, rawBody), false);
  if (statusCode >= 500) return ppapiError("server_error", "PPAPI 服务暂时失败", errorPayload(statusCode, providerErrorCode, providerMessage, rawBody), true);
  return ppapiError("http_error", "PPAPI 请求失败", errorPayload(statusCode, providerErrorCode, providerMessage, rawBody), false);
}

function providerErrorFields(rawBody) {
  try {
    const payload = JSON.parse(rawBody || "{}");
    const errorPayload = payload?.error && typeof payload.error === "object" ? payload.error : payload;
    return {
      providerErrorCode: errorPayload.code ?? errorPayload.type ?? null,
      providerMessage: errorPayload.message ?? errorPayload.detail ?? null,
    };
  } catch {
    return { providerErrorCode: null, providerMessage: null };
  }
}

function errorPayload(providerStatus, providerErrorCode, providerMessage, rawBody) {
  return {
    providerStatus,
    providerErrorCode,
    providerMessage,
    detail: String(rawBody ?? "").slice(0, 500),
  };
}

function ppapiError(code, message, debugPayload = null, retryable = true) {
  const error = new Error(message);
  error.code = code;
  error.safeSummary = message;
  error.debugPayload = debugPayload;
  error.retryable = retryable;
  if (debugPayload?.providerStatus) error.providerStatus = debugPayload.providerStatus;
  if (debugPayload?.providerErrorCode) error.providerErrorCode = debugPayload.providerErrorCode;
  if (debugPayload?.providerMessage) error.providerMessage = debugPayload.providerMessage;
  return error;
}

module.exports = {
  DEFAULT_PPAPI_IMAGE_URL,
  createPPAPIProvider,
  buildPPAPIRequestBody,
  extractImageItems,
  normalizePPAPIResponse,
  classifyHTTPError,
  ppapiError,
};
