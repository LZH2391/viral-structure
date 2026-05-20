const { PROCESSING_ERRORS } = require("./sample-video-contracts");

const MAX_FILE_SIZE_BYTES = 500 * 1024 * 1024;
const MAX_DURATION_SECONDS = 10 * 60;
const DEFAULT_FRAME_SAMPLE_RATE_FPS = 0.25;
const MIN_FRAME_SAMPLE_RATE_FPS = 0.1;
const MAX_FRAME_SAMPLE_RATE_FPS = 2;
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

function normalizeFrameSampleRateFps(value) {
  if (value === undefined || value === null || value === "") return ok(DEFAULT_FRAME_SAMPLE_RATE_FPS);
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fail("invalid_frame_sample_rate", "抽帧采样率必须是数字");
  if (numeric < MIN_FRAME_SAMPLE_RATE_FPS || numeric > MAX_FRAME_SAMPLE_RATE_FPS) {
    return fail("invalid_frame_sample_rate", "抽帧采样率必须在 0.1 到 2 fps 之间");
  }
  return ok(Number(numeric.toFixed(3)));
}

function ok(value) {
  return { ok: true, value };
}

function fail(code, message) {
  return { ok: false, error: { code, message } };
}

module.exports = {
  MAX_FILE_SIZE_BYTES,
  MAX_DURATION_SECONDS,
  DEFAULT_FRAME_SAMPLE_RATE_FPS,
  MIN_FRAME_SAMPLE_RATE_FPS,
  MAX_FRAME_SAMPLE_RATE_FPS,
  validateUploadFile,
  validateDuration,
  normalizeFrameSampleRateFps,
};
