const fs = require("fs/promises");
const path = require("path");
const { renderTurnTemplate } = require("../gateways/threadpool/role-profile-loader");
const {
  codedError,
  sanitizeForAppServerText,
  normalizeText,
  normalizeStringArray,
  buildOutputContract,
  stableJson,
  contentHash,
} = require("./shared");
const { INPUT_SCHEMA_VERSION } = require("./cache-params");

const INPUT_PACKAGE_SCHEMA_VERSION = "function_slot_atomization_input_package.v1";

function prepareInput(artifact) {
  const script = artifact?.scriptSegmentAnalysis;
  const rhythm = artifact?.rhythmStructureAnalysis;
  const packaging = artifact?.packagingStructureAnalysis;
  assertProcessedAnalysis(script, "function_slot_atomization_missing_script_segments", "请先完成脚本段落分析");
  assertProcessedAnalysis(rhythm, "function_slot_atomization_missing_rhythm_structure", "请先完成节奏结构分析");
  assertProcessedAnalysis(packaging, "function_slot_atomization_missing_packaging_structure", "请先完成包装结构分析");

  return sanitizeForAppServerText({
    schemaVersion: INPUT_SCHEMA_VERSION,
    sampleVideoId: artifact.sampleVideoId,
    parentArtifactId: packaging.artifactId ?? rhythm.artifactId ?? script.artifactId ?? artifact.sampleVideo?.artifactId ?? null,
    sourceScriptSegmentArtifactId: script.artifactId ?? null,
    sourceRhythmStructureArtifactId: rhythm.artifactId ?? null,
    sourcePackagingStructureArtifactId: packaging.artifactId ?? null,
    sourceShotBoundaryArtifactId: script.sourceShotBoundaryArtifactId ?? rhythm.sourceShotBoundaryArtifactId ?? packaging.sourceShotBoundaryArtifactId ?? null,
    scriptSegmentAnalysis: normalizeScriptSegmentAnalysis(script),
    rhythmStructureAnalysis: normalizeRhythmStructureAnalysis(rhythm),
    packagingStructureAnalysis: normalizePackagingStructureAnalysis(packaging),
  });
}

async function prepareInputPackage({ input, sampleDir, store }) {
  if (!sampleDir || !store) throw new Error("function slot atomization input package missing sampleDir/store");
  const inputPackageDir = path.join(sampleDir, "function-slot-atomization-input");
  await fs.mkdir(inputPackageDir, { recursive: true });

  const manifest = buildManifest(input);
  const lineage = buildLineage(input);
  const outputContract = buildOutputContract();
  const metadata = {
    schemaVersion: INPUT_PACKAGE_SCHEMA_VERSION,
    inputPackageDir,
    generatedAt: new Date().toISOString(),
  };

  const manifestPath = path.join(inputPackageDir, "manifest.json");
  const lineagePath = path.join(inputPackageDir, "lineage.json");
  const metadataPath = path.join(inputPackageDir, "metadata.json");
  const outputContractPath = path.join(inputPackageDir, "output-contract.json");
  await Promise.all([
    store.writeJson(manifestPath, manifest),
    store.writeJson(lineagePath, lineage),
    store.writeJson(metadataPath, metadata),
    store.writeJson(outputContractPath, outputContract),
  ]);

  return sanitizeForAppServerText({
    schemaVersion: INPUT_PACKAGE_SCHEMA_VERSION,
    manifest,
    manifestPath,
    lineage,
    lineagePath,
    metadata,
    metadataPath,
    outputContract,
    outputContractPath,
    hashes: {
      manifestHash: contentHash(stableJson(manifest)),
      outputContractHash: contentHash(stableJson(outputContract)),
    },
  });
}

function renderAnalyzeTurnInputs({ input, inputPackage, roleProfile }) {
  const prompt = renderTurnTemplate(roleProfile, "analyze", {
    inputSummaryText: buildInputSummaryText(inputPackage),
    manifestPath: inputPackage.manifestPath,
    outputContractPath: inputPackage.outputContractPath,
  });
  return {
    ...prompt,
    inputs: sanitizeForAppServerText([{ type: "text", text: prompt.text, text_elements: [] }]),
    manifest: inputPackage.manifest,
    lineage: inputPackage.lineage,
    outputContract: inputPackage.outputContract,
  };
}

