const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const GOVERNANCE_LOOKUP_SCHEMA_VERSION = "function_slot_governance_lookup_index.v1";

function buildGovernanceLookupIndex(governance) {
  const byId = {};
  const byVariantId = {};
  const reviewByVariantId = {};
  const subtypeToAtomPatternIds = {};
  const bundleToGovernanceIds = {};

  const collections = [
    ["slotFamily", governance?.slotFamilies],
    ["slotArchetype", governance?.slotArchetypes],
    ["slotSubtype", governance?.slotSubtypes],
    ["atomArchetype", governance?.atomArchetypes],
    ["atomPattern", governance?.atomPatterns],
    ["bindingPattern", governance?.bindingPatterns],
    ["bindingPrinciple", governance?.bindingPrinciples],
    ["rulePattern", governance?.rulePatterns],
    ["recompositionPolicy", governance?.recompositionPolicies],
    ["implementationBundle", governance?.implementationBundles],
    ["observedChainPattern", governance?.observedChainPatterns],
  ];

  for (const [type, items] of collections) {
    for (const item of asArray(items)) {
      const id = firstText(item.id, item.governanceId, item.patternId);
      if (!id) continue;
      byId[id] = {
        type,
        id,
        name: firstText(item.name, item.label, id),
        sourceVariantIds: normalizeTextArray(item.sourceVariantIds),
        item,
      };
      for (const variantId of byId[id].sourceVariantIds) {
        const row = byVariantId[variantId] ?? { variantId, governanceIds: [], byType: {} };
        row.governanceIds.push(id);
        row.byType[type] = [...new Set([...(row.byType[type] ?? []), id])];
        byVariantId[variantId] = row;
      }
    }
  }

  for (const pattern of asArray(governance?.atomPatterns)) {
    const patternId = firstText(pattern.id, pattern.governanceId);
    if (!patternId) continue;
    for (const subtypeId of normalizeTextArray(pattern.forSlotSubtypeIds)) {
      subtypeToAtomPatternIds[subtypeId] = [...new Set([...(subtypeToAtomPatternIds[subtypeId] ?? []), patternId])];
    }
  }

  for (const bundle of asArray(governance?.implementationBundles)) {
    const bundleId = firstText(bundle.id, bundle.governanceId);
    if (!bundleId) continue;
    bundleToGovernanceIds[bundleId] = {
      slotSubtypeIds: normalizeTextArray(bundle.slotSubtypeIds),
      atomPatternIds: normalizeTextArray([
        ...asArray(bundle.scriptPatternIds),
        ...asArray(bundle.rhythmPatternIds),
        ...asArray(bundle.packagingPatternIds),
      ]),
    };
  }

  for (const item of asArray(governance?.reviewItems)) {
    const label = [firstText(item.severity), firstText(item.topic)].filter(Boolean).join(":") || "review_item";
    for (const variantId of normalizeTextArray(item.sourceVariantIds)) {
      reviewByVariantId[variantId] = [...new Set([...(reviewByVariantId[variantId] ?? []), label])];
    }
  }

  return {
    schemaVersion: GOVERNANCE_LOOKUP_SCHEMA_VERSION,
    governanceId: governance?.governanceId ?? null,
    sourceSchemaVersion: governance?.schemaVersion ?? null,
    sourceGovernanceFormat: governance?.governanceFormat ?? null,
    sourceFingerprint: governanceFingerprint(governance),
    generatedAt: new Date().toISOString(),
    byId,
    byVariantId,
    reviewByVariantId,
    subtypeToAtomPatternIds,
    bundleToGovernanceIds,
    summary: {
      itemCount: Object.keys(byId).length,
      variantCount: Object.keys(byVariantId).length,
      reviewVariantCount: Object.keys(reviewByVariantId).length,
    },
  };
}

async function writeGovernanceLookupIndex(filePath, governance) {
  const index = buildGovernanceLookupIndex(governance);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
  return index;
}

async function readGovernanceLookupIndexIfExists(filePath) {
  try {
    const value = JSON.parse(await fs.readFile(filePath, "utf8"));
    return value?.schemaVersion === GOVERNANCE_LOOKUP_SCHEMA_VERSION ? value : null;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeTextArray(value) {
  return asArray(value).map(firstText).filter(Boolean);
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

function governanceFingerprint(governance) {
  return crypto.createHash("sha256").update(stableStringify({
    schemaVersion: governance?.schemaVersion ?? null,
    governanceId: governance?.governanceId ?? null,
    sourceSnapshot: governance?.sourceSnapshot ?? null,
    coverage: governance?.coverage ?? null,
    sourceVariants: governance?.sourceVariants ?? [],
    slotFamilies: governance?.slotFamilies ?? [],
    slotArchetypes: governance?.slotArchetypes ?? [],
    slotSubtypes: governance?.slotSubtypes ?? [],
    atomArchetypes: governance?.atomArchetypes ?? [],
    atomPatterns: governance?.atomPatterns ?? [],
    bindingPatterns: governance?.bindingPatterns ?? [],
    bindingPrinciples: governance?.bindingPrinciples ?? [],
    rulePatterns: governance?.rulePatterns ?? [],
    recompositionPolicies: governance?.recompositionPolicies ?? [],
    implementationBundles: governance?.implementationBundles ?? [],
    observedChainPatterns: governance?.observedChainPatterns ?? [],
    unmappedAtomVariants: governance?.unmappedAtomVariants ?? [],
    unmappedBindingVariants: governance?.unmappedBindingVariants ?? [],
    unmappedRuleVariants: governance?.unmappedRuleVariants ?? [],
    reviewItems: governance?.reviewItems ?? [],
    openQuestions: governance?.openQuestions ?? [],
  }), "utf8").digest("hex");
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

module.exports = {
  GOVERNANCE_LOOKUP_SCHEMA_VERSION,
  buildGovernanceLookupIndex,
  governanceFingerprint,
  readGovernanceLookupIndexIfExists,
  writeGovernanceLookupIndex,
};
