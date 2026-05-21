const fs = require("fs");
const path = require("path");
const { notFound, runtimeContentType } = require("./http-utils");

function sendRuntimeFile(req, res, runtimeRoot, pathname) {
  const filePath = resolveRuntimePath(runtimeRoot, pathname);
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return notFound(res);
  const stat = fs.statSync(filePath);
  const baseHeaders = {
    "content-type": runtimeContentType(filePath),
    "access-control-allow-origin": "*",
    "accept-ranges": "bytes",
  };
  if (stat.size <= 0) {
    res.writeHead(200, { ...baseHeaders, "content-length": 0 });
    res.end();
    return undefined;
  }
  const range = parseRangeHeader(req.headers.range, stat.size);
  if (range?.invalid) {
    res.writeHead(416, { ...baseHeaders, "content-range": `bytes */${stat.size}` });
    res.end();
    return undefined;
  }
  if (range) {
    const length = range.end - range.start + 1;
    res.writeHead(206, {
      ...baseHeaders,
      "content-length": length,
      "content-range": `bytes ${range.start}-${range.end}/${stat.size}`,
    });
    fs.createReadStream(filePath, { start: range.start, end: range.end }).pipe(res);
    return undefined;
  }
  res.writeHead(200, { ...baseHeaders, "content-length": stat.size });
  fs.createReadStream(filePath).pipe(res);
  return undefined;
}

function resolveRuntimePath(runtimeRoot, pathname) {
  const relative = decodeURIComponent(pathname.replace(/^\/runtime\//, ""));
  const filePath = path.resolve(runtimeRoot, relative);
  const root = path.resolve(runtimeRoot);
  return filePath.startsWith(root) ? filePath : null;
}

function parseRangeHeader(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!match) return { invalid: true };
  const [, startText, endText] = match;
  if (!startText && !endText) return { invalid: true };
  if (!startText) {
    const suffixLength = Number(endText);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return { invalid: true };
    const start = Math.max(0, size - suffixLength);
    return { start, end: size - 1 };
  }
  const start = Number(startText);
  const end = endText ? Number(endText) : size - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= size) return { invalid: true };
  return { start, end: Math.min(end, size - 1) };
}

module.exports = { parseRangeHeader, resolveRuntimePath, sendRuntimeFile };
