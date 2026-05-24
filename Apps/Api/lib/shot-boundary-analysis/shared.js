const path = require("path");
const fs = require("fs/promises");
const fsSync = require("fs");
const { createHash } = require("crypto");

const ROLE = "shot-boundary-analyzer";
const SKILL_PATH = "C:\\ByteDanceFullStack\\.agents\\skills\\shot-boundary-analyzer\\SKILL.md";
const MIN_SHOT_DURATION_SECONDS = 0.01;
const MAX_REPAIR_ATTEMPTS = 1;
const ANALYSIS_SELECTION_POLICY = "target_grid_nearest_unique";
const ANALYSIS_DUPLICATE_POLICY = "nearest_unselected_tie_later";
const FRAME_SAMPLING_POLICY = "fixed_interval_from_zero";
const MIN_ANALYSIS_FPS = 1;
const MAX_ANALYSIS_FPS = 10;
const MAX_SUBTITLE_SEGMENT_TEXT_LENGTH = 120;
const MAX_SUBTITLE_CONTEXT_TOTAL_CHARS = 1600;
const MAX_COMMERCE_BRIEF_FIELD_LENGTH = 120;
const MAX_COMMERCE_BRIEF_UNCERTAINTIES = 5;
const MAX_VIDEO_SUMMARY_LENGTH = 160;
const ROLE_PROFILE_PATH = "Assets/RoleProfiles/shot-boundary-analyzer/role.json";

function safeError(error, stageName) {
  return {
    code: error?.code ?? "shot_boundary_failed",
    message: error instanceof Error ? error.message : "镜头切分失败",
    stageName,
    retryable: typeof error?.retryable === "boolean" ? error.retryable : true,
  };
}

function codedError(code, message, debugPayload = null, retryable = true) {
  const error = new Error(message);
  error.code = code;
  error.debugPayload = debugPayload;
  error.retryable = retryable;
  return error;
}

function sanitizeDebugPayload(error) {
  const details = error?.debugPayload ?? null;
  return {
    code: error?.code ?? null,
    message: error instanceof Error ? error.message : String(error ?? "unknown").slice(0, 240),
    turnId: details?.turnId ?? null,
    attemptCount: details?.attemptCount ?? null,
    requestTimeoutMs: details?.requestTimeoutMs ?? details?.lastRequestError?.request?.requestTimeoutMs ?? null,
    readinessDetail: details?.readinessDetail ?? details?.threadPool ?? null,
    lastRequestError: details?.lastRequestError ?? details?.requestError ?? null,
    outputSchemaVersion: details?.outputSchemaVersion ?? null,
    outputSummary: details?.outputSummary ?? null,
    parseFailureReason: details?.parseFailureReason ?? null,
    suspiciousReason: details?.suspiciousReason ?? null,
    collectStatus: details?.collectStatus ?? details?.status ?? null,
    finalMessagePreview: details?.finalMessagePreview ?? null,
    activeThreadMessagePreview: details?.activeThreadMessagePreview ?? null,
    validation: details?.validation ?? null,
    repairAttemptCount: details?.repairAttemptCount ?? null,
    resultOrigin: details?.resultOrigin ?? null,
    appServer: details,
  };
}

function sanitizeForAppServerText(value) {
  if (typeof value === "string") return value.replace(/[\uD800-\uDFFF]/g, "");
  if (Array.isArray(value)) return value.map((item) => sanitizeForAppServerText(item));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeForAppServerText(item)]));
}

function extractJsonObject(text) {
  const value = String(text ?? "").trim();
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start < 0 || end < start) throw codedError("agent_output_parse_failed", "切镜 Agent 未返回 JSON 对象");
  try {
    return JSON.parse(value.slice(start, end + 1));
  } catch (error) {
    error.code = "agent_output_parse_failed";
    throw error;
  }
}

function detectReasonEncodingIssue(boundaries) {
  for (const boundary of boundaries) {
    const reason = String(boundary?.reason ?? "");
    if (reason.includes("\uFFFD")) {
      return { reason: "reason contains replacement character", suspiciousReason: reason.slice(0, 160) };
    }
    if (looksLikeUtf8Mojibake(reason)) {
      return { reason: "reason matches UTF-8 mojibake pattern", suspiciousReason: reason.slice(0, 160) };
    }
    if (looksLikeGbkMojibake(reason)) {
      return { reason: "reason matches GBK mojibake pattern", suspiciousReason: reason.slice(0, 160) };
    }
  }
  return null;
}

