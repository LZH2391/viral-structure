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
function buildGovernanceSourceIndex(governance) {
  const index = new Map();
  if (!governance || typeof governance !== "object") return index;
  for (const variant of asArray(governance.sourceVariants)) {
    const variantId = firstText(variant.variantId);
    if (!variantId) continue;
    index.set(`${variantId}::sourceVariant`, variant);
    index.set(`${variantId}::label`, firstText(variant.label, variantId));
  }
  for (const collectionName of ["slotFamilies", "slotArchetypes", "slotSubtypes", "atomArchetypes", "atomPatterns", "bindingPrinciples", "bindingPatterns", "rulePatterns", "recompositionPolicies", "implementationBundles", "templates"]) {
    for (const item of asArray(governance[collectionName])) {
      const id = firstText(item.id, item.governanceId, item.patternId);
      if (!id) continue;
      index.set(`${id}::item`, item);
      index.set(`${id}::name`, firstText(item.name, item.label, id));
      const variants = normalizeTextArray(item.sourceVariantIds);
      if (variants.length) index.set(id, variants);
      for (const variantId of variants) {
        const current = asArray(index.get(variantId));
        if (!current.includes(id)) index.set(variantId, [...current, id]);
      }
    }
  }
  for (const archetype of asArray(governance.slotArchetypes)) {
    const archetypeId = firstText(archetype.id, archetype.governanceId);
    const familyId = firstText(archetype.familyId);
    if (archetypeId && familyId) index.set(`${archetypeId}::familyId`, familyId);
  }
  for (const subtype of asArray(governance.slotSubtypes)) {
    const subtypeId = firstText(subtype.id, subtype.governanceId);
    const archetypeId = firstText(subtype.archetypeId);
    const familyId = archetypeId ? index.get(`${archetypeId}::familyId`) : null;
    if (subtypeId && archetypeId) index.set(`${subtypeId}::archetypeId`, archetypeId);
    if (subtypeId && familyId) index.set(`${subtypeId}::familyId`, familyId);
  }
  for (const pattern of asArray(governance.atomPatterns)) {
    const patternId = firstText(pattern.id, pattern.governanceId);
    const archetypeId = firstText(pattern.parentAtomArchetype);
    if (patternId && archetypeId) index.set(`${patternId}::atomArchetypeId`, archetypeId);
  }
  return index;
}

function governanceName(sourceIndex, governanceId, fallback) {
  return firstText(sourceIndex.get(`${governanceId}::name`), fallback);
}

function extractSourceAliasMap(display) {
  const map = new Map();
  const text = JSON.stringify(display ?? {});
  const regex = /([A-Z])\s*=\s*(sample_[A-Za-z0-9-]+)/g;
  for (const match of text.matchAll(regex)) map.set(match[1], match[2]);
  return map;
}

