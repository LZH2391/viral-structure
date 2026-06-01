const fs = require("fs/promises");
const path = require("path");

const SCHEMA_VERSION = "function_slot_replacement_candidates.v1";
const SLOT_INDEX_RELATIVE_PATH = path.join("Runtime", "Temp", "FunctionSlotLibrary", "slot_index.json");
const GOVERNANCE_RELATIVE_PATH = path.join("Artifacts", "FunctionSlotLibrary", "_governance", "semantic-governance.v1.json");

function createFunctionSlotReplacementCandidateService({ rootDir }) {
  if (!rootDir) throw new Error("FunctionSlotReplacementCandidateService requires rootDir");

  async function listCandidates({ kind = "slot", atomKind = null, slotSubtypeId = null, q = null, limit = 50 } = {}) {
    const slotIndexPath = path.join(rootDir, SLOT_INDEX_RELATIVE_PATH);
    const governancePath = path.join(rootDir, GOVERNANCE_RELATIVE_PATH);
    const [slotIndex, governance] = await Promise.all([
      readJson(slotIndexPath),
      readJson(governancePath).catch((error) => {
        if (error.code === "ENOENT") return null;
        throw error;
      }),
    ]);
    const normalizedKind = String(kind ?? "slot").trim() === "atom" ? "atom" : "slot";
    const normalizedAtomKind = normalizeAtomKind(atomKind);
    const normalizedSlotSubtypeId = normalizeText(slotSubtypeId);
    const query = normalizeText(q)?.toLowerCase() ?? null;
    const max = clampLimit(limit);
    const candidates = normalizedKind === "atom"
      ? buildAtomCandidates(slotIndex, governance, { atomKind: normalizedAtomKind, slotSubtypeId: normalizedSlotSubtypeId, query, max })
      : buildSlotCandidates(slotIndex, governance, { query, max });
    return {
      ok: true,
      schemaVersion: SCHEMA_VERSION,
      source: {
        slotIndexPath: SLOT_INDEX_RELATIVE_PATH.replaceAll(path.sep, "/"),
        governancePath: GOVERNANCE_RELATIVE_PATH.replaceAll(path.sep, "/"),
        slotIndexSchemaVersion: slotIndex.schemaVersion ?? null,
        governanceId: governance?.governanceId ?? null,
      },
      kind: normalizedKind,
      atomKind: normalizedKind === "atom" ? normalizedAtomKind : null,
      candidates,
    };
  }

  return { listCandidates };
}

function buildSlotCandidates(slotIndex, governance, { query, max }) {
  const reviewByVariant = buildReviewMap(governance);
  return (slotIndex.slotVariants ?? [])
    .map((slot) => {
      const tags = buildTags([
        slot.needReview ? "need_review" : null,
        slot.confidence != null ? `confidence:${slot.confidence}` : null,
        ...(reviewByVariant.get(slot.variantId) ?? []),
      ]);
      return {
        kind: "slot",
        candidateId: String(slot.variantId ?? ""),
        slotSubtypeId: textOrNull(slot.slotType),
        sourceSlotId: textOrNull(slot.sourceSlotId),
        label: textOrNull(slot.slotName) ?? textOrNull(slot.slotType) ?? textOrNull(slot.variantId),
        functionText: textOrNull(slot.persuasionTask),
        sourceSampleId: textOrNull(slot.sampleId),
        sourceArtifactId: textOrNull(slot.artifactId),
        order: numberOrNull(slot.slotOrder),
        confidence: numberOrNull(slot.confidence),
        needReview: Boolean(slot.needReview),
        evidenceTags: tags,
        evidence: {
          viewerStateBefore: textOrNull(slot.viewerStateBefore),
          viewerStateAfter: textOrNull(slot.viewerStateAfter),
          requiredSyncPoints: normalizeStringArray(slot.requiredSyncPoints),
          substitutionRules: normalizeStringArray(slot.substitutionRules),
          sourceRefs: slot.sourceRefs ?? slot.raw?.sourceRefs ?? null,
        },
        bindingEvidence: relatedEvidence(slotIndex, slot),
      };
    })
    .filter((candidate) => candidate.candidateId && matchesQuery(candidate, query))
    .slice(0, max);
}

