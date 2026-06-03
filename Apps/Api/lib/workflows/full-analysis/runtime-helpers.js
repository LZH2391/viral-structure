function createStageState(definition) {
  return {
    ...definition,
    status: "pending",
    attemptNo: 1,
    stageId: null,
    childJobId: null,
    childTraceId: null,
    artifactId: null,
    parentArtifactId: null,
    sampleVideoId: null,
    inputSummary: null,
    outputSummary: null,
    errorSummary: null,
    startedAt: null,
    completedAt: null,
  };
}

function resetStageForRun(stage) {
  return {
    ...stage,
    status: "pending",
    stageId: null,
    childJobId: null,
    childTraceId: null,
    artifactId: null,
    parentArtifactId: null,
    inputSummary: null,
    outputSummary: null,
    errorSummary: null,
    startedAt: null,
    completedAt: null,
  };
}

function findStage(run, stageKey) {
  return run?.stages?.find((stage) => stage.key === stageKey) ?? createStageState({ key: stageKey, stageName: stageKey, label: stageKey, artifactKey: null });
}

function updateStage(stages, stageKey, update) {
  return stages.map((stage) => stage.key === stageKey ? update(stage) : stage);
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function summarizeStageInput(stageKey, input) {
  if (stageKey === "upload") {
    return {
      filename: input.file?.name ?? input.file?.filename ?? null,
      mimeType: input.file?.type ?? input.file?.mimeType ?? null,
      sizeBytes: input.file?.size ?? input.file?.buffer?.length ?? null,
      frameSampleRateFps: input.fields?.frameSampleRateFps ?? null,
      cacheDecision: input.fields?.cacheDecision ?? null,
    };
  }
  return { cacheDecision: input.cacheDecision ?? null };
}

function artifactRefForStage(stage, artifact) {
  if (!artifact) return null;
  return stage?.artifactKey ? artifact[stage.artifactKey] ?? null : null;
}

function buildAggregateSummary(artifact) {
  return {
    sampleVideoId: artifact?.sampleVideoId ?? null,
    shotCount: artifact?.shotBoundaryAnalysis?.shots?.length ?? 0,
    scriptSegmentCount: artifact?.scriptSegmentAnalysis?.segments?.length ?? 0,
    rhythmSectionCount: artifact?.rhythmStructureAnalysis?.sections?.length ?? 0,
    packagingBlockCount: artifact?.packagingStructureAnalysis?.packagingBlocks?.length ?? 0,
    functionSlotCount: artifact?.functionSlotAtomizationAnalysis?.slotMap?.slots?.length ?? 0,
    userMaterialShotCardCount: artifact?.userMaterialPack?.shotCards?.length ?? 0,
    userMaterialGroupCount: artifact?.userMaterialPack?.materialGroups?.length ?? 0,
  };
}

function buildModuleDependencies(stageKey, artifact) {
  if (stageKey === "functionSlotAtomization") {
    return {
      scriptSegmentArtifactId: artifact?.scriptSegmentAnalysis?.artifactId ?? null,
      rhythmStructureArtifactId: artifact?.rhythmStructureAnalysis?.artifactId ?? null,
      packagingStructureArtifactId: artifact?.packagingStructureAnalysis?.artifactId ?? null,
    };
  }
  if (stageKey === "userMaterialTagger") {
    return {
      shotBoundaryArtifactId: artifact?.shotBoundaryAnalysis?.artifactId ?? null,
    };
  }
  return {
    shotBoundaryArtifactId: artifact?.shotBoundaryAnalysis?.artifactId ?? null,
  };
}

function normalizeError(error, stageKey) {
  if (error?.code && error?.message) {
    return {
      code: error.code,
      message: String(error.message).slice(0, 240),
      stageName: stageKey,
      retryable: typeof error.retryable === "boolean" ? error.retryable : true,
    };
  }
  return {
    code: "workflow_stage_failed",
    message: error instanceof Error ? error.message.slice(0, 240) : "workflow 步骤失败",
    stageName: stageKey,
    retryable: true,
  };
}

function hasRunningChildren(run, cacheWaitingStatus) {
  return Boolean(run?.stages?.some((stage) => stage.childJobId && ["pending", "running", cacheWaitingStatus].includes(stage.status)));
}

function hasTerminalRunWithRunningChildren(run, jobStore, cacheWaitingStatus) {
  if (!["processed", "failed"].includes(run?.status)) return false;
  return Boolean(run?.stages?.some((stage) => {
    if (!stage.childJobId || !["pending", "running", cacheWaitingStatus].includes(stage.status)) return false;
    const job = jobStore.getJob(stage.childJobId);
    return Boolean(job && ["processed", "failed", cacheWaitingStatus, "processing", "pending"].includes(job.status));
  }));
}

function workflowRunTime(run) {
  const timestamp = Date.parse(run?.updatedAt ?? run?.createdAt ?? "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function latestWorkflowRun(workflowRunStore, workflowKey, sampleVideoId = null) {
  const runs = typeof workflowRunStore.listRuns === "function" ? workflowRunStore.listRuns() : [];
  return runs
    .filter((run) => run?.workflowKey === workflowKey && (!sampleVideoId || run.sampleVideoId === sampleVideoId))
    .sort((a, b) => workflowRunTime(b) - workflowRunTime(a))[0] ?? null;
}

function publicRun(run) {
  return {
    workflowRunId: run.workflowRunId,
    workflowKey: run.workflowKey,
    workflowVersion: run.workflowVersion,
    cacheDecision: run.cacheDecision ?? "ask",
    options: run.options ?? {},
    status: run.status,
    traceId: run.traceId,
    runId: run.runId,
    sampleVideoId: run.sampleVideoId,
    currentStageKeys: run.currentStageKeys ?? [],
    stages: run.stages,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    completedAt: run.completedAt ?? null,
    errorSummary: run.errorSummary ?? null,
  };
}

function resolveWorkflowStages(workflowDescriptor, moduleRegistry) {
  return workflowDescriptor.nodes.map((node) => {
    if (node.kind === "module") {
      const module = moduleRegistry?.getByModuleId?.(node.moduleId);
      return {
        key: node.key,
        kind: node.kind,
        moduleId: node.moduleId,
        stageName: module?.ui?.stageId ?? node.stageName ?? node.key,
        label: module?.ui?.displayName ?? module?.ui?.label ?? node.label ?? node.key,
        artifactKey: module?.artifact?.key ?? node.artifactKey ?? null,
        after: node.after ?? [],
        parallelGroup: node.parallelGroup ?? null,
        blocking: Boolean(node.blocking),
      };
    }
    return {
      key: node.key,
      kind: node.kind,
      stageName: node.stageName ?? node.key,
      label: node.label ?? node.key,
      artifactKey: node.artifactKey ?? null,
      after: node.after ?? [],
      parallelGroup: node.parallelGroup ?? null,
      blocking: Boolean(node.blocking),
    };
  });
}

function findModuleStage(moduleStageDefinitions, stageKey) {
  return moduleStageDefinitions.find((stage) => stage.key === stageKey) ?? null;
}

function downstreamStageKeys(stages, stageKey, parallelGroups = {}) {
  const result = [];
  const pending = [stageKey];
  while (pending.length) {
    const currentKey = pending.shift();
    for (const stage of stages) {
      if (stage.key === stageKey || result.includes(stage.key)) continue;
      if (stageDependsOn(stage, currentKey, parallelGroups)) {
        result.push(stage.key);
        pending.push(stage.key);
      }
    }
  }
  return result;
}

function stageDependsOn(stage, dependencyKey, parallelGroups = {}) {
  const dependencies = Array.isArray(stage.after) ? stage.after : [];
  if (dependencies.includes(dependencyKey)) return true;
  return dependencies.some((dependency) => (parallelGroups[dependency] ?? []).includes(dependencyKey));
}

function hasStage(run, stageKey) {
  return Boolean(run?.stages?.some((stage) => stage.key === stageKey));
}

module.exports = {
  artifactRefForStage,
  buildAggregateSummary,
  buildModuleDependencies,
  createStageState,
  downstreamStageKeys,
  findModuleStage,
  findStage,
  hasStage,
  hasRunningChildren,
  hasTerminalRunWithRunningChildren,
  latestWorkflowRun,
  normalizeError,
  publicRun,
  resetStageForRun,
  resolveWorkflowStages,
  summarizeStageInput,
  unique,
  updateStage,
  workflowRunTime,
};
