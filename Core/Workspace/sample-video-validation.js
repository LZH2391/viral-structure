const { PROCESSING_ERRORS } = require("./sample-video-contracts");

const MAX_FILE_SIZE_BYTES = 500 * 1024 * 1024;
const MAX_DURATION_SECONDS = 10 * 60;
const ALLOWED_EXTENSIONS = new Set([".mp4", ".mov", ".m4v", ".webm"]);
const ALLOWED_MIME_PREFIXES = ["video/"];

function validateUploadFile(file) {
  const extension = (file.extension || "").toLowerCase();
  const mimeType = file.mimeType || "";
  if (!ALLOWED_EXTENSIONS.has(extension) && !ALLOWED_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix))) {
    return fail(PROCESSING_ERRORS.invalidFileType, "仅支持常见视频文件");
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return fail(PROCESSING_ERRORS.fileTooLarge, "视频文件过大");
  }
  return { ok: true };
}

function validateDuration(durationSeconds) {
  if (Number.isFinite(durationSeconds) && durationSeconds > MAX_DURATION_SECONDS) {
    return fail(PROCESSING_ERRORS.durationTooLong, "视频时长超出第一版处理限制");
  }
  return { ok: true };
}

function fail(code, message) {
  return { ok: false, error: { code, message } };
}

module.exports = {
  MAX_FILE_SIZE_BYTES,
  MAX_DURATION_SECONDS,
  validateUploadFile,
  validateDuration,
};
