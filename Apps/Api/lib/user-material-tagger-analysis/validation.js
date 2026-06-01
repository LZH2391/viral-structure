const {
  MAX_MATERIAL_GROUPS,
  MAX_SEQUENCE_CANDIDATES,
  MAX_SHOT_CARDS,
  PROOF_NEED_CLASSES,
  normalizeConfidence,
  normalizeStringArray,
  normalizeText,
} = require("./shared");

const SHOT_CLASSES = new Set([
  "product_display",
  "usage_process",
  "problem_scene",
  "result_or_state",
  "comparison",
  "trust_evidence",
  "human_presence",
  "scene_context",
  "transition_or_filler",
  "unusable",
]);
const STRENGTHS = new Set(["strong", "medium", "weak", "none", "unknown"]);
const COVERAGES = new Set(["strong", "partial", "weak", "missing", "unknown"]);
const FITS = new Set(["strong", "medium", "weak"]);
const QUALITY_VALUES = new Set(["high", "medium", "low", "none", "unknown"]);
const CONTINUITY_VALUES = new Set(["strong", "medium", "weak", "none"]);

function validateUserMaterialPack(parsed, input) {
  if (parsed?.type !== "user-material-pack") {
    return invalidValidation("user_material_pack_type_invalid", "用户素材识别输出 type 必须为 user-material-pack", { path: "type" });
  }
  if (parsed?.schemaVersion !== "user-material-pack.stable") {
    return invalidValidation("user_material_pack_schema_invalid", "用户素材识别输出 schemaVersion 不正确", { path: "schemaVersion" });
  }
  const shotMap = buildShotRefMap(input?.shots);
  const shotCards = normalizeShotCards(parsed?.shotCards, shotMap);
  if (!shotCards.ok) return shotCards;
  const materialGroups = normalizeMaterialGroups(parsed?.materialGroups, shotMap);
  if (!materialGroups.ok) return materialGroups;
  const proofCoverage = normalizeProofCoverage(parsed?.proofCoverage, shotMap, materialGroups.items);
  if (!proofCoverage.ok) return proofCoverage;
  const sequenceRecommendations = normalizeSequenceRecommendations(parsed?.sequenceRecommendations, shotMap);
  if (!sequenceRecommendations.ok) return sequenceRecommendations;
  return {
    ok: true,
    shotCards: shotCards.items,
    materialGroups: materialGroups.items,
    proofCoverage: proofCoverage.items,
    sequenceRecommendations: sequenceRecommendations.value,
    globalConstraints: normalizeStringArray(parsed?.globalConstraints, 24),
    restructureInputSummary: normalizeRestructureInputSummary(parsed?.restructureInputSummary),
    summary: {
      validatorCode: null,
      shotCardCount: shotCards.items.length,
      materialGroupCount: materialGroups.items.length,
      proofCoverageCount: proofCoverage.items.length,
      openingCandidateCount: sequenceRecommendations.value.openingCandidates.length,
      middleCandidateCount: sequenceRecommendations.value.middleCandidates.length,
      endingCandidateCount: sequenceRecommendations.value.endingCandidates.length,
    },
  };
}

