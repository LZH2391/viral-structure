const path = require("path");
const { randomUUID } = require("crypto");
const { SAMPLE_STATUS } = require("../../../../Core/Workspace/sample-video-contracts");
const { createTraceIds, nextStage } = require("../../../../Infrastructure/Observability/trace");

const MODULES = {
  "function-slot-semantic-governance": {
    moduleId: "function-slot-semantic-governance",
    stageName: "function.slot.semantic_governance.placeholder",
    artifactType: "function-slot-semantic-governance-placeholder",
    artifactDir: "function-slot-semantic-governance",
    displayName: "语义治理",
    role: "function-slot-library-builder",
    skillName: "function-slot-library-builder",
    placeholderPrompt: "占位：后续根据 FunctionSlotLibrary 证据索引生成或刷新语义治理结果。",
    outputSummary: {
      status: "placeholder",
      targetArtifact: "Artifacts/FunctionSlotLibrary/_governance/semantic-governance.v1.json",
    },
  },
  "function-slot-restructure": {
    moduleId: "function-slot-restructure",
    stageName: "function.slot.restructure.placeholder",
    artifactType: "function-slot-restructure-placeholder",
    artifactDir: "function-slot-restructure",
    displayName: "结构重组",
    role: "function-slot-restructure",
    skillName: "function-slot-restructure",
    placeholderPrompt: "占位：后续根据 brief、slot_index 和 semantic-governance 生成结构重组方案。",
    outputSummary: {
      status: "placeholder",
      targetArtifact: "Artifacts/FunctionSlotRestructure/<runId>/restructure.final.md",
    },
  },
  "shot-storyboard-prep": {
    moduleId: "shot-storyboard-prep",
    stageName: "function.slot.shot_storyboard_prep.placeholder",
    artifactType: "shot-storyboard-prep-placeholder",
    artifactDir: "shot-storyboard-prep",
    displayName: "Shot Storyboard Prep",
    role: "shot-storyboard-prep",
    skillName: "shot-storyboard-prep",
    placeholderPrompt: "占位：后续从 restructure.final.md 提取 Shot 设计并生成故事板 prompt。",
    outputSummary: {
      status: "placeholder",
      targetArtifact: "Artifacts/FunctionSlotRestructure/<briefSlug-or-runId>/shot-storyboard-prompts.md",
    },
  },
};

