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
  if (value.schemaVersion !== "function_slot_restructure_display.v1" || !value.sections || typeof value.sections !== "object") return value;
  const sections = value.sections;
  const targetAssumption = normalizeSection(sections.goalAndAssumptions, "targetAssumption");
  const slotChain = normalizeSlotChainSection(sections.finalSlotChain);
  const atoms = normalizeTableSection(sections.atomLandingTable, "atoms");
  const scriptSegments = normalizeMixedSection(sections.scriptSegments, "scriptSegments");
  const rhythmCurve = normalizeMixedSection(sections.rhythmCurve, "rhythmCurve");
  const packagingProof = normalizeMixedSection(sections.packagingProof, "packagingProof");
  return {
    ...copyPassthroughFields(value),
    schemaVersion: value.schemaVersion,
    source: value.source ?? null,
    targetAssumption: targetAssumption.items.length ? targetAssumption : value.targetAssumption ?? targetAssumption,
    slotChain: slotChain.length ? slotChain : asArray(value.slotChain),
    atoms: atoms.length ? atoms : asArray(value.atoms),
    scriptSegments: scriptSegments.length ? scriptSegments : asArray(value.scriptSegments),
    rhythmCurve: rhythmCurve.length ? rhythmCurve : asArray(value.rhythmCurve),
    packagingProof: packagingProof.length ? packagingProof : asArray(value.packagingProof),
    sourceDisplay: value,
    missingSections: Array.isArray(value.missingSections) ? value.missingSections : [],
  };
}

function copyPassthroughFields(value) {
  const passthrough = {};
  for (const key of ["planId", "briefSlug", "slug", "artifactId", "parentArtifactId", "confirmationId", "sourceTurnId"]) {
    if (key in value) passthrough[key] = value[key];
  }
  return passthrough;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
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

function normalizeSlotChainSection(section) {
  const items = Array.isArray(section?.items) ? section.items : [];
  const candidates = [];
  for (const item of items) {
    if (item?.type !== "table" || !Array.isArray(item.rows)) continue;
    const rows = item.rows.map((row) => normalizeRow(row, "slotChain"));
    const slotRows = rows.filter((row) => canonicalSlotSubtype(row.slotSubtype));
    if (slotRows.length) candidates.push({ rows: dedupeSlotRows(slotRows), score: scoreSlotChainTable(item, slotRows) });
  }
  candidates.sort((left, right) => right.score - left.score || right.rows.length - left.rows.length);
  if (candidates[0]?.rows?.length) return candidates[0].rows;
  return normalizeTableSection(section, "slotChain", { firstTableOnly: true });
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
  if (["slotsubtype", "slotsubtypeid", "slot_subtype", "slot_subtype_id", "subtype", "subtypeid", "槽位", "对应槽位", "功能槽位", "槽位类型", "槽位subtype"].includes(lower)) return "slotSubtype";
  if (["parentarchetype", "slotarchetype", "archetype", "parent_archetype", "父级原型", "原型", "槽位原型"].includes(lower)) return "slotArchetype";
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

function canonicalSlotSubtype(value) {
  const text = firstText(value);
  if (!text) return null;
  const match = text.match(/\bSUB_[A-Za-z0-9_]+\b/);
  return match?.[0] ?? null;
}

function scoreSlotChainTable(item, rows) {
  const columns = Array.isArray(item?.columns) ? item.columns.join(" ") : "";
  const text = `${columns} ${JSON.stringify(rows.slice(0, 2))}`.toLowerCase();
  let score = rows.length * 10;
  if (/slotsubtype|slot_subtype|槽位|功能槽位|subtype/.test(text)) score += 80;
  if (/顺序|序号|order|index/.test(text)) score += 35;
  if (/观众状态|状态变化|链路功能|选择理由|需求|need|demand/.test(text)) score += 35;
  if (/slotarchetype|parent\s*archetype|archetype|槽位原型|父级原型/.test(text)) score += 20;
  if (/素材|供给|缺口|得分|能力|推荐素材|shot|group/.test(text)) score -= 30;
  return score;
}

function dedupeSlotRows(rows) {
  const seen = new Set();
  const result = [];
  for (const row of rows) {
    const slotId = canonicalSlotSubtype(row.slotSubtype);
    if (!slotId || seen.has(slotId)) continue;
    seen.add(slotId);
    result.push({ ...row, slotSubtype: slotId });
  }
  return result;
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
