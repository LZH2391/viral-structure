const { assertFile, normalizeText, readJson } = require("./shot-storyboard-pipeline-utils");
const {
  PDF_LAYOUT_SCHEMA,
  PDF_SUMMARY_SCHEMA,
  countManifestSlots,
  pdfAgentError,
} = require("./shot-storyboard-pdf-agent-shared");

async function validatePdfAgentOutputs({
  manifest,
  pdfPath,
  summaryPath,
  layoutPath,
  expectedWarnings = null,
} = {}) {
  await assertFile(pdfPath, "storyboard_prep_pdf_agent_pdf_missing", true);
  await assertFile(summaryPath, "storyboard_prep_pdf_agent_summary_missing", true);
  await assertFile(layoutPath, "storyboard_prep_pdf_agent_layout_missing", true);
  const summary = await readJson(summaryPath);
  const layout = await readJson(layoutPath);
  validatePdfAgentSummary(summary, manifest);
  validatePdfAgentLayout(layout, manifest, expectedWarnings, summary);
  return { summary, layout, pdfPath, summaryPath, layoutPath };
}

function validatePdfAgentSummary(summary, manifest) {
  if (summary?.schemaVersion !== PDF_SUMMARY_SCHEMA) {
    throw pdfAgentError("storyboard_prep_pdf_agent_summary_schema_invalid", "summary schemaVersion 不正确", true, { summarySchemaVersion: summary?.schemaVersion ?? null });
  }
  const expectedShotCount = Array.isArray(manifest?.shots) ? manifest.shots.length : 0;
  const expectedSlotCount = countManifestSlots(manifest?.shots);
  if (Number(summary?.shotCount ?? -1) !== expectedShotCount) {
    throw pdfAgentError("storyboard_prep_pdf_agent_summary_shot_count_mismatch", "summary shotCount 与 manifest 不一致", true, {
      expectedShotCount,
      actualShotCount: summary?.shotCount ?? null,
    });
  }
  if (Number(summary?.slotCount ?? -1) !== expectedSlotCount) {
    throw pdfAgentError("storyboard_prep_pdf_agent_summary_slot_count_mismatch", "summary slotCount 与 manifest 不一致", true, {
      expectedSlotCount,
      actualSlotCount: summary?.slotCount ?? null,
    });
  }
}

function validatePdfAgentLayout(layout, manifest, expectedWarnings, summary) {
  if (layout?.schemaVersion !== PDF_LAYOUT_SCHEMA) {
    throw pdfAgentError("storyboard_prep_pdf_agent_layout_schema_invalid", "layout schemaVersion 不正确", true, { layoutSchemaVersion: layout?.schemaVersion ?? null });
  }
  if (!Number.isFinite(Number(layout?.pageCount)) || Number(layout.pageCount) <= 0) {
    throw pdfAgentError("storyboard_prep_pdf_agent_layout_page_count_invalid", "layout pageCount 不合法", true, { pageCount: layout?.pageCount ?? null });
  }
  if (!Array.isArray(layout?.slots) || !Array.isArray(layout?.shots) || !Array.isArray(layout?.warnings)) {
    throw pdfAgentError("storyboard_prep_pdf_agent_layout_shape_invalid", "layout 缺少必需字段", true, {
      hasSlots: Array.isArray(layout?.slots),
      hasShots: Array.isArray(layout?.shots),
      hasWarnings: Array.isArray(layout?.warnings),
    });
  }
  const expectedShotIds = new Set((manifest?.shots ?? []).map((shot) => normalizeText(shot.shotId)).filter(Boolean));
  const layoutShots = new Map();
  for (const item of layout.shots) {
    const shotId = normalizeText(item?.shotId);
    if (!shotId) continue;
    layoutShots.set(shotId, item);
  }
  const missingShotIds = Array.from(expectedShotIds).filter((shotId) => !layoutShots.has(shotId));
  if (missingShotIds.length) {
    throw pdfAgentError("storyboard_prep_pdf_agent_layout_missing_shot", "layout 未覆盖全部非 pad shot", true, {
      missingShotIds,
    }, missingShotIds.map((shotId) => ({ code: "layout_missing_shot", shotId })));
  }
  const invalidImageFitShotIds = [];
  for (const [shotId, item] of layoutShots.entries()) {
    if (!Object.hasOwn(item, "pageIndex") || !normalizeText(item.mediaKind)) {
      throw pdfAgentError("storyboard_prep_pdf_agent_layout_shot_shape_invalid", "layout.shots[] 缺少必需字段", true, {
        shotId,
        item,
      });
    }
    if (String(item.imageFit ?? "").trim().toLowerCase() !== "contain") invalidImageFitShotIds.push(shotId);
  }
  if (invalidImageFitShotIds.length) {
    throw pdfAgentError("storyboard_prep_pdf_agent_layout_image_fit_invalid", "存在非 contain 的 imageFit", true, {
      invalidImageFitShotIds,
    }, invalidImageFitShotIds.map((shotId) => ({ code: "image_fit_not_contain", shotId })));
  }
  const combinedWarnings = [
    ...(Array.isArray(layout.warnings) ? layout.warnings : []),
    ...(Array.isArray(summary?.warnings) ? summary.warnings : []),
  ].map((item) => String(item ?? ""));
  const requiredWarningShots = Array.isArray(expectedWarnings?.materialFrameMissingShotIds)
    ? expectedWarnings.materialFrameMissingShotIds
    : [];
  const missingWarningShots = requiredWarningShots.filter((shotId) => !combinedWarnings.some((item) => item.includes(shotId)));
  if (missingWarningShots.length) {
    throw pdfAgentError("storyboard_prep_pdf_agent_missing_material_warning", "缺失素材代表帧的 shot 未进入 warnings", true, {
      missingWarningShots,
    }, missingWarningShots.map((shotId) => ({ code: "missing_material_warning", shotId })));
  }
}

module.exports = {
  validatePdfAgentOutputs,
};
