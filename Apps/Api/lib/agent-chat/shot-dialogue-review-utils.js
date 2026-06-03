const fs = require("fs/promises");
const path = require("path");
const { createHash } = require("crypto");

function parseReviewJson(value) {
  const text = stripCodeFence(String(value ?? "").trim());
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const wrapped = new Error("dialogue review finalMessage is not valid JSON");
    wrapped.code = "dialogue_robotic_review_json_invalid";
    wrapped.retryable = true;
    wrapped.cause = error;
    throw wrapped;
  }
  const decision = String(parsed?.decision ?? "").trim();
  if (!["pass", "rework", "blocked"].includes(decision)) {
    const error = new Error("dialogue review decision must be pass, rework, or blocked");
    error.code = "dialogue_robotic_review_decision_invalid";
    error.retryable = true;
    throw error;
  }
  return {
    decision,
    reason: safePreview(parsed.reason, 500) ?? "",
    issues: Array.isArray(parsed.issues) ? parsed.issues.map(normalizeIssue).filter(Boolean) : [],
  };
}

function normalizeIssue(value) {
  if (!value || typeof value !== "object") return null;
  return {
    shot: String(value.shot ?? "unknown"),
    original: safePreview(value.original, 300) ?? "",
    robotic_type: String(value.robotic_type ?? ""),
    reason: safePreview(value.reason, 500) ?? "",
    minimal_direction: safePreview(value.minimal_direction, 500) ?? "",
  };
}

function stripCodeFence(value) {
  const match = value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : value;
}

function findLatestShotDesignFinalPath(conversation) {
  const messages = Array.isArray(conversation?.messages) ? conversation.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const pathFromMessage = extractShotDesignFinalPath(messages[index]?.text);
    if (pathFromMessage) return pathFromMessage;
  }
  return normalizeText(conversation?.confirmedPlan?.sourceShotDesignPath);
}

function findLatestReviewFingerprint(conversation, shotDesignFinalPath) {
  const messages = Array.isArray(conversation?.messages) ? conversation.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const fingerprint = messages[index]?.dialogueRoboticReview?.fileFingerprint;
    if (fingerprint?.path === shotDesignFinalPath) return fingerprint;
  }
  return null;
}

function findLatestDialogueReviewSummary(conversation, shotDesignFinalPath) {
  const messages = Array.isArray(conversation?.messages) ? conversation.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const review = messages[index]?.dialogueRoboticReview;
    if (review?.fileFingerprint?.path === shotDesignFinalPath || review?.dialogueFingerprint?.path === shotDesignFinalPath) return review;
  }
  return null;
}

async function readFileFingerprint(filePath, rootDir) {
  const content = await fs.readFile(filePath);
  const stat = await fs.stat(filePath);
  return {
    path: safeRelative(rootDir, filePath),
    size: stat.size,
    mtimeMs: Math.trunc(stat.mtimeMs),
    sha256: createHash("sha256").update(content).digest("hex"),
  };
}

async function readDialogueFingerprint(filePath, rootDir) {
  const content = await fs.readFile(filePath, "utf8");
  const entries = extractDialogueEntries(content);
  const normalized = entries.map((entry) => `${entry.shot}\t${entry.dialogue}`).join("\n");
  return {
    path: safeRelative(rootDir, filePath),
    size: entries.length,
    sha256: createHash("sha256").update(normalized).digest("hex"),
    entryCount: entries.length,
    nonEmptyCount: entries.filter((entry) => entry.dialogue && entry.dialogue !== "无").length,
  };
}

function extractDialogueEntries(markdown) {
  const lines = String(markdown ?? "").split(/\r?\n/);
  const entries = [];
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (!isMarkdownTableLine(lines[index]) || !isMarkdownSeparatorLine(lines[index + 1])) continue;
    const headers = splitMarkdownRow(lines[index]).map(normalizeTableCell);
    const dialogueIndex = headers.findIndex(isDialogueHeader);
    if (dialogueIndex < 0) continue;
    const shotIndex = headers.findIndex((header) => header === "shot" || header.includes("镜头"));
    index += 2;
    for (; index < lines.length && isMarkdownTableLine(lines[index]); index += 1) {
      const cells = splitMarkdownRow(lines[index]);
      const dialogue = normalizeDialogueCell(cells[dialogueIndex]);
      entries.push({
        shot: normalizeTableCell(cells[shotIndex]) || `row_${entries.length + 1}`,
        dialogue,
      });
    }
    index -= 1;
  }
  return entries;
}

function isMarkdownTableLine(line) {
  return /^\s*\|.*\|\s*$/.test(String(line ?? ""));
}

function isMarkdownSeparatorLine(line) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(String(line ?? ""));
}

function splitMarkdownRow(line) {
  return String(line ?? "").trim().replace(/^\|/, "").replace(/\|$/, "").split("|");
}

