const fs = require("fs/promises");
const path = require("path");
const { createHash } = require("crypto");

const ORDER_KEYS = ["顺序", "序号", "order", "index", "编号"];
const SLOT_SUBTYPE_KEYS = [
  "slotSubtype",
  "slotSubtypeId",
  "slot subtype",
  "slot subtype id",
  "slot",
  "slot id",
  "槽位",
  "对应槽位",
  "功能槽位",
  "槽位类型",
  "槽位 subtype",
];
const SLOT_ARCHETYPE_KEYS = ["parent archetype", "parentArchetype", "slotArchetype", "slot archetype", "archetype", "父级原型", "槽位原型", "原型"];
const ATOM_SLOT_KEYS = ["槽位", "对应槽位", "功能槽位", "slotSubtype", "slotSubtypeId", "slot subtype", "slot subtype id", "slot", "slot id"];
const SOURCE_KEYS = ["来源", "source", "source slot", "sourceSlot", "来源槽位", "样例来源", "原槽位", "source id"];

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

async function hydrateConversationSlotAtomDisplays(conversation, { rootDir } = {}) {
  if (!conversation || !rootDir || !Array.isArray(conversation.messages)) return conversation;
  const messages = await Promise.all(conversation.messages.map(async (message) => {
    const hydratedDisplay = await hydrateSlotAtomDisplay(message?.slotAtomDisplay, { rootDir });
    return hydratedDisplay === message?.slotAtomDisplay ? message : { ...message, slotAtomDisplay: hydratedDisplay };
  }));
  return { ...conversation, messages };
}

async function hydrateSlotAtomDisplay(display, { rootDir } = {}) {
  if (!display || typeof display !== "object" || !rootDir) return display;
  const hydratedVersionDisplays = Array.isArray(display.versionDisplays)
    ? (await Promise.all(display.versionDisplays.map((item) => hydrateSlotAtomDisplay(item, { rootDir })))).filter(Boolean)
    : [];
  if (!shouldHydrateSlotAtomDisplay(display)) {
    return hydratedVersionDisplays.length ? { ...display, versionDisplays: hydratedVersionDisplays } : display;
  }
  const displayJsonPath = resolveWorkspacePath(rootDir, display.displayJsonPath);
  if (!displayJsonPath) return hydratedVersionDisplays.length ? { ...display, versionDisplays: hydratedVersionDisplays } : display;
  try {
    const content = await fs.readFile(displayJsonPath, "utf8");
    const displayJson = JSON.parse(content);
    const versionMeta = extractVersionMeta(displayJson);
    const summary = buildSlotAtomDisplaySummary(displayJson, {
      displayJsonPath: safeRelative(rootDir, displayJsonPath),
      fileFingerprint: display.fileFingerprint ?? null,
    });
    return summary.status === "available" ? {
      ...display,
      ...summary,
      mode: display.mode ?? summary.mode ?? null,
      versionId: versionMeta.versionId ?? display.versionId ?? summary.versionId ?? null,
      versionName: versionMeta.versionName ?? display.versionName ?? summary.versionName ?? null,
      defaultVersionId: display.defaultVersionId ?? summary.defaultVersionId ?? null,
      rootRestructureFinalPath: display.rootRestructureFinalPath ?? summary.rootRestructureFinalPath ?? null,
      sourceRestructureFinalPath: display.sourceRestructureFinalPath ?? summary.sourceRestructureFinalPath ?? null,
      versionDisplays: hydratedVersionDisplays,
    } : (hydratedVersionDisplays.length ? { ...display, versionDisplays: hydratedVersionDisplays } : display);
  } catch {
    return hydratedVersionDisplays.length ? { ...display, versionDisplays: hydratedVersionDisplays } : display;
  }
}

