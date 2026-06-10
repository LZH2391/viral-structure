const { request: httpRequest } = require("http");
const { request: httpsRequest } = require("https");
const { randomBytes } = require("crypto");
const fs = require("fs/promises");
const path = require("path");

const DEFAULT_IMAGE_GENERATION_PROVIDER = process.env.IMAGE_GENERATION_PROVIDER || "pptoken";
const DEFAULT_IMAGE_GENERATIONS_URL = process.env.IMAGE_GENERATION_GENERATIONS_URL || "https://api.pptoken.cc/v1/images/generations";
const DEFAULT_IMAGE_EDITS_URL = process.env.IMAGE_GENERATION_EDITS_URL || "https://api.pptoken.cc/v1/images/edits";

function createPPAPIProvider({ apiKey = null, url = DEFAULT_IMAGE_GENERATIONS_URL, editsUrl = DEFAULT_IMAGE_EDITS_URL, providerName = DEFAULT_IMAGE_GENERATION_PROVIDER, requestImpl = null } = {}) {
  return {
    providerName,
    request: async (requestPayload = {}, options = {}) => {
      const token = resolveApiKey(apiKey);
      const startedAt = Date.now();
      const rawPayload = requestPayload.referenceImagePath
        ? await requestImageEdit({
          requestPayload,
          options,
          token,
          editsUrl,
          requestImpl,
        })
        : await requestImageGeneration({
          requestPayload,
          options,
          token,
          url,
          requestImpl,
        });
      return normalizePPAPIResponse(rawPayload, Date.now() - startedAt, requestPayload.referenceImagePath ? "edits" : "generations");
    },
  };
}

async function requestImageGeneration({ requestPayload, options, token, url, requestImpl }) {
  const body = buildPPAPIRequestBody(requestPayload);
  return requestImpl
    ? requestImpl({ mode: "generations", url, body, headers: ppapiJsonHeaders(token), timeoutSeconds: options.timeoutSeconds })
    : postJson(url, body, ppapiJsonHeaders(token), options.timeoutSeconds);
}

async function requestImageEdit({ requestPayload, options, token, editsUrl, requestImpl }) {
  const { fields, files } = await buildPPAPIEditForm(requestPayload);
  return requestImpl
    ? requestImpl({ mode: "edits", url: editsUrl, fields, files, headers: ppapiAuthHeaders(token), timeoutSeconds: options.timeoutSeconds })
    : postMultipart(editsUrl, fields, files, ppapiAuthHeaders(token), options.timeoutSeconds);
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

async function buildPPAPIEditForm({ prompt, referenceImagePath, size = "auto", quality = "auto", background = "auto", outputFormat = "png", n = 1 } = {}) {
  const text = String(prompt ?? "").trim();
  if (!text) throw ppapiError("prompt_empty", "生图 prompt 为空", { promptChars: 0 }, false);
  const imagePath = String(referenceImagePath ?? "").trim();
  if (!imagePath) throw ppapiError("reference_image_missing", "参考图路径为空", null, false);
  let stat = null;
  try {
    stat = await fs.stat(imagePath);
  } catch {
    throw ppapiError("reference_image_missing", "参考图文件不存在", { referenceImage: path.basename(imagePath) }, false);
  }
  if (!stat.isFile()) throw ppapiError("reference_image_missing", "参考图路径不是文件", { referenceImage: path.basename(imagePath) }, false);
  return {
    fields: {
      model: "gpt-image-2",
      prompt: text,
      size,
      quality,
      background,
      output_format: outputFormat,
      moderation: "auto",
      ...(Number(n) > 1 ? { n: String(Math.floor(Number(n))) } : {}),
    },
    files: {
      image: {
        path: imagePath,
        filename: path.basename(imagePath),
        contentType: inferImageContentType(imagePath),
      },
    },
  };
}

function resolveApiKey(explicitKey) {
  const value = explicitKey || process.env.IMAGE_GENERATION_API_KEY;
  const token = String(value ?? "").trim();
  if (!token) throw ppapiError("missing_api_key", "IMAGE_GENERATION_API_KEY 未配置", null, false);
  return token;
}

function ppapiAuthHeaders(apiKey) {
  const token = String(apiKey ?? "").trim();
  const rawToken = token.toLowerCase().startsWith("bearer ") ? token.slice(7).trim() : token;
  return {
    Accept: "application/json",
    Authorization: token.toLowerCase().startsWith("bearer ") ? token : `Bearer ${token}`,
    "x-api-key": rawToken,
  };
}

function ppapiJsonHeaders(apiKey) {
  return {
    ...ppapiAuthHeaders(apiKey),
    "Content-Type": "application/json",
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
      req.destroy(ppapiError("network_timeout", "生图服务请求超时", { timeoutSeconds }, true));
    });
    req.on("error", (error) => {
      reject(error?.code ? error : ppapiError("network_error", "生图服务网络请求失败", { message: error.message }, true));
    });
    req.write(data, "utf8");
    req.end();
  });
}

