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
        path: `sections[${index}].shotRefs[0]`,
        field: "shotRefs",
        shotRef: normalized.shotRefs[0] ?? null,
        previousLastOrder,
        currentFirstOrder: firstOrder,
        readableMessage: `sections[${index}].shotRefs[0] 的镜头顺序早于上一段结尾: ${normalized.shotRefs[0] ?? "空"}`,
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
      path: "overview.summary",
      field: "summary",
      missingFields: ["summary"],
      readableMessage: "overview.summary 缺少或为空",
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

  const missingFields = [];
  if (!label) missingFields.push("label");
  if (!fields.length) missingFields.push("fields");
  if (!label || !fields.length) {
    return invalidValidation("rhythm_structure_required_field_missing", "section 缺少必要字段", {
      validatorCode: "rhythm_structure_required_field_missing",
      failingIndex: index,
      path: `sections[${index}]`,
      missingFields,
      readableMessage: `sections[${index}] 缺少必要字段: ${missingFields.join(", ")}`,
    });
  }
  if (!shotRefs.length) {
    return invalidValidation("rhythm_structure_missing_shot_refs", "section.shotRefs 不能为空", {
      validatorCode: "rhythm_structure_missing_shot_refs",
      failingIndex: index,
      path: `sections[${index}].shotRefs`,
      field: "shotRefs",
      readableMessage: `sections[${index}].shotRefs 不能为空`,
    });
  }

  const uniqueRefs = Array.from(new Set(shotRefs));
  if (uniqueRefs.length !== shotRefs.length) {
    const duplicateShotRefs = shotRefs.filter((shotRef, refIndex) => shotRefs.indexOf(shotRef) !== refIndex);
    return invalidValidation("rhythm_structure_duplicate_shot_refs", "section.shotRefs 不允许重复引用同一镜头", {
      validatorCode: "rhythm_structure_duplicate_shot_refs",
      failingIndex: index,
      path: `sections[${index}].shotRefs`,
      field: "shotRefs",
      duplicateShotRefs: Array.from(new Set(duplicateShotRefs)),
      readableMessage: `sections[${index}].shotRefs 重复引用: ${Array.from(new Set(duplicateShotRefs)).join(", ")}`,
    });
  }

  const shotOrders = [];
  for (let refIndex = 0; refIndex < shotRefs.length; refIndex += 1) {
    const shotRef = shotRefs[refIndex];
    const shot = shotMap.get(shotRef);
    if (!shot) {
      return invalidValidation("rhythm_structure_unknown_shot_ref", "section.shotRefs 引用了不存在的 shotId", {
        validatorCode: "rhythm_structure_unknown_shot_ref",
        failingIndex: index,
        refIndex,
        path: `sections[${index}].shotRefs[${refIndex}]`,
        field: "shotRefs",
        shotRef,
        readableMessage: `sections[${index}].shotRefs[${refIndex}] 引用了不存在的 shotId: ${shotRef}`,
      });
    }
    shotOrders.push(shot.order);
  }
  for (let refIndex = 1; refIndex < shotOrders.length; refIndex += 1) {
    if (shotOrders[refIndex] !== shotOrders[refIndex - 1] + 1) {
      return invalidValidation("rhythm_structure_non_contiguous_shot_refs", "section.shotRefs 必须引用连续镜头", {
        validatorCode: "rhythm_structure_non_contiguous_shot_refs",
        failingIndex: index,
        refIndex,
        path: `sections[${index}].shotRefs[${refIndex}]`,
        field: "shotRefs",
        previousShotRef: shotRefs[refIndex - 1],
        shotRef: shotRefs[refIndex],
        readableMessage: `sections[${index}].shotRefs 在 ${shotRefs[refIndex - 1]} -> ${shotRefs[refIndex]} 之间不连续`,
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
    summary: {
      message,
      readableMessage: summary?.readableMessage ?? message,
      ...summary,
    },
  };
}

module.exports = {
  validateRhythmStructure,
};
