const { normalizeMaterialGapMatrix } = require("./conversation-normalizers");

const MATERIAL_GAP_STRUCTURED_TYPES = new Set([
  "opening_hook_shot",
  "product_closeup_shot",
  "usage_process_shot",
  "comparison_shot",
  "ending_cta_shot",
  "material_capability_insufficient",
  "critical_material_missing",
  "material_usage_risk",
]);

function validateMaterialGapMatrix(matrix) {
  const issues = [];
  if (!matrix || typeof matrix !== "object") {
    return { ok: false, issues: [materialGapValidationIssue("matrix_invalid", "$", "矩阵必须是 JSON object")] };
  }
  if (matrix.schemaVersion !== "material_gap_matrix.v1") {
    issues.push(materialGapValidationIssue("schema_invalid", "schemaVersion", "schemaVersion 必须是 material_gap_matrix.v1"));
  }
  if (matrix.status !== "processed") {
    issues.push(materialGapValidationIssue("status_invalid", "status", "status 必须是 processed"));
  }
  const rows = Array.isArray(matrix.rows) ? matrix.rows : [];
  if (!rows.length) {
    issues.push(materialGapValidationIssue("rows_empty", "rows", "rows 必须包含槽位判断"));
  }
  rows.forEach((row, index) => {
    const pathPrefix = `rows[${index}]`;
    const satisfaction = String(row?.directSatisfaction ?? "");
    if (!["satisfied", "partial", "missing", "unsafe", "not_required"].includes(satisfaction)) {
      issues.push(materialGapValidationIssue("direct_satisfaction_invalid", `${pathPrefix}.directSatisfaction`, "directSatisfaction 枚举不合法"));
    }
    const missingTypes = Array.isArray(row?.missingMaterialTypes) ? row.missingMaterialTypes.filter(Boolean) : [];
    missingTypes.forEach((item, typeIndex) => {
      if (!MATERIAL_GAP_STRUCTURED_TYPES.has(String(item))) {
        issues.push(materialGapValidationIssue("missing_material_type_invalid", `${pathPrefix}.missingMaterialTypes[${typeIndex}]`, "missingMaterialTypes 包含不支持的枚举"));
      }
    });
    if (["partial", "missing", "unsafe"].includes(satisfaction) && !missingTypes.length) {
      issues.push(materialGapValidationIssue("missing_material_types_required", `${pathPrefix}.missingMaterialTypes`, "partial/missing/unsafe 必须写结构化缺口"));
    }
  });
  return { ok: issues.length === 0, issues };
}

function buildMaterialGapValidationSummary(validation, fallbackApplied) {
  return {
    status: validation.ok ? "passed" : "failed",
    fallbackApplied: Boolean(fallbackApplied),
    issueCount: validation.issues.length,
    issues: validation.issues,
  };
}

function materialGapValidationIssue(code, pathText, message) {
  return { code, path: pathText, message };
}

function applyMaterialGapFallback(matrix) {
  const rows = (matrix?.rows ?? []).map((row) => {
    const satisfaction = String(row?.directSatisfaction ?? "missing");
    const existingTypes = Array.isArray(row?.missingMaterialTypes)
      ? row.missingMaterialTypes.filter((item) => MATERIAL_GAP_STRUCTURED_TYPES.has(String(item)))
      : [];
    return {
      ...row,
      missingMaterialTypes: ["partial", "missing", "unsafe"].includes(satisfaction) && !existingTypes.length
        ? [fallbackMaterialTypeForSatisfaction(satisfaction)]
        : existingTypes,
    };
  });
  return normalizeMaterialGapMatrix({
    ...(matrix ?? {}),
    schemaVersion: "material_gap_matrix.v1",
    status: "processed",
    rows,
    summary: recomputeMaterialGapSummary(matrix?.summary, rows),
  });
}

function fallbackMaterialTypeForSatisfaction(satisfaction) {
  if (satisfaction === "partial") return "material_capability_insufficient";
  if (satisfaction === "unsafe") return "material_usage_risk";
  return "critical_material_missing";
}

function recomputeMaterialGapSummary(previousSummary, rows) {
  const summary = rows.reduce((acc, row) => {
    const satisfaction = row.directSatisfaction;
    if (satisfaction === "satisfied") acc.satisfiedCount += 1;
    if (satisfaction === "partial") acc.partialCount += 1;
    if (satisfaction === "missing") acc.missingCount += 1;
    if (satisfaction === "unsafe") acc.unsafeCount += 1;
    if (satisfaction === "not_required") acc.notRequiredCount += 1;
    (row.missingMaterialTypes ?? []).forEach((item) => acc.missingTypeCounts.set(item, (acc.missingTypeCounts.get(item) ?? 0) + 1));
    return acc;
  }, {
    satisfiedCount: 0,
    partialCount: 0,
    missingCount: 0,
    unsafeCount: 0,
    notRequiredCount: 0,
    missingTypeCounts: new Map(),
  });
  return {
    ...(previousSummary ?? {}),
    slotCount: rows.length,
    satisfiedCount: summary.satisfiedCount,
    partialCount: summary.partialCount,
    missingCount: summary.missingCount,
    unsafeCount: summary.unsafeCount,
    notRequiredCount: summary.notRequiredCount,
    topMissingMaterialTypes: Array.from(summary.missingTypeCounts.entries()).sort((a, b) => b[1] - a[1]).map(([key]) => key).slice(0, 5),
  };
}

module.exports = {
  applyMaterialGapFallback,
  buildMaterialGapValidationSummary,
  validateMaterialGapMatrix,
};
