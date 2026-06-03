const fs = require("fs/promises");
const path = require("path");
const { createHash } = require("crypto");

function findLatestRestructureFinalPath(conversation) {
  const messages = Array.isArray(conversation?.messages) ? conversation.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const pathFromMessage = extractRestructureFinalPath(messages[index]?.text);
    if (pathFromMessage) return pathFromMessage;
  }
  return normalizeText(conversation?.confirmedPlan?.sourceRestructurePath);
}

function findLatestDisplayFingerprint(conversation, restructureFinalPath) {
  const messages = Array.isArray(conversation?.messages) ? conversation.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const fingerprint = messages[index]?.slotAtomDisplay?.fileFingerprint;
    if (fingerprint?.path === restructureFinalPath) return fingerprint;
  }
  return null;
}

async function readRestructureFinalFingerprint(filePath, rootDir) {
  const content = await fs.readFile(filePath);
  const stat = await fs.stat(filePath);
  return {
    path: safeRelative(rootDir, filePath),
    size: stat.size,
    mtimeMs: Math.trunc(stat.mtimeMs),
    sha256: createHash("sha256").update(content).digest("hex"),
  };
}

function fingerprintsEqual(left, right) {
  if (!left || !right) return false;
  return left.path === right.path
    && left.size === right.size
    && left.sha256 === right.sha256;
}

function resolveRestructureFinalPath({ rootDir, finalMessage, explicitPath, conversationId, turnId }) {
  const inferred = explicitPath || extractRestructureFinalPath(finalMessage);
  const relativePath = inferred
    ? normalizeRelativeArtifactPath(inferred, rootDir)
    : path.join("Artifacts", "FunctionSlotRestructure", safeSlug(conversationId || turnId || "agent-chat"), "restructure.final.md");
  const resolved = path.resolve(rootDir, relativePath);
  const root = path.resolve(rootDir);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    const error = new Error("restructure.final.md path is outside workspace");
    error.code = "restructure_final_path_outside_workspace";
    throw error;
  }
  return resolved;
}

function extractRestructureFinalPath(finalMessage) {
  const text = String(finalMessage ?? "");
  const saved = text.match(/保存路径[：:]\s*`([^`]+restructure\.final\.md)`/i);
  if (saved?.[1]) return saved[1];
  const artifactPath = text.match(/(Artifacts[\\/]+FunctionSlotRestructure[^\n`]*?restructure\.final\.md)/i);
  return artifactPath?.[1] ?? null;
}

function normalizeRelativeArtifactPath(value, rootDir) {
  const text = String(value ?? "").trim().replaceAll("\\", "/");
  if (!text) return null;
  const absolute = path.isAbsolute(text) || /^[A-Za-z]:\//.test(text);
  if (!absolute) return text;
  return path.relative(rootDir, path.resolve(text)).replaceAll(path.sep, "/");
}

