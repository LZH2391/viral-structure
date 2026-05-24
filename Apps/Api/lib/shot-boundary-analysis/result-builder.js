const {
  ROLE,
  SKILL_PATH,
  ANALYSIS_SELECTION_POLICY,
  ANALYSIS_DUPLICATE_POLICY,
  skillContentHashSync,
  summarizeCommerceBrief,
  stripLocalImagePath,
  resolveShotSummary,
  sanitizeDebugPayload,
} = require("./shared");
const { extractJsonObject } = require("./shared");
const {
  normalizeTimestampBoundaries,
  normalizeShotCentricShots,
  deriveBoundariesFromShots,
  validateTimestampBoundaries,
  validateShotCentricShots,
  validateCommerceBrief,
  buildShotsFromBoundaries,
  detectReasonEncodingIssue,
  summarizeAgentOutput,
} = require("./validation");
const { buildShotBoundaryCacheParams, cacheParams } = require("./cache-params");

function buildProcessedAnalysis(message, prepared, contactSheets, context, lease, turn, options = {}) {
  const parsed = extractJsonObject(message);
  return buildProcessedAnalysisFromParsed(parsed, prepared, contactSheets, context, lease, turn, {
    ...options,
    rawMessage: message,
  });
}

function buildProcessedAnalysisFromParsed(parsed, prepared, contactSheets, context, lease, turn, options = {}) {
  const rawMessage = options.rawMessage ?? JSON.stringify(parsed);
  const promptTemplateVersion = context.promptTemplate?.promptTemplateVersion ?? null;
  const strictShotCentric = /^((analyze|repair)\.v2)$/.test(String(promptTemplateVersion ?? ""));
  const hasCommerceBriefPayload = Object.prototype.hasOwnProperty.call(parsed, "commerceBrief");
  const hasShotCentricPayload = Object.prototype.hasOwnProperty.call(parsed, "shots");
  const parsedShots = Array.isArray(parsed.shots) ? parsed.shots : null;
  const commerceBriefValidation = validateCommerceBrief(parsed.commerceBrief);
  const shotCentricValidation = hasShotCentricPayload
    ? validateShotCentricShots(parsedShots, prepared.durationSeconds)
    : null;
  const usingShotCentricSchema = Boolean(shotCentricValidation?.ok);
  const rawBoundaries = usingShotCentricSchema
    ? deriveBoundariesFromShots(parsedShots)
    : (strictShotCentric && hasShotCentricPayload ? [] : (Array.isArray(parsed.boundaries) ? parsed.boundaries : null));
  const normalizedBoundaries = normalizeTimestampBoundaries(rawBoundaries);
  const normalizedShotCentricShots = usingShotCentricSchema ? normalizeShotCentricShots(parsedShots) : null;
  const validation = (strictShotCentric && hasShotCentricPayload)
    ? shotCentricValidation
    : validateTimestampBoundaries(normalizedBoundaries, prepared.durationSeconds);
  if (strictShotCentric && hasCommerceBriefPayload && !commerceBriefValidation.ok) {
    throw require("./shared").codedError("shot_boundary_validation_failed", commerceBriefValidation.message, {
      turnId: turn?.turnId ?? null,
      outputSchemaVersion: "shot-centric.v2",
      outputSummary: summarizeAgentOutput(rawMessage, rawBoundaries, normalizedBoundaries, parsedShots),
      validation: commerceBriefValidation.summary,
    }, false);
  }
  if (!validation.ok) {
    throw require("./shared").codedError("shot_boundary_validation_failed", validation.message, {
      turnId: turn?.turnId ?? null,
      outputSchemaVersion: (strictShotCentric && hasShotCentricPayload) ? "shot-centric.v2" : "legacy-boundary.v1",
      outputSummary: summarizeAgentOutput(rawMessage, rawBoundaries, normalizedBoundaries, parsedShots),
      validation: validation.summary,
    }, false);
  }
  const qualityIssue = detectReasonEncodingIssue(normalizedBoundaries);
  if (qualityIssue) {
    throw require("./shared").codedError("agent_output_quality_failed", "切镜 Agent 输出存在编码异常，已阻止写入 processed 产物", {
      turnId: turn?.turnId ?? null,
      parseFailureReason: qualityIssue.reason,
      outputSchemaVersion: (strictShotCentric && hasShotCentricPayload) ? "shot-centric.v2" : "legacy-boundary.v1",
      outputSummary: summarizeAgentOutput(rawMessage, rawBoundaries, normalizedBoundaries, parsedShots),
      suspiciousReason: qualityIssue.suspiciousReason,
      validation: validation.summary,
    }, false);
  }
  const mergedBoundaries = normalizedBoundaries;
  const commerceBrief = options.commerceBrief !== undefined
    ? options.commerceBrief
    : (commerceBriefValidation.ok ? commerceBriefValidation.commerceBrief : null);
  const shots = usingShotCentricSchema
    ? buildShotsFromBoundaries(mergedBoundaries, prepared.frames, prepared.durationSeconds, normalizedShotCentricShots)
    : buildShotsFromBoundaries(mergedBoundaries, prepared.frames, prepared.durationSeconds, parsedShots);
  return {
    artifactId: context.artifactId,
    parentArtifactId: prepared.sourceArtifactId,
    type: "shot-boundary-analysis",
    status: "processed",
    resultOrigin: options.resultOrigin ?? "new_turn",
    sourceFrameArtifactIds: prepared.frames.map((frame) => frame.artifactId),
    extractSampling: prepared.extractSampling,
    analysisSampling: prepared.analysisSampling,
    subtitleContextSummary: prepared.subtitleContextSummary ?? null,
    commerceBrief,
    contactSheets: contactSheets.map(stripLocalImagePath),
    boundaries: mergedBoundaries,
    validation: {
      status: "passed",
      rawBoundaryCount: rawBoundaries.length,
      normalizedBoundaryCount: mergedBoundaries.length,
      repairAttemptCount: options.repairAttemptCount ?? 0,
      reviewReworkCount: options.reviewReworkCount ?? 0,
      validatorCode: null,
      schemaVersion: usingShotCentricSchema ? "shot-centric.v2" : "legacy-boundary.v1",
      commerceBrief: summarizeCommerceBrief(commerceBrief),
      review: options.review !== undefined ? options.review : null,
    },
    agent: {
      provider: "codex-appserver",
      role: ROLE,
      profilePath: context.roleProfile?.profilePath ?? null,
      profileVersion: context.roleProfile?.profileVersion ?? null,
      promptTemplateId: context.promptTemplate?.promptTemplateId ?? null,
      promptTemplateVersion: context.promptTemplate?.promptTemplateVersion ?? null,
      promptTemplateHash: context.promptTemplate?.promptTemplateHash ?? null,
      initFingerprint: context.initFingerprint ?? null,
      skillPath: context.skillPath ?? SKILL_PATH,
      skillHash: context.skillHash ?? skillContentHashSync(context.skillPath ?? SKILL_PATH),
      threadId: lease.thread_id,
      leaseId: lease.lease_id,
      turnId: turn.turnId,
      sheetCount: contactSheets.length,
      inputMode: "multi_contact_sheet",
      enableReview: options.enableReview !== false,
      reviewMode: options.enableReview === false ? "unreviewed" : "reviewed",
    },
    shots,
    review: options.review ?? null,
    reviewRuns: Array.isArray(options.reviewRuns) ? options.reviewRuns : [],
    createdAt: new Date().toISOString(),
  };
}

