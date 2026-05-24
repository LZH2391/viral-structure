const { extractJsonObject, stripLocalImagePath, skillContentHashSync } = require("../shot-boundary-analysis/shared");
const { buildProcessedAnalysisFromParsed } = require("../shot-boundary-analysis/result-builder");
const { evidenceHash } = require("./evidence");

function buildV2ProcessedAnalysis(message, prepared, evidence, context, lease, turn) {
  const parsed = extractJsonObject(message);
  const previousPromptTemplate = context.promptTemplate;
  context.promptTemplate = {
    ...(context.promptTemplate ?? {}),
    promptTemplateVersion: "analyze.v2",
  };
  const normalized = {
    commerceBrief: parsed.commerceBrief ?? defaultCommerceBrief(),
    shots: parsed.shots,
  };
  let analysis;
  try {
    analysis = buildProcessedAnalysisFromParsed(normalized, prepared, evidence.sheets, context, lease, turn, {
      rawMessage: message,
      resultOrigin: "v2_evidence_single_turn",
      repairAttemptCount: 0,
      reviewReworkCount: 0,
      enableReview: false,
    });
  } finally {
    context.promptTemplate = previousPromptTemplate;
  }
  return {
    ...analysis,
    method: "shot_boundary_v2_evidence_single_turn",
    evidence: {
      hash: evidenceHash(evidence),
      candidateCount: evidence.candidates.length,
      denseWindowCount: evidence.denseWindows.length,
      candidates: evidence.candidates,
      denseWindows: evidence.denseWindows,
      sheets: evidence.sheets.map(stripLocalImagePath),
    },
    rejectedCandidates: Array.isArray(parsed.rejectedCandidates) ? parsed.rejectedCandidates.map(normalizeRejectedCandidate) : [],
    methodSummary: parsed.methodSummary && typeof parsed.methodSummary === "object" ? parsed.methodSummary : null,
    agent: {
      ...analysis.agent,
      role: context.role,
      profilePath: context.roleProfile?.profilePath ?? null,
      profileVersion: context.roleProfile?.profileVersion ?? null,
      promptTemplateId: previousPromptTemplate?.promptTemplateId ?? null,
      promptTemplateVersion: previousPromptTemplate?.promptTemplateVersion ?? null,
      promptTemplateHash: previousPromptTemplate?.promptTemplateHash ?? null,
      skillPath: context.skillPath,
      skillHash: context.skillHash ?? skillContentHashSync(context.skillPath),
      inputMode: "v2_evidence_sheets_single_turn",
      enableReview: false,
      reviewMode: "none",
    },
    validation: {
      ...analysis.validation,
      review: null,
      schemaVersion: "shot-boundary-v2.result.v1",
    },
  };
}

function defaultCommerceBrief() {
  return {
    sellingObject: "未在 V2 切镜阶段归纳",
    proofApproach: "未在 V2 切镜阶段归纳",
    promisedOutcome: "未在 V2 切镜阶段归纳",
    persuasionTarget: "未在 V2 切镜阶段归纳",
    conversionAction: "未观察到明显转化动作",
    uncertainties: [],
  };
}

function normalizeRejectedCandidate(candidate) {
  return {
    id: String(candidate?.id ?? "").slice(0, 20),
    time: Number(candidate?.time ?? 0),
    reason: String(candidate?.reason ?? "").replace(/\s+/g, " ").trim().slice(0, 160),
  };
}

module.exports = {
  buildV2ProcessedAnalysis,
};
