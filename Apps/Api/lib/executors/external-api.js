function createExternalApiExecutor() {
  return {
    executorKind: "external-api",
    execute: async (payload = {}, context = {}) => {
      const provider = payload.provider;
      if (!provider || typeof provider.request !== "function") {
        throw externalApiError("external_api_provider_missing", "外部 API provider 未配置", { providerName: payload.providerName ?? null }, false);
      }
      const result = await withTimeout(
        () => provider.request(payload.request ?? {}, {
          traceContext: context.traceContext ?? null,
          timeoutSeconds: payload.timeoutSeconds ?? null,
        }),
        payload.timeoutSeconds,
      ).catch((error) => {
        throw normalizeExternalApiError(error, payload);
      });
      if (result?.ok === false) {
        throw normalizeExternalApiError(providerResultError(result, payload), payload);
      }
      return {
        status: "completed",
        provider: payload.providerName ?? provider.providerName ?? null,
        result,
      };
    },
  };
}

function providerResultError(result, payload = {}) {
  const rawError = result.error && typeof result.error === "object" ? result.error : null;
  const error = new Error(result.message ?? rawError?.message ?? "外部 API provider 返回失败");
  error.code = result.errorCode ?? result.code ?? (typeof result.error === "string" ? result.error : rawError?.code) ?? "external_api_provider_failed";
  error.retryable = result.retryable ?? rawError?.retryable ?? true;
  error.providerStatus = result.providerStatus ?? result.statusCode ?? result.status ?? null;
  error.providerErrorCode = result.providerErrorCode ?? rawError?.code ?? null;
  error.providerMessage = result.providerMessage ?? rawError?.message ?? result.message ?? null;
  error.detail = result.detail ?? rawError?.detail ?? result.debugPayload ?? {
    providerName: payload.providerName ?? null,
    result,
  };
  return error;
}

function withTimeout(action, timeoutSeconds) {
  const timeoutMs = Number(timeoutSeconds) > 0 ? Number(timeoutSeconds) * 1000 : 0;
  if (!timeoutMs) return Promise.resolve().then(action);
  let timeoutHandle = null;
  return Promise.race([
    Promise.resolve().then(action),
    new Promise((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(externalApiError("external_api_timeout", "外部 API 请求超时", { timeoutSeconds: Number(timeoutSeconds) }, true));
      }, timeoutMs);
    }),
  ]).finally(() => {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  });
}

function normalizeExternalApiError(error, payload = {}) {
  if (error?.code) {
    return externalApiError(error.code, error.safeSummary ?? error.message ?? "外部 API 请求失败", sanitizeDebugPayload({
      providerName: payload.providerName ?? null,
      providerStatus: error.providerStatus ?? error.statusCode ?? null,
      providerErrorCode: error.providerErrorCode ?? null,
      providerMessage: error.providerMessage ?? null,
      retryable: error.retryable ?? null,
      detail: error.detail ?? null,
    }), Boolean(error.retryable));
  }
  return externalApiError("external_api_failed", "外部 API 请求失败", sanitizeDebugPayload({
    providerName: payload.providerName ?? null,
    causeName: error?.name ?? null,
    message: error?.message ?? String(error ?? ""),
  }), true);
}

function externalApiError(code, message, debugPayload = null, retryable = true) {
  const error = new Error(message);
  error.code = code;
  error.debugPayload = debugPayload;
  error.retryable = retryable;
  return error;
}

function sanitizeDebugPayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  return Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, sanitizeValue(value)]));
}

function sanitizeValue(value) {
  if (typeof value !== "string") return value ?? null;
  const redacted = value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/[A-Za-z]:[\\/][^\s"'<>]+/g, "[local-path]")
    .replace(/\/[^\s"'<>]+/g, "[local-path]");
  return redacted.length <= 500 ? redacted : `${redacted.slice(0, 500)}...`;
}

module.exports = {
  createExternalApiExecutor,
  externalApiError,
};