function renderRepairTurnInputs({ inputPackage, validationError, priorTurnOutput, repairAttemptCount, roleProfile }) {
  const priorOutputSummary = {
    hasPriorOutput: Boolean(String(priorTurnOutput ?? "").trim()),
    outputLength: String(priorTurnOutput ?? "").trim().length,
  };
  const prompt = renderTurnTemplate(roleProfile, "repair", {
    repairAttemptCount,
    inputSummaryText: buildInputSummaryText(inputPackage),
    manifestPath: inputPackage.manifestPath,
    outputContractPath: inputPackage.outputContractPath,
    validationPathText: "校验失败摘要见当前输入文本",
    priorOutputSummaryPathText: "上次输出摘要见当前输入文本",
    validationJson: stableJson(validationError?.debugPayload?.validation ?? { code: validationError?.code ?? null, message: validationError?.message ?? null }),
    priorOutputSummaryJson: stableJson(priorOutputSummary),
  });
  return {
    ...prompt,
    inputs: sanitizeForAppServerText([{ type: "text", text: prompt.text, text_elements: [] }]),
    manifest: inputPackage.manifest,
    lineage: inputPackage.lineage,
    outputContract: inputPackage.outputContract,
    validation: validationError?.debugPayload?.validation ?? null,
    priorOutputSummary,
    repairAttemptCount,
  };
}

function buildManifest(input) {
  return {
    schemaVersion: INPUT_PACKAGE_SCHEMA_VERSION,
    sourceScriptSegmentArtifactId: input.sourceScriptSegmentArtifactId,
    sourceRhythmStructureArtifactId: input.sourceRhythmStructureArtifactId,
    sourcePackagingStructureArtifactId: input.sourcePackagingStructureArtifactId,
    sourceShotBoundaryArtifactId: input.sourceShotBoundaryArtifactId,
    scriptSegmentAnalysis: input.scriptSegmentAnalysis,
    rhythmStructureAnalysis: input.rhythmStructureAnalysis,
    packagingStructureAnalysis: input.packagingStructureAnalysis,
  };
}

function buildLineage(input) {
  return {
    schemaVersion: INPUT_PACKAGE_SCHEMA_VERSION,
    sampleVideoId: input.sampleVideoId,
    parentArtifactId: input.parentArtifactId,
    sourceScriptSegmentArtifactId: input.sourceScriptSegmentArtifactId,
    sourceRhythmStructureArtifactId: input.sourceRhythmStructureArtifactId,
    sourcePackagingStructureArtifactId: input.sourcePackagingStructureArtifactId,
    sourceShotBoundaryArtifactId: input.sourceShotBoundaryArtifactId,
  };
}

function buildInputSummaryText(inputPackage) {
  const manifest = inputPackage.manifest;
  return [
    `脚本段落 ${manifest.scriptSegmentAnalysis.segments.length} 个`,
    `节奏 section ${manifest.rhythmStructureAnalysis.sections.length} 个`,
    `包装块 ${manifest.packagingStructureAnalysis.packagingBlocks.length} 个`,
    `逐镜包装记录 ${manifest.packagingStructureAnalysis.shotPackagingNotes.length} 条`,
  ].join("；");
}

function assertProcessedAnalysis(analysis, code, message) {
  if (!analysis || analysis.status !== "processed" || analysis.validation?.status === "failed") {
    throw codedError(code, message, {
      artifactId: analysis?.artifactId ?? null,
      status: analysis?.status ?? null,
      validatorCode: analysis?.validation?.validatorCode ?? null,
    }, false);
  }
}

function normalizeScriptSegmentAnalysis(analysis) {
  return {
    artifactId: analysis.artifactId ?? null,
    parentArtifactId: analysis.parentArtifactId ?? null,
    validation: summarizeValidation(analysis.validation),
    commerceBrief: analysis.commerceBrief ?? null,
    segments: Array.isArray(analysis.segments) ? analysis.segments.map((segment) => ({
      segmentId: normalizeText(segment.segmentId, 80),
      label: normalizeText(segment.label),
      roleInScript: normalizeText(segment.roleInScript, 260),
      shotRefs: normalizeStringArray(segment.shotRefs),
      evidence: normalizeStringArray(segment.evidence, 6),
      transferableRule: normalizeText(segment.transferableRule, 260),
      confidence: segment.confidence ?? null,
      needReview: Boolean(segment.needReview),
      start: segment.start ?? null,
      end: segment.end ?? null,
    })) : [],
  };
}

