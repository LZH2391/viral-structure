const fs = require("fs/promises");

const GROUP_RE = /^##\s+Storyboard Group\s+(.+?)\s*$/;
const SHOT_RE = /^###\s+(.+?)\s*$/;
const FIELD_RE = /^-\s+(imagePrompt|overlayPackaging)\s*:\s*(.*)$/;
const ASPECT_RE = /^画幅\s*[：:]\s*(.+?)\s*$/m;

async function parseStoryboardPromptFile(filePath) {
  const text = await fs.readFile(filePath, "utf8");
  return parseStoryboardPromptMarkdown(text, { sourceFile: filePath });
}

function parseStoryboardPromptMarkdown(text, { sourceFile = null } = {}) {
  const aspect = parseAspect(text);
  const groups = [];
  let currentGroup = null;
  let currentShot = null;

  for (const line of String(text ?? "").split(/\r?\n/)) {
    const groupMatch = line.trim().match(GROUP_RE);
    if (groupMatch) {
      currentGroup = { groupId: normalizeGroupId(groupMatch[1], groups.length + 1), title: groupMatch[1].trim(), shots: [] };
      groups.push(currentGroup);
      currentShot = null;
      continue;
    }
    const shotMatch = line.trim().match(SHOT_RE);
    if (shotMatch && currentGroup) {
      currentShot = { shot: shotMatch[1].trim(), imagePrompt: "", overlayPackaging: "" };
      currentGroup.shots.push(currentShot);
      continue;
    }
    const fieldMatch = line.trim().match(FIELD_RE);
    if (fieldMatch && currentShot) {
      currentShot[fieldMatch[1]] = fieldMatch[2].trim();
    }
  }

  const validGroups = groups.filter((group) => group.shots.length);
  if (!validGroups.length) {
    throw storyboardPromptError("storyboard_prompt_groups_missing", "故事板 prompt 文件没有可用分组", { sourceFile }, false);
  }
  return {
    sourceFile,
    aspect,
    groups: validGroups.map((group) => ({
      ...group,
      prompt: buildGroupPrompt(group, aspect),
    })),
  };
}

function parseAspect(text) {
  const match = ASPECT_RE.exec(String(text ?? ""));
  const raw = match ? match[1].trim() : "";
  if (/9\s*:\s*16/.test(raw) || /竖屏|竖版/.test(raw)) {
    return { ratio: "9:16", orientation: "竖屏", raw: raw || "9:16 竖屏" };
  }
  if (/16\s*:\s*9/.test(raw) || /横屏|横版/.test(raw)) {
    return { ratio: "16:9", orientation: "横屏", raw: raw || "16:9 横屏" };
  }
  return { ratio: null, orientation: "未明确", raw: raw || null };
}

function buildGroupPrompt(group, aspect) {
  const ratio = aspect.ratio ?? "未明确";
  const orientation = aspect.orientation ?? "未明确";
  const lines = [
    `以故事板呈现以下镜头，比例为${ratio}，${orientation}。每组固定四格，按顺序排列。`,
  ];
  for (const shot of group.shots) {
    const imagePrompt = shot.imagePrompt || "纯白空白画面，没有人物、产品、文字、图标或包装元素";
    lines.push(`镜头 ${shot.shot}：${imagePrompt}`);
    lines.push(`包装覆盖层：${shot.overlayPackaging || "无"}`);
  }
  return lines.join("\n");
}

function normalizeGroupId(value, index) {
  const text = String(value ?? "").trim();
  const numberMatch = text.match(/\d+/);
  if (numberMatch) return `storyboard-group-${numberMatch[0].padStart(2, "0")}`;
  return `storyboard-group-${String(index).padStart(2, "0")}`;
}

function storyboardPromptError(code, message, debugPayload = null, retryable = false) {
  const error = new Error(message);
  error.code = code;
  error.debugPayload = debugPayload;
  error.retryable = retryable;
  return error;
}

module.exports = {
  parseStoryboardPromptFile,
  parseStoryboardPromptMarkdown,
  buildGroupPrompt,
};
