const SECTION_KEY_MAP = {
  goalAndAssumptions: "targetAssumption",
  finalSlotChain: "slotChain",
  atomLandingTable: "atoms",
  scriptSegments: "scriptSegments",
  rhythmCurve: "rhythmCurve",
  packagingProof: "packagingProof",
};

function normalizeDisplayForOverlay(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  if (hasCanonicalOverlayShape(value)) return value;
  if (value.schemaVersion !== "function_slot_restructure_display.v1" || !value.sections || typeof value.sections !== "object") return value;
  const sections = value.sections;
  return {
    schemaVersion: value.schemaVersion,
    source: value.source ?? null,
    targetAssumption: normalizeSection(sections.goalAndAssumptions, "targetAssumption"),
    slotChain: normalizeTableSection(sections.finalSlotChain, "slotChain", { firstTableOnly: true }),
    atoms: normalizeTableSection(sections.atomLandingTable, "atoms"),
    scriptSegments: normalizeMixedSection(sections.scriptSegments, "scriptSegments"),
    rhythmCurve: normalizeMixedSection(sections.rhythmCurve, "rhythmCurve"),
    packagingProof: normalizeMixedSection(sections.packagingProof, "packagingProof"),
    sourceDisplay: value,
    missingSections: Array.isArray(value.missingSections) ? value.missingSections : [],
  };
}

function hasCanonicalOverlayShape(value) {
  return Boolean(value.targetAssumption || value.slotChain || value.atoms || value.scriptSegments || value.rhythmCurve || value.packagingProof);
}

function normalizeSection(section, fallbackId) {
  const normalized = {
    id: fallbackId,
    title: stringOrNull(section?.title) ?? fallbackId,
    items: Array.isArray(section?.items) ? section.items : [],
  };
  const paragraphs = normalized.items
    .filter((item) => item?.type === "paragraph" && typeof item.text === "string")
    .map((item) => item.text);
  if (paragraphs.length) normalized.summary = paragraphs.join("\n");
  return normalized;
}

function normalizeTableSection(section, fallbackKey, options = {}) {
  const rows = [];
  const items = Array.isArray(section?.items) ? section.items : [];
  for (const item of items) {
    if (item?.type === "table" && Array.isArray(item.rows)) {
      rows.push(...item.rows.map((row) => normalizeRow(row, fallbackKey)));
      if (options.firstTableOnly) break;
    } else if (item) {
      if (options.firstTableOnly && rows.length) break;
      rows.push(normalizeLooseItem(item, fallbackKey));
    }
  }
  return rows;
}

function normalizeMixedSection(section, fallbackKey) {
  const rows = [];
  const items = Array.isArray(section?.items) ? section.items : [];
  for (const item of items) {
    if (item?.type === "table" && Array.isArray(item.rows)) {
      rows.push(...item.rows.map((row) => normalizeRow(row, fallbackKey)));
    } else if (item) {
      rows.push(normalizeLooseItem(item, fallbackKey));
    }
  }
  return rows;
}

function normalizeRow(row, fallbackKey) {
  const normalized = {};
  for (const [key, rawValue] of Object.entries(row && typeof row === "object" ? row : {})) {
    normalized[normalizeKey(key)] = stripMarkdownTicks(rawValue);
  }
  const slotSubtype = firstCodeOrText(normalized.slotSubtype, normalized.subtype, normalized.slot);
  const archetype = firstCodeOrText(normalized.parentArchetype, normalized.slotArchetype, normalized.archetype);
  if (slotSubtype) normalized.slotSubtype = slotSubtype;
  if (archetype) normalized.slotArchetype = archetype;
  normalized.id = firstText(normalized.id, normalized.order, normalized.sequence, normalized.segment, normalized.name, normalized.title, stableLabel(normalized, fallbackKey));
  normalized.name = firstText(normalized.name, normalized.title, normalized.need, normalized.demand, normalized.role, normalized.function, normalized.id);
  return normalized;
}

function normalizeLooseItem(item, fallbackKey) {
  const text = firstText(item.text, item.title, item.label, item.name, stableLabel(item, fallbackKey));
  return {
    id: firstText(item.id, item.sectionId, text),
    name: text,
    title: firstText(item.title, item.text, item.label, fallbackKey),
    raw: item,
  };
}

function normalizeKey(key) {
  const text = String(key ?? "").trim();
  const lower = text.toLowerCase().replace(/\s+/g, "");
  if (["顺序", "序号", "order", "index"].includes(lower)) return "order";
  if (["需求", "观众需求", "need", "demand"].includes(lower)) return "need";
  if (["slotsubtype", "slot_subtype", "subtype"].includes(lower)) return "slotSubtype";
  if (["parentarchetype", "slotarchetype", "archetype", "parent_archetype"].includes(lower)) return "slotArchetype";
  if (["链路功能", "功能", "function", "role"].includes(lower)) return "function";
  if (["本方案用法", "方案用法", "usage"].includes(lower)) return "usage";
  if (["选择理由", "reason"].includes(lower)) return "reason";
  if (["atom", "atomid", "atom_id", "patternid", "pattern_id"].includes(lower)) return "atomId";
  if (["名称", "name"].includes(lower)) return "name";
  if (["标题", "title"].includes(lower)) return "title";
  return text.replace(/[^A-Za-z0-9_]+(.)/g, (_, char) => String(char).toUpperCase()).replace(/^[^A-Za-z_]+/, "") || "value";
}

function stripMarkdownTicks(value) {
  if (value && typeof value === "object" && !Array.isArray(value) && "value" in value) return stripMarkdownTicks(value.value);
  if (value == null) return value;
  if (typeof value !== "string") return value;
  return value.trim().replace(/^`+|`+$/g, "").trim();
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

function firstCodeOrText(...values) {
  const text = firstText(...values);
  if (!text) return null;
  const code = text.match(/`([^`]+)`/);
  if (code?.[1]) return code[1].trim();
  const leadingIdentifier = text.match(/^([A-Za-z0-9_.:-]+)`?\b/);
  if (leadingIdentifier?.[1]) return leadingIdentifier[1].trim();
  return (code?.[1] ?? text).trim();
}

function stringOrNull(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stableLabel(value, fallback) {
  try {
    return JSON.stringify(value).slice(0, 48);
  } catch {
    return fallback;
  }
}

module.exports = {
  SECTION_KEY_MAP,
  normalizeDisplayForOverlay,
};
