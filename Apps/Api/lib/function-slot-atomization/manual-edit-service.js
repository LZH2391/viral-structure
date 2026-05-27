const { createHash, randomUUID } = require("crypto");
const path = require("path");
const { createTraceContext } = require("../../../../Core/Workspace/sample-video-contracts");
const { createTraceIds, nextStage } = require("../../../../Infrastructure/Observability/trace");
const { createMaterializeRuntime } = require("../analysis-runtime-v2/materialize-runtime");
const { createAnalysisFinalOutputStore } = require("../stores/analysis-final-output-store");
const { validateFunctionSlotAtomization } = require("../function-slot-atomization-analysis/validation");
const { summarizeAgentOutput } = require("../function-slot-atomization-analysis/shared");
const { attachFunctionSlotAtomizationAnalysis } = require("./artifact-writer");

const STAGE_NAME = "function_slot_atomization.manual_boundary_edit";

function createFunctionSlotAtomizationManualEditService({
  rootDir,
  store,
  logger,
  artifactIndex,
  projectionService = null,
} = {}) {
  async function applyBoundaryManualEdit({
    sampleVideoId,
    editedJsonText,
    editedJson,
    expectedArtifactId = null,
    sourceBoundaryReviewArtifactId = null,
  }) {
    const traceContext = createTraceContext(createTraceIds());
    const startedAt = Date.now();
    const artifactPath = path.join(store.sampleDir(sampleVideoId), "artifact.json");
    const artifact = await store.readJson(artifactPath);
    const current = artifact?.functionSlotAtomizationAnalysis ?? null;
    const inputSummary = {
      sampleVideoId,
      expectedArtifactId,
      currentArtifactId: current?.artifactId ?? null,
      sourceBoundaryReviewArtifactId,
      boundaryReviewDecision: current?.boundaryReview?.decision ?? null,
      boundaryReviewArtifactId: current?.boundaryReview?.artifactId ?? null,
    };
    await logger.writeStageLog({
      traceContext,
      stageName: STAGE_NAME,
      event: "stage.start",
      artifactId: current?.artifactId ?? null,
      parentArtifactId: current?.parentArtifactId ?? null,
      inputSummary,
    });
    try {
      assertEditable(current, { expectedArtifactId, sourceBoundaryReviewArtifactId });
      const parsed = parseEditedJson({ editedJsonText, editedJson });
      const validation = validateFunctionSlotAtomization(parsed.value);
      if (!validation.ok) {
        throw badRequest("function_slot_atomization_manual_edit_validation_failed", "手动修正 JSON 未通过原子化结构校验", {
          validation: validation.summary,
          outputSummary: summarizeAgentOutput(parsed.text, parsed.value),
        });
      }
      const analysis = buildManualAnalysis({
        current,
        parsed,
        validation,
        traceContext,
      });
      const nextArtifact = await attachFunctionSlotAtomizationAnalysis(sampleVideoId, analysis, store, {
        traceId: traceContext.traceId,
        sourceTraceId: current.traceId ?? artifact?.trace?.traceId ?? null,
      });
      const materializeRuntime = createMaterializeRuntime({
        artifactIndex,
        resolveExistingFileHash: async () => (await artifactIndex.getItem(sampleVideoId).catch(() => null))?.fileHash ?? null,
        finalOutputStore: createAnalysisFinalOutputStore({ store, rootDir }),
        projectionService,
        logger,
      });
      await materializeRuntime.registerSampleArtifact({
        sampleVideoId,
        cacheKind: null,
        finalOutputText: parsed.text,
        traceContext: nextStage(traceContext),
        activeStage: { stageName: STAGE_NAME },
        nextStage,
      }, nextArtifact);
      await logger.writeStageLog({
        traceContext,
        stageName: STAGE_NAME,
        event: "stage.end",
        artifactId: analysis.artifactId,
        parentArtifactId: analysis.parentArtifactId,
        outputSummary: {
          artifactId: analysis.artifactId,
          sourceFunctionSlotAtomizationArtifactId: analysis.sourceFunctionSlotAtomizationArtifactId,
          slotCount: analysis.slotMap.slots.length,
          boundaryReviewDecision: analysis.boundaryReview?.decision ?? null,
        },
        durationMs: Date.now() - startedAt,
      });
      return {
        sampleArtifact: nextArtifact,
        analysis,
        traceId: traceContext.traceId,
      };
    } catch (error) {
      const snapshot = await logger.writeDebugSnapshot({
        traceContext,
        stageName: STAGE_NAME,
        artifactId: current?.artifactId ?? null,
        parentArtifactId: current?.parentArtifactId ?? null,
        reason: error?.code ?? "function_slot_atomization_manual_edit_failed",
        inputSummary,
        outputSummary: error?.debugPayload?.outputSummary ?? null,
        debugPayload: {
          code: error?.code ?? null,
          message: error instanceof Error ? error.message : String(error ?? "manual edit failed").slice(0, 240),
          validation: error?.debugPayload?.validation ?? null,
          outputSummary: error?.debugPayload?.outputSummary ?? null,
        },
      });
      await logger.writeStageLog({
        traceContext,
        stageName: STAGE_NAME,
        event: "stage.fail",
        artifactId: current?.artifactId ?? null,
        parentArtifactId: current?.parentArtifactId ?? null,
        errorSummary: {
          code: error?.code ?? "function_slot_atomization_manual_edit_failed",
          message: error instanceof Error ? error.message : "手动修正失败",
          debugSnapshotUri: snapshot.uri,
          retryable: false,
        },
        durationMs: Date.now() - startedAt,
      });
      error.traceId = traceContext.traceId;
      error.debugSnapshotUri = snapshot.uri;
      throw error;
    }
  }

  return { applyBoundaryManualEdit };
}

