const {
  MAX_SECTIONS,
  normalizeText,
  normalizeStringArray,
  normalizeFieldArray,
  normalizeConfidence,
} = require("./shared");

function validateRhythmStructure(parsed, input) {
  const overview = normalizeOverview(parsed?.overview);
  if (!overview.ok) return overview;

  const rawSections = Array.isArray(parsed?.sections) ? parsed.sections : null;
  if (!rawSections) {
    return invalidValidation("rhythm_structure_missing_sections", "节奏结构 Agent 未返回 sections", {
      validatorCode: "rhythm_structure_missing_sections",
      sectionCount: 0,
    });
  }
  if (!rawSections.length) {
    return invalidValidation("rhythm_structure_empty", "节奏结构 Agent 未返回有效 sections", {
      validatorCode: "rhythm_structure_empty",
      sectionCount: 0,
    });
  }
  if (rawSections.length > MAX_SECTIONS) {
    return invalidValidation("rhythm_structure_too_many_sections", "节奏区间数量超出允许范围", {
      validatorCode: "rhythm_structure_too_many_sections",
      sectionCount: rawSections.length,
      maxSections: MAX_SECTIONS,
    });
  }

  const shotMap = new Map(input.shots.map((shot, index) => [shot.shotId, { ...shot, order: index }]));
  const sections = [];
  let previousLastOrder = -1;

  for (let index = 0; index < rawSections.length; index += 1) {
    const section = normalizeSection(rawSections[index], index, shotMap);
    if (!section.ok) return section;
    const normalized = section.section;
    const firstOrder = shotMap.get(normalized.shotRefs[0])?.order ?? -1;
    if (firstOrder < previousLastOrder) {
      return invalidValidation("rhythm_structure_order_invalid", "sections 未按镜头顺序排列", {
        validatorCode: "rhythm_structure_order_invalid",
        sectionCount: rawSections.length,
        failingIndex: index,
      });
    }
    previousLastOrder = shotMap.get(normalized.shotRefs.at(-1))?.order ?? previousLastOrder;
    sections.push(normalized);
  }

  return {
    ok: true,
    overview: overview.overview,
    sections,
    summary: {
      validatorCode: null,
      sectionCount: sections.length,
    },
  };
}

function normalizeOverview(overview) {
  const summary = normalizeText(overview?.summary, 240);
  if (!summary) {
    return invalidValidation("rhythm_structure_overview_required_field_missing", "overview 缺少必要字段", {
      validatorCode: "rhythm_structure_overview_required_field_missing",
    });
  }
  return {
    ok: true,
    overview: {
      summary,
      fields: normalizeFieldArray(overview?.fields),
      uncertainties: normalizeStringArray(overview?.uncertainties, 5),
    },
  };
}

function normalizeSection(section, index, shotMap) {
  const label = normalizeText(section?.label);
  const shotRefs = Array.isArray(section?.shotRefs) ? section.shotRefs.map((item) => String(item ?? "").trim()).filter(Boolean) : [];
  const fields = normalizeFieldArray(section?.fields);

  if (!label || !fields.length) {
    return invalidValidation("rhythm_structure_required_field_missing", "section 缺少必要字段", {
      validatorCode: "rhythm_structure_required_field_missing",
      failingIndex: index,
    });
  }
  if (!shotRefs.length) {
    return invalidValidation("rhythm_structure_missing_shot_refs", "section.shotRefs 不能为空", {
      validatorCode: "rhythm_structure_missing_shot_refs",
      failingIndex: index,
    });
  }

  const uniqueRefs = Array.from(new Set(shotRefs));
  if (uniqueRefs.length !== shotRefs.length) {
    return invalidValidation("rhythm_structure_duplicate_shot_refs", "section.shotRefs 不允许重复引用同一镜头", {
      validatorCode: "rhythm_structure_duplicate_shot_refs",
      failingIndex: index,
    });
  }

  const shotOrders = [];
  for (const shotRef of shotRefs) {
    const shot = shotMap.get(shotRef);
    if (!shot) {
      return invalidValidation("rhythm_structure_unknown_shot_ref", "section.shotRefs 引用了不存在的 shotId", {
        validatorCode: "rhythm_structure_unknown_shot_ref",
        failingIndex: index,
        shotRef,
      });
    }
    shotOrders.push(shot.order);
  }
  for (let refIndex = 1; refIndex < shotOrders.length; refIndex += 1) {
    if (shotOrders[refIndex] !== shotOrders[refIndex - 1] + 1) {
      return invalidValidation("rhythm_structure_non_contiguous_shot_refs", "section.shotRefs 必须引用连续镜头", {
        validatorCode: "rhythm_structure_non_contiguous_shot_refs",
        failingIndex: index,
      });
    }
  }

  const firstShot = shotMap.get(shotRefs[0]);
  const lastShot = shotMap.get(shotRefs[shotRefs.length - 1]);
  return {
    ok: true,
    section: {
      sectionId: normalizeText(section?.sectionId) || `rhythm_section_${index + 1}`,
      label,
      shotRefs,
      fields,
      confidence: normalizeConfidence(section?.confidence, 0.7),
      needReview: Boolean(section?.needReview),
      start: firstShot.start,
      end: lastShot.end,
    },
  };
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