function shouldHydrateSlotAtomDisplay(display) {
  if (!display || typeof display !== "object") return false;
  if (!display.displayJsonPath) return false;
  const slots = Array.isArray(display.slots) ? display.slots : [];
  return slots.length === 0
    || Number(display.slotCount ?? 0) === 0
    || hasBareAtomReferences(display)
    || hasUnmatchedAtomSlotBindings(display);
}

function hasBareAtomReferences(display) {
  const atoms = Array.isArray(display.atoms) ? display.atoms : [];
  return atoms.some((atom) => (
    isBareAtomReference(atom?.scriptAtom, "script")
    || isBareAtomReference(atom?.rhythmAtom, "rhythm")
    || isBareAtomReference(atom?.packagingAtom, "packaging")
  ));
}

function isBareAtomReference(value, atomKind) {
  const text = String(value ?? "").trim();
  if (!text) return false;
  const escapedKind = atomKind.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp("^`?[^`]+::" + escapedKind + "::[^`]+`?$", "i").test(text);
}

function hasUnmatchedAtomSlotBindings(display) {
  const atoms = Array.isArray(display.atoms) ? display.atoms : [];
  const slots = Array.isArray(display.slots) ? display.slots : [];
  if (!atoms.length || !slots.length) return false;
  const slotIds = new Set(slots.map((slot) => normalizeText(slot?.slotSubtypeId)).filter(Boolean));
  if (!slotIds.size) return false;
  return atoms.some((atom) => {
    const atomSlotId = normalizeText(atom?.slotSubtypeId);
    return !atomSlotId || !slotIds.has(atomSlotId);
  });
}

