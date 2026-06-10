const TEXT_LIMIT = 12000;
const MATERIAL_GAP_TEXT_LIMIT = 360;
const MATERIAL_GAP_ROWS_LIMIT = 40;
const MATERIAL_GAP_ARRAY_LIMIT = 12;
const MATERIAL_GAP_DIRECT_SATISFACTIONS = new Set(["satisfied", "partial", "missing", "unsafe", "not_required"]);
const MATERIAL_GAP_MATERIAL_TYPES = new Set([
  "opening_hook_shot",
  "product_closeup_shot",
  "usage_process_shot",
  "comparison_shot",
  "ending_cta_shot",
  "material_capability_insufficient",
  "critical_material_missing",
  "material_usage_risk",
]);

function normalizeMaterialGapMatrix(value) {
  if (!value || typeof value !== "object") return null;
  const rows = Array.isArray(value.rows) ? value.rows.map(normalizeMaterialGapRow).filter(Boolean).slice(0, MATERIAL_GAP_ROWS_LIMIT) : [];
  return {
    schemaVersion: String(value.schemaVersion ?? "material_gap_matrix.v1"),
    status: String(value.status ?? (rows.length ? "processed" : "failed")),
    artifactId: value.artifactId ? String(value.artifactId) : null,
    parentArtifactId: value.parentArtifactId ? String(value.parentArtifactId) : null,
    matrixJsonPath: normalizePathText(value.matrixJsonPath ?? value.outputJsonPath),
    sourceRestructurePath: normalizePathText(value.sourceRestructurePath),
    sourceMaterialPackArtifactId: value.sourceMaterialPackArtifactId ? String(value.sourceMaterialPackArtifactId) : null,
    sourceMaterialPackPath: normalizePathText(value.sourceMaterialPackPath),
    slotChainFingerprint: normalizePlainObject(value.slotChainFingerprint),
    summary: normalizeMaterialGapSummary(value.summary, rows),
    rows,
    traceId: normalizeIdText(value.traceId),
    runId: normalizeIdText(value.runId),
    stageId: normalizeIdText(value.stageId),
    stageName: value.stageName ? String(value.stageName) : null,
    role: value.role ? String(value.role) : null,
    turnId: value.turnId ? String(value.turnId) : null,
    promptTemplateVersion: value.promptTemplateVersion ? String(value.promptTemplateVersion) : null,
    validation: normalizeMaterialGapValidation(value.validation),
    repairAttemptCount: normalizeCount(value.repairAttemptCount),
    repairTurns: Array.isArray(value.repairTurns) ? value.repairTurns.map(normalizeMaterialGapRepairTurn).filter(Boolean).slice(0, 4) : [],
    error: value.error ? String(value.error) : null,
    message: limitText(value.message),
    debugSnapshotUri: normalizePathText(value.debugSnapshotUri),
    createdAt: value.createdAt ?? null,
    updatedAt: value.updatedAt ?? null,
  };
}

function normalizeMaterialGapValidation(value) {
  if (!value || typeof value !== "object") return null;
  return {
    status: value.status ? String(value.status) : null,
    fallbackApplied: Boolean(value.fallbackApplied),
    issueCount: normalizeCount(value.issueCount),
    issues: Array.isArray(value.issues) ? value.issues.map(normalizeMaterialGapValidationIssue).filter(Boolean).slice(0, MATERIAL_GAP_ROWS_LIMIT) : [],
  };
}

function normalizeMaterialGapValidationIssue(value) {
  if (!value || typeof value !== "object") return null;
  return {
    code: value.code ? String(value.code) : null,
    path: value.path ? String(value.path) : null,
    message: limitTextTo(value.message, MATERIAL_GAP_TEXT_LIMIT),
  };
}

function normalizeMaterialGapRepairTurn(value) {
  if (!value || typeof value !== "object") return null;
  return {
    repairAttemptCount: normalizeCount(value.repairAttemptCount),
    threadId: normalizeIdText(value.threadId),
    turnId: normalizeIdText(value.turnId),
    status: value.status ? String(value.status) : null,
    validationStatus: value.validationStatus ? String(value.validationStatus) : null,
    issueCount: normalizeCount(value.issueCount),
    errorCode: value.errorCode ? String(value.errorCode) : null,
  };
}

