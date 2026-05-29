const { createModuleDefinition } = require("../modules/definition");
const { createImageGenerationService } = require("./service");
const { STAGES } = require("./debug");

function createImageGenerationModuleDefinition() {
  return createModuleDefinition({
    moduleId: "image-generation",
    moduleKind: "asset-generation",
    serviceKey: "imageGenerationService",
    executorKind: "local-service",
    cacheKind: null,
    route: "/api/sample-videos/:sampleVideoId/image-generation",
    dependencies: [],
    artifact: {
      key: "imageGenerationArtifact",
      historyKey: "imageGenerationHistory",
      type: "image-generation",
    },
    stages: STAGES,
    ui: {
      label: "image-generation",
      stageKind: "imageGeneration",
      displayName: "生图",
      stageId: STAGES.providerRequested,
      completeReason: "生图完成",
      refreshReason: "生图重新生成",
      reuseReason: "生图复用缓存",
      invalidResultMessage: "生图未返回有效产物",
      failureMessage: "生图失败",
      timeoutMessage: "生图超时",
    },
    supportsCacheReuse: false,
    supportsRerun: true,
    artifactPolicy: "required",
    getArtifact: (artifact) => artifact?.imageGenerationArtifact ?? null,
    startOptionsFromBody: ({ sampleVideoId, body = {} }) => ({
      sampleVideoId,
      prompt: body.prompt,
      storyboard: body.storyboard,
      groupId: body.groupId,
      selectedShots: Array.isArray(body.selectedShots) ? body.selectedShots : [],
      parentArtifactId: body.parentArtifactId ?? null,
      size: body.size,
      quality: body.quality,
      background: body.background,
      outputFormat: body.outputFormat,
      n: body.n,
      timeoutSeconds: body.timeoutSeconds,
    }),
    createService: (options = {}) => {
      if (options.imageGenerationService) return options.imageGenerationService;
      return createImageGenerationService(options);
    },
  });
}

module.exports = {
  createImageGenerationModuleDefinition,
};