function assertEditable(current, { expectedArtifactId, sourceBoundaryReviewArtifactId }) {
  if (!current || current.status !== "processed") {
    throw badRequest("function_slot_atomization_manual_edit_source_missing", "当前样例没有可手动修正的原子化结果");
  }
  if (expectedArtifactId && current.artifactId !== expectedArtifactId) {
    throw conflict("function_slot_atomization_manual_edit_stale", "原子化结果已更新，请刷新后再提交", {
      expectedArtifactId,
      actualArtifactId: current.artifactId,
    });
  }
  const review = current.boundaryReview ?? null;
  if (!review || review.decision !== "rework") {
    throw conflict("function_slot_atomization_manual_edit_not_rework", "当前原子化结果不需要人工边界修正");
  }
  if (sourceBoundaryReviewArtifactId && review.artifactId !== sourceBoundaryReviewArtifactId) {
    throw conflict("function_slot_atomization_manual_edit_review_stale", "边界审查结果已更新，请刷新后再提交", {
      expectedBoundaryReviewArtifactId: sourceBoundaryReviewArtifactId,
      actualBoundaryReviewArtifactId: review.artifactId ?? null,
    });
  }
  if (!isSecondReviewRework(current)) {
    throw conflict("function_slot_atomization_manual_edit_before_rework_limit", "自动返工尚未达到人工接管条件");
  }
}

function isSecondReviewRework(analysis) {
  const reviewAttemptCount = Number(analysis?.boundaryReview?.reviewAttemptCount ?? 0);
  const boundaryReworkAttemptCount = Number(analysis?.validation?.boundaryReworkAttemptCount ?? 0);
  const reviewHistory = Array.isArray(analysis?.boundaryReviewHistory) ? analysis.boundaryReviewHistory : [];
  return reviewAttemptCount >= 2
    || boundaryReworkAttemptCount >= 1
    || reviewHistory.filter((item) => item?.decision === "rework").length >= 2;
}

function parseEditedJson({ editedJsonText, editedJson }) {
  if (editedJsonText != null) {
    const text = String(editedJsonText).trim();
    if (!text) throw badRequest("function_slot_atomization_manual_edit_empty_json", "手动修正 JSON 不能为空");
    try {
      return { value: JSON.parse(text), text: `${text}\n` };
    } catch (error) {
      throw badRequest("function_slot_atomization_manual_edit_parse_failed", "手动修正 JSON 不是合法 JSON object", {
        validation: {
          validatorCode: "function_slot_atomization_manual_edit_parse_failed",
          message: error instanceof Error ? error.message : String(error ?? "JSON parse failed"),
          path: "$",
        },
      });
    }
  }
  if (editedJson && typeof editedJson === "object" && !Array.isArray(editedJson)) {
    return { value: editedJson, text: `${JSON.stringify(editedJson, null, 2)}\n` };
  }
  throw badRequest("function_slot_atomization_manual_edit_empty_json", "手动修正 JSON 不能为空");
}

