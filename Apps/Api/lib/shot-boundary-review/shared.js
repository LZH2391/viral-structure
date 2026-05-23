const path = require("path");
const { createHash } = require("crypto");

const REVIEW_ROLE = "shot-boundary-reviewer";
const REVIEW_SKILL_PATH = "C:\\ByteDanceFullStack\\.agents\\skills\\shot-boundary-reviewer\\SKILL.md";
const REVIEW_INPUT_SCHEMA_VERSION = "shot-boundary-review-input.v1";
const REVIEW_RESULT_SCHEMA_VERSION = "shot-boundary-review.v1";
const REVIEW_SHEET_PURPOSE = "shot_boundary_review";
const REVIEW_SHEET_SUBDIR = "sheets";
const MAX_REVIEW_REWORK_COUNT = 2;

function sanitizeForAppServerText(value) {
  if (typeof value === "string") return value.replace(/[\uD800-\uDFFF]/g, "");
  if (Array.isArray(value)) return value.map((item) => sanitizeForAppServerText(item));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeForAppServerText(item)]));
}

function normalizeReviewShot(shot) {
  const shotNo = String(shot?.shotNo ?? `S${String((Number(shot?.index) || 0) + 1).padStart(3, "0")}`);
  return {
    shotNo,
    shotId: shot?.id ?? null,
    index: Number.isInteger(shot?.index) ? shot.index : shotNumberFromShotNo(shotNo) - 1,
    start: round(Number(shot?.start ?? 0)),
    end: round(Number(shot?.end ?? 0)),
    summary: normalizeText(shot?.summary, 120),
    endBoundaryReason: shot?.endBoundaryReason == null ? null : normalizeText(shot.endBoundaryReason, 160),
  };
}

function normalizeReviewFrame(frame) {
  return {
    frameId: String(frame?.frameId ?? ""),
    artifactId: frame?.artifactId ?? null,
    parentArtifactId: frame?.parentArtifactId ?? null,
    timestamp: round(Number(frame?.timestamp ?? 0)),
    inputIndex: Number.isInteger(frame?.inputIndex) ? frame.inputIndex : 0,
    sourceFrameIndex: Number.isInteger(frame?.sourceFrameIndex) ? frame.sourceFrameIndex : 0,
    filePath: frame?.filePath ?? null,
  };
}

function normalizeReviewSubtitleContext(items) {
  return (Array.isArray(items) ? items : []).map((item) => ({
    start: round(Number(item?.start ?? 0)),
    end: round(Number(item?.end ?? 0)),
    text: normalizeText(item?.text, 120),
  })).filter((item) => item.text);
}

function normalizeText(value, maxLength) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function shotNumberFromShotNo(shotNo) {
  const match = String(shotNo ?? "").match(/(\d+)/);
  return match ? Number(match[1]) : 1;
}

function round(value) {
  return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : 0;
}

function contentHash(value) {
  return createHash("sha256").update(String(value ?? ""), "utf8").digest("hex").slice(0, 16);
}

function stripReviewSheetPath(sheet) {
  const { localImagePath, ...safeSheet } = sheet;
  return safeSheet;
}

function basename(value) {
  return path.basename(String(value ?? ""));
}

module.exports = {
  REVIEW_ROLE,
  REVIEW_SKILL_PATH,
  REVIEW_INPUT_SCHEMA_VERSION,
  REVIEW_RESULT_SCHEMA_VERSION,
  REVIEW_SHEET_PURPOSE,
  REVIEW_SHEET_SUBDIR,
  MAX_REVIEW_REWORK_COUNT,
  sanitizeForAppServerText,
  normalizeReviewShot,
  normalizeReviewFrame,
  normalizeReviewSubtitleContext,
  normalizeText,
  shotNumberFromShotNo,
  contentHash,
  stripReviewSheetPath,
  basename,
};