function summarizeAgentOutput(message, rawBoundaries, normalizedBoundaries, rawShots) {
  return {
    messagePreview: String(message ?? "").replace(/\s+/g, " ").slice(0, 200),
    rawBoundaryCount: Array.isArray(rawBoundaries) ? rawBoundaries.length : 0,
    normalizedBoundaryCount: Array.isArray(normalizedBoundaries) ? normalizedBoundaries.length : 0,
    rawShotCount: Array.isArray(rawShots) ? rawShots.length : 0,
    timestamps: Array.isArray(normalizedBoundaries) ? normalizedBoundaries.slice(0, 5).map((boundary) => boundary.timestamp) : [],
  };
}

function buildSubtitleContextSummary(subtitlesArtifact, durationSeconds) {
  if (!subtitlesArtifact || subtitlesArtifact.status !== "processed" || !Array.isArray(subtitlesArtifact.segments)) {
    return {
      items: [],
      summary: {
        subtitleArtifactId: null,
        subtitleSegmentCount: 0,
        subtitleTextHash: null,
        truncated: false,
      },
    };
  }
  const safeDuration = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : Number.POSITIVE_INFINITY;
  const relevantSegments = subtitlesArtifact.segments
    .map((segment) => ({
      start: roundNormalizedTime(Number(segment?.start ?? 0)),
      end: roundNormalizedTime(Number(segment?.end ?? 0)),
      text: normalizeSubtitleText(segment?.text),
    }))
    .filter((segment) => segment.text && segment.end >= 0 && segment.start <= safeDuration);
  const items = [];
  let totalChars = 0;
  let truncated = false;
  for (const segment of relevantSegments) {
    const nextChars = totalChars + segment.text.length;
    if (nextChars > MAX_SUBTITLE_CONTEXT_TOTAL_CHARS) {
      truncated = true;
      break;
    }
    items.push({
      start: segment.start,
      end: Math.max(segment.start, segment.end),
      text: segment.text,
    });
    totalChars = nextChars;
  }
  if (!items.length && relevantSegments.length > 0) truncated = true;
  return {
    items,
    summary: {
      subtitleArtifactId: subtitlesArtifact.artifactId ?? null,
      subtitleSegmentCount: items.length,
      subtitleTextHash: items.length ? contentHash(items.map((segment) => `${segment.start}-${segment.end}:${segment.text}`).join("\n")) : null,
      truncated,
    },
  };
}

function normalizeSubtitleText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_SUBTITLE_SEGMENT_TEXT_LENGTH);
}

function resolveShotSummary(summary, fallbackReason) {
  const normalized = String(summary ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (normalized) return normalized;
  return String(fallbackReason ?? "镜头内容").replace(/\s+/g, " ").trim().slice(0, 80) || "镜头内容";
}

function normalizeCommerceBrief(rawBrief) {
  const brief = rawBrief && typeof rawBrief === "object" ? rawBrief : {};
  return {
    sellingObject: normalizeCommerceBriefField(brief.sellingObject),
    proofApproach: normalizeCommerceBriefField(brief.proofApproach),
    promisedOutcome: normalizeCommerceBriefField(brief.promisedOutcome),
    persuasionTarget: normalizeCommerceBriefField(brief.persuasionTarget),
    conversionAction: normalizeCommerceBriefConversionAction(brief.conversionAction),
    uncertainties: normalizeCommerceBriefUncertainties(brief.uncertainties),
    videoSummary: normalizeVideoSummary(brief.videoSummary),
  };
}

function normalizeCommerceBriefField(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_COMMERCE_BRIEF_FIELD_LENGTH);
}

function normalizeCommerceBriefConversionAction(value) {
  const normalized = normalizeCommerceBriefField(value);
  return normalized || "未观察到明显转化动作";
}

function normalizeCommerceBriefUncertainties(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeCommerceBriefField(item))
    .filter(Boolean)
    .slice(0, MAX_COMMERCE_BRIEF_UNCERTAINTIES);
}

function normalizeVideoSummary(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_VIDEO_SUMMARY_LENGTH);
}

function summarizeCommerceBrief(brief) {
  return {
    hasSellingObject: Boolean(brief?.sellingObject),
    hasProofApproach: Boolean(brief?.proofApproach),
    hasPromisedOutcome: Boolean(brief?.promisedOutcome),
    hasPersuasionTarget: Boolean(brief?.persuasionTarget),
    hasConversionAction: Boolean(brief?.conversionAction),
    uncertaintyCount: Array.isArray(brief?.uncertainties) ? brief.uncertainties.length : 0,
    hasVideoSummary: Boolean(brief?.videoSummary),
  };
}

function stripLocalImagePath(sheet) {
  const { localImagePath, ...safeSheet } = sheet;
  return {
    ...safeSheet,
    gridItems: Array.isArray(safeSheet.gridItems)
      ? safeSheet.gridItems.map(({ filePath, ...safeItem }) => safeItem)
      : [],
  };
}

function normalizeBoundaryType(value) {
  const normalized = String(value ?? "").trim();
  return normalized || "hard_cut";
}