function normalizeRhythmStructureAnalysis(analysis) {
  return {
    artifactId: analysis.artifactId ?? null,
    parentArtifactId: analysis.parentArtifactId ?? null,
    validation: summarizeValidation(analysis.validation),
    overview: normalizeOverview(analysis.overview),
    sections: Array.isArray(analysis.sections) ? analysis.sections.map((section) => ({
      sectionId: normalizeText(section.sectionId, 80),
      label: normalizeText(section.label),
      shotRefs: normalizeStringArray(section.shotRefs),
      fields: normalizeFields(section.fields),
      confidence: section.confidence ?? null,
      needReview: Boolean(section.needReview),
      start: section.start ?? null,
      end: section.end ?? null,
    })) : [],
    cards: Array.isArray(analysis.cards) ? analysis.cards.map((card) => ({
      cardId: normalizeText(card.cardId, 80),
      label: normalizeText(card.label),
      rhythmRole: normalizeText(card.rhythmRole, 220),
      shotRefs: normalizeStringArray(card.shotRefs),
      evidence: normalizeStringArray(card.evidence, 6),
      rhythmPattern: normalizeText(card.rhythmPattern, 220),
      attentionEffect: normalizeText(card.attentionEffect, 220),
      transferableRule: normalizeText(card.transferableRule, 260),
      confidence: card.confidence ?? null,
      needReview: Boolean(card.needReview),
      start: card.start ?? null,
      end: card.end ?? null,
    })) : [],
  };
}

function normalizePackagingStructureAnalysis(analysis) {
  return {
    artifactId: analysis.artifactId ?? null,
    parentArtifactId: analysis.parentArtifactId ?? null,
    validation: summarizeValidation(analysis.validation),
    overview: normalizeOverview(analysis.overview),
    shotPackagingNotes: Array.isArray(analysis.shotPackagingNotes) ? analysis.shotPackagingNotes.map((note) => ({
      noteId: normalizeText(note.noteId, 80),
      shotRef: normalizeText(note.shotRef, 80),
      fields: normalizeFields(note.fields),
      packagingFunction: normalizeText(note.packagingFunction, 260),
      confidence: note.confidence ?? null,
      needReview: Boolean(note.needReview),
      start: note.start ?? null,
      end: note.end ?? null,
    })) : [],
    packagingBlocks: Array.isArray(analysis.packagingBlocks) ? analysis.packagingBlocks.map((block) => ({
      blockId: normalizeText(block.blockId, 80),
      label: normalizeText(block.label),
      shotRefs: normalizeStringArray(block.shotRefs),
      fields: normalizeFields(block.fields),
      packagingFunction: normalizeText(block.packagingFunction, 260),
      confidence: block.confidence ?? null,
      needReview: Boolean(block.needReview),
      start: block.start ?? null,
      end: block.end ?? null,
    })) : [],
    claimStack: normalizeStack(analysis.claimStack),
    proofStack: normalizeStack(analysis.proofStack),
    conversionWrap: analysis.conversionWrap ? {
      summary: normalizeText(analysis.conversionWrap.summary, 260),
      fields: normalizeFields(analysis.conversionWrap.fields),
      shotRefs: normalizeStringArray(analysis.conversionWrap.shotRefs),
      uncertainties: normalizeStringArray(analysis.conversionWrap.uncertainties, 8),
      start: analysis.conversionWrap.start ?? null,
      end: analysis.conversionWrap.end ?? null,
    } : null,
  };
}

function normalizeOverview(overview) {
  if (!overview) return null;
  return {
    summary: normalizeText(overview.summary, 360),
    fields: normalizeFields(overview.fields),
    uncertainties: normalizeStringArray(overview.uncertainties, 8),
  };
}

function normalizeFields(fields) {
  if (!Array.isArray(fields)) return [];
  return fields.map((field) => ({
    label: normalizeText(field?.label, 80),
    value: normalizeText(field?.value, 260),
  })).filter((field) => field.label || field.value).slice(0, 12);
}

function normalizeStack(items) {
  if (!Array.isArray(items)) return [];
  return items.map((item) => ({
    label: normalizeText(item.label),
    shotRefs: normalizeStringArray(item.shotRefs),
    fields: normalizeFields(item.fields),
    start: item.start ?? null,
    end: item.end ?? null,
  })).slice(0, 16);
}

function summarizeValidation(validation) {
  return {
    status: validation?.status ?? null,
    validatorCode: validation?.validatorCode ?? null,
    repairAttemptCount: validation?.repairAttemptCount ?? 0,
  };
}

module.exports = {
  INPUT_PACKAGE_SCHEMA_VERSION,
  prepareInput,
  prepareInputPackage,
  renderAnalyzeTurnInputs,
  renderRepairTurnInputs,
  buildInputSummaryText,
};