function normalizeShotCards(value, shotMap) {
  if (!Array.isArray(value)) return invalidValidation("user_material_pack_missing_shot_cards", "用户素材识别未返回 shotCards", { path: "shotCards" });
  if (value.length !== shotMap.size) {
    const shotRefs = value.map((card) => resolveShotRef(card?.shotRef ?? card?.shotId ?? card?.id ?? card?.shotNo, shotMap)).filter(Boolean);
    return invalidValidation("user_material_pack_shot_cards_incomplete", "shotCards 必须逐镜头覆盖所有输入 shots", {
      expectedShotCount: shotMap.size,
      shotCardCount: value.length,
      missingShotRefs: Array.from(shotMap.keys()).filter((shotRef) => !shotRefs.includes(shotRef)),
      unexpectedShotRefs: value.map((card) => normalizeText(card?.shotRef ?? card?.shotId ?? card?.id ?? card?.shotNo, 80)).filter((shotRef) => shotRef && !resolveShotRef(shotRef, shotMap)),
    });
  }
  if (value.length > MAX_SHOT_CARDS) return invalidValidation("user_material_pack_too_many_shot_cards", "shotCards 数量超出允许范围", { shotCardCount: value.length, maxShotCards: MAX_SHOT_CARDS });
  const seen = new Set();
  const items = [];
  for (let index = 0; index < value.length; index += 1) {
    const card = normalizeShotCard(value[index], index, shotMap);
    if (!card.ok) return card;
    if (seen.has(card.item.shotRef)) return invalidValidation("user_material_pack_duplicate_shot_card", "同一 shotRef 只能出现一个 shotCard", { path: `shotCards[${index}].shotRef`, shotRef: card.item.shotRef });
    seen.add(card.item.shotRef);
    const { shotOrder, ...clean } = card.item;
    items.push(clean);
  }
  return { ok: true, items: items.sort((a, b) => shotMap.get(a.shotRef).order - shotMap.get(b.shotRef).order) };
}

function normalizeShotCard(card, index, shotMap) {
  const rawShotRef = normalizeText(card?.shotRef ?? card?.shotId ?? card?.id ?? card?.shotNo, 80);
  const shotRef = resolveShotRef(rawShotRef, shotMap);
  const shot = shotMap.get(shotRef);
  if (!shotRef || !shot) return invalidValidation("user_material_pack_unknown_shot_ref", "shotCard.shotRef 引用了不存在的 shotId", { path: `shotCards[${index}].shotRef`, shotRef: rawShotRef });
  const shotClass = normalizeShotClass(card?.shotClass);
  const sequenceFit = normalizeSequenceFit(card?.sequenceFit ?? card?.positionRecommendations);
  return {
    ok: true,
    item: {
      shotRef,
      shotNo: normalizeText(card?.shotNo, 40) || shot.shotNo,
      timeRange: { start: shot.start, end: shot.end },
      shotClass,
      shotFunctions: normalizeStringArray(card?.shotFunctions, 16),
      visualSummary: normalizeText(card?.visualSummary, 360),
      spokenOrSubtitleSummary: normalizeText(card?.spokenOrSubtitleSummary, 320),
      detectedEntities: normalizeDetectedEntities(card?.detectedEntities, card),
      materialTags: normalizeStringArray(card?.materialTags, 24),
      proofAffordances: normalizeProofAffordances(card?.proofAffordances ?? card?.proofNeedRefs),
      sequenceFit,
      quality: normalizeQuality(card?.quality),
      constraints: normalizeStringArray(firstArray(card?.constraints, card?.limitations, card?.quality?.limitations), 16),
      confidence: normalizeConfidence(card?.confidence, 0.72),
      needReview: Boolean(card?.needReview),
      shotOrder: shot.order,
    },
  };
}

function normalizeDetectedEntities(value, card = {}) {
  return {
    products: normalizeStringArray(value?.products, 12),
    people: normalizeStringArray(value?.people, 12),
    scenes: normalizeStringArray(value?.scenes, 12),
    objects: normalizeStringArray(firstArray(value?.objects, card?.visibleObjects), 12),
    textSignals: normalizeStringArray(value?.textSignals, 12),
  };
}

function normalizeProofAffordances(value) {
  return (Array.isArray(value) ? value : []).map((item) => ({
    proofNeedClass: normalizeEnum(item?.proofNeedClass, new Set(PROOF_NEED_CLASSES), "problem_visibility"),
    strength: normalizeEnum(item?.strength ?? item?.supportStrength, STRENGTHS, "unknown"),
    reason: normalizeText(item?.reason, 240),
    limits: normalizeStringArray(firstArray(item?.limits, item?.limitations), 8),
  })).filter((item) => item.reason || item.limits.length);
}

function normalizeSequenceFit(value) {
  return {
    opening: normalizeFit(value?.opening),
    middle: normalizeFit(value?.middle),
    ending: normalizeFit(value?.ending),
  };
}