function validateCommerceBriefOutput(message, turn) {
  const parsed = extractJsonObject(message);
  const validation = validateCommerceBrief(parsed.commerceBrief);
  if (!validation.ok) {
    throw require("./shared").codedError("shot_summary_validation_failed", validation.message, {
      turnId: turn?.turnId ?? null,
      outputSchemaVersion: "commerce-brief.v1",
      outputSummary: {
        messagePreview: String(message ?? "").replace(/\s+/g, " ").slice(0, 200),
        hasCommerceBrief: Object.prototype.hasOwnProperty.call(parsed, "commerceBrief"),
      },
      validation: validation.summary,
    }, false);
  }
  return validation.commerceBrief;
}

function buildFailedArtifact(context, errorSummary, contactSheets = []) {
  const agentRun = context.job?.agentRun ?? null;
  const validation = context.validationSummary ?? null;
  return {
    artifactId: context.artifactId,
    parentArtifactId: context.sampleArtifact?.sampleVideo?.artifactId ?? null,
    type: "shot-boundary-analysis",
    status: "failed",
    resultOrigin: validation?.repairAttemptCount ? "failed_validation" : "new_turn",
    sourceFrameArtifactIds: [],
    extractSampling: null,
    analysisSampling: {
      fps: context.analysisFps,
      requestedFps: context.analysisFps,
      targetFrameCount: null,
      selectedFrameCount: null,
      effectiveFps: null,
      selectionPolicy: ANALYSIS_SELECTION_POLICY,
      duplicatePolicy: ANALYSIS_DUPLICATE_POLICY,
      roundingPolicy: ANALYSIS_SELECTION_POLICY,
    },
    subtitleContextSummary: context.prepared?.subtitleContextSummary ?? null,
    contactSheets: contactSheets.map(stripLocalImagePath),
    boundaries: [],
    validation: {
      status: "failed",
      rawBoundaryCount: validation?.rawBoundaryCount ?? 0,
      normalizedBoundaryCount: validation?.normalizedBoundaryCount ?? 0,
      repairAttemptCount: validation?.repairAttemptCount ?? 0,
      validatorCode: validation?.validatorCode ?? errorSummary.code ?? null,
    },
    agent: {
      provider: "codex-appserver",
      role: ROLE,
      profilePath: context.roleProfile?.profilePath ?? null,
      profileVersion: context.roleProfile?.profileVersion ?? null,
      promptTemplateId: context.promptTemplate?.promptTemplateId ?? null,
      promptTemplateVersion: context.promptTemplate?.promptTemplateVersion ?? null,
      promptTemplateHash: context.promptTemplate?.promptTemplateHash ?? null,
      initFingerprint: context.initFingerprint ?? null,
      skillPath: context.skillPath ?? SKILL_PATH,
      skillHash: context.skillHash ?? skillContentHashSync(context.skillPath ?? SKILL_PATH),
      threadId: agentRun?.threadId ?? null,
      leaseId: agentRun?.leaseId ?? null,
      turnId: agentRun?.turnId ?? null,
      sheetCount: contactSheets.length || agentRun?.contactSheets?.length || 0,
      inputMode: "multi_contact_sheet",
    },
    commerceBrief: null,
    shots: [],
    reason: errorSummary.message,
    debugSnapshotUri: errorSummary.debugSnapshotUri ?? null,
    createdAt: new Date().toISOString(),
  };
}

