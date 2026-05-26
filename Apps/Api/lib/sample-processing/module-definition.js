const { createModuleDefinition } = require("../modules/definition");
const { STAGES } = require("./debug");

function createSampleIngestModuleDefinition() {
  return createModuleDefinition({
    moduleId: "sample-ingest",
    moduleKind: "sample-ingest",
    serviceKey: "sampleProcessingService",
    executorKind: "local-service",
    cacheKind: "sample",
    route: "/api/workspaces/:workspaceId/sample-videos",
    dependencies: [],
    artifact: {
      key: "sampleVideo",
      historyKey: null,
      type: "sample-video",
    },
    stages: STAGES,
    ui: {
      label: "sample-ingest",
      stageKind: "upload",
      displayName: "上传",
      stageId: "upload.ingest",
      completeReason: "样例导入完成",
      refreshReason: "样例重新处理",
      reuseReason: "样例复用缓存",
      invalidResultMessage: "样例导入未返回有效产物",
      failureMessage: "样例导入失败",
      timeoutMessage: "样例导入超时",
    },
    supportsCacheReuse: true,
    supportsRerun: false,
    artifactPolicy: "required",
    getArtifact: (artifact) => artifact?.sampleVideo ?? null,
    createService: (options = {}) => {
      if (!options.sampleProcessingService) throw new Error("sampleProcessingService is required for sample-ingest module");
      return options.sampleProcessingService;
    },
  });
}

module.exports = {
  createSampleIngestModuleDefinition,
};
