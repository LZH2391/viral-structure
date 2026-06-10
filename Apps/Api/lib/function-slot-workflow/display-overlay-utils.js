const fs = require("fs/promises");
const path = require("path");

const REQUIRED_KEYS = ["targetAssumption", "slotChain", "atoms", "scriptSegments", "rhythmCurve", "packagingProof"];

function parseDisplayTransformerFinalMessage(finalMessage) {
  const text = String(finalMessage ?? "").trim();
  if (!text) throw codedError("display_final_message_empty", "展示转换 finalMessage 为空");
  const candidates = [];
  const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((match) => match[1].trim()).filter(Boolean);
  candidates.push(...fenced, text);
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) candidates.push(text.slice(first, last + 1));
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try next candidate
    }
  }
  throw codedError("display_final_message_json_parse_failed", "展示转换 finalMessage 未解析出合法 JSON");
}

function validateRestructureDisplayJson(value) {
  const errors = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) errors.push("root must be object");
  for (const key of REQUIRED_KEYS) {
    if (!(key in (value ?? {}))) errors.push(`missing ${key}`);
  }
  for (const key of ["slotChain", "atoms", "scriptSegments", "rhythmCurve", "packagingProof"]) {
    if (key in (value ?? {}) && !Array.isArray(value[key])) errors.push(`${key} must be array`);
  }
  if (errors.length) {
    const error = codedError("display_json_schema_invalid", "展示转换 JSON 校验失败");
    error.validationErrors = errors;
    throw error;
  }
  return true;
}

function inferPlanId({ restructureFinalPath, displayJson }) {
  const explicit = firstText(displayJson.planId, displayJson.briefSlug, displayJson.slug);
  if (explicit) return safeSlug(explicit);
  const normalized = normalizeRelativePath(restructureFinalPath);
  const parts = normalized.split(/[\\/]+/).filter(Boolean);
  const index = parts.findIndex((part) => part === "FunctionSlotRestructure");
  if (index >= 0 && parts[index + 1]) return safeSlug(parts[index + 1]);
  const parent = parts.at(-2);
  return safeSlug(parent || "confirmed-plan");
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function firstText(...values) {
  for (const value of values) {
    if (value && typeof value === "object" && !Array.isArray(value) && "value" in value) {
      const nested = firstText(value.value);
      if (nested) return nested;
    }
    const text = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
    if (text) return text;
  }
  return null;
}

function normalizeText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function safeSlug(value) {
  return String(value ?? "confirmed-plan").trim().replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "") || "confirmed-plan";
}

function normalizeRelativePath(filePath) {
  const text = String(filePath ?? "").trim();
  if (!text) return null;
  return text.replaceAll("\\", "/").replace(/^[A-Za-z]:\//, "");
}

function inferPlanSetIdFromPath(filePath) {
  const normalized = normalizeRelativePath(filePath);
  const parts = normalized.split(/[\\/]+/).filter(Boolean);
  const marker = parts.findIndex((part) => part === "FunctionSlotRestructure");
  return marker >= 0 && parts[marker + 1] ? safeSlug(parts[marker + 1]) : safeSlug(path.basename(path.dirname(filePath)));
}

function displayRecordTitle(planSetId, variants) {
  if (variants.length > 1) return `${planSetId} (${variants.length} 版本)`;
  return variants[0]?.versionName && variants[0].versionName !== "默认方案" ? variants[0].versionName : planSetId;
}

function inferRestructureFinalPathFromDisplayPath(displayJsonPath) {
  const normalized = normalizeRelativePath(displayJsonPath);
  if (!normalized) return null;
  return normalized.replace(/(^|\/)restructure\.display\.json$/i, "$1restructure.final.md");
}

function resolveInsideRoot(filePath, rootDir) {
  const relativePath = normalizeRelativePath(filePath);
  if (!relativePath) throw codedError("display_json_path_required", "displayJsonPath 不能为空");
  const resolved = path.resolve(rootDir, relativePath);
  const root = path.resolve(rootDir);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw codedError("display_json_path_outside_workspace", "displayJsonPath 必须位于工作区内");
  }
  return resolved;
}

function resolveOptionalInsideRoot(filePath, rootDir) {
  return normalizeRelativePath(filePath) ? resolveInsideRoot(filePath, rootDir) : null;
}

function safeRelative(rootDir, filePath) {
  return filePath ? path.relative(rootDir, path.resolve(filePath)).replaceAll(path.sep, "/") : null;
}

async function pathExists(filePath) {
  if (!filePath) return false;
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function fileMtimeMs(filePath) {
  if (!filePath) return Number.NaN;
  try {
    return (await fs.stat(filePath)).mtimeMs;
  } catch {
    return Number.NaN;
  }
}

function safeRelativePath(filePath) {
  return normalizeRelativePath(filePath);
}

function safePreview(value, limit = 240) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length <= limit ? text : `${text.slice(0, limit)}...`;
}

module.exports = {
  REQUIRED_KEYS,
  asArray,
  codedError,
  displayRecordTitle,
  fileMtimeMs,
  inferPlanId,
  inferPlanSetIdFromPath,
  inferRestructureFinalPathFromDisplayPath,
  normalizeRelativePath,
  normalizeText,
  parseDisplayTransformerFinalMessage,
  pathExists,
  readJsonIfExists,
  resolveInsideRoot,
  resolveOptionalInsideRoot,
  safeRelative,
  safeRelativePath,
  safeSlug,
  safePreview,
  validateRestructureDisplayJson,
  writeJson,
};
