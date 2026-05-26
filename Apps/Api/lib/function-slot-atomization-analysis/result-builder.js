const { randomUUID } = require("crypto");
const { buildFunctionSlotAtomizationContentFingerprint } = require("./cache-params");
const { validateFunctionSlotAtomization } = require("./validation");
const {
  ROLE,
  SKILL_PATH,
  STAGES,
  codedError,
  extractJsonObject,
  summarizeAgentOutput,
} = require("./shared");

function buildProcessedAnalysis(message, input, context, agentRun, turn, { repairAttemptCount = 0 } = {}) {
  const parsed = parseAgentOutput(message, agentRun, turn, repairAttemptCount);
  const validation = validateFunctionSlotAtomization(parsed);
  if (!validation.ok) {
    throw codedError("function_slot_atomization_validation_failed", "功能槽位原子化输出未通过校验", {
      validation: {
        ...validation.summary,
        status: "failed",
        repairAttemptCount,
      },
      outputSummary: summarizeAgentOutput(message, parsed),
      turnId: turn?.turnId ?? agentRun?.turnId ?? null,
      repairAttemptCount,
    }, false);
  }
  return {
    artifactId: context.artifactId ?? `artifact_${randomUUID()}`,
    parentArtifactId: input.parentArtifactId,
    traceId: context.traceContext?.traceId ?? null,
    type: "function-slot-atomization-analysis",
    status: "processed",
    resultOrigin: repairAttemptCount > 0 ? "repaired_turn" : "new_turn",
    stageName: STAGES.materialized,
    sampleVideoId: input.sampleVideoId,
    sourceScriptSegmentArtifactId: input.sourceScriptSegmentArtifactId,
    sourceRhythmStructureArtifactId: input.sourceRhythmStructureArtifactId,
    sourcePackagingStructureArtifactId: input.sourcePackagingStructureArtifactId,
    sourceShotBoundaryArtifactId: input.sourceShotBoundaryArtifactId,
    cacheKey: context.cacheKey ?? buildFunctionSlotAtomizationContentFingerprint(input),
    inputPackage: context.inputPackage ?? null,
    atomInventory: validation.analysis.atomInventory,
    slotMap: validation.analysis.slotMap,
    bindingGraph: validation.analysis.bindingGraph,
    conflictChecks: validation.analysis.conflictChecks,
    recombinationRules: validation.analysis.recombinationRules,
    recompositionTemplates: validation.analysis.recompositionTemplates,
    validation: {
      status: "passed",
      ...validation.summary,
      repairAttemptCount,
    },
    agent: buildAgentArtifact(context, agentRun, turn),
    reason: null,
    debugSnapshotUri: null,
    createdAt: new Date().toISOString(),
  };
}

function parseAgentOutput(message, agentRun, turn, repairAttemptCount) {
  try {
    return extractJsonObject(message);
  } catch (error) {
    const validatorCode = error?.code ?? "agent_output_parse_failed";
    throw codedError("function_slot_atomization_validation_failed", "功能槽位原子化输出未通过校验", {
      validation: {
        validatorCode,
        code: validatorCode,
        message: error instanceof Error ? error.message : "功能槽位原子化 Agent 未返回合法 JSON",
        readableMessage: buildParseReadableMessage(error),
        path: "$",
        repairAttemptCount,
        status: "failed",
      },
      outputSummary: summarizeAgentOutput(message, null),
      turnId: turn?.turnId ?? agentRun?.turnId ?? null,
      repairAttemptCount,
    }, false);
  }
}

function buildParseReadableMessage(error) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const positionMatch = message.match(/position\s+(\d+)/i);
  const lineColumnMatch = message.match(/line\s+(\d+)\s+column\s+(\d+)/i);
  const location = lineColumnMatch
    ? `line ${lineColumnMatch[1]}, column ${lineColumnMatch[2]}`
    : positionMatch
      ? `position ${positionMatch[1]}`
      : "$";
  return `输出不是合法 JSON object，解析失败位置: ${location}`;
}