async function postMultipart(url, fields, files, headers, timeoutSeconds) {
  const { body, contentType } = await buildMultipartBody(fields, files);
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const transport = target.protocol === "http:" ? httpRequest : httpsRequest;
    const req = transport({
      method: "POST",
      hostname: target.hostname,
      port: target.port || undefined,
      path: `${target.pathname}${target.search}`,
      headers: {
        ...headers,
        "Content-Type": contentType,
        "Content-Length": body.length,
      },
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
      req.destroy(ppapiError("network_timeout", "生图服务请求超时", { timeoutSeconds }, true));
    });
    req.on("error", (error) => {
      reject(error?.code ? error : ppapiError("network_error", "生图服务网络请求失败", { message: error.message }, true));
    });
    req.write(body);
    req.end();
  });
}

async function buildMultipartBody(fields, files) {
  const boundary = `----codex-ppapi-${randomBytes(12).toString("hex")}`;
  const chunks = [];
  for (const [name, value] of Object.entries(fields ?? {})) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${escapeMultipartName(name)}"\r\n\r\n${String(value)}\r\n`, "utf8"));
  }
  for (const [name, file] of Object.entries(files ?? {})) {
    const content = await fs.readFile(file.path);
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${escapeMultipartName(name)}"; filename="${escapeMultipartName(file.filename)}"\r\nContent-Type: ${file.contentType || "application/octet-stream"}\r\n\r\n`, "utf8"));
    chunks.push(content);
    chunks.push(Buffer.from("\r\n", "utf8"));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`, "utf8"));
  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

function escapeMultipartName(value) {
  return String(value ?? "").replace(/["\r\n]/g, "_");
}

function inferImageContentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  if (extension === ".png") return "image/png";
  return "application/octet-stream";
}

function normalizePPAPIResponse(rawPayload, durationMs, requestMode = "generations") {
  let payload = rawPayload;
  if (typeof rawPayload === "string") {
    try {
      payload = JSON.parse(rawPayload || "{}");
    } catch (error) {
      throw ppapiError("invalid_json", "生图服务响应不是合法 JSON", { detail: rawPayload.slice(0, 500) }, false);
    }
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw ppapiError("invalid_response", "生图服务响应格式不正确", null, false);
  }
  return {
    payload,
    meta: {
      durationMs,
      responseBytes: Buffer.byteLength(JSON.stringify(payload), "utf8"),
      imageCount: extractImageItems(payload).length,
      model: "gpt-image-2",
      requestMode,
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
  if ([401, 403].includes(statusCode) || combined.includes("api_key") || combined.includes("authorization")) return ppapiError("auth_error", "生图服务鉴权失败", errorPayload(statusCode, providerErrorCode, providerMessage, rawBody), false);
  if (statusCode === 413) return ppapiError("file_too_large", "生图服务请求体过大", errorPayload(statusCode, providerErrorCode, providerMessage, rawBody), false);
  if (statusCode === 429) return ppapiError("rate_limited", "生图服务请求被限流", errorPayload(statusCode, providerErrorCode, providerMessage, rawBody), true);
  if ([400, 422].includes(statusCode) && ["policy", "moderation", "safety", "content_filter", "blocked", "rejected"].some((token) => combined.includes(token))) return ppapiError("prompt_rejected", "生图服务拒绝了当前 prompt", errorPayload(statusCode, providerErrorCode, providerMessage, rawBody), false);
  if ([400, 422].includes(statusCode)) return ppapiError("bad_request", "生图服务请求参数不合法", errorPayload(statusCode, providerErrorCode, providerMessage, rawBody), false);
  if (statusCode >= 500) return ppapiError("server_error", "生图服务暂时失败", errorPayload(statusCode, providerErrorCode, providerMessage, rawBody), true);
  return ppapiError("http_error", "生图服务请求失败", errorPayload(statusCode, providerErrorCode, providerMessage, rawBody), false);
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
  DEFAULT_IMAGE_GENERATION_PROVIDER,
  DEFAULT_IMAGE_GENERATIONS_URL,
  DEFAULT_IMAGE_EDITS_URL,
  createPPAPIProvider,
  buildPPAPIRequestBody,
  buildPPAPIEditForm,
  extractImageItems,
  normalizePPAPIResponse,
  classifyHTTPError,
  ppapiError,
};
