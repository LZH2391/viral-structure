const { createModuleDefinition, toPublicModuleEntry } = require("./definition");
const { MODULE_DEFINITIONS } = require("./catalog");
const { createExecutorRegistry } = require("../executors/registry");

function createModuleRegistry(options = {}) {
  const serviceOverrides = options.serviceOverrides ?? {};
  const executorRegistry = options.executorRegistry ?? createExecutorRegistry(options);
  const entries = MODULE_DEFINITIONS.map((definition) => ({ ...definition, service: serviceOverrides[definition.serviceKey] ?? null }));
  const byModuleId = indexBy(entries, "moduleId");
  const byLegacyPathSegment = indexBy(entries, "legacyPathSegment");
  const byCacheKind = indexBy(entries, "cacheKind");

  return {
    list: () => entries.map(toPublicModuleEntry),
    getByModuleId: (moduleId) => byModuleId.get(moduleId) ?? null,
    getByLegacyPathSegment: (legacyPathSegment) => byLegacyPathSegment.get(legacyPathSegment) ?? null,
    getByCacheKind: (cacheKind) => byCacheKind.get(cacheKind) ?? null,
    startModule: ({ moduleId, sampleVideoId, body = {} }) => {
      const entry = byModuleId.get(moduleId);
      if (!entry) throw notFoundError("module_not_found", "未知模块", { moduleId });
      if (typeof entry.startOptionsFromBody !== "function") throw unsupportedError("module_start_unsupported", "模块不支持启动", { moduleId });
      return executeServiceModule(executorRegistry, entry, options, "enqueue", [entry.startOptionsFromBody({ sampleVideoId, body })]);
    },
    startLegacyModule: ({ legacyPathSegment, sampleVideoId, body = {} }) => {
      const entry = byLegacyPathSegment.get(legacyPathSegment);
      if (!entry) throw notFoundError("module_not_found", "未知模块", { legacyPathSegment });
      if (typeof entry.startOptionsFromBody !== "function") throw unsupportedError("module_start_unsupported", "模块不支持启动", { legacyPathSegment });
      return executeServiceModule(executorRegistry, entry, options, "enqueue", [entry.startOptionsFromBody({ sampleVideoId, body })]);
    },
    resolveModuleCacheDecision: ({ cacheKind, jobId, decision }) => {
      const entry = byCacheKind.get(cacheKind);
      if (!entry) return null;
      return executeServiceModule(executorRegistry, entry, options, "resolveCacheDecision", [{ jobId, decision }]);
    },
  };
}

async function executeServiceModule(executorRegistry, entry, options, method, args) {
  const execution = await executorRegistry.execute(entry.executorRef?.kind ?? entry.executorKind, {
    service: resolveService(entry, options),
    method,
    args,
  }, { moduleId: entry.moduleId });
  if (method === "enqueue") assertModuleStarted(execution.result, entry);
  return execution.result;
}

function assertModuleStarted(result, entry) {
  if (result?.ok === false) {
    throw moduleStartError(
      result.error ?? result.code ?? "module_start_failed",
      result.message ?? "模块启动失败",
      { moduleId: entry.moduleId, result },
      result.retryable !== false,
      result.statusCode ?? 502,
    );
  }
  if (result?.processingJobId) return;
  throw moduleStartError(
    "module_start_result_invalid",
    "模块启动未返回 processingJobId",
    { moduleId: entry.moduleId, result },
    true,
    502,
  );
}

function resolveService(entry, options) {
  if (!entry.service) entry.service = createServiceForDefinition(entry, options);
  return entry.service;
}

function createServiceForDefinition(definition, options) {
  if (typeof definition.createService === "function") {
    return definition.createService(options);
  }
  throw new Error(`Unsupported module executor: ${definition.executorKind ?? "unknown"}`);
}

function indexBy(entries, key) {
  return new Map(entries.map((entry) => [entry[key], entry]));
}

function notFoundError(code, message, debugPayload = {}) {
  const error = new Error(message);
  error.statusCode = 404;
  error.code = code;
  error.debugPayload = debugPayload;
  error.retryable = false;
  return error;
}

function unsupportedError(code, message, debugPayload = {}) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = code;
  error.debugPayload = debugPayload;
  error.retryable = false;
  return error;
}

function moduleStartError(code, message, debugPayload = {}, retryable = true, statusCode = 502) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.debugPayload = debugPayload;
  error.retryable = retryable;
  return error;
}

module.exports = {
  MODULE_DEFINITIONS,
  createModuleDefinition,
  createModuleRegistry,
  toPublicModuleEntry,
};
