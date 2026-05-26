const {
  MAX_SEGMENTS,
  MAX_EVIDENCE_PER_SEGMENT,
  codedError,
  normalizeText,
  normalizeStringArray,
  normalizeConfidence,
} = require("./shared");

function validateSegments(parsed, input) {
  const rawSegments = Array.isArray(parsed?.segments) ? parsed.segments : null;
  if (!rawSegments) {
    return invalidValidation("script_segment_missing_segments", "脚本段落 Agent 未返回 segments", {
      validatorCode: "script_segment_missing_segments",
      segmentCount: 0,
    });
  }
  if (!rawSegments.length) {
    return invalidValidation("script_segment_empty", "脚本段落 Agent 未返回有效 segments", {
      validatorCode: "script_segment_empty",
      segmentCount: 0,
    });
  }
  if (rawSegments.length > MAX_SEGMENTS) {
    return invalidValidation("script_segment_too_many_segments", "脚本段落数量超出允许范围", {
      validatorCode: "script_segment_too_many_segments",
      segmentCount: rawSegments.length,
      maxSegments: MAX_SEGMENTS,
    });
  }

  const shotIds = input.shots.map((shot) => shot.shotId);
  const shotMap = new Map(input.shots.map((shot, index) => [shot.shotId, { ...shot, order: index }]));
  const segments = [];
  const flattenedShotRefs = [];

  for (let index = 0; index < rawSegments.length; index += 1) {
    const segment = normalizeSegment(rawSegments[index], index, shotMap);
    if (!segment.ok) return segment;
    const normalized = segment.segment;
    if (index > 0 && normalized.start < segments[index - 1].end) {
      return invalidValidation("script_segment_order_invalid", "segments 未按镜头顺序排列", {
        validatorCode: "script_segment_order_invalid",
        segmentCount: rawSegments.length,
        failingIndex: index,
      });
    }
    segments.push(normalized);
    flattenedShotRefs.push(...normalized.shotRefs);
  }

  if (flattenedShotRefs.length !== shotIds.length || flattenedShotRefs.some((shotId, index) => shotId !== shotIds[index])) {
    const missingShotRefs = shotIds.filter((shotId) => !flattenedShotRefs.includes(shotId));
    const unexpectedShotRefs = flattenedShotRefs.filter((shotId) => !shotIds.includes(shotId));
    const firstMismatchIndex = shotIds.findIndex((shotId, index) => flattenedShotRefs[index] !== shotId);
    return invalidValidation("script_segment_shot_coverage_invalid", "segments 必须完整且按顺序覆盖所有 shots", {
      validatorCode: "script_segment_shot_coverage_invalid",
      segmentCount: segments.length,
      expectedShotCount: shotIds.length,
      coveredShotCount: flattenedShotRefs.length,
      path: "segments[].shotRefs",
      field: "shotRefs",
      missingShotRefs,
      unexpectedShotRefs,
      firstMismatch: firstMismatchIndex >= 0
        ? {
          index: firstMismatchIndex,
          expectedShotRef: shotIds[firstMismatchIndex] ?? null,
          actualShotRef: flattenedShotRefs[firstMismatchIndex] ?? null,
        }
        : null,
      readableMessage: buildCoverageMessage({ expectedShotRefs: shotIds, coveredShotRefs: flattenedShotRefs, missingShotRefs, unexpectedShotRefs, firstMismatchIndex }),
    });
  }

  return {
    ok: true,
    segments,
    summary: {
      validatorCode: null,
      segmentCount: segments.length,
    },
  };
}

