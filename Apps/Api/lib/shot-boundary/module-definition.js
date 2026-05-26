const { createModuleDefinition } = require("../module-definition");
const { STAGES } = require("../shot-boundary-service");
const { buildShotBoundaryCacheParams } = require("../shot-boundary-analysis");

function createShotBoundaryModuleDefinition() {
  return createModuleDefinition({
    moduleId: "shot-boundary",
    moduleKind: "sample-understanding",
    serviceKey: "shotBoundaryService",
    executorKind: "threadpool-role",
    cacheKind: "shot_boundary",
    route: "/api/sample-videos/:sampleVideoId/shot-boundary",
    dependencies: [{
      key: "sampleVideoArtifactId",
      artifactKey: "sampleVideo",
      requestKey: "expectedSampleVideoArtifactId",
      label: "样例视频",
    }],
    artifact: {
      key: "shotBoundaryAnalysis",
      historyKey: "shotBoundaryAnalysisHistory",
      type: "shot-boundary-analysis",
    },
    stages: STAGES,
    ui: {
      label: "shot-boundary",
      stageKind: "shotBoundary",
      displayName: "切镜",
      stageId: "shot.boundary",
      completeReason: "切镜完成",
      refreshReason: "切镜重新生成",
      reuseReason: "切镜复用缓存",
      invalidResultMessage: "切镜分析未返回有效产物",
      failureMessage: "切镜分析失败",
      timeoutMessage: "切镜分析超时",
    },
    supportsCacheReuse: true,
    supportsRerun: true,
    artifactPolicy: "required",
    getArtifact: (artifact) => artifact?.shotBoundaryAnalysis ?? null,
    buildCacheParams: buildShotBoundaryStageParams,
    startOptionsFromBody: ({ sampleVideoId, body = {} }) => ({
      sampleVideoId,
      analysisFps: body.analysisFps ?? 10,
      cacheDecision: body.cacheDecision ?? "ask",
      enableReview: body.enableReview ?? true,
    }),
    createService: (options = {}) => {
      if (!options.shotBoundaryService) throw new Error("shotBoundaryService is required for shot-boundary module");
      return options.shotBoundaryService;
    },
  });
}

function buildShotBoundaryStageParams(artifact) {
  return buildShotBoundaryCacheParams({
    sourceArtifactId: artifact?.shotBoundaryAnalysis?.parentArtifactId ?? artifact?.sampleVideo?.artifactId ?? null,
    analysisSampling: artifact?.shotBoundaryAnalysis?.analysisSampling ?? null,
    subtitleContextSummary: artifact?.shotBoundaryAnalysis?.subtitleContextSummary ?? null,
    profileVersion: artifact?.shotBoundaryAnalysis?.agent?.profileVersion ?? null,
    promptTemplateId: artifact?.shotBoundaryAnalysis?.agent?.promptTemplateId ?? null,
    promptTemplateVersion: artifact?.shotBoundaryAnalysis?.agent?.promptTemplateVersion ?? null,
    promptTemplateHash: artifact?.shotBoundaryAnalysis?.agent?.promptTemplateHash ?? null,
    reviewMode: artifact?.shotBoundaryAnalysis?.agent?.reviewMode ?? (artifact?.shotBoundaryAnalysis?.agent?.enableReview === false ? "unreviewed" : "reviewed"),
    skillHash: artifact?.shotBoundaryAnalysis?.agent?.skillHash ?? null,
  });
}

module.exports = {
  createShotBoundaryModuleDefinition,
};
