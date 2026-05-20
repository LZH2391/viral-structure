const path = require("path");

async function parseMultipartUpload(req, contentType) {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || "");
  if (!boundaryMatch) throw new Error("missing multipart boundary");
  const boundary = `--${boundaryMatch[1] || boundaryMatch[2]}`;
  const buffer = await readRequestBuffer(req);
  const parts = buffer.toString("binary").split(boundary);
  for (const part of parts) {
    if (!part.includes("filename=")) continue;
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd < 0) continue;
    const header = part.slice(0, headerEnd);
    const filename = sanitizeFilename(parseHeaderValue(header, "filename") || "sample-video");
    const mimeType = parseHeaderValue(header, "Content-Type") || "application/octet-stream";
    let content = Buffer.from(part.slice(headerEnd + 4), "binary");
    if (content.slice(-2).toString("binary") === "\r\n") content = content.slice(0, -2);
    return {
      filename,
      mimeType,
      extension: path.extname(filename),
      size: content.length,
      buffer: content,
    };
  }
  throw new Error("missing upload file");
}

function readRequestBuffer(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function parseHeaderValue(header, key) {
  const regex = new RegExp(`${key}="?([^";\\r\\n]+)"?`, "i");
  return regex.exec(header)?.[1] ?? null;
}

function sanitizeFilename(filename) {
  return path.basename(filename).replace(/[^\w.\-\u4e00-\u9fa5]/g, "_");
}

module.exports = { parseMultipartUpload };
