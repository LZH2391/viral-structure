const {
  MAX_CARDS,
  MAX_EVIDENCE_PER_CARD,
  normalizeText,
  normalizeStringArray,
  normalizeConfidence,
} = require("./shared");

function validateRhythmStructure(parsed, input) {
  const overview = normalizeOverview(parsed?.overview);
  if (!overview.ok) return overview;

  const rawCards = Array.isArray(parsed?.cards) ? parsed.cards : null;
  if (!rawCards) {
    return invalidValidation("rhythm_structure_missing_cards", "节奏结构 Agent 未返回 cards", {
      validatorCode: "rhythm_structure_missing_cards",
      cardCount: 0,
    });
  }
  if (!rawCards.length) {
    return invalidValidation("rhythm_structure_empty", "节奏结构 Agent 未返回有效 cards", {
      validatorCode: "rhythm_structure_empty",
      cardCount: 0,
    });
  }
  if (rawCards.length > MAX_CARDS) {
    return invalidValidation("rhythm_structure_too_many_cards", "节奏卡片数量超出允许范围", {
      validatorCode: "rhythm_structure_too_many_cards",
      cardCount: rawCards.length,
      maxCards: MAX_CARDS,
    });
  }

  const shotMap = new Map(input.shots.map((shot, index) => [shot.shotId, { ...shot, order: index }]));
  const cards = [];
  let previousLastOrder = -1;

  for (let index = 0; index < rawCards.length; index += 1) {
    const card = normalizeCard(rawCards[index], index, shotMap);
    if (!card.ok) return card;
    const normalized = card.card;
    const firstOrder = shotMap.get(normalized.shotRefs[0])?.order ?? -1;
    if (firstOrder < previousLastOrder) {
      return invalidValidation("rhythm_structure_order_invalid", "cards 未按镜头顺序排列", {
        validatorCode: "rhythm_structure_order_invalid",
        cardCount: rawCards.length,
        failingIndex: index,
      });
    }
    previousLastOrder = shotMap.get(normalized.shotRefs.at(-1))?.order ?? previousLastOrder;
    cards.push(normalized);
  }

  return {
    ok: true,
    overview: overview.overview,
    cards,
    summary: {
      validatorCode: null,
      cardCount: cards.length,
    },
  };
}

function normalizeOverview(overview) {
  const rhythmShape = normalizeText(overview?.rhythmShape, 180);
  const pacingSummary = normalizeText(overview?.pacingSummary, 240);
  const transferableRhythmRule = normalizeText(overview?.transferableRhythmRule, 240);
  if (!rhythmShape || !pacingSummary || !transferableRhythmRule) {
    return invalidValidation("rhythm_structure_overview_required_field_missing", "overview 缺少必要字段", {
      validatorCode: "rhythm_structure_overview_required_field_missing",
    });
  }
  return {
    ok: true,
    overview: {
      rhythmShape,
      pacingSummary,
      peakRange: normalizeText(overview?.peakRange, 80),
      turningPoints: normalizeStringArray(overview?.turningPoints, 8),
      transferableRhythmRule,
      uncertainties: normalizeStringArray(overview?.uncertainties, 5),
    },
  };
}

function normalizeCard(card, index, shotMap) {
  const label = normalizeText(card?.label);
  const rhythmRole = normalizeText(card?.rhythmRole, 180);
  const shotRefs = Array.isArray(card?.shotRefs) ? card.shotRefs.map((item) => String(item ?? "").trim()).filter(Boolean) : [];
  const rhythmPattern = normalizeText(card?.rhythmPattern, 220);
  const attentionEffect = normalizeText(card?.attentionEffect, 180);
  const transferableRule = normalizeText(card?.transferableRule, 220);

  if (!label || !rhythmRole || !rhythmPattern || !attentionEffect || !transferableRule) {
    return invalidValidation("rhythm_structure_required_field_missing", "card 缺少必要字段", {
      validatorCode: "rhythm_structure_required_field_missing",
      failingIndex: index,
    });
  }
  if (!shotRefs.length) {
    return invalidValidation("rhythm_structure_missing_shot_refs", "card.shotRefs 不能为空", {
      validatorCode: "rhythm_structure_missing_shot_refs",
      failingIndex: index,
    });
  }

  const uniqueRefs = Array.from(new Set(shotRefs));
  if (uniqueRefs.length !== shotRefs.length) {
    return invalidValidation("rhythm_structure_duplicate_shot_refs", "card.shotRefs 不允许重复引用同一镜头", {
      validatorCode: "rhythm_structure_duplicate_shot_refs",
      failingIndex: index,
    });
  }

  const shotOrders = [];
  for (const shotRef of shotRefs) {
    const shot = shotMap.get(shotRef);
    if (!shot) {
      return invalidValidation("rhythm_structure_unknown_shot_ref", "card.shotRefs 引用了不存在的 shotId", {
        validatorCode: "rhythm_structure_unknown_shot_ref",
        failingIndex: index,
        shotRef,
      });
    }
    shotOrders.push(shot.order);
  }
  for (let refIndex = 1; refIndex < shotOrders.length; refIndex += 1) {
    if (shotOrders[refIndex] !== shotOrders[refIndex - 1] + 1) {
      return invalidValidation("rhythm_structure_non_contiguous_shot_refs", "card.shotRefs 必须引用连续镜头", {
        validatorCode: "rhythm_structure_non_contiguous_shot_refs",
        failingIndex: index,
      });
    }
  }

  const firstShot = shotMap.get(shotRefs[0]);
  const lastShot = shotMap.get(shotRefs[shotRefs.length - 1]);
  return {
    ok: true,
    card: {
      cardId: normalizeText(card?.cardId) || `rhythm_card_${index + 1}`,
      label,
      rhythmRole,
      shotRefs,
      evidence: resolveEvidence(card?.evidence, shotRefs, shotMap),
      rhythmPattern,
      attentionEffect,
      transferableRule,
      confidence: normalizeConfidence(card?.confidence, 0.7),
      needReview: Boolean(card?.needReview),
      start: firstShot.start,
      end: lastShot.end,
    },
  };
}

function resolveEvidence(value, shotRefs, shotMap) {
  const evidence = normalizeStringArray(value, MAX_EVIDENCE_PER_CARD);
  if (evidence.length) return evidence;
  return shotRefs
    .map((shotRef) => normalizeText(shotMap.get(shotRef)?.summary ?? "", 120))
    .filter(Boolean)
    .slice(0, MAX_EVIDENCE_PER_CARD);
}

function invalidValidation(code, message, summary) {
  return {
    ok: false,
    code,
    message,
    summary,
  };
}

module.exports = {
  validateRhythmStructure,
};