function buildFailedArtifact(context, errorSummary, debugSnapshotUri = null) {
  return {
    artifactId: context.artifactId ?? `artifact_${randomUUID()}`,
    parentArtifactId: context.input?.parentArtifactId
      ?? context.artifact?.packagingStructureAnalysis?.artifactId
      ?? context.artifact?.rhythmStructureAnalysis?.artifactId
      ?? context.artifact?.scriptSegmentAnalysis?.artifactId
      ?? context.artifact?.sampleVideo?.artifactId
      ?? null,
    traceId: context.traceContext?.traceId ?? null,
    type: "function-slot-atomization-analysis",
    status: "failed",
    resultOrigin: context.validationSummary?.repairAttemptCount ? "failed_validation" : "new_turn",
    stageName: context.activeStage?.stageName ?? STAGES.analyzed,
    sampleVideoId: context.sampleVideoId,
    sourceScriptSegmentArtifactId: context.input?.sourceScriptSegmentArtifactId ?? context.artifact?.scriptSegmentAnalysis?.artifactId ?? null,
    sourceRhythmStructureArtifactId: context.input?.sourceRhythmStructureArtifactId ?? context.artifact?.rhythmStructureAnalysis?.artifactId ?? null,
    sourcePackagingStructureArtifactId: context.input?.sourcePackagingStructureArtifactId ?? context.artifact?.packagingStructureAnalysis?.artifactId ?? null,
    sourceShotBoundaryArtifactId: context.input?.sourceShotBoundaryArtifactId ?? context.artifact?.shotBoundaryAnalysis?.artifactId ?? null,
    cacheKey: context.cacheKey ?? (context.input ? buildFunctionSlotAtomizationContentFingerprint(context.input) : null),
    inputPackage: context.inputPackage ?? null,
    atomInventory: { scriptAtoms: [], rhythmAtoms: [], packagingAtoms: [] },
    slotMap: { slots: [] },
    bindingGraph: { bindings: [] },
    conflictChecks: [],
    recombinationRules: [],
    recompositionTemplates: [],
    validation: {
      status: "failed",
      slotCount: 0,
      scriptAtomCount: 0,
      rhythmAtomCount: 0,
      packagingAtomCount: 0,
      bindingCount: 0,
      recombinationRuleCount: 0,
      templateCount: 0,
      validatorCode: context.validationSummary?.validatorCode ?? errorSummary?.code ?? null,
      repairAttemptCount: context.validationSummary?.repairAttemptCount ?? 0,
    },
    agent: buildAgentArtifact(context, context.agentRun ?? null, null),
    reason: errorSummary?.message ?? null,
    debugSnapshotUri,
    createdAt: new Date().toISOString(),
  };
}

function buildAgentArtifact(context, agentRun, turn) {
  return {
    provider: agentRun?.provider ?? "codex-appserver",
    role: ROLE,
    skillPath: context.skillPath ?? agentRun?.skillPath ?? SKILL_PATH,
    skillHash: context.skillHash ?? agentRun?.skillHash ?? null,
    threadId: agentRun?.threadId ?? null,
    leaseId: agentRun?.leaseId ?? null,
    turnId: turn?.turnId ?? agentRun?.turnId ?? null,
    profileVersion: context.roleProfile?.profileVersion ?? agentRun?.profileVersion ?? null,
    promptTemplateId: context.promptTemplate?.promptTemplateId ?? agentRun?.promptTemplateId ?? null,
    promptTemplateVersion: context.promptTemplate?.promptTemplateVersion ?? agentRun?.promptTemplateVersion ?? null,
    promptTemplateHash: context.promptTemplate?.promptTemplateHash ?? agentRun?.promptTemplateHash ?? null,
  };
}

function evaluateCacheEligibility(analysis, options = {}) {
  const statusProcessed = analysis?.status === "processed";
  const validationPassed = analysis?.validation?.status === "passed";
  const hasSlots = Array.isArray(analysis?.slotMap?.slots) && analysis.slotMap.slots.length > 0;
  const validatorClean = !analysis?.validation?.validatorCode;
  const cacheKeyMatches = !options.cacheKey || analysis?.cacheKey === options.cacheKey;
  return {
    eligible: Boolean(statusProcessed && validationPassed && hasSlots && validatorClean && cacheKeyMatches),
    statusProcessed,
    validationPassed,
    hasSlots,
    validatorClean,
    cacheKeyMatches,
  };
}

function buildCacheReuseAnalysis({ cachedAnalysis, context }) {
  return {
    ...cachedAnalysis,
    artifactId: context.artifactId ?? `artifact_${randomUUID()}`,
    parentArtifactId: context.input?.parentArtifactId ?? cachedAnalysis?.parentArtifactId ?? null,
    traceId: context.traceContext?.traceId ?? null,
    sourceTraceId: cachedAnalysis?.traceId ?? cachedAnalysis?.agent?.traceId ?? null,
    sourceFunctionSlotAtomizationArtifactId: cachedAnalysis?.artifactId ?? null,
    resultOrigin: "cache_reuse",
    sourceSampleVideoId: cachedAnalysis?.sampleVideoId ?? cachedAnalysis?.sourceSampleVideoId ?? null,
    sourceTurnId: cachedAnalysis?.agent?.turnId ?? null,
    sourceCreatedAt: cachedAnalysis?.createdAt ?? null,
    sampleVideoId: context.sampleVideoId,
    cacheKey: context.cacheKey ?? cachedAnalysis?.cacheKey ?? null,
    createdAt: new Date().toISOString(),
  };
}

module.exports = {
  buildProcessedAnalysis,
  buildFailedArtifact,
  buildCacheReuseAnalysis,
  evaluateCacheEligibility,
};
