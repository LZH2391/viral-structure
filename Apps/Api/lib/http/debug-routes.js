const { sendJson, notFound } = require("./utils");

async function handleDebugTraces(res, handlers = {}) {
  return sendJson(res, 200, await handlers.readDebugTracesImpl(handlers.store.runtimeRoot));
}

async function handleUiDebugEvent(req, res, handlers = {}) {
  const body = await handlers.readJsonBodyImpl(req);
  return sendJson(res, 200, await handlers.ingestUiDebugEventImpl(handlers.logger, body));
}

async function handleDebugTraceDetail(res, traceId, handlers = {}) {
  const trace = await handlers.readDebugTraceDetailImpl(handlers.store.runtimeRoot, traceId);
  if (!trace) return notFound(res);
  return sendJson(res, 200, trace);
}

module.exports = {
  handleDebugTraces,
  handleUiDebugEvent,
  handleDebugTraceDetail,
};
