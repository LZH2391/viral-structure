const fs = require("fs/promises");
const { request: httpRequest } = require("http");
const { request: httpsRequest } = require("https");
const path = require("path");

const IMAGE_KEYS = ["b64_json", "base64", "image"];

async function writeGeneratedImages({
  store,
  sampleVideoId,
  artifactId,
  groupId,
  providerResult,
}) {
  const items = extractImageItems(providerResult?.payload ?? providerResult);
  if (!items.length) throw artifactError("image_generation_no_images", "生图响应中没有图片", null, false);
  const outputDir = path.join(store.sampleDir(sampleVideoId), "image-generation", artifactId);
  await fs.mkdir(outputDir, { recursive: true });
  const images = [];
  for (let index = 0; index < items.length; index += 1) {
    const { buffer, sourceUrl } = await decodeImageItem(items[index]);
    const filename = outputFilename(groupId, index + 1, items.length);
    const filePath = path.join(outputDir, filename);
    await fs.writeFile(filePath, buffer);
    images.push({
      index: index + 1,
      filename,
      path: filePath,
      uri: store.runtimeUri(filePath),
      bytes: buffer.length,
      sourceUrl,
    });
  }
  return images;
}

async function writeImageGenerationArtifact({
  store,
  sampleVideoId,
  artifact,
}) {
  const artifactDir = path.join(store.sampleDir(sampleVideoId), "image-generation", artifact.artifactId);
  const artifactPath = path.join(artifactDir, "artifact.json");
  await store.writeJson(artifactPath, artifact);
  return {
    ...artifact,
    uri: store.runtimeUri(artifactPath),
  };
}

function extractImageItems(payload) {
  if (Array.isArray(payload?.data)) return payload.data.filter((item) => item && typeof item === "object");
  if (Array.isArray(payload?.images)) return payload.images.filter((item) => item && typeof item === "object");
  if (payload && typeof payload === "object" && ["url", "image_url", ...IMAGE_KEYS].some((key) => payload[key])) return [payload];
  return [];
}

async function decodeImageItem(item) {
  for (const key of IMAGE_KEYS) {
    const value = item[key];
    if (typeof value !== "string" || !value.trim()) continue;
    const raw = value.trim().startsWith("data:") ? value.trim().split(",", 2)[1] : value.trim();
    try {
      return { buffer: Buffer.from(raw, "base64"), sourceUrl: null };
    } catch (error) {
      throw artifactError("image_generation_invalid_image_payload", "生图图片 base64 无法解析", { key }, false);
    }
  }
  const url = String(item.url ?? item.image_url ?? "").trim();
  if (url) {
    return { buffer: await downloadBinary(url), sourceUrl: url };
  }
  throw artifactError("image_generation_invalid_image_payload", "生图图片响应缺少 base64 或 URL", null, false);
}

function downloadBinary(url) {
  return new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(url);
    } catch {
      reject(artifactError("image_generation_invalid_image_url", "生图图片 URL 不合法", null, false));
      return;
    }
    const transport = target.protocol === "http:" ? httpRequest : httpsRequest;
    const req = transport({
      method: "GET",
      hostname: target.hostname,
      port: target.port || undefined,
      path: `${target.pathname}${target.search}`,
      headers: { "User-Agent": "viral-structure-image-generation/1.0" },
      timeout: 120000,
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(Buffer.concat(chunks));
          return;
        }
        reject(artifactError("image_generation_download_failed", "下载生图图片失败", { providerStatus: res.statusCode }, true));
      });
    });
    req.on("timeout", () => req.destroy(artifactError("image_generation_download_timeout", "下载生图图片超时", null, true)));
    req.on("error", (error) => reject(error?.code ? error : artifactError("image_generation_download_failed", "下载生图图片失败", { message: error.message }, true)));
    req.end();
  });
}

function outputFilename(groupId, index, total) {
  const safeGroup = safeFilename(String(groupId ?? "default"));
  const suffix = total > 1 ? `__${index}` : "";
  return `image_${safeGroup}${suffix}.png`;
}

function safeFilename(value) {
  return value.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim().replace(/^\.+|\.+$/g, "") || "default";
}

function artifactError(code, message, debugPayload = null, retryable = false) {
  const error = new Error(message);
  error.code = code;
  error.debugPayload = debugPayload;
  error.retryable = retryable;
  return error;
}

module.exports = {
  writeGeneratedImages,
  writeImageGenerationArtifact,
  extractImageItems,
  decodeImageItem,
};
