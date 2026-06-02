const { randomUUID } = require("crypto");
const { validateUserMaterialPack } = require("./validation");
const { buildUserMaterialTaggerContentFingerprint } = require("./cache-params");
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
  const validation = validateUserMaterialPack(parsed, input);
  if (!validation.ok) {
    throw codedError("user_material_tagger_validation_failed", "用户素材识别输出未通过校验", {
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
    type: "user-material-pack",
    schemaVersion: "user-material-pack.stable",
    status: "processed",
    resultOrigin: repairAttemptCount > 0 ? "repaired_turn" : "new_turn",
    stageName: STAGES.materialized,
    sampleVideoId: input.sampleVideoId,
    sourceShotBoundaryArtifactId: input.parentArtifactId,
    sourceShotCount: input.shots.length,
    sourceArtifacts: parsed.sourceArtifacts ?? {
      shotBoundaryAnalysis: {
        artifactId: input.parentArtifactId,
        traceId: null,
        shotCount: input.shots.length,
      },
    },
    cacheKey: context.cacheKey ?? buildUserMaterialTaggerContentFingerprint(input),
    inputPackage: compactInputPackageForArtifact(context.inputPackage),
    semanticDictionaries: validation.semanticDictionaries,
    shotCards: attachShotVisualRefs(validation.shotCards, context.inputPackage?.visualManifest),
    materialGroups: validation.materialGroups,
    proofCoverage: validation.proofCoverage,
    sequenceRecommendations: validation.sequenceRecommendations,
    globalConstraintRefs: validation.globalConstraintRefs,
    restructureInputSummary: validation.restructureInputSummary,
    validation: {
      status: "passed",
      shotCardCount: validation.shotCards.length,
      materialGroupCount: validation.materialGroups.length,
      proofCoverageCount: validation.proofCoverage.length,
      validatorCode: null,
      repairAttemptCount,
    },
    agent: buildAgentArtifact(context, agentRun, turn),
    traceMeta: parsed.traceMeta ?? null,
    reason: null,
    debugSnapshotUri: null,
    createdAt: new Date().toISOString(),
  };
}

function attachShotVisualRefs(shotCards, visualManifest) {
  const visualRefsByShot = buildVisualRefsByShot(visualManifest);
  return shotCards.map((card) => {
    const visualRef = visualRefsByShot.get(card.shotRef);
    return visualRef ? { ...card, visualRef } : card;
  });
}

function buildVisualRefsByShot(visualManifest) {
  const sheetsById = new Map((visualManifest?.sheets ?? []).map((sheet) => [sheet.sheetId, sheet]));
  const result = new Map();
  for (const shotSheet of visualManifest?.shotSheets ?? []) {
    const sheetId = (shotSheet.sheetIds ?? [])[0] ?? null;
    if (!sheetId) continue;
    const sheet = sheetsById.get(sheetId);
    const cell = (sheet?.cells ?? []).find((item) => item.shotId === shotSheet.shotId);
    if (!cell) continue;
    result.set(shotSheet.shotId, {
      type: "shot_representative_frame",
      sheetId,
      attachmentIndex: sheet?.attachmentIndex ?? null,
      pageIndex: sheet?.pageIndex ?? null,
      row: cell.row ?? null,
      col: cell.col ?? null,
      timeRange: { start: cell.start, end: cell.end },
      middleTimestamp: cell.middleTimestamp ?? shotSheet.middleTimestamp ?? null,
      representativeFrameTimestamp: cell.representativeFrameTimestamp ?? shotSheet.representativeFrameTimestamp ?? null,
    });
  }
  return result;
}

function compactInputPackageForArtifact(inputPackage) {
  if (!inputPackage) return null;
  return {
    schemaVersion: inputPackage.schemaVersion ?? null,
    snapshotMode: "external_refs",
    manifestPath: inputPackage.manifestPath ?? null,
    metadataPath: inputPackage.metadataPath ?? null,
    lineagePath: inputPackage.lineagePath ?? null,
    outputContractPath: inputPackage.outputContractPath ?? null,
    outputSkeletonPath: inputPackage.outputSkeletonPath ?? null,
    visualManifestPath: inputPackage.visualManifestPath ?? null,
    visualAttachments: inputPackage.visualAttachments ?? [],
    sheetCount: inputPackage.sheetCount ?? inputPackage.visualManifest?.sheetCount ?? 0,
    emptyShotCount: inputPackage.emptyShotCount ?? inputPackage.visualManifest?.emptyShotCount ?? 0,
    hashes: inputPackage.hashes ?? null,
    refIntegrity: "paths_and_hashes_preserve_full_input_package",
  };
}

function parseAgentOutput(message, agentRun, turn, repairAttemptCount) {
  try {
    return extractJsonObject(message);
  } catch (error) {
    const validatorCode = error?.code ?? "agent_output_parse_failed";
    throw codedError("user_material_tagger_validation_failed", "用户素材识别输出未通过校验", {
      validation: {
        validatorCode,
        code: validatorCode,
        message: error instanceof Error ? error.message : "用户素材识别 Agent 未返回合法 JSON",
        readableMessage: "输出不是合法 JSON object",
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

function buildFailedArtifact(context, errorSummary, debugSnapshotUri = null) {
  return {
    artifactId: context.artifactId ?? `artifact_${randomUUID()}`,
    parentArtifactId: context.input?.parentArtifactId ?? context.artifact?.shotBoundaryAnalysis?.artifactId ?? context.artifact?.sampleVideo?.artifactId ?? null,
    traceId: context.traceContext?.traceId ?? null,
    type: "user-material-pack",
    schemaVersion: "user-material-pack.stable",
    status: "failed",
    resultOrigin: context.validationSummary?.repairAttemptCount ? "failed_validation" : "new_turn",
    stageName: context.activeStage?.stageName ?? STAGES.analyzed,
    sampleVideoId: context.sampleVideoId,
    sourceShotBoundaryArtifactId: context.artifact?.shotBoundaryAnalysis?.artifactId ?? null,
    sourceShotCount: context.input?.shots?.length ?? context.artifact?.shotBoundaryAnalysis?.shots?.length ?? 0,
    cacheKey: context.cacheKey ?? (context.input ? buildUserMaterialTaggerContentFingerprint(context.input) : null),
    inputPackage: compactInputPackageForArtifact(context.inputPackage),
    semanticDictionaries: { entityDict: {}, supportDict: {}, guardrailDict: {} },
    shotCards: [],
    materialGroups: [],
    proofCoverage: [],
    sequenceRecommendations: { openingCandidates: [], middleCandidates: [], endingCandidates: [] },
    globalConstraintRefs: [],
    restructureInputSummary: {
      strongMaterialAreas: [],
      weakMaterialAreas: [],
      missingMaterialAreas: [],
      recommendedUse: [],
      doNotUseForRefs: [],
      needsRestructureAttentionRefs: [],
    },
    validation: {
      status: "failed",
      shotCardCount: 0,
      materialGroupCount: 0,
      proofCoverageCount: 0,
      validatorCode: context.validationSummary?.validatorCode ?? errorSummary?.validatorCode ?? errorSummary?.code ?? null,
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

function buildCacheReuseAnalysis({ cachedAnalysis, context }) {
  const compactCachedAnalysis = compactMaterialPackForArtifact(cachedAnalysis);
  return {
    ...compactCachedAnalysis,
    artifactId: context.artifactId ?? `artifact_${randomUUID()}`,
    parentArtifactId: context.input?.parentArtifactId ?? context.artifact?.shotBoundaryAnalysis?.artifactId ?? cachedAnalysis?.parentArtifactId ?? null,
    traceId: context.traceContext?.traceId ?? null,
    sourceTraceId: cachedAnalysis?.traceId ?? cachedAnalysis?.agent?.traceId ?? null,
    sourceShotBoundaryArtifactId: context.input?.parentArtifactId ?? context.artifact?.shotBoundaryAnalysis?.artifactId ?? cachedAnalysis?.sourceShotBoundaryArtifactId ?? null,
    sourceShotCount: context.input?.shots?.length ?? cachedAnalysis?.sourceShotCount ?? 0,
    resultOrigin: "cache_reuse",
    sourceSampleVideoId: cachedAnalysis?.sampleVideoId ?? cachedAnalysis?.sourceSampleVideoId ?? null,
    sourceUserMaterialPackArtifactId: cachedAnalysis?.artifactId ?? null,
    sourceTurnId: cachedAnalysis?.agent?.turnId ?? null,
    sourceCreatedAt: cachedAnalysis?.createdAt ?? null,
    sampleVideoId: context.sampleVideoId,
    cacheKey: context.cacheKey ?? cachedAnalysis?.cacheKey ?? null,
    inputPackage: compactInputPackageForArtifact(context.inputPackage),
    shotCards: attachShotVisualRefs(compactCachedAnalysis?.shotCards ?? [], context.inputPackage?.visualManifest),
    createdAt: new Date().toISOString(),
  };
}

function compactMaterialPackForArtifact(analysis) {
  if (!analysis || typeof analysis !== "object") return analysis;
  const { semanticReuse, globalConstraints, ...rest } = analysis;
  const reuse = semanticReuse ?? {};
  const semanticDictionaries = analysis.semanticDictionaries ?? {
    entityDict: reuse.entityDict ?? {},
    supportDict: reuse.supportDict ?? {},
    guardrailDict: reuse.guardrailDict ?? {},
  };
  return {
    ...rest,
    semanticDictionaries,
    shotCards: (analysis.shotCards ?? []).map(compactShotCard),
    materialGroups: (analysis.materialGroups ?? []).map(compactMaterialGroup),
    proofCoverage: (analysis.proofCoverage ?? []).map(compactProofCoverage),
    sequenceRecommendations: compactSequenceRecommendations(analysis.sequenceRecommendations),
    globalConstraintRefs: firstArray(analysis.globalConstraintRefs, globalConstraints),
    restructureInputSummary: compactRestructureInputSummary(analysis.restructureInputSummary),
    inputPackage: compactInputPackageForArtifact(analysis.inputPackage),
  };
}

function compactShotCard(card) {
  const { detectedEntities, constraints, limitations, ...rest } = card;
  return {
    ...rest,
    detectedEntityRefs: card.detectedEntityRefs ?? detectedEntities ?? { products: [], people: [], scenes: [], objects: [], textSignals: [] },
    proofAffordances: (card.proofAffordances ?? []).map((item) => {
      const { limits, limitations: proofLimitations, ...proofRest } = item;
      return {
        ...proofRest,
        limitRefs: firstArray(item.limitRefs, limits, proofLimitations),
      };
    }),
    sequenceFit: Object.fromEntries(Object.entries(card.sequenceFit ?? {}).map(([position, fit]) => [
      position,
      compactSequenceFit(fit),
    ])),
    constraintRefs: firstArray(card.constraintRefs, constraints, limitations),
  };
}

function compactSequenceFit(fit) {
  const { requiredSupport, ...rest } = fit ?? {};
  return {
    ...rest,
    requiredSupportRefs: firstArray(fit?.requiredSupportRefs, requiredSupport),
  };
}

function compactMaterialGroup(group) {
  const { constraints, limitations, ...rest } = group;
  return {
    ...rest,
    constraintRefs: firstArray(group.constraintRefs, constraints, limitations),
  };
}

function compactProofCoverage(item) {
  const { safeUsage, gapAdvice, ...rest } = item;
  return {
    ...rest,
    safeUsageRefs: firstArray(item.safeUsageRefs, stringToArray(safeUsage)),
    gapAdviceRefs: firstArray(item.gapAdviceRefs, stringToArray(gapAdvice)),
  };
}

function compactSequenceRecommendations(sequenceRecommendations) {
  return Object.fromEntries(Object.entries(sequenceRecommendations ?? {
    openingCandidates: [],
    middleCandidates: [],
    endingCandidates: [],
  }).map(([position, candidates]) => [
    position,
    (Array.isArray(candidates) ? candidates : []).map((item) => {
      const { requiredSupport, ...rest } = item;
      return {
        ...rest,
        requiredSupportRefs: firstArray(item.requiredSupportRefs, requiredSupport),
      };
    }),
  ]));
}

function compactRestructureInputSummary(summary) {
  return {
    strongMaterialAreas: summary?.strongMaterialAreas ?? [],
    weakMaterialAreas: summary?.weakMaterialAreas ?? [],
    missingMaterialAreas: summary?.missingMaterialAreas ?? [],
    recommendedUse: summary?.recommendedUse ?? [],
    doNotUseForRefs: firstArray(summary?.doNotUseForRefs, summary?.doNotUseFor),
    needsRestructureAttentionRefs: firstArray(summary?.needsRestructureAttentionRefs, summary?.needsRestructureAttention),
  };
}

function firstArray(...values) {
  return values.find((value) => Array.isArray(value) && value.length) ?? values.find((value) => Array.isArray(value)) ?? [];
}

function stringToArray(value) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text ? [text] : [];
}

function evaluateCacheEligibility(analysis, options = {}) {
  const statusProcessed = analysis?.status === "processed";
  const validationPassed = analysis?.validation?.status === "passed";
  const hasShotCards = Array.isArray(analysis?.shotCards) && analysis.shotCards.length > 0;
  const validatorClean = !analysis?.validation?.validatorCode;
  const cacheKeyMatches = !options.cacheKey || analysis?.cacheKey === options.cacheKey;
  return {
    eligible: Boolean(statusProcessed && validationPassed && hasShotCards && validatorClean && cacheKeyMatches),
    statusProcessed,
    validationPassed,
    hasShotCards,
    validatorClean,
    cacheKeyMatches,
  };
}

module.exports = {
  buildProcessedAnalysis,
  buildFailedArtifact,
  buildCacheReuseAnalysis,
  evaluateCacheEligibility,
  attachShotVisualRefs,
  compactInputPackageForArtifact,
  compactMaterialPackForArtifact,
};