function buildManualAnalysis({ current, parsed, validation, traceContext }) {
  const createdAt = new Date().toISOString();
  const previousReview = current.boundaryReview ?? null;
  const reviewHistory = Array.isArray(current.boundaryReviewHistory) ? current.boundaryReviewHistory : [];
  return {
    artifactId: `artifact_${randomUUID()}`,
    parentArtifactId: current.artifactId ?? current.parentArtifactId ?? null,
    traceId: traceContext.traceId,
    type: "function-slot-atomization-analysis",
    status: "processed",
    resultOrigin: "manual_boundary_edit",
    stageName: STAGE_NAME,
    sampleVideoId: current.sampleVideoId ?? null,
    sourceScriptSegmentArtifactId: current.sourceScriptSegmentArtifactId ?? null,
    sourceRhythmStructureArtifactId: current.sourceRhythmStructureArtifactId ?? null,
    sourcePackagingStructureArtifactId: current.sourcePackagingStructureArtifactId ?? null,
    sourceShotBoundaryArtifactId: current.sourceShotBoundaryArtifactId ?? null,
    sourceFunctionSlotAtomizationArtifactId: current.artifactId ?? null,
    cacheKey: current.cacheKey ?? null,
    inputPackage: current.inputPackage ?? null,
    atomInventory: validation.analysis.atomInventory,
    slotMap: validation.analysis.slotMap,
    bindingGraph: validation.analysis.bindingGraph,
    conflictChecks: validation.analysis.conflictChecks,
    recombinationRules: validation.analysis.recombinationRules,
    recompositionTemplates: validation.analysis.recompositionTemplates,
    validation: {
      status: "passed",
      ...validation.summary,
      repairAttemptCount: current.validation?.repairAttemptCount ?? 0,
      boundaryReworkAttemptCount: current.validation?.boundaryReworkAttemptCount ?? 0,
      manualEdit: true,
    },
    boundaryReview: previousReview ? {
      ...previousReview,
      manuallyResolved: true,
      manualResolvedAt: createdAt,
    } : null,
    boundaryReviewHistory: reviewHistory,
    boundaryRework: current.boundaryRework ?? null,
    manualBoundaryEdit: {
      sourceFunctionSlotAtomizationArtifactId: current.artifactId ?? null,
      sourceBoundaryReviewArtifactId: previousReview?.artifactId ?? null,
      sourceBoundaryReviewDecision: previousReview?.decision ?? null,
      sourceBoundaryReviewIssueCount: Array.isArray(previousReview?.issues) ? previousReview.issues.length : 0,
      fieldPaths: collectIssueFieldPaths(previousReview),
      contentHash: createHash("sha256").update(parsed.text, "utf8").digest("hex"),
      createdAt,
    },
    agent: {
      provider: "manual",
      role: "human-boundary-editor",
      skillPath: null,
      skillHash: null,
      threadId: null,
      leaseId: null,
      turnId: null,
      profileVersion: null,
      promptTemplateId: null,
      promptTemplateVersion: null,
      promptTemplateHash: null,
    },
    reason: null,
    debugSnapshotUri: null,
    createdAt,
  };
}

function collectIssueFieldPaths(review) {
  const issues = Array.isArray(review?.issues) ? review.issues : [];
  return Array.from(new Set(issues.flatMap((issue) => issue?.fieldPaths ?? issue?.field_paths ?? []))).slice(0, 80);
}

function badRequest(code, message, debugPayload = null) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = 400;
  error.retryable = false;
  error.debugPayload = debugPayload;
  return error;
}

function conflict(code, message, debugPayload = null) {
  const error = badRequest(code, message, debugPayload);
  error.statusCode = 409;
  return error;
}

module.exports = {
  STAGE_NAME,
  createFunctionSlotAtomizationManualEditService,
  isSecondReviewRework,
  parseEditedJson,
};