function createFunctionSlotWorkflowPlaceholderService({ store, logger, jobStore, now = () => new Date().toISOString() } = {}) {
  if (!store) throw new Error("store is required for function-slot workflow placeholder service");
  if (!logger) throw new Error("logger is required for function-slot workflow placeholder service");
  if (!jobStore) throw new Error("jobStore is required for function-slot workflow placeholder service");

  async function enqueue(options = {}) {
    const definition = resolveDefinition(options.moduleId);
    await store.ensureRuntimeDirs?.();
    const sampleVideoId = normalizeSampleVideoId(options.sampleVideoId);
    const traceContext = nextStage(createTraceIds());
    const artifactId = options.artifactId ?? `artifact_${randomUUID()}`;
    const parentArtifactId = options.parentArtifactId ?? null;
    const job = jobStore.createJob({ sampleVideoId, traceId: traceContext.traceId });
    runPlaceholderStage({
      definition,
      sampleVideoId,
      job,
      traceContext,
      artifactId,
      parentArtifactId,
      body: options.body ?? {},
      now,
    }).catch(async (error) => {
      await markFailed({ definition, job, traceContext, artifactId, parentArtifactId, error });
    });
    return {
      processingJobId: job.jobId,
      sampleVideoId,
      traceId: traceContext.traceId,
      runId: traceContext.runId,
      stageId: traceContext.stageId,
      artifactId,
      parentArtifactId,
      status: "placeholder",
      message: `${definition.displayName} 暂未接入真实执行，已创建占位任务。`,
    };
  }

  async function runPlaceholderStage({ definition, sampleVideoId, job, traceContext, artifactId, parentArtifactId, body, now }) {
    const startedAt = Date.now();
    const inputSummary = {
      moduleId: definition.moduleId,
      role: definition.role,
      sampleVideoId,
      parentArtifactId,
      bodyKeys: Object.keys(body).sort(),
      promptMode: "placeholder",
    };
    jobStore.updateJob(job.jobId, {
      stage: definition.stageName,
      status: SAMPLE_STATUS.processing,
      progress: 40,
      runId: traceContext.runId,
      stageId: traceContext.stageId,
      moduleId: definition.moduleId,
      artifactId,
      parentArtifactId,
    });
    await logger.writeStageLog({
      traceContext,
      event: "stage.start",
      stageName: definition.stageName,
      artifactId,
      parentArtifactId,
      inputSummary,
    });
    const artifact = await writePlaceholderArtifact({
      definition,
      sampleVideoId,
      traceContext,
      artifactId,
      parentArtifactId,
      inputSummary,
      now,
    });
    const outputSummary = {
      ...definition.outputSummary,
      artifactId,
      artifactType: definition.artifactType,
      uri: artifact.uri,
    };
    await logger.writeStageLog({
      traceContext,
      event: "stage.end",
      stageName: definition.stageName,
      artifactId,
      parentArtifactId,
      outputSummary,
      durationMs: Date.now() - startedAt,
    });
    jobStore.updateJob(job.jobId, {
      stage: "placeholder_done",
      status: SAMPLE_STATUS.processed,
      progress: 100,
      runId: traceContext.runId,
      stageId: traceContext.stageId,
      artifactId,
      parentArtifactId,
      placeholder: true,
      placeholderResult: artifact,
    });
  }

  async function writePlaceholderArtifact({ definition, sampleVideoId, traceContext, artifactId, parentArtifactId, inputSummary, now }) {
    const artifactDir = path.join(store.sampleDir(sampleVideoId), definition.artifactDir, artifactId);
    const artifactPath = path.join(artifactDir, "artifact.json");
    const createdAt = now();
    const artifact = {
      artifactId,
      parentArtifactId,
      artifactType: definition.artifactType,
      type: definition.artifactType,
      stageName: definition.stageName,
      sampleVideoId,
      runId: traceContext.runId,
      traceId: traceContext.traceId,
      stageId: traceContext.stageId,
      status: "placeholder",
      createdAt,
      moduleId: definition.moduleId,
      displayName: definition.displayName,
      role: definition.role,
      skillName: definition.skillName,
      prompt: {
        mode: "placeholder",
        text: definition.placeholderPrompt,
      },
      inputSummary,
      outputSummary: definition.outputSummary,
      message: `${definition.displayName} 暂未接入真实执行。`,
    };
    await store.writeJson(artifactPath, artifact);
    return {
      ...artifact,
      uri: store.runtimeUri(artifactPath),
    };
  }

  async function markFailed({ definition, job, traceContext, artifactId, parentArtifactId, error }) {
    const errorSummary = {
      code: error?.code ?? "function_slot_placeholder_failed",
      message: error?.message ?? "占位任务失败",
      stageName: definition.stageName,
      retryable: true,
      debugSnapshotUri: null,
    };
    const snapshot = await logger.writeDebugSnapshot({
      traceContext,
      stageName: definition.stageName,
      artifactId,
      parentArtifactId,
      reason: "function_slot_placeholder_failed",
      inputSummary: { moduleId: definition.moduleId },
      outputSummary: null,
      debugPayload: {
        code: errorSummary.code,
        message: errorSummary.message,
      },
    }).catch(() => null);
    const finalError = { ...errorSummary, debugSnapshotUri: snapshot?.uri ?? null };
    await logger.writeStageLog({
      traceContext,
      event: "stage.fail",
      stageName: definition.stageName,
      artifactId,
      parentArtifactId,
      errorSummary: finalError,
    }).catch(() => undefined);
    jobStore.updateJob(job.jobId, {
      stage: definition.stageName,
      status: SAMPLE_STATUS.failed,
      progress: 100,
      errorSummary: finalError,
    });
  }

  return { enqueue };
}

function resolveDefinition(moduleId) {
  const definition = MODULES[moduleId];
  if (!definition) {
    const error = new Error("未知功能槽位占位模块");
    error.statusCode = 404;
    error.code = "function_slot_placeholder_module_not_found";
    throw error;
  }
  return definition;
}

function normalizeSampleVideoId(sampleVideoId) {
  const value = String(sampleVideoId ?? "function-slot-workflow").trim();
  return value || "function-slot-workflow";
}

module.exports = {
  MODULES,
  createFunctionSlotWorkflowPlaceholderService,
};
