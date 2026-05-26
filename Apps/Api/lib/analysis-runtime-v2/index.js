const { createStageRuntime } = require("./stage-runtime");
const { createJobRuntime } = require("./job-runtime");
const { createThreadRuntime } = require("./thread-runtime");
const { createMaterializeRuntime } = require("./materialize-runtime");
const { createAnalysisFinalOutputStore } = require("../stores/analysis-final-output-store");
const {
  buildUnifiedCachePrompt,
  buildDependencyRefs,
  buildAnalysisOptions,
  readCacheDependency,
  readCacheOption,
  resolveCacheSourceSampleVideoId,
} = require("./cache-runtime");
const {
  assertExpectedArtifact,
  buildRequiredArtifactRefs,
  readRequiredArtifactRef,
} = require("./dependency-contract");
const {
  buildActiveThreadMessage,
  isPendingTurnStatus,
} = require("./thread-message");

function createAnalysisRuntimeV2(options) {
  const stageRuntime = createStageRuntime(options);
  const jobRuntime = createJobRuntime({
    jobStore: options.jobStore,
    sampleStatus: options.sampleStatus,
  });
  const threadRuntime = createThreadRuntime({
    jobStore: options.jobStore,
  });
  const materializeRuntime = options.artifactIndex && options.resolveExistingFileHash
    ? createMaterializeRuntime({
      artifactIndex: options.artifactIndex,
      resolveExistingFileHash: options.resolveExistingFileHash,
      finalOutputStore: options.store ? createAnalysisFinalOutputStore({ store: options.store, rootDir: options.rootDir }) : null,
    })
    : null;

  return {
    ...stageRuntime,
    job: jobRuntime,
    thread: threadRuntime,
    materialize: materializeRuntime,
    updateActiveThreadMessage: threadRuntime.updateActiveThreadMessage,
  };
}

module.exports = {
  createAnalysisRuntimeV2,
  createAnalysisRuntime: createAnalysisRuntimeV2,
  assertExpectedArtifact,
  buildRequiredArtifactRefs,
  readRequiredArtifactRef,
  buildUnifiedCachePrompt,
  buildDependencyRefs,
  buildAnalysisOptions,
  readCacheDependency,
  readCacheOption,
  resolveCacheSourceSampleVideoId,
  buildActiveThreadMessage,
  isPendingTurnStatus,
};