function normalizeFit(value) {
  if (typeof value?.suitable === "boolean") {
    return {
      fit: value.suitable ? "medium" : "weak",
      reason: normalizeText(value?.reason, 180),
      requiredSupport: normalizeStringArray(value?.requiredSupport, 8),
    };
  }
  return {
    fit: normalizeEnum(value?.fit, FITS, "weak"),
    reason: normalizeText(value?.reason, 180),
    requiredSupport: normalizeStringArray(value?.requiredSupport, 8),
  };
}

function normalizeQuality(value) {
  return {
    visualClarity: normalizeEnum(value?.visualClarity ?? value?.clarity, QUALITY_VALUES, "unknown"),
    stability: normalizeEnum(value?.stability, QUALITY_VALUES, "unknown"),
    subjectFocus: normalizeEnum(value?.subjectFocus, QUALITY_VALUES, "unknown"),
    audioUsefulness: normalizeEnum(value?.audioUsefulness, QUALITY_VALUES, "unknown"),
    captionUsefulness: normalizeEnum(value?.captionUsefulness, QUALITY_VALUES, "unknown"),
  };
}

function normalizeMaterialGroups(value, shotMap) {
  if (!Array.isArray(value)) return invalidValidation("user_material_pack_missing_material_groups", "用户素材识别未返回 materialGroups", { path: "materialGroups" });
  if (value.length > MAX_MATERIAL_GROUPS) return invalidValidation("user_material_pack_too_many_material_groups", "materialGroups 数量超出允许范围", { materialGroupCount: value.length, maxMaterialGroups: MAX_MATERIAL_GROUPS });
  const items = [];
  for (let index = 0; index < value.length; index += 1) {
    const groupId = normalizeText(value[index]?.groupId, 80) || `group_${index + 1}`;
    const shotRefs = normalizeExistingShotRefs(firstArray(value[index]?.shotRefs, value[index]?.supportingShotRefs, value[index]?.shots), shotMap);
    if (!shotRefs.ok) return invalidValidation("user_material_pack_material_group_unknown_shot_ref", "materialGroups.shotRefs 引用了不存在的 shotId", { path: `materialGroups[${index}].shotRefs`, shotRefs: shotRefs.invalid });
    items.push({
      groupId,
      groupType: normalizeText(value[index]?.groupType, 80) || "bridge_group",
      shotRefs: shotRefs.items,
      groupSummary: normalizeText(value[index]?.groupSummary, 320) || normalizeText(value[index]?.name, 160) || normalizeText(value[index]?.safeUsage, 320),
      usableForProofNeedClasses: normalizeProofNeedClasses(firstArray(value[index]?.usableForProofNeedClasses, value[index]?.proofNeedClasses)),
      notUsableForProofNeedClasses: normalizeProofNeedClasses(value[index]?.notUsableForProofNeedClasses),
      continuity: normalizeEnum(value[index]?.continuity, CONTINUITY_VALUES, "none"),
      constraints: normalizeStringArray(firstArray(value[index]?.constraints, value[index]?.limitations), 12),
    });
  }
  return { ok: true, items };
}

