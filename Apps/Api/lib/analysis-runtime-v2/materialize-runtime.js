const { MODULE_ARTIFACTS } = require("../modules/artifact-catalog");

function createMaterializeRuntime({ artifactIndex, resolveExistingFileHash, finalOutputStore = null, projectionService = null, logger = null }) {
  async function registerSampleArtifact(context, artifact) {
    await artifactIndex.registerSampleArtifact({
      artifact,
      fileHash: await resolveExistingFileHash(context.sampleVideoId, artifactIndex),
      traceId: context.traceContext.traceId,
    });
    await writeLatestFinalOutput(context, artifact);
    await writeFunctionSlotProjection(context, artifact);
    return artifact;
  }

  async function writeLatestFinalOutput(context, artifact) {
    if (!finalOutputStore?.writeFinalOutput) return null;
    const analysis = latestAnalysisFromArtifact(artifact, context.cacheKind);
    if (!analysis) return null;
    return finalOutputStore.writeFinalOutput({
      sampleVideoId: context.sampleVideoId,
      analysis,
      finalOutputText: context.finalOutputText ?? null,
      traceId: context.traceContext?.traceId ?? null,
      stageName: context.activeStage?.stageName ?? analysis?.stageName ?? null,
    });
  }

  async function writeFunctionSlotProjection(context, artifact) {
    if (!projectionService?.projectArtifact || !artifact?.functionSlotAtomizationAnalysis) return null;
    const traceContext = context.nextStage(context.traceContext);
    const analysis = artifact.functionSlotAtomizationAnalysis;
    const stageName = "function_slot_projection.materialize";
    const startedAt = Date.now();
    const inputSummary = {
      sampleVideoId: context.sampleVideoId,
      functionSlotAtomizationArtifactId: analysis.artifactId ?? null,
      slotCount: analysis.slotMap?.slots?.length ?? 0,
    };
    await logger?.writeStageLog?.({
      traceContext,
      stageName,
      event: "stage.start",
      artifactId: analysis.artifactId ?? null,
      parentArtifactId: analysis.parentArtifactId ?? null,
      inputSummary,
    });
    try {
      const projection = await projectionService.projectArtifact(artifact);
      await logger?.writeStageLog?.({
        traceContext,
        stageName,
        event: "stage.end",
        artifactId: analysis.artifactId ?? null,
        parentArtifactId: analysis.parentArtifactId ?? null,
        outputSummary: projection,
        durationMs: Date.now() - startedAt,
      });
      return projection;
    } catch (error) {
      const errorSummary = {
        code: "function_slot_projection_failed",
        message: "功能槽位投影写入失败，artifact 已保留，可稍后重建投影",
        stageName,
        retryable: true,
      };
      const snapshot = await logger?.writeDebugSnapshot?.({
        traceContext,
        stageName,
        artifactId: analysis.artifactId ?? null,
        parentArtifactId: analysis.parentArtifactId ?? null,
        reason: errorSummary.code,
        inputSummary,
        outputSummary: null,
        debugPayload: {
          code: error?.code ?? null,
          message: error instanceof Error ? error.message : String(error ?? "unknown").slice(0, 240),
          artifactId: analysis.artifactId ?? null,
          sampleVideoId: context.sampleVideoId,
        },
      });
      await logger?.writeStageLog?.({
        traceContext,
        stageName,
        event: "stage.fail",
        artifactId: analysis.artifactId ?? null,
        parentArtifactId: analysis.parentArtifactId ?? null,
        errorSummary: {
          ...errorSummary,
          debugSnapshotUri: snapshot?.uri ?? null,
        },
        durationMs: Date.now() - startedAt,
      });
      return null;
    }
  }

  return {
    registerSampleArtifact,
  };
}

function latestAnalysisFromArtifact(artifact, cacheKind) {
  const module = MODULE_ARTIFACTS.find((entry) => entry.cacheKind === cacheKind);
  if (module?.getArtifact) return module.getArtifact(artifact);
  for (const entry of MODULE_ARTIFACTS) {
    const analysis = entry.getArtifact?.(artifact);
    if (analysis) return analysis;
  }
  return null;
}

module.exports = {
  createMaterializeRuntime,
};