function isDialogueHeader(value) {
  return /台词|字幕|旁白|屏幕文字|口播/i.test(String(value ?? ""));
}

function normalizeTableCell(value) {
  return String(value ?? "").replace(/<br\s*\/?>/gi, "\n").replace(/\s+/g, " ").trim();
}

function normalizeDialogueCell(value) {
  return normalizeTableCell(value)
    .replace(/^[-–—]+$/, "")
    .replace(/^无(?:新增)?(?:台词|字幕|口播|旁白)?$/i, "无")
    .trim();
}

function fingerprintsEqual(left, right) {
  if (!left || !right) return false;
  return left.path === right.path
    && left.size === right.size
    && left.sha256 === right.sha256;
}

function resolveShotDesignFinalPath({ rootDir, finalMessage, explicitPath, conversationId, turnId }) {
  const inferred = explicitPath || extractShotDesignFinalPath(finalMessage);
  const relativePath = inferred
    ? normalizeRelativeArtifactPath(inferred, rootDir)
    : path.join("Artifacts", "FunctionSlotRestructure", safeSlug(conversationId || turnId || "agent-chat"), "shot-design.final.md");
  const resolved = path.resolve(rootDir, relativePath);
  const root = path.resolve(rootDir);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    const error = new Error("shot-design.final.md path is outside workspace");
    error.code = "shot_design_final_path_outside_workspace";
    throw error;
  }
  return resolved;
}

function extractShotDesignFinalPath(finalMessage) {
  const text = String(finalMessage ?? "");
  const saved = text.match(/保存路径[：:]\s*`([^`]+shot-design\.final\.md)`/i);
  if (saved?.[1]) return saved[1];
  const artifactPath = text.match(/(Artifacts[\\/]+FunctionSlotRestructure[^\n`]*?shot-design\.final\.md)/i);
  if (artifactPath?.[1]) return artifactPath[1];
  const absolutePath = text.match(/([A-Za-z]:[\\/][^\n`)]*?shot-design\.final\.md)/i);
  return absolutePath?.[1] ?? null;
}

function extractGeneratedShotDesignFinalPath(finalMessage) {
  const text = String(finalMessage ?? "");
  const saved = text.match(/保存路径[：:]\s*`([^`]+shot-design\.final\.md)`/i);
  if (saved?.[1]) return saved[1];
  if (!/(已生成|生成并落盘|已写入|写入|已保存|保存|落盘|更新|已更新|改写|已改写|返工后|重新生成|完成 Shot 设计|Shot 设计已完成)/i.test(text)) return null;
  return extractShotDesignFinalPath(text);
}

async function isCurrentTurnFileOutput(filePath, activeBinding) {
  const createdAtMs = Date.parse(activeBinding?.createdAt ?? "");
  if (!Number.isFinite(createdAtMs)) return true;
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat) return true;
  return stat.mtimeMs + 1000 >= createdAtMs;
}

function normalizeRelativeArtifactPath(value, rootDir) {
  const text = String(value ?? "").trim().replaceAll("\\", "/");
  if (!text) return null;
  const absolute = path.isAbsolute(text) || /^[A-Za-z]:\//.test(text);
  if (!absolute) return text;
  return path.relative(rootDir, path.resolve(text)).replaceAll(path.sep, "/");
}

function isCompleted(status) {
  return String(status ?? "").toLowerCase() === "completed";
}

function isTerminalStatus(status) {
  return ["completed", "complete", "failed", "error", "errored", "cancelled", "canceled"].includes(String(status ?? "").toLowerCase());
}

function isDialogueReviewEligibleConversation(conversation, shotDesignPath) {
  const role = String(conversation?.role ?? "").trim();
  if (!["function-slot-shot-design", "function-slot-restructure"].includes(role)) return false;
  return /shot-design\.final\.md$/i.test(String(shotDesignPath ?? "").trim());
}

function normalizeText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function safeSlug(value) {
  return String(value ?? "").trim().replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "") || "agent-chat";
}

function safeRelative(rootDir, filePath) {
  return path.relative(rootDir, path.resolve(filePath)).replaceAll(path.sep, "/");
}

function safePreview(value, limit = 240) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length <= limit ? text : `${text.slice(0, limit)}...`;
}


module.exports = {
  extractGeneratedShotDesignFinalPath,
  extractShotDesignFinalPath,
  findLatestDialogueReviewSummary,
  findLatestReviewFingerprint,
  findLatestShotDesignFinalPath,
  fingerprintsEqual,
  isCompleted,
  isCurrentTurnFileOutput,
  isDialogueReviewEligibleConversation,
  isTerminalStatus,
  normalizeText,
  parseReviewJson,
  readDialogueFingerprint,
  readFileFingerprint,
  resolveShotDesignFinalPath,
  safePreview,
  safeRelative,
};