function normalizeProofCoverage(value, shotMap, materialGroups) {
  const normalizedValue = normalizeProofCoverageInput(value);
  if (!Array.isArray(normalizedValue)) return invalidValidation("user_material_pack_missing_proof_coverage", "用户素材识别未返回 proofCoverage", { path: "proofCoverage" });
  const groupIds = new Set(materialGroups.map((group) => group.groupId));
  const byClass = new Map();
  for (let index = 0; index < normalizedValue.length; index += 1) {
    const proofNeedClass = normalizeEnum(normalizedValue[index]?.proofNeedClass, new Set(PROOF_NEED_CLASSES), "");
    if (!proofNeedClass) continue;
    const shotRefs = normalizeExistingShotRefs(normalizedValue[index]?.candidateShots, shotMap);
    if (!shotRefs.ok) return invalidValidation("user_material_pack_proof_coverage_unknown_shot_ref", "proofCoverage.candidateShots 引用了不存在的 shotId", { path: `proofCoverage[${index}].candidateShots`, shotRefs: shotRefs.invalid });
    const candidateGroups = normalizeStringArray(normalizedValue[index]?.candidateGroups, 16).filter((groupId) => groupIds.has(groupId));
    byClass.set(proofNeedClass, {
      proofNeedClass,
      coverage: normalizeCoverage(normalizedValue[index]?.coverage),
      candidateShots: shotRefs.items,
      candidateGroups,
      reason: normalizeText(normalizedValue[index]?.reason, 320),
      safeUsage: normalizeText(normalizedValue[index]?.safeUsage, 240),
      gapAdvice: normalizeText(normalizedValue[index]?.gapAdvice, 240),
    });
  }
  const missing = PROOF_NEED_CLASSES.filter((proofNeedClass) => !byClass.has(proofNeedClass));
  if (missing.length) return invalidValidation("user_material_pack_proof_coverage_incomplete", "proofCoverage 必须覆盖所有 proofNeedClass", { missingProofNeedClasses: missing });
  const items = PROOF_NEED_CLASSES.map((proofNeedClass) => byClass.get(proofNeedClass));
  const untouched = items.every((item) => item.coverage === "unknown" && !item.candidateShots.length && !item.candidateGroups.length && !item.reason && !item.safeUsage && !item.gapAdvice);
  if (untouched) return invalidValidation("user_material_pack_proof_coverage_unfilled", "proofCoverage 仍是未填写骨架", { path: "proofCoverage" });
  return { ok: true, items };
}

function normalizeProofCoverageInput(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return value;
  return Object.entries(value).map(([proofNeedClass, item]) => {
    const coverage = item && typeof item === "object" ? item : {};
    const candidateShots = firstArray(coverage.candidateShots, coverage.supportingShotRefs, coverage.shotRefs);
    const candidateGroups = firstArray(coverage.candidateGroups, coverage.supportingGroupRefs, coverage.groupRefs);
    const safeUsage = normalizeText(coverage.safeUsage, 240);
    return {
      proofNeedClass,
      coverage: coverage.coverage,
      candidateShots,
      candidateGroups,
      reason: normalizeText(coverage.reason, 320) || safeUsage || normalizeProofCoverageReason(coverage),
      safeUsage,
      gapAdvice: normalizeText(coverage.gapAdvice, 240),
    };
  });
}

function firstArray(...values) {
  return values.find((value) => Array.isArray(value) && value.length) ?? values.find((value) => Array.isArray(value)) ?? [];
}

function normalizeCoverage(value) {
  const text = normalizeText(value, 80);
  if (text === "covered") return "strong";
  if (text === "partially_covered") return "partial";
  if (text === "not_covered" || text === "none") return "missing";
  return normalizeEnum(text, COVERAGES, "unknown");
}

function normalizeProofCoverageReason(value) {
  const coverage = normalizeText(value?.coverage, 80);
  const supportStrength = normalizeText(value?.supportStrength, 80);
  return [coverage, supportStrength].filter(Boolean).join(" / ");
}

function normalizeSequenceRecommendations(value, shotMap) {
  const opening = normalizeCandidateList(value?.openingCandidates, "opening", shotMap);
  if (!opening.ok) return opening;
  const middle = normalizeCandidateList(value?.middleCandidates, "middle", shotMap);
  if (!middle.ok) return middle;
  const ending = normalizeCandidateList(value?.endingCandidates, "ending", shotMap);
  if (!ending.ok) return ending;
  return { ok: true, value: { openingCandidates: opening.items, middleCandidates: middle.items, endingCandidates: ending.items } };
}