function normalizeFinalMarkdown(value) {
  const text = String(value ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trimEnd();
  return `${text}\n`;
}

function buildRepairSnippet(markdown, repairTargets = []) {
  const lines = String(markdown ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const lineNumbers = (repairTargets ?? []).map((target) => Number(target.line)).filter((line) => Number.isFinite(line) && line > 0);
  if (!lineNumbers.length) return lines.slice(0, 240).join("\n");
  const ranges = [];
  for (const line of lineNumbers) {
    const start = Math.max(1, line - 8);
    const end = Math.min(lines.length, line + 12);
    ranges.push([start, end]);
  }
  const merged = [];
  for (const [start, end] of ranges.sort((left, right) => left[0] - right[0])) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged.map(([start, end]) => lines.slice(start - 1, end).join("\n")).join("\n\n...\n\n");
}

function isCompleted(status) {
  return String(status ?? "").toLowerCase() === "completed";
}

function buildSlotAtomDisplaySummary(displayJson, { displayJsonPath = null, fileFingerprint = null } = {}) {
  const slotRows = tableRowsAfterHeading(displayJson?.sections?.finalSlotChain, "槽位链");
  const atomRows = firstTableRows(displayJson?.sections?.atomLandingTable);
  const slots = slotRows.map((row, index) => {
    const slotSubtype = rowValue(row, ["slotSubtype", "槽位", "slot subtype"]);
    const archetype = rowValue(row, ["parent archetype", "archetype"]);
    return {
      index: numberOrFallback(rowValue(row, ["顺序", "序号"]), index + 1),
      demand: rowValue(row, ["需求"]),
      slotSubtype,
      slotSubtypeId: extractBacktickId(slotSubtype),
      archetype,
      archetypeId: extractBacktickId(archetype),
      functionText: rowValue(row, ["链路功能", "功能"]),
      usage: rowValue(row, ["本方案用法", "用法"]),
      reason: rowValue(row, ["选择理由", "理由"]),
    };
  });
  const atoms = atomRows.map((row) => {
    const slotSubtype = rowValue(row, ["槽位", "slotSubtype"]);
    return {
      slotSubtype,
      slotSubtypeId: extractBacktickId(slotSubtype),
      source: rowValue(row, ["来源"]),
      scriptAtom: rowValueContains(row, "script atom"),
      rhythmAtom: rowValueContains(row, "rhythm atom"),
      packagingAtom: rowValueContains(row, "packaging atom"),
      handling: rowValue(row, ["atom 处理", "处理"]),
    };
  });
  return {
    schemaVersion: "function_slot_restructure_slot_atom_display.v1",
    status: slots.length || atoms.length ? "available" : "empty",
    displayJsonPath,
    slotCount: slots.length,
    atomBindingCount: atoms.length,
    selectedSlotSubtypeId: slots[0]?.slotSubtypeId ?? atoms[0]?.slotSubtypeId ?? null,
    fileFingerprint,
    slots,
    atoms,
  };
}

function firstTableRows(section) {
  const table = (section?.items ?? []).find((item) => item?.type === "table" && Array.isArray(item.rows));
  return table?.rows ?? [];
}

function tableRowsAfterHeading(section, headingNeedle) {
  const normalizedNeedle = normalizeKey(headingNeedle);
  let matchedHeading = false;
  for (const item of section?.items ?? []) {
    if (item?.type === "heading" && normalizeKey(item.text).includes(normalizedNeedle)) {
      matchedHeading = true;
      continue;
    }
    if (matchedHeading && item?.type === "table" && Array.isArray(item.rows)) return item.rows;
  }
  return [];
}

function rowValue(row, keys) {
  for (const key of keys) {
    if (row?.[key] != null) return String(row[key]);
  }
  const entries = Object.entries(row ?? {});
  const normalizedKeys = keys.map(normalizeKey);
  const found = entries.find(([key]) => normalizedKeys.includes(normalizeKey(key)));
  return found ? String(found[1]) : "";
}

function rowValueContains(row, needle) {
  const normalizedNeedle = normalizeKey(needle);
  const found = Object.entries(row ?? {}).find(([key]) => normalizeKey(key).includes(normalizedNeedle));
  return found ? String(found[1]) : "";
}

function normalizeKey(value) {
  return String(value ?? "").toLowerCase().replace(/[\s_（）()：:·\-]/g, "");
}

function extractBacktickId(value) {
  const match = String(value ?? "").match(/`([^`]+)`/);
  return match?.[1] ?? null;
}

function numberOrFallback(value, fallback) {
  const number = Number(String(value ?? "").match(/\d+/)?.[0]);
  return Number.isFinite(number) && number > 0 ? number : fallback;
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
  buildRepairSnippet,
  buildSlotAtomDisplaySummary,
  extractRestructureFinalPath,
  findLatestDisplayFingerprint,
  findLatestRestructureFinalPath,
  fingerprintsEqual,
  isCompleted,
  normalizeFinalMarkdown,
  normalizeText,
  readRestructureFinalFingerprint,
  resolveRestructureFinalPath,
  safePreview,
  safeRelative,
};