function resolveRepresentativeFrameIdByTime(frames, startTime, endTime) {
  const midpoint = (startTime + endTime) / 2;
  const candidates = frames.filter((frame) => frame.timestamp >= startTime && frame.timestamp <= endTime);
  const pool = candidates.length ? candidates : frames;
  if (!pool.length) return "";
  let best = pool[0];
  for (const frame of pool) {
    if (Math.abs(frame.timestamp - midpoint) < Math.abs(best.timestamp - midpoint)) best = frame;
  }
  return best.frameId ?? "";
}

function resolveSheetStartTime(sheet) {
  const timestamps = (sheet.gridItems ?? []).map((item) => Number(item.timestamp)).filter(Number.isFinite);
  return timestamps.length ? Math.min(...timestamps) : 0;
}

function resolveSheetEndTime(sheet) {
  const timestamps = (sheet.gridItems ?? []).map((item) => Number(item.timestamp)).filter(Number.isFinite);
  return timestamps.length ? Math.max(...timestamps) : 0;
}

function invalidValidation(code, message, summary) {
  return {
    ok: false,
    code,
    message,
    summary,
  };
}

function looksLikeUtf8Mojibake(text) {
  const value = String(text ?? "");
  return /(?:Ã.|Â.|æ[\u0080-\u00FF]|å[\u0080-\u00FF]|ç[\u0080-\u00FF]|ä[\u0080-\u00FF]|é[\u0080-\u00FF]){2,}/.test(value);
}

function looksLikeGbkMojibake(text) {
  const value = String(text ?? "");
  return /(鏈|娴嬪|鏄庢|瑙嗚|鍙樺|锟斤拷)/.test(value);
}

function resolveLocalImagePath(imageUri, runtimeRoot) {
  const value = String(imageUri ?? "");
  if (runtimeRoot && value.startsWith("/runtime/")) {
    return path.join(runtimeRoot, ...value.slice("/runtime/".length).split("/"));
  }
  if (isAbsolutePath(value)) return value;
  return value;
}

function isAbsolutePath(value) {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\") || value.startsWith("/");
}

function formatShotNo(index) {
  return `S${String(index + 1).padStart(3, "0")}`;
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function round(value) {
  return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null;
}

function roundNormalizedTime(value) {
  return round(clamp(value, 0, Number.POSITIVE_INFINITY)) ?? 0;
}

function basename(value) {
  return String(value ?? "").split(/[\\/]/).at(-1) ?? "";
}

function contentHash(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex").slice(0, 16);
}

function skillContentHashSync(skillPath = SKILL_PATH) {
  try {
    return contentHash(fsSync.readFileSync(skillPath, "utf8"));
  } catch {
    return contentHash(String(skillPath ?? ""));
  }
}

async function resolveSkillHash(skillPath = SKILL_PATH) {
  try {
    const content = await fs.readFile(skillPath, "utf8");
    return contentHash(content);
  } catch {
    return contentHash(String(skillPath ?? ""));
  }
}

module.exports = {
  ROLE,
  SKILL_PATH,
  ROLE_PROFILE_PATH,
  MIN_SHOT_DURATION_SECONDS,
  MAX_REPAIR_ATTEMPTS,
  ANALYSIS_SELECTION_POLICY,
  ANALYSIS_DUPLICATE_POLICY,
  FRAME_SAMPLING_POLICY,
  MIN_ANALYSIS_FPS,
  MAX_ANALYSIS_FPS,
  MAX_SUBTITLE_SEGMENT_TEXT_LENGTH,
  MAX_SUBTITLE_CONTEXT_TOTAL_CHARS,
  MAX_COMMERCE_BRIEF_FIELD_LENGTH,
  MAX_COMMERCE_BRIEF_UNCERTAINTIES,
  MAX_VIDEO_SUMMARY_LENGTH,
  safeError,
  codedError,
  sanitizeDebugPayload,
  sanitizeForAppServerText,
  extractJsonObject,
  detectReasonEncodingIssue,
  summarizeAgentOutput,
  buildSubtitleContextSummary,
  normalizeSubtitleText,
  resolveShotSummary,
  normalizeCommerceBrief,
  normalizeVideoSummary,
  summarizeCommerceBrief,
  stripLocalImagePath,
  normalizeBoundaryType,
  resolveRepresentativeFrameIdByTime,
  resolveSheetStartTime,
  resolveSheetEndTime,
  invalidValidation,
  looksLikeUtf8Mojibake,
  looksLikeGbkMojibake,
  resolveLocalImagePath,
  isAbsolutePath,
  formatShotNo,
  clamp,
  round,
  roundNormalizedTime,
  basename,
  contentHash,
  skillContentHashSync,
  resolveSkillHash,
};