function normalizeCandidateList(value, position, shotMap) {
  const raw = Array.isArray(value) ? value : [];
  const items = [];
  for (let index = 0; index < Math.min(raw.length, MAX_SEQUENCE_CANDIDATES); index += 1) {
    const rawShotRef = normalizeText(raw[index]?.shotRef ?? raw[index]?.shotId ?? raw[index]?.shotNo, 80);
    const shotRef = resolveShotRef(rawShotRef, shotMap);
    if (!shotRef) return invalidValidation("user_material_pack_sequence_candidate_unknown_shot_ref", "sequenceRecommendations 引用了不存在的 shotId", { position, shotRef: rawShotRef });
    items.push({
      shotRef,
      fit: normalizeEnum(raw[index]?.fit, FITS, "weak"),
      recommendedPosition: normalizeEnum(raw[index]?.recommendedPosition, new Set(["opening", "middle", "ending"]), position),
      reason: normalizeText(raw[index]?.reason, 240),
      requiredSupport: normalizeStringArray(raw[index]?.requiredSupport, 8),
      doNotUseAs: normalizeProofNeedClasses(raw[index]?.doNotUseAs),
    });
  }
  return { ok: true, items };
}

function normalizeRestructureInputSummary(value) {
  return {
    strongMaterialAreas: normalizeStringArray(value?.strongMaterialAreas, 12),
    weakMaterialAreas: normalizeStringArray(value?.weakMaterialAreas, 12),
    missingMaterialAreas: normalizeStringArray(value?.missingMaterialAreas, 12),
    recommendedUse: normalizeStringArray(value?.recommendedUse, 12),
    doNotUseFor: normalizeStringArray(value?.doNotUseFor, 12),
    needsRestructureAttention: normalizeStringArray(value?.needsRestructureAttention, 12),
  };
}

function normalizeProofNeedClasses(value) {
  const allowed = new Set(PROOF_NEED_CLASSES);
  return normalizeStringArray(value, 12).filter((item) => allowed.has(item));
}

function normalizeExistingShotRefs(value, shotMap) {
  const items = normalizeStringArray(value, 60);
  const resolved = items.map((shotRef) => ({ raw: shotRef, resolved: resolveShotRef(shotRef, shotMap) }));
  const invalid = resolved.filter((item) => !item.resolved).map((item) => item.raw);
  return invalid.length ? { ok: false, invalid } : { ok: true, items: [...new Set(resolved.map((item) => item.resolved))] };
}

function buildShotRefMap(shots) {
  const aliases = new Map();
  const entries = (Array.isArray(shots) ? shots : []).map((shot, index) => {
    const shotId = normalizeText(shot?.shotId, 80);
    const shotNo = normalizeText(shot?.shotNo, 80);
    if (shotNo) aliases.set(shotNo, shotId);
    return [shotId, { ...shot, order: index }];
  }).filter(([shotId]) => shotId);
  const map = new Map(entries);
  map.aliases = aliases;
  return map;
}

function resolveShotRef(value, shotMap) {
  const text = normalizeText(value, 80);
  if (!text) return "";
  if (shotMap.has(text)) return text;
  return shotMap.aliases?.get(text) ?? "";
}

function normalizeShotClass(value) {
  const text = normalizeText(value, 80);
  if (SHOT_CLASSES.has(text)) return text;
  if (text.includes("process") || text.includes("operation") || text.includes("brewing")) return "usage_process";
  if (text.includes("result") || text.includes("state") || text.includes("drink")) return "result_or_state";
  if (text.includes("comparison") || text.includes("compare")) return "comparison";
  if (text.includes("trust") || text.includes("brand")) return "trust_evidence";
  if (text.includes("scene")) return "scene_context";
  if (text.includes("product") || text.includes("package")) return "product_display";
  return "unusable";
}

function normalizeEnum(value, allowed, fallback) {
  const text = normalizeText(value, 80);
  return allowed.has(text) ? text : fallback;
}

function invalidValidation(code, message, extra = {}) {
  return {
    ok: false,
    code,
    message,
    summary: {
      validatorCode: code,
      code,
      message,
      readableMessage: message,
      ...extra,
    },
  };
}

module.exports = {
  validateUserMaterialPack,
};
