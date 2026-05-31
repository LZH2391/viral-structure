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
  const shotMap = new Map((Array.isArray(input?.shots) ? input.shots : []).map((shot, index) => [shot.shotId, { ...shot, order: index }]));
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
    const shotRefs = value.map((card) => normalizeText(card?.shotRef, 80)).filter(Boolean);
    return invalidValidation("user_material_pack_shot_cards_incomplete", "shotCards 必须逐镜头覆盖所有输入 shots", {
      expectedShotCount: shotMap.size,
      shotCardCount: value.length,
      missingShotRefs: Array.from(shotMap.keys()).filter((shotRef) => !shotRefs.includes(shotRef)),
      unexpectedShotRefs: shotRefs.filter((shotRef) => !shotMap.has(shotRef)),
    });
  }
  if (value.length > MAX_SHOT_CARDS) return invalidValidation("user_material_pack_too_many_shot_cards", "shotCards 数量超出允许范围", { shotCardCount: value.length, maxShotCards: MAX_SHOT_CARDS });
  const seen = new Set();
  const items = [];
  for (let index = 0; index < value.length; index += 1) {
    const card = normalizeShotCard(value[index], index, shotMap);
    if (!card.ok) return card;
    if (seen.has(card.item.shotRef)) return invalidValidation("user_material_pack_duplicate_shot_card", "同一 shotRef 只能出现一个 shotCard", { path: `shotCards[${index}].shotRef`, shotRef: card.item.shotRef });
    if (card.item.shotOrder !== index) return invalidValidation("user_material_pack_shot_card_order_invalid", "shotCards 必须按输入镜头顺序排列", { path: `shotCards[${index}].shotRef`, expectedShotRef: Array.from(shotMap.keys())[index], shotRef: card.item.shotRef });
    seen.add(card.item.shotRef);
    const { shotOrder, ...clean } = card.item;
    items.push(clean);
  }
  return { ok: true, items };
}

function normalizeShotCard(card, index, shotMap) {
  const shotRef = normalizeText(card?.shotRef, 80);
  const shot = shotMap.get(shotRef);
  if (!shotRef || !shot) return invalidValidation("user_material_pack_unknown_shot_ref", "shotCard.shotRef 引用了不存在的 shotId", { path: `shotCards[${index}].shotRef`, shotRef });
  const shotClass = normalizeEnum(card?.shotClass, SHOT_CLASSES, "unusable");
  const sequenceFit = normalizeSequenceFit(card?.sequenceFit);
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
      detectedEntities: normalizeDetectedEntities(card?.detectedEntities),
      materialTags: normalizeStringArray(card?.materialTags, 24),
      proofAffordances: normalizeProofAffordances(card?.proofAffordances),
      sequenceFit,
      quality: normalizeQuality(card?.quality),
      constraints: normalizeStringArray(card?.constraints, 16),
      confidence: normalizeConfidence(card?.confidence, 0.72),
      needReview: Boolean(card?.needReview),
      shotOrder: shot.order,
    },
  };
}

function normalizeDetectedEntities(value) {
  return {
    products: normalizeStringArray(value?.products, 12),
    people: normalizeStringArray(value?.people, 12),
    scenes: normalizeStringArray(value?.scenes, 12),
    objects: normalizeStringArray(value?.objects, 12),
    textSignals: normalizeStringArray(value?.textSignals, 12),
  };
}

function normalizeProofAffordances(value) {
  return (Array.isArray(value) ? value : []).map((item) => ({
    proofNeedClass: normalizeEnum(item?.proofNeedClass, new Set(PROOF_NEED_CLASSES), "problem_visibility"),
    strength: normalizeEnum(item?.strength, STRENGTHS, "unknown"),
    reason: normalizeText(item?.reason, 240),
    limits: normalizeStringArray(item?.limits, 8),
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
  return {
    fit: normalizeEnum(value?.fit, FITS, "weak"),
    reason: normalizeText(value?.reason, 180),
    requiredSupport: normalizeStringArray(value?.requiredSupport, 8),
  };
}

function normalizeQuality(value) {
  return {
    visualClarity: normalizeEnum(value?.visualClarity, QUALITY_VALUES, "unknown"),
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
    const shotRefs = normalizeExistingShotRefs(value[index]?.shotRefs, shotMap);
    if (!shotRefs.ok) return invalidValidation("user_material_pack_material_group_unknown_shot_ref", "materialGroups.shotRefs 引用了不存在的 shotId", { path: `materialGroups[${index}].shotRefs`, shotRefs: shotRefs.invalid });
    items.push({
      groupId,
      groupType: normalizeText(value[index]?.groupType, 80) || "bridge_group",
      shotRefs: shotRefs.items,
      groupSummary: normalizeText(value[index]?.groupSummary, 320),
      usableForProofNeedClasses: normalizeProofNeedClasses(value[index]?.usableForProofNeedClasses),
      notUsableForProofNeedClasses: normalizeProofNeedClasses(value[index]?.notUsableForProofNeedClasses),
      continuity: normalizeEnum(value[index]?.continuity, CONTINUITY_VALUES, "none"),
      constraints: normalizeStringArray(value[index]?.constraints, 12),
    });
  }
  return { ok: true, items };
}

function normalizeProofCoverage(value, shotMap, materialGroups) {
  if (!Array.isArray(value)) return invalidValidation("user_material_pack_missing_proof_coverage", "用户素材识别未返回 proofCoverage", { path: "proofCoverage" });
  const groupIds = new Set(materialGroups.map((group) => group.groupId));
  const byClass = new Map();
  for (let index = 0; index < value.length; index += 1) {
    const proofNeedClass = normalizeEnum(value[index]?.proofNeedClass, new Set(PROOF_NEED_CLASSES), "");
    if (!proofNeedClass) continue;
    const shotRefs = normalizeExistingShotRefs(value[index]?.candidateShots, shotMap);
    if (!shotRefs.ok) return invalidValidation("user_material_pack_proof_coverage_unknown_shot_ref", "proofCoverage.candidateShots 引用了不存在的 shotId", { path: `proofCoverage[${index}].candidateShots`, shotRefs: shotRefs.invalid });
    const candidateGroups = normalizeStringArray(value[index]?.candidateGroups, 16).filter((groupId) => groupIds.has(groupId));
    byClass.set(proofNeedClass, {
      proofNeedClass,
      coverage: normalizeEnum(value[index]?.coverage, COVERAGES, "unknown"),
      candidateShots: shotRefs.items,
      candidateGroups,
      reason: normalizeText(value[index]?.reason, 320),
      safeUsage: normalizeText(value[index]?.safeUsage, 240),
      gapAdvice: normalizeText(value[index]?.gapAdvice, 240),
    });
  }
  const missing = PROOF_NEED_CLASSES.filter((proofNeedClass) => !byClass.has(proofNeedClass));
  if (missing.length) return invalidValidation("user_material_pack_proof_coverage_incomplete", "proofCoverage 必须覆盖所有 proofNeedClass", { missingProofNeedClasses: missing });
  return { ok: true, items: PROOF_NEED_CLASSES.map((proofNeedClass) => byClass.get(proofNeedClass)) };
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
    const shotRef = normalizeText(raw[index]?.shotRef, 80);
    if (!shotMap.has(shotRef)) return invalidValidation("user_material_pack_sequence_candidate_unknown_shot_ref", "sequenceRecommendations 引用了不存在的 shotId", { position, shotRef });
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
  const invalid = items.filter((shotRef) => !shotMap.has(shotRef));
  return invalid.length ? { ok: false, invalid } : { ok: true, items };
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
