const { renderTurnTemplate } = require("../role-profile-loader");
const {
  MAX_UNCERTAINTIES,
  MAX_TEXT_FIELD_LENGTH,
  codedError,
  sanitizeForAppServerText,
  normalizeText,
  normalizeStringArray,
  buildOutputContract,
  stableJson,
} = require("./shared");

function prepareInput(artifact) {
  const shotBoundary = artifact?.shotBoundaryAnalysis;
  const shots = Array.isArray(shotBoundary?.shots) ? shotBoundary.shots : [];
  if (!shots.length) {
    throw codedError("script_segment_missing_shots", "当前样例没有可分析的切镜结果", null, false);
  }
  return sanitizeForAppServerText({
    sampleVideoId: artifact.sampleVideoId,
    parentArtifactId: shotBoundary?.artifactId ?? artifact.sampleVideo?.artifactId ?? null,
    commerceBrief: normalizeCommerceBrief(shotBoundary?.commerceBrief ?? null),
    shots: shots.map((shot) => ({
      shotId: String(shot.id),
      start: normalizeNumber(shot.start, 0),
      end: normalizeNumber(shot.end, normalizeNumber(shot.start, 0)),
      summary: normalizeText(shot.summary ?? shot.reason ?? "镜头内容", 160),
      subtitleSummary: null,
      ocrSummary: null,
      audioHintSummary: null,
    })),
  });
}

function buildTurnInputs(input) {
  return {
    manifest: {
      sampleVideoId: input.sampleVideoId,
      commerceBrief: input.commerceBrief,
      shotCount: input.shots.length,
      shots: input.shots,
    },
    outputContract: buildOutputContract(),
  };
}

function renderAnalyzeTurnInputs({ input, roleProfile }) {
  const built = buildTurnInputs(input);
  const prompt = renderTurnTemplate(roleProfile, "analyze", {
    manifestJson: stableJson(built.manifest),
    outputContractJson: stableJson(built.outputContract),
  });
  return {
    ...prompt,
    inputs: sanitizeForAppServerText([{ type: "text", text: prompt.text, text_elements: [] }]),
    manifest: built.manifest,
    outputContract: built.outputContract,
  };
}

function buildRepairTurnInputs({ input, validationError, priorTurnOutput, repairAttemptCount }) {
  return {
    manifest: {
      sampleVideoId: input.sampleVideoId,
      commerceBrief: input.commerceBrief,
      shotCount: input.shots.length,
      shots: input.shots,
    },
    validation: validationError?.debugPayload?.validation ?? { code: validationError?.code ?? null, message: validationError?.message ?? null },
    priorOutputSummary: {
      hasPriorOutput: Boolean(String(priorTurnOutput ?? "").trim()),
      outputLength: String(priorTurnOutput ?? "").trim().length,
    },
    repairAttemptCount,
    outputContract: buildOutputContract(),
  };
}

function renderRepairTurnInputs({ input, validationError, priorTurnOutput, repairAttemptCount, roleProfile }) {
  const built = buildRepairTurnInputs({ input, validationError, priorTurnOutput, repairAttemptCount });
  const prompt = renderTurnTemplate(roleProfile, "repair", {
    repairAttemptCount,
    manifestJson: stableJson(built.manifest),
    validationJson: stableJson(built.validation),
    priorOutputSummaryJson: stableJson(built.priorOutputSummary),
    outputContractJson: stableJson(built.outputContract),
  });
  return {
    ...prompt,
    inputs: sanitizeForAppServerText([{ type: "text", text: prompt.text, text_elements: [] }]),
    ...built,
  };
}

function normalizeCommerceBrief(brief) {
  if (!brief || typeof brief !== "object") return null;
  const normalized = {
    sellingObject: normalizeText(brief.sellingObject, MAX_TEXT_FIELD_LENGTH),
    proofApproach: normalizeText(brief.proofApproach, MAX_TEXT_FIELD_LENGTH),
    promisedOutcome: normalizeText(brief.promisedOutcome, MAX_TEXT_FIELD_LENGTH),
    persuasionTarget: normalizeText(brief.persuasionTarget, MAX_TEXT_FIELD_LENGTH),
    conversionAction: normalizeText(brief.conversionAction, MAX_TEXT_FIELD_LENGTH),
    uncertainties: normalizeStringArray(brief.uncertainties, MAX_UNCERTAINTIES),
  };
  return normalized;
}

function normalizeNumber(value, fallback) {
  const next = Number(value);
  return Number.isFinite(next) ? Math.round(next * 1000) / 1000 : fallback;
}

module.exports = {
  prepareInput,
  buildTurnInputs,
  renderAnalyzeTurnInputs,
  buildRepairTurnInputs,
  renderRepairTurnInputs,
};