function normalizeMaterialGapSummary(value, rows) {
  const computed = rows.reduce((acc, row) => {
    if (row.directSatisfaction === "satisfied") acc.satisfiedCount += 1;
    if (row.directSatisfaction === "partial") acc.partialCount += 1;
    if (row.directSatisfaction === "missing") acc.missingCount += 1;
    if (row.directSatisfaction === "unsafe") acc.unsafeCount += 1;
    if (row.directSatisfaction === "not_required") acc.notRequiredCount += 1;
    row.missingMaterialTypes.forEach((item) => acc.missingTypeCounts.set(item, (acc.missingTypeCounts.get(item) ?? 0) + 1));
    return acc;
  }, {
    satisfiedCount: 0,
    partialCount: 0,
    missingCount: 0,
    unsafeCount: 0,
    notRequiredCount: 0,
    missingTypeCounts: new Map(),
  });
  const topMissingMaterialTypes = normalizeStringArray(value?.topMissingMaterialTypes, MATERIAL_GAP_ARRAY_LIMIT).filter((item) => MATERIAL_GAP_MATERIAL_TYPES.has(item));
  return {
    slotCount: normalizeCount(value?.slotCount) ?? rows.length,
    satisfiedCount: normalizeCount(value?.satisfiedCount) ?? computed.satisfiedCount,
    partialCount: normalizeCount(value?.partialCount) ?? computed.partialCount,
    missingCount: normalizeCount(value?.missingCount) ?? computed.missingCount,
    unsafeCount: normalizeCount(value?.unsafeCount) ?? computed.unsafeCount,
    notRequiredCount: normalizeCount(value?.notRequiredCount ?? value?.not_requiredCount) ?? computed.notRequiredCount,
    topMissingMaterialTypes: topMissingMaterialTypes.length ? topMissingMaterialTypes : Array.from(computed.missingTypeCounts.entries()).sort((a, b) => b[1] - a[1]).map(([key]) => key).slice(0, 5),
    overallImpact: limitTextTo(value?.overallImpact, MATERIAL_GAP_TEXT_LIMIT),
  };
}

function normalizeMaterialGapRow(value) {
  if (!value || typeof value !== "object") return null;
  const directSatisfaction = MATERIAL_GAP_DIRECT_SATISFACTIONS.has(String(value.directSatisfaction ?? "")) ? String(value.directSatisfaction) : "missing";
  return {
    slotId: limitTextTo(value.slotId, 80),
    slotSubtype: limitTextTo(value.slotSubtype, 160),
    slotFunction: limitTextTo(value.slotFunction, MATERIAL_GAP_TEXT_LIMIT),
    requiredMaterialTypes: normalizeStringArray(value.requiredMaterialTypes, MATERIAL_GAP_ARRAY_LIMIT).filter((item) => MATERIAL_GAP_MATERIAL_TYPES.has(item)),
    directSatisfaction,
    missingMaterialTypes: normalizeStringArray(value.missingMaterialTypes, MATERIAL_GAP_ARRAY_LIMIT).filter((item) => MATERIAL_GAP_MATERIAL_TYPES.has(item)),
    impact: limitTextTo(value.impact, MATERIAL_GAP_TEXT_LIMIT),
    availableEvidenceRefs: normalizeStringArray(value.availableEvidenceRefs, MATERIAL_GAP_ARRAY_LIMIT),
    handoffToShotDesign: limitTextTo(value.handoffToShotDesign, MATERIAL_GAP_TEXT_LIMIT),
  };
}

function normalizePathText(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text.replaceAll("\\", "/") : null;
}

function normalizeIdText(value) {
  const text = String(value ?? "").trim();
  return text ? text.replace(/[^A-Za-z0-9_.:-]+/g, "_") : null;
}

function normalizeCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
}

function normalizeNullableNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function limitText(value) {
  const text = String(value ?? "");
  return text.length > TEXT_LIMIT ? `${text.slice(0, TEXT_LIMIT)}...` : text;
}

function limitTextTo(value, limit) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function normalizeStringArray(value, limit = 12) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => limitTextTo(item, 120)).filter(Boolean).slice(0, limit);
}

function normalizePlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return Object.fromEntries(Object.entries(value)
    .slice(0, 24)
    .map(([key, item]) => [limitTextTo(key, 80), limitTextTo(typeof item === "object" ? JSON.stringify(item) : item, 240)])
    .filter(([key]) => key));
}

module.exports = {
  normalizeMaterialGapMatrix,
};
