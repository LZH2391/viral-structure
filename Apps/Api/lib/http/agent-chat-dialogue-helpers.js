const path = require("path");
const fs = require("fs/promises");

function buildDialogueReworkMessage({
  shotDesignFinalPath,
  reviewOutputPath,
  decision,
  issueCount,
  reviewDetails,
  userInstruction,
}) {
  const reviewSummary = normalizeDialogueReviewDetails(reviewDetails);
  const lines = [
    "根据台词机器人感审查结果，返工当前 Shot 设计里的台词字段。",
    "",
    `- shotDesignFinalPath: \`${shotDesignFinalPath}\``,
    `- dialogueReviewPath: \`${reviewOutputPath}\``,
    `- reviewDecision: \`${reviewSummary.decision ?? decision ?? "unknown"}\``,
    `- issueCount: ${reviewSummary.issues.length || issueCount || 0}`,
    "",
    "reviewIssuesJson:",
    stableJson({
      decision: reviewSummary.decision ?? decision ?? null,
      reason: reviewSummary.reason ?? null,
      issues: reviewSummary.issues,
    }),
    "",
    "要求：",
    "- 必须逐条依据 reviewIssuesJson 中的 issues 返工，不要只按泛泛的“自然一点”自行发挥。",
    "- 每条 issue 只改对应 shot 的台词字段；优先按 minimal_direction 做最小改写。",
    "- 不重新选择槽位链，不改素材策略，不改包装证明方案，除非台词修正必须同步轻微调整字幕表述。",
    "- 保留原 shot-design.final.md 的表格结构和 shot 顺序，返工后仍写回同一个 shot-design.final.md。",
    "- 回复中说明已修哪些 shot，并给出文件路径。",
    userInstruction ? "" : null,
    userInstruction ? `补充要求：${userInstruction}` : null,
  ];
  return lines.filter(Boolean).join("\n");
}

async function readDialogueReviewDetails({ rootDir, reviewOutputPath }) {
  const absolutePath = resolveWorkspacePath(rootDir, reviewOutputPath, "dialogueReviewPath");
  try {
    const parsed = JSON.parse(await fs.readFile(absolutePath, "utf8"));
    return parsed?.review && typeof parsed.review === "object" ? parsed.review : parsed;
  } catch (error) {
    const wrapped = badRequestError("agent_chat_dialogue_rework_review_unreadable", "台词 review 结果不可读，需重新触发台词审查");
    wrapped.debugPayload = {
      message: safePreview(error instanceof Error ? error.message : String(error), 240),
      reviewOutputPath,
    };
    throw wrapped;
  }
}

function findLatestDialogueReviewValue(conversation, key) {
  const messages = Array.isArray(conversation?.messages) ? conversation.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const review = messages[index]?.dialogueRoboticReview;
    if (review && review[key] != null && review[key] !== "") return review[key];
  }
  return null;
}

function normalizeDialogueReviewDetails(value) {
  const details = value && typeof value === "object" ? value : {};
  return {
    decision: ["pass", "rework", "blocked"].includes(details.decision) ? details.decision : null,
    reason: safePreview(details.reason, 500),
    issues: Array.isArray(details.issues) ? details.issues.map(normalizeDialogueReviewIssue).filter(Boolean) : [],
  };
}

function normalizeDialogueReviewIssue(value) {
  if (!value || typeof value !== "object") return null;
  return {
    shot: normalizeText(value.shot),
    original: safePreview(value.original, 300),
    robotic_type: normalizeText(value.robotic_type ?? value.roboticType),
    reason: safePreview(value.reason, 500),
    minimal_direction: safePreview(value.minimal_direction ?? value.minimalDirection, 500),
  };
}

function resolveWorkspacePath(rootDir, value, fieldName) {
  const text = requiredText(value, fieldName).replaceAll("\\", "/");
  const absolute = /^[A-Za-z]:\//.test(text) || text.startsWith("/");
  const root = path.resolve(rootDir).replaceAll("\\", "/");
  const resolved = (absolute ? path.resolve(text) : path.resolve(rootDir, text)).replaceAll("\\", "/");
  if (resolved !== root && !resolved.startsWith(`${root}/`)) throw badRequestError("agent_chat_dialogue_rework_path_outside_workspace", "台词 review 路径不能超出 workspace");
  return resolved;
}

function stableJson(value) {
  return JSON.stringify(sortJsonValue(value), null, 2);
}

function sortJsonValue(value) {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortJsonValue(value[key])]));
}

function requiredText(value, fieldName) {
  const text = normalizeText(value);
  if (!text) throw badRequestError("agent_chat_manual_replacement_field_required", `${fieldName} 不能为空`);
  return text;
}

function normalizeText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function safePreview(value, limit = 240) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function badRequestError(code, message) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = code;
  error.retryable = false;
  return error;
}

module.exports = {
  buildDialogueReworkMessage,
  findLatestDialogueReviewValue,
  readDialogueReviewDetails,
};