function buildAtomCandidates(slotIndex, governance, { atomKind, slotSubtypeId, query, max }) {
  const reviewByVariant = buildReviewMap(governance);
  const kindMatched = (slotIndex.atomVariants ?? [])
    .filter((atom) => !atomKind || atom.kind === atomKind)
  const slotMatched = slotSubtypeId ? kindMatched.filter((atom) => atom.slotType === slotSubtypeId) : kindMatched;
  const sourceAtoms = slotMatched.length ? slotMatched : kindMatched;
  return sourceAtoms
    .map((atom) => {
      const tags = buildTags([
        atom.needReview ? "need_review" : null,
        atom.confidence != null ? `confidence:${atom.confidence}` : null,
        atom.risk ? "has_risk_note" : null,
        ...(reviewByVariant.get(atom.variantId) ?? []),
      ]);
      return {
        kind: "atom",
        atomKind: textOrNull(atom.kind),
        candidateId: String(atom.variantId ?? ""),
        atomId: textOrNull(atom.sourceAtomId),
        slotSubtypeId: textOrNull(atom.slotType),
        label: textOrNull(atom.label) ?? textOrNull(atom.sourceAtomId) ?? textOrNull(atom.variantId),
        functionText: textOrNull(atom.function),
        sourceSampleId: textOrNull(atom.sampleId),
        sourceArtifactId: textOrNull(atom.artifactId),
        confidence: numberOrNull(atom.confidence),
        needReview: Boolean(atom.needReview),
        evidenceTags: tags,
        evidence: {
          claimType: textOrNull(atom.claimType),
          proofNeed: textOrNull(atom.proofNeed),
          pace: textOrNull(atom.pace),
          densityType: textOrNull(atom.densityType),
          packagingFunction: textOrNull(atom.packagingFunction),
          visualHierarchy: textOrNull(atom.visualHierarchy),
          risk: textOrNull(atom.risk),
          avoidFor: normalizeStringArray(atom.avoidFor),
          sourceRefs: atom.raw?.sourceRefs ?? null,
        },
        bindingEvidence: relatedEvidence(slotIndex, atom),
      };
    })
    .filter((candidate) => candidate.candidateId && matchesQuery(candidate, query))
    .slice(0, max);
}

function relatedEvidence(slotIndex, value) {
  const variantId = String(value.variantId ?? "");
  const sourceId = String(value.sourceSlotId ?? value.sourceAtomId ?? "");
  const slotType = String(value.slotType ?? "");
  const bindings = (slotIndex.bindings ?? [])
    .filter((binding) => sameSource(binding, value) && (
      binding.slotIds?.includes(sourceId)
      || binding.atomIds?.includes(sourceId)
      || (slotType && binding.slotIds?.some((id) => variantId.includes(`::${id}`)))
    ))
    .slice(0, 4)
    .map((binding) => ({
      id: textOrNull(binding.id),
      type: textOrNull(binding.type),
      rule: textOrNull(binding.rule),
      riskIfBroken: textOrNull(binding.riskIfBroken),
      confidence: numberOrNull(binding.confidence),
    }));
  const rules = (slotIndex.rules ?? [])
    .filter((rule) => sameSource(rule, value) && (
      rule.slotIds?.includes(sourceId)
      || rule.atomIds?.includes(sourceId)
    ))
    .slice(0, 4)
    .map((rule) => ({
      id: textOrNull(rule.id),
      ruleKind: textOrNull(rule.ruleKind),
      reason: textOrNull(rule.reason),
      fix: textOrNull(rule.fix),
    }));
  return { bindings, rules };
}

function sameSource(left, right) {
  return String(left.sampleId ?? "") === String(right.sampleId ?? "")
    && String(left.artifactId ?? "") === String(right.artifactId ?? "");
}

function buildReviewMap(governance) {
  const byVariant = new Map();
  for (const item of governance?.reviewItems ?? []) {
    const label = [item.severity, item.topic].filter(Boolean).join(":");
    for (const variantId of item.sourceVariantIds ?? []) {
      const current = byVariant.get(variantId) ?? [];
      current.push(label || "review_item");
      byVariant.set(variantId, current);
    }
  }
  return byVariant;
}

function buildTags(values) {
  return [...new Set(values.map((value) => normalizeText(value)).filter(Boolean))];
}

function matchesQuery(candidate, query) {
  if (!query) return true;
  return JSON.stringify(candidate).toLowerCase().includes(query);
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function normalizeAtomKind(value) {
  const text = String(value ?? "").trim();
  return ["script", "rhythm", "packaging"].includes(text) ? text : null;
}

function clampLimit(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 50;
  return Math.max(1, Math.min(100, Math.floor(number)));
}

function normalizeText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function textOrNull(value) {
  return normalizeText(value);
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeStringArray(value) {
  return Array.isArray(value) ? value.map((item) => normalizeText(item)).filter(Boolean) : [];
}

module.exports = {
  SCHEMA_VERSION,
  createFunctionSlotReplacementCandidateService,
};
