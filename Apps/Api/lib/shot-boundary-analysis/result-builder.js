const {
  ROLE,
  SKILL_PATH,
  ANALYSIS_SELECTION_POLICY,
  ANALYSIS_DUPLICATE_POLICY,
  skillContentHashSync,
  stripLocalImagePath,
  resolveShotSummary,
  sanitizeDebugPayload,
} = require("./shared");
const { extractJsonObject } = require("./shared");
const {
  normalizeTimestampBoundaries,
  validateTimestampBoundaries,
  buildShotsFromBoundaries,
  detectReasonEncodingIssue,
  summarizeAgentOutput,
} = require("./validation");
const { buildShotBoundaryCacheParams, cacheParams } = require("./cache-params");

function buildProcessedAnalysis(message, prepared, contactSheets, context, lease, turn, options = {}) {
  const parsed = extractJsonObject(message);
  const rawBoundaries = Array.isArray(parsed.boundaries) ? parsed.boundaries : null;
  const rawShots = Array.isArray(parsed.shots) ? parsed.shots : null;
  const normalizedBoundaries = normalizeTimestampBoundaries(rawBoundaries);
  const validation = validateTimestampBoundaries(normalizedBoundaries, prepared.durationSeconds);
  if (!validation.ok) {
    throw require("./shared").codedError("shot_boundary_validation_failed", validation.message, {
      turnId: turn?.turnId ?? null,
      outputSummary: summarizeAgentOutput(message, rawBoundaries, normalizedBoundaries, rawShots),
      validation: validation.summary,
    }, false);
  }
  const qualityIssue = detectReasonEncodingIssue(normalizedBoundaries);
  if (qualityIssue) {
    throw require("./shared").codedError("agent_output_quality_failed", "切镜 Agent 输出存在编码异常，已阻止写入 processed 产物", {
      turnId: turn?.turnId ?? null,
      parseFailureReason: qualityIssue.reason,
      outputSummary: summarizeAgentOutput(message, rawBoundaries, normalizedBoundaries, rawShots),
      suspiciousReason: qualityIssue.suspiciousReason,
      validation: validation.summary,
    }, false);
  }
  const mergedBoundaries = normalizedBoundaries;
  const shots = buildShotsFromBoundaries(mergedBoundaries, prepared.frames, prepared.durationSeconds, rawShots);
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
    contactSheets: contactSheets.map(stripLocalImagePath),
    boundaryCandidateArtifacts: [],
    boundaries: mergedBoundaries,
    validation: {
      status: "passed",
      rawBoundaryCount: rawBoundaries.length,
      normalizedBoundaryCount: mergedBoundaries.length,
      repairAttemptCount: options.repairAttemptCount ?? 0,
      validatorCode: null,
    },
    agent: {
      provider: "codex-appserver",
      role: ROLE,
      skillPath: context.skillPath ?? SKILL_PATH,
      skillHash: context.skillHash ?? skillContentHashSync(context.skillPath ?? SKILL_PATH),
      threadId: lease.thread_id,
      leaseId: lease.lease_id,
      turnId: turn.turnId,
      sheetCount: contactSheets.length,
      inputMode: "multi_contact_sheet",
    },
    shots,
    createdAt: new Date().toISOString(),
  };
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
      stride: null,
    },
    subtitleContextSummary: context.prepared?.subtitleContextSummary ?? null,
    contactSheets: contactSheets.map(stripLocalImagePath),
    boundaryCandidateArtifacts: [],
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
      skillPath: context.skillPath ?? SKILL_PATH,
      skillHash: context.skillHash ?? skillContentHashSync(context.skillPath ?? SKILL_PATH),
      threadId: agentRun?.threadId ?? null,
      leaseId: agentRun?.leaseId ?? null,
      turnId: agentRun?.turnId ?? null,
      sheetCount: contactSheets.length || agentRun?.contactSheets?.length || 0,
      inputMode: "multi_contact_sheet",
    },
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