function resolveWorkspacePath(rootDir, relativePath) {
  const text = String(relativePath ?? "").trim();
  if (!text) return null;
  const resolved = path.resolve(rootDir, text);
  const root = path.resolve(rootDir);
  return resolved === root || resolved.startsWith(`${root}${path.sep}`) ? resolved : null;
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
  let slotRows = tableRowsAfterHeading(displayJson?.sections?.finalSlotChain, "槽位链");
  if (!slotRows.length) slotRows = firstTableRows(displayJson?.sections?.finalSlotChain);
  const atomRows = firstTableRows(displayJson?.sections?.atomLandingTable);
  const slots = slotRows.map((row, index) => {
    const slotSubtype = rowValue(row, SLOT_SUBTYPE_KEYS);
    const archetype = rowValue(row, SLOT_ARCHETYPE_KEYS);
    return {
      index: numberOrFallback(rowValue(row, ORDER_KEYS), index + 1),
      demand: rowValue(row, ["需求", "观众需求", "need", "demand"]),
      slotSubtype,
      slotSubtypeId: extractStructuredId(slotSubtype, "slotSubtype"),
      archetype,
      archetypeId: extractStructuredId(archetype, "slotArchetype"),
      functionText: rowValue(row, ["链路功能", "本方案任务", "任务", "功能", "function", "role"]),
      usage: rowValue(row, ["本方案用法", "用法", "usage", "application"]),
      reason: rowValue(row, ["选择理由", "理由", "reason", "why"]),
    };
  });
  const atoms = atomRows.map((row, index) => {
    const slotSubtype = rowValue(row, ATOM_SLOT_KEYS);
    const source = rowValue(row, SOURCE_KEYS);
    return {
      slotSubtype,
      slotSubtypeId: resolveAtomSlotSubtypeId({
        slotSubtype,
        source,
        slots,
        rowIndex: index,
        atomRowCount: atomRows.length,
      }),
      source,
      scriptAtom: rowAtomLandingValue(row, "script"),
      rhythmAtom: rowAtomLandingValue(row, "rhythm"),
      packagingAtom: rowAtomLandingValue(row, "packaging"),
      handling: rowValue(row, ["atom 处理", "处理"]),
    };
  });
  return {
    schemaVersion: "function_slot_restructure_slot_atom_display.v1",
    status: slots.length || atoms.length ? "available" : "empty",
    displayJsonPath,
    sourceRestructureFinalPath: fileFingerprint?.path ?? null,
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

function resolveAtomSlotSubtypeId({ slotSubtype, source, slots, rowIndex, atomRowCount }) {
  const explicitId = extractStructuredId(slotSubtype, "slotSubtype");
  if (explicitId) return explicitId;
  const matchedByLabel = findSlotByLabel(slotSubtype, slots);
  if (matchedByLabel?.slotSubtypeId) return matchedByLabel.slotSubtypeId;
  const sourceOrder = sourceSlotOrder(source) ?? sourceSlotOrder(slotSubtype);
  if (sourceOrder) {
    const matchedByOrder = slots.find((slot) => slot.index === sourceOrder) ?? slots[sourceOrder - 1];
    if (matchedByOrder?.slotSubtypeId) return matchedByOrder.slotSubtypeId;
  }
  if (atomRowCount === slots.length && slots[rowIndex]?.slotSubtypeId) return slots[rowIndex].slotSubtypeId;
  return null;
}

function findSlotByLabel(value, slots) {
  const needle = normalizeSlotLabel(value);
  if (!needle) return null;
  return slots.find((slot) => slot.slotSubtypeId && [
    slot.slotSubtype,
    stripBacktickLabel(slot.slotSubtype),
  ].some((candidate) => normalizeSlotLabel(candidate) === needle)) ?? null;
}

function sourceSlotOrder(value) {
  const text = String(value ?? "");
  const match = text.match(/(?:^|::|[\s_-])F0*(\d+)\b/i)
    ?? text.match(/\bslot\s*0*(\d+)\b/i)
    ?? text.match(/第\s*0*(\d+)\s*槽/)
    ?? text.match(/\b0*(\d+)\s*槽\b/);
  if (!match?.[1]) return null;
  const order = Number(match[1]);
  return Number.isFinite(order) && order > 0 ? order : null;
}

function tableRowsAfterHeading(section, headingNeedle) {
  const normalizedNeedle = normalizeKey(headingNeedle);
  let matchedHeading = false;
  for (const item of section?.items ?? []) {
    if (isDisplayHeadingItem(item) && normalizeKey(item.text).includes(normalizedNeedle)) {
      matchedHeading = true;
      continue;
    }
    if (matchedHeading && item?.type === "table" && Array.isArray(item.rows)) return item.rows;
  }
  return [];
}

function isDisplayHeadingItem(item) {
  if (item?.type === "heading") return true;
  return item?.type === "paragraph" && /^#{1,6}\s+/.test(String(item.text ?? "").trim());
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

function extractVersionMeta(displayJson) {
  const result = { versionId: null, versionName: null };
  for (const item of displayJson?.sections?.goalAndAssumptions?.items ?? []) {
    const text = String(item?.text ?? "").trim();
    if (!result.versionId) result.versionId = /versionId[：:]\s*`?([A-Za-z0-9_.-]+)`?/i.exec(text)?.[1] ?? null;
    if (!result.versionName) result.versionName = /versionName[：:]\s*([^`\n]+)/i.exec(text)?.[1]?.trim() ?? null;
  }
  return result;
}

function rowAtomLandingValue(row, atomKind) {
  const entries = Object.entries(row ?? {});
  const kindNeedles = atomKindNeedles(atomKind).map(normalizeKey);
  const landingNeedles = atomLandingNeedles().map(normalizeKey);
  const preferred = entries.find(([key]) => {
    const normalizedKey = normalizeKey(key);
    return kindNeedles.some((needle) => normalizedKey.includes(needle))
      && landingNeedles.some((needle) => normalizedKey.includes(needle));
  });
  if (preferred) return withRawAtomIdPrefix(row, atomKind, String(preferred[1]));
  const fallback = entries.find(([key]) => {
    const normalizedKey = normalizeKey(key);
    return kindNeedles.some((needle) => normalizedKey.includes(needle));
  });
  return fallback ? String(fallback[1]) : "";
}

function withRawAtomIdPrefix(row, atomKind, landingValue) {
  const landingText = String(landingValue ?? "").trim();
  if (!landingText) return "";
  if (extractStructuredId(landingText, atomKind)) return landingText;
  const rawAtom = rawAtomReferenceValue(row, atomKind);
  const rawId = extractStructuredId(rawAtom, atomKind);
  if (!rawId) return landingText;
  return `\`${rawId}\` ${landingText}`;
}

function rawAtomReferenceValue(row, atomKind) {
  const kindNeedles = atomKindNeedles(atomKind).map(normalizeKey);
  const landingNeedles = atomLandingNeedles().map(normalizeKey);
  const found = Object.entries(row ?? {}).find(([key]) => {
    const normalizedKey = normalizeKey(key);
    return kindNeedles.some((needle) => normalizedKey.includes(needle))
      && !landingNeedles.some((needle) => normalizedKey.includes(needle));
  });
  return found ? String(found[1]) : "";
}

function atomKindNeedles(atomKind) {
  if (atomKind === "script") return ["script atom", "scriptAtom", "script_atom", "脚本原子", "脚本"];
  if (atomKind === "rhythm") return ["rhythm atom", "rhythmAtom", "rhythm_atom", "节奏原子", "节奏"];
  return ["packaging atom", "packagingAtom", "packaging_atom", "包装原子", "包装", "证明包装"];
}

function atomLandingNeedles() {
  return ["本方案落地", "本方案节奏落地", "本方案证明包装落地", "落地为", "落地", "方案落地", "迁移后", "改写后", "应用为", "应用"];
}

function normalizeKey(value) {
  return String(value ?? "").toLowerCase().replace(/[\s_（）()：:·\-]/g, "");
}

function normalizeSlotLabel(value) {
  return stripBacktickLabel(value)
    .toLowerCase()
    .replace(/^\s*(?:\d+|0+\d+|第\s*\d+\s*槽|slot\s*\d+|f0*\d+)[.、\s:：-]*/i, "")
    .replace(/[\s_（）()：:·\-`'"]/g, "");
}

function stripBacktickLabel(value) {
  return String(value ?? "").replace(/`[^`]+`\s*[：:]?\s*/g, "").trim();
}

function extractBacktickId(value) {
  return extractStructuredId(value);
}

function extractStructuredId(value, kind = null) {
  const text = String(value ?? "");
  const backtick = text.match(/`([^`]+)`/);
  if (backtick?.[1]) return backtick[1].trim();
  if (kind === "slotSubtype") return text.match(/\bSUB_[A-Za-z0-9_.:-]+\b/)?.[0] ?? null;
  if (kind === "slotArchetype") return text.match(/\bARCH_[A-Za-z0-9_.:-]+\b/)?.[0] ?? null;
  if (kind === "script") return text.match(/\b[A-Za-z0-9_.-]+::script::[A-Za-z0-9_.:-]+\b/i)?.[0] ?? null;
  if (kind === "rhythm") return text.match(/\b[A-Za-z0-9_.-]+::rhythm::[A-Za-z0-9_.:-]+\b/i)?.[0] ?? null;
  if (kind === "packaging") return text.match(/\b[A-Za-z0-9_.-]+::packaging::[A-Za-z0-9_.:-]+\b/i)?.[0] ?? null;
  return text.match(/\b(?:SUB|ARCH)_[A-Za-z0-9_.:-]+\b/)?.[0]
    ?? text.match(/\b[A-Za-z0-9_.-]+::(?:script|rhythm|packaging)::[A-Za-z0-9_.:-]+\b/i)?.[0]
    ?? null;
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
  hydrateConversationSlotAtomDisplays,
  hydrateSlotAtomDisplay,
  isCompleted,
  normalizeFinalMarkdown,
  normalizeText,
  readRestructureFinalFingerprint,
  resolveRestructureFinalPath,
  safePreview,
  safeRelative,
};
