const { sendJson } = require("./utils");
const { platformErrorBody } = require("./platform-errors");

async function handlePlatformRoute(req, res, url, handlers = {}) {
  if (req.method === "GET" && url.pathname === "/api/platform/v1/catalog") {
    handleCatalog(res, url, handlers);
    return true;
  }
  if (req.method === "GET" && url.pathname === "/api/platform/v1/resources") {
    await handleResourceList(res, url, handlers);
    return true;
  }
  if (req.method === "POST" && url.pathname === "/api/platform/v1/commands") {
    await handleCommand(req, res, handlers);
    return true;
  }
  if (req.method === "GET" && /^\/api\/platform\/v1\/traces\/[^/]+$/.test(url.pathname)) {
    await handleTraceRead(res, decodeURIComponent(url.pathname.split("/").at(-1)), handlers);
    return true;
  }
  if (req.method === "GET" && /^\/api\/platform\/v1\/artifacts\/[^/]+$/.test(url.pathname)) {
    await handleArtifactResolution(res, decodeURIComponent(url.pathname.split("/").at(-1)), url, handlers);
    return true;
  }
  if (req.method === "GET" && /^\/api\/platform\/v1\/runtime-state\/[^/]+\/[^/]+$/.test(url.pathname)) {
    const parts = url.pathname.split("/");
    await handleRuntimeState(res, decodeURIComponent(parts.at(-2)), decodeURIComponent(parts.at(-1)), handlers);
    return true;
  }
  if (req.method === "GET" && /^\/api\/platform\/v1\/resources\/[^/]+\/[^/]+\/actions$/.test(url.pathname)) {
    const parts = url.pathname.split("/");
    await handleResourceActions(res, decodeURIComponent(parts.at(-3)), decodeURIComponent(parts.at(-2)), handlers);
    return true;
  }
  if (req.method === "GET" && /^\/api\/platform\/v1\/resources\/[^/]+\/[^/]+\/lineage$/.test(url.pathname)) {
    const parts = url.pathname.split("/");
    await handleResourceLineage(res, decodeURIComponent(parts.at(-3)), decodeURIComponent(parts.at(-2)), handlers);
    return true;
  }
  if (req.method === "GET" && /^\/api\/platform\/v1\/resources\/[^/]+\/[^/]+$/.test(url.pathname)) {
    const parts = url.pathname.split("/");
    await handleResourceRead(res, decodeURIComponent(parts.at(-2)), decodeURIComponent(parts.at(-1)), handlers);
    return true;
  }
  return false;
}

async function handleCommand(req, res, handlers = {}) {
  const body = await handlers.readJsonBodyImpl(req);
  const result = await handlers.commandDispatcher.execute(body);
  return sendJson(res, 202, result);
}

function handleCatalog(res, url, handlers = {}) {
  const includeInternal = url.searchParams.get("includeInternal") === "true";
  const catalog = handlers.resourceCatalog;
  return sendJson(res, 200, {
    schemaVersion: "platform_catalog_response.v1",
    catalogVersion: catalog.schemaVersion,
    resources: catalog.list({ includeInternal }),
  });
}

async function handleResourceList(res, url, handlers = {}) {
  const resourceKind = url.searchParams.get("kind");
  const result = await handlers.resourceResolver.list({ resourceKind });
  if (!result) {
    return sendJson(res, 404, platformErrorBody({
      code: "resource_kind_not_found",
      message: "未找到该资源类型",
      resource: { resourceKind: resourceKind ?? null, resourceId: null },
      retryable: false,
    }));
  }
  return sendJson(res, 200, result);
}

async function handleResourceRead(res, resourceKind, resourceId, handlers = {}) {
  const resource = resourceKind === "projection"
    ? await handlers.projectionResolver.read({ projectionId: resourceId })
    : await handlers.resourceResolver.read({ resourceKind, resourceId });
  if (!resource) {
    return sendJson(res, 404, platformErrorBody({
      code: "resource_not_found",
      message: "未找到该资源",
      resource: { resourceKind, resourceId },
      retryable: false,
    }));
  }
  return sendJson(res, 200, resource);
}

async function handleArtifactResolution(res, artifactId, url, handlers = {}) {
  const resolution = await handlers.artifactResolver.resolve({
    artifactId,
    sampleVideoId: url.searchParams.get("sampleVideoId"),
  });
  if (!resolution.exists) {
    return sendJson(res, 404, platformErrorBody({
      code: "artifact_not_found",
      message: "未找到该 artifact",
      resource: { resourceKind: "artifact", resourceId: artifactId },
      retryable: false,
      details: { resolution },
    }));
  }
  return sendJson(res, 200, resolution);
}

async function handleRuntimeState(res, resourceKind, resourceId, handlers = {}) {
  const state = await handlers.runtimeStateResolver.resolve({ resourceKind, resourceId });
  if (!state) {
    return sendJson(res, 404, platformErrorBody({
      code: "runtime_state_not_found",
      message: "未找到该运行状态",
      resource: { resourceKind, resourceId },
      retryable: false,
    }));
  }
  return sendJson(res, 200, state);
}

async function handleResourceLineage(res, resourceKind, resourceId, handlers = {}) {
  const lineage = await handlers.lineageResolver.resolve({ resourceKind, resourceId });
  if (!lineage) {
    return sendJson(res, 404, platformErrorBody({
      code: "resource_lineage_not_found",
      message: "未找到该资源血缘",
      resource: { resourceKind, resourceId },
      retryable: false,
    }));
  }
  return sendJson(res, 200, lineage);
}

async function handleResourceActions(res, resourceKind, resourceId, handlers = {}) {
  const result = await handlers.actionRegistry.listActions({ resourceKind, resourceId });
  if (!result) {
    return sendJson(res, 404, platformErrorBody({
      code: "resource_actions_not_found",
      message: "未找到该资源的动作声明",
      resource: { resourceKind, resourceId },
      retryable: false,
    }));
  }
  return sendJson(res, 200, result);
}

async function handleTraceRead(res, traceId, handlers = {}) {
  const trace = await handlers.traceResolver.read({ traceId });
  if (!trace) {
    return sendJson(res, 404, platformErrorBody({
      code: "trace_not_found",
      message: "未找到该 trace",
      resource: { resourceKind: "trace", resourceId: traceId },
      retryable: false,
    }));
  }
  return sendJson(res, 200, trace);
}

module.exports = {
  handlePlatformRoute,
};