function normalizeSegment(segment, index, shotMap) {
  const label = normalizeText(segment?.label);
  const roleInScript = normalizeText(segment?.roleInScript);
  const shotRefs = Array.isArray(segment?.shotRefs) ? segment.shotRefs.map((item) => String(item ?? "").trim()).filter(Boolean) : [];
  const transferableRule = normalizeText(segment?.transferableRule);

  const missingFields = [];
  if (!label) missingFields.push("label");
  if (!roleInScript) missingFields.push("roleInScript");
  if (!transferableRule) missingFields.push("transferableRule");
  if (!label || !roleInScript || !transferableRule) {
    return invalidValidation("script_segment_required_field_missing", "segment 缺少必要字段", {
      validatorCode: "script_segment_required_field_missing",
      failingIndex: index,
      path: `segments[${index}]`,
      missingFields,
      readableMessage: `segments[${index}] 缺少必要字段: ${missingFields.join(", ")}`,
    });
  }
  if (!shotRefs.length) {
    return invalidValidation("script_segment_missing_shot_refs", "segment.shotRefs 不能为空", {
      validatorCode: "script_segment_missing_shot_refs",
      failingIndex: index,
      path: `segments[${index}].shotRefs`,
      field: "shotRefs",
      readableMessage: `segments[${index}].shotRefs 不能为空`,
    });
  }

  const uniqueRefs = Array.from(new Set(shotRefs));
  if (uniqueRefs.length !== shotRefs.length) {
    const duplicateShotRefs = shotRefs.filter((shotRef, refIndex) => shotRefs.indexOf(shotRef) !== refIndex);
    return invalidValidation("script_segment_duplicate_shot_refs", "segment.shotRefs 不允许重复引用同一镜头", {
      validatorCode: "script_segment_duplicate_shot_refs",
      failingIndex: index,
      path: `segments[${index}].shotRefs`,
      field: "shotRefs",
      duplicateShotRefs: Array.from(new Set(duplicateShotRefs)),
      readableMessage: `segments[${index}].shotRefs 重复引用: ${Array.from(new Set(duplicateShotRefs)).join(", ")}`,
    });
  }

  const shotOrders = [];
  for (let refIndex = 0; refIndex < shotRefs.length; refIndex += 1) {
    const shotRef = shotRefs[refIndex];
    const shot = shotMap.get(shotRef);
    if (!shot) {
      return invalidValidation("script_segment_unknown_shot_ref", "segment.shotRefs 引用了不存在的 shotId", {
        validatorCode: "script_segment_unknown_shot_ref",
        failingIndex: index,
        refIndex,
        path: `segments[${index}].shotRefs[${refIndex}]`,
        field: "shotRefs",
        shotRef,
        readableMessage: `segments[${index}].shotRefs[${refIndex}] 引用了不存在的 shotId: ${shotRef}`,
      });
    }
    shotOrders.push(shot.order);
  }
  for (let refIndex = 1; refIndex < shotOrders.length; refIndex += 1) {
    if (shotOrders[refIndex] !== shotOrders[refIndex - 1] + 1) {
      return invalidValidation("script_segment_non_contiguous_shot_refs", "segment.shotRefs 必须引用连续镜头", {
        validatorCode: "script_segment_non_contiguous_shot_refs",
        failingIndex: index,
        refIndex,
        path: `segments[${index}].shotRefs[${refIndex}]`,
        field: "shotRefs",
        previousShotRef: shotRefs[refIndex - 1],
        shotRef: shotRefs[refIndex],
        readableMessage: `segments[${index}].shotRefs 在 ${shotRefs[refIndex - 1]} -> ${shotRefs[refIndex]} 之间不连续`,
      });
    }
  }

  const firstShot = shotMap.get(shotRefs[0]);
  const lastShot = shotMap.get(shotRefs[shotRefs.length - 1]);
  return {
    ok: true,
    segment: {
      segmentId: normalizeText(segment?.segmentId) || `segment_${index + 1}`,
      label,
      roleInScript,
      shotRefs,
      evidence: resolveEvidence(segment?.evidence, shotRefs, shotMap),
      transferableRule,
      confidence: normalizeConfidence(segment?.confidence, 0.7),
      needReview: Boolean(segment?.needReview),
      start: firstShot.start,
      end: lastShot.end,
    },
  };
}

function resolveEvidence(value, shotRefs, shotMap) {
  const evidence = normalizeStringArray(value, MAX_EVIDENCE_PER_SEGMENT);
  if (evidence.length) return evidence;
  return shotRefs
    .map((shotRef) => normalizeText(shotMap.get(shotRef)?.summary ?? "", 120))
    .filter(Boolean)
    .slice(0, MAX_EVIDENCE_PER_SEGMENT);
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

function buildCoverageMessage({ expectedShotRefs, coveredShotRefs, missingShotRefs, unexpectedShotRefs, firstMismatchIndex }) {
  const parts = ["segments[].shotRefs 未完整按顺序覆盖输入 shots"];
  if (firstMismatchIndex >= 0) {
    parts.push(`第 ${firstMismatchIndex + 1} 个引用期望 ${expectedShotRefs[firstMismatchIndex] ?? "无"}，实际 ${coveredShotRefs[firstMismatchIndex] ?? "缺失"}`);
  }
  if (missingShotRefs.length) parts.push(`缺失: ${missingShotRefs.join(", ")}`);
  if (unexpectedShotRefs.length) parts.push(`多余: ${unexpectedShotRefs.join(", ")}`);
  return parts.join("；");
}

module.exports = {
  validateSegments,
};