function extractAtomSourceRows(display, aliasMap, sourceIndex = new Map()) {
  const rows = [];
  const bySlotId = new Map();
  for (const atom of extractDisplayAtoms(display)) {
    const atomVariantIds = [];
    const slotId = extractSlotSubtypeId(atom);
    let hasSlotAnchor = false;
    for (const value of Object.values(atom)) {
      const text = firstText(value);
      if (!text) continue;
      if (/(^|[`'\s])([A-Z])::F\d+/i.test(text)) hasSlotAnchor = true;
      for (const match of text.matchAll(/([A-Z])::(script|rhythm|packaging)::([A-Za-z0-9_-]+)/g)) {
        const sampleId = aliasMap.get(match[1]);
        const variantId = sampleId ? `${sampleId}::${match[2]}::${match[3]}` : null;
        if (variantId && isKnownSourceVariant(variantId, sourceIndex)) atomVariantIds.push(variantId);
      }
    }
    if (hasSlotAnchor || atomVariantIds.length) {
      const row = { slotId, atomVariantIds };
      rows.push(row);
      if (slotId) {
        const current = bySlotId.get(slotId)?.atomVariantIds ?? [];
        bySlotId.set(slotId, { slotId, atomVariantIds: uniqueStrings([...current, ...atomVariantIds]) });
      }
    }
  }
  return { rows, bySlotId };
}

function isKnownSourceVariant(variantId, sourceIndex) {
  return Boolean(sourceIndex.get(`${variantId}::sourceVariant`) || asArray(sourceIndex.get(variantId)).length);
}

function parseVariantId(variantId) {
  const parts = String(variantId ?? "").split("::");
  return {
    sampleId: parts[0]?.startsWith("sample_") ? parts[0] : null,
    variantKind: parts.length > 2 ? parts[1] : "slot",
    variantKey: parts.slice(1).join("::"),
  };
}

function isAtomVariantKind(kind) {
  return kind === "script" || kind === "rhythm" || kind === "packaging";
}

function aliasForSample(aliasMap, sampleId) {
  for (const [alias, id] of aliasMap.entries()) {
    if (id === sampleId) return alias;
  }
  return null;
}

function shortSampleLabel(sampleId) {
  return String(sampleId ?? "").replace(/^sample_/, "sample ").slice(0, 18);
}

function variantDisplayLabel(aliasMap, variantId) {
  const parsed = parseVariantId(variantId);
  const alias = parsed.sampleId ? aliasForSample(aliasMap, parsed.sampleId) : null;
  return alias && parsed.variantKey ? `${alias}::${parsed.variantKey}` : String(variantId ?? "");
}

function normalizeTextArray(value) {
  return asArray(value).map((item) => firstText(item)).filter(Boolean);
}

function extractDisplaySlotChain(display) {
  const candidates = [];
  const topLevelSlots = asArray(display?.slotChain)
    .map((slot) => normalizeTraceRow(slot, "slotChain"))
    .filter((slot) => extractSlotSubtypeId(slot));
  if (topLevelSlots.length) candidates.push({
    rows: dedupeSlotChainRows(topLevelSlots),
    score: scoreSlotChainCandidate({ rows: topLevelSlots, sourceKind: "topLevel" }),
  });
  candidates.push(...extractSlotChainCandidatesFromSections(display));
  candidates.sort((left, right) => right.score - left.score || right.rows.length - left.rows.length);
  return candidates[0]?.rows ?? [];
}

function extractSlotChainCandidatesFromSections(display) {
  const candidates = [];
  for (const section of [display?.sections?.finalSlotChain, display?.sourceDisplay?.sections?.finalSlotChain]) {
    for (const item of asArray(section?.items)) {
      if (item?.type !== "table" || !Array.isArray(item.rows)) continue;
      const rows = item.rows
        .map((row) => normalizeTraceRow(row, "slotChain"))
        .filter((row) => extractSlotSubtypeId(row));
      if (rows.length) candidates.push({
        rows: dedupeSlotChainRows(rows),
        score: scoreSlotChainCandidate({ rows, item, sourceKind: "sectionTable" }),
      });
    }
  }
  return candidates;
}

function extractDisplayAtoms(display) {
  const candidates = [];
  const topLevelAtoms = asArray(display?.atoms).map((atom) => normalizeTraceRow(atom, "atoms"));
  if (topLevelAtoms.length) candidates.push({
    rows: topLevelAtoms,
    score: scoreAtomRowsCandidate(topLevelAtoms, "topLevel"),
  });
  for (const section of [display?.sections?.atomLandingTable, display?.sourceDisplay?.sections?.atomLandingTable]) {
    for (const item of asArray(section?.items)) {
      if (item?.type !== "table" || !Array.isArray(item.rows)) continue;
      const rows = item.rows.map((row) => normalizeTraceRow(row, "atoms"));
      if (rows.length) candidates.push({
        rows,
        score: scoreAtomRowsCandidate(rows, "sectionTable", item),
      });
    }
  }
  candidates.sort((left, right) => right.score - left.score || right.rows.length - left.rows.length);
  return candidates[0]?.rows ?? [];
}

function normalizeTraceRow(row, fallbackKey) {
  const normalized = {};
  for (const [key, rawValue] of Object.entries(row && typeof row === "object" ? row : {})) {
    normalized[normalizeTraceKey(key)] = rawValue;
  }
  const slotSubtype = extractSlotSubtypeId(normalized);
  if (slotSubtype) normalized.slotSubtype = slotSubtype;
  if (!firstText(normalized.id)) normalized.id = firstText(normalized.order, normalized.sequence, normalized.segment, normalized.name, normalized.title, stableLabel(normalized, fallbackKey));
  if (!firstText(normalized.name)) normalized.name = firstText(normalized.title, normalized.need, normalized.demand, normalized.role, normalized.function, normalized.id);
  return normalized;
}

function normalizeTraceKey(key) {
  const text = String(key ?? "").trim();
  const lower = text.toLowerCase().replace(/\s+/g, "");
  if (["顺序", "序号", "order", "index"].includes(lower)) return "order";
  if (["需求", "观众需求", "need", "demand"].includes(lower)) return "need";
  if (["slotsubtype", "slotsubtypeid", "slot_subtype", "slot_subtype_id", "subtype", "subtypeid", "对应槽位", "槽位", "功能槽位", "槽位类型", "槽位subtype"].includes(lower)) return "slotSubtype";
  if (["parentarchetype", "slotarchetype", "archetype", "parent_archetype", "父级原型", "原型", "槽位原型"].includes(lower)) return "slotArchetype";
  if (["观众状态变化", "状态变化", "audiencestate", "statechange"].includes(lower)) return "audienceState";
  if (["选择理由", "reason"].includes(lower)) return "reason";
  if (["名称", "name"].includes(lower)) return "name";
  if (["标题", "title"].includes(lower)) return "title";
  if (["段落", "segment"].includes(lower)) return "segment";
  return text.replace(/[^A-Za-z0-9_]+(.)/g, (_, char) => String(char).toUpperCase()).replace(/^[^A-Za-z_]+/, "") || "value";
}

function extractSlotSubtypeId(value, ...rest) {
  if (rest.length) return extractSlotSubtypeId([value, ...rest]);
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractSlotSubtypeId(item);
      if (found) return found;
    }
    return null;
  }
  if (value && typeof value === "object") {
    const ownText = firstText(value);
    if (ownText) {
      const ownMatch = ownText.match(/\bSUB_[A-Za-z0-9_]+\b/);
      if (ownMatch?.[0]) return ownMatch[0];
    }
    return extractSlotSubtypeId(value.slotSubtypeId, value.subtypeId, value.slotSubtype, value.subtype, value.slot, value.id);
  }
  const text = firstText(value);
  if (!text) return null;
  const match = text.match(/\bSUB_[A-Za-z0-9_]+\b/);
  return match?.[0] ?? null;
}

function scoreSlotChainCandidate({ rows, item = null, sourceKind = "unknown" }) {
  const columns = Array.isArray(item?.columns) ? item.columns.join(" ") : "";
  const text = `${columns} ${JSON.stringify(rows.slice(0, 3))}`.toLowerCase();
  let score = rows.length * 10;
  if (sourceKind === "topLevel") score += 20;
  if (/slotsubtype|slot_subtype|槽位|功能槽位|subtype/.test(text)) score += 80;
  if (/顺序|序号|order|index/.test(text)) score += 35;
  if (/观众状态|状态变化|链路功能|选择理由|需求|need|demand|reason/.test(text)) score += 35;
  if (/slotarchetype|parent\s*archetype|archetype|槽位原型|父级原型/.test(text)) score += 20;
  if (/素材|供给|缺口|得分|能力|推荐素材|shot|group/.test(text)) score -= 30;
  return score;
}

function dedupeSlotChainRows(rows) {
  const seen = new Set();
  const result = [];
  for (const row of rows) {
    const slotId = extractSlotSubtypeId(row);
    if (!slotId || seen.has(slotId)) continue;
    seen.add(slotId);
    result.push({ ...row, slotSubtype: slotId });
  }
  return result;
}

function scoreAtomRowsCandidate(rows, sourceKind = "unknown", item = null) {
  const columns = Array.isArray(item?.columns) ? item.columns.join(" ") : "";
  const text = `${columns} ${JSON.stringify(rows.slice(0, 3))}`;
  let score = rows.length * 8;
  if (sourceKind === "topLevel") score += 10;
  if (/\bSUB_[A-Za-z0-9_]+\b/.test(text)) score += 40;
  if (/[A-Z]::(script|rhythm|packaging)::[A-Za-z0-9_-]+/.test(text)) score += 60;
  if (/script|rhythm|packaging|atom|原标签|落地|对应槽位|槽位/i.test(text)) score += 30;
  if (/来源短码|sample_|素材包|缺口|审计/.test(text)) score -= 15;
  return score;
}

function uniqueStrings(values) {
  return Array.from(new Set(asArray(values).map((value) => firstText(value)).filter(Boolean)));
}

function atomGroup(variantKey) {
  if (String(variantKey).startsWith("rhythm::")) return "rhythm";
  if (String(variantKey).startsWith("packaging::")) return "packaging";
  return "script";
}

function stableLabel(value) {
  try {
    return JSON.stringify(value).slice(0, 48);
  } catch {
    return "item";
  }
}

module.exports = {
  aliasForSample,
  asArray,
  atomGroup,
  buildGovernanceSourceIndex,
  extractAtomSourceRows,
  extractDisplayAtoms,
  extractDisplaySlotChain,
  extractSlotSubtypeId,
  extractSourceAliasMap,
  firstText,
  governanceName,
  isAtomVariantKind,
  normalizeTextArray,
  parseVariantId,
  shortSampleLabel,
  uniqueStrings,
  variantDisplayLabel,
};