function buildCacheReuseAnalysis(analysis) {
  return {
    ...analysis,
    resultOrigin: "cache_reuse",
    validation: analysis.validation ?? null,
    createdAt: new Date().toISOString(),
  };
}

function evaluateCacheEligibility(analysis) {
  const status = analysis?.status === "processed";
  const validationPassed = analysis?.validation?.status === "passed";
  const hasBoundaries = Array.isArray(analysis?.boundaries) && analysis.boundaries.length > 0;
  const hasShots = Array.isArray(analysis?.shots) && analysis.shots.length > 0;
  const validatorClean = !analysis?.validation?.validatorCode;
  return {
    eligible: Boolean(status && validationPassed && hasBoundaries && hasShots && validatorClean),
    status,
    validationPassed,
    hasBoundaries,
    hasShots,
    validatorClean,
  };
}

module.exports = {
  buildProcessedAnalysis,
  buildProcessedAnalysisFromParsed,
  validateCommerceBriefOutput,
  buildFailedArtifact,
  buildCacheReuseAnalysis,
  evaluateCacheEligibility,
  buildShotsFromBoundaries,
  normalizeTimestampBoundaries,
  validateTimestampBoundaries,
  detectReasonEncodingIssue,
  summarizeAgentOutput,
  buildShotBoundaryCacheParams,
  cacheParams,
};
