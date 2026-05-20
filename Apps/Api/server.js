const http = require("http");
const fs = require("fs");
const path = require("path");
const { createLocalStore } = require("../../Infrastructure/Storage/local-store");
const { createStageLogger } = require("../../Infrastructure/Observability/stage-logger");
const { parseMultipartUpload } = require("./lib/multipart");
const { createJobStore } = require("./lib/job-store");
const { createSampleProcessingService } = require("./lib/sample-processing-service");
const { sendJson, notFound, runtimeContentType } = require("./lib/http-utils");
const { createWorkbenchStaticHandler } = require("./lib/static-files");
const { readDebugTraces, readDebugTraceDetail } = require("./lib/debug-traces");

const rootDir = path.resolve(__dirname, "../..");
const port = Number(process.env.PORT || 5177);
const store = createLocalStore(rootDir);
const logger = createStageLogger(store);
const jobStore = createJobStore();
const service = createSampleProcessingService({ store, logger, jobStore });
const staticWorkbench = createWorkbenchStaticHandler(rootDir);

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") return sendJson(res, 200, {});
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === "POST" && /^\/api\/workspaces\/[^/]+\/sample-videos$/.test(url.pathname)) return handleUpload(req, res, url);
    if (req.method === "GET" && /^\/api\/processing-jobs\/[^/]+$/.test(url.pathname)) return handleJob(res, url.pathname.split("/").at(-1));
    if (req.method === "GET" && /^\/api\/sample-videos\/[^/]+\/artifact$/.test(url.pathname)) return handleArtifact(res, url.pathname.split("/").at(-2));
    if (req.method === "GET" && url.pathname === "/api/debug/traces") return handleDebugTraces(res);
    if (req.method === "GET" && /^\/api\/debug\/traces\/[^/]+$/.test(url.pathname)) return handleDebugTraceDetail(res, decodeURIComponent(url.pathname.split("/").at(-1)));
    if (req.method === "GET" && url.pathname.startsWith("/runtime/")) return handleRuntime(res, url.pathname);
    if (req.method === "GET" && staticWorkbench.handle(req, res, url.pathname)) return undefined;
    return notFound(res);
  } catch {
    return sendJson(res, 500, { error: "internal_error", message: "请求处理失败" });
  }
});

async function handleUpload(req, res, url) {
  const workspaceId = url.pathname.split("/")[3];
  const { file, fields } = await parseMultipartUpload(req, req.headers["content-type"]);
  const result = await service.enqueueUpload({ workspaceId, file, fields });
  sendJson(res, 202, result);
}

function handleJob(res, jobId) {
  const job = jobStore.getJob(jobId);
  if (!job) return notFound(res);
  return sendJson(res, 200, job);
}

async function handleArtifact(res, sampleVideoId) {
  const artifactPath = path.join(store.sampleDir(sampleVideoId), "artifact.json");
  if (!fs.existsSync(artifactPath)) return sendJson(res, 202, { sampleVideoId, status: "processing" });
  return sendJson(res, 200, await store.readJson(artifactPath));
}

async function handleDebugTraces(res) {
  return sendJson(res, 200, await readDebugTraces(store.runtimeRoot));
}

async function handleDebugTraceDetail(res, traceId) {
  const trace = await readDebugTraceDetail(store.runtimeRoot, traceId);
  if (!trace) return notFound(res);
  return sendJson(res, 200, trace);
}

function handleRuntime(res, pathname) {
  const relative = decodeURIComponent(pathname.replace(/^\/runtime\//, ""));
  const filePath = path.resolve(store.runtimeRoot, relative);
  if (!filePath.startsWith(path.resolve(store.runtimeRoot)) || !fs.existsSync(filePath)) return notFound(res);
  res.writeHead(200, { "content-type": runtimeContentType(filePath), "access-control-allow-origin": "*" });
  fs.createReadStream(filePath).pipe(res);
}

if (require.main === module) {
  server.listen(port, () => process.stdout.write(`API server listening on http://127.0.0.1:${port}\n`));
}

module.exports = { server };
