const path = require("path");

async function parseMultipartUpload(req, contentType) {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || "");
  if (!boundaryMatch) throw new Error("missing multipart boundary");
  const boundary = `--${boundaryMatch[1] || boundaryMatch[2]}`;
  const buffer = await readRequestBuffer(req);
  const parts = buffer.toString("binary").split(boundary);
  const fields = {};
  let file = null;
  for (const part of parts) {
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd < 0) continue;
    const header = part.slice(0, headerEnd);
    const fieldName = parseHeaderValue(header, "name");
    if (!fieldName) continue;
    if (!/filename\*?=/i.test(part)) {
      fields[fieldName] = parseFieldValue(part.slice(headerEnd + 4));
      continue;
    }
    const filename = sanitizeFilename(parseHeaderValue(header, "filename") || "sample-video");
    const mimeType = parseHeaderValue(header, "Content-Type") || "application/octet-stream";
    let content = Buffer.from(part.slice(headerEnd + 4), "binary");
    if (content.slice(-2).toString("binary") === "\r\n") content = content.slice(0, -2);
    file = {
      filename,
      mimeType,
      extension: path.extname(filename),
      size: content.length,
      buffer: content,
    };
  }
  if (!file) throw new Error("missing upload file");
  return { file, fields };
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
  if (key.toLowerCase() === "content-type") {
    return /^content-type:\s*([^\r\n]+)/im.exec(header)?.[1]?.trim() ?? null;
  }
  const extendedRegex = new RegExp(`${escapeRegExp(key)}\\*=([^;\\r\\n]+)`, "i");
  const extended = extendedRegex.exec(header)?.[1];
  if (extended) return decodeExtendedHeaderValue(extended);
  const regex = new RegExp(`${escapeRegExp(key)}=(?:"([^"\\r\\n]*)"|([^;\\r\\n]*))`, "i");
  const match = regex.exec(header);
  if (!match) return null;
  return decodeHeaderParamValue(match[1] ?? match[2] ?? "", key);
}

function parseFieldValue(value) {
  return Buffer.from(value.replace(/\r\n$/, ""), "binary").toString("utf8");
}

function sanitizeFilename(filename) {
  return path.basename(filename).replace(/[^\w.\-\u4e00-\u9fa5]/g, "_");
}

function decodeHeaderParamValue(value, key) {
  const text = String(value ?? "").trim();
  if (key.toLowerCase() !== "filename") return text;
  return Buffer.from(text, "binary").toString("utf8");
}

function decodeExtendedHeaderValue(value) {
  const text = String(value ?? "").trim();
  const match = /^([^']*)'[^']*'(.*)$/.exec(text);
  if (!match) return decodeURIComponent(text);
  const charset = match[1].toLowerCase();
  const encoded = match[2];
  if (charset && charset !== "utf-8") return decodeURIComponent(encoded);
  return decodeURIComponent(encoded);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = { parseMultipartUpload };
