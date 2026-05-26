const { createModuleDefinition, toPublicModuleEntry } = require("./module-definition");
const { MODULE_DEFINITIONS } = require("./module-catalog");
const { createExecutorRegistry } = require("./executor-registry");

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
  return execution.result;
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

module.exports = {
  MODULE_DEFINITIONS,
  createModuleDefinition,
  createModuleRegistry,
  toPublicModuleEntry,
};
