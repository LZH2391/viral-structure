const {
  createAnalysisRuntimeV2,
  assertExpectedArtifact,
  buildActiveThreadMessage,
  isPendingTurnStatus,
} = require("../analysis-runtime-v2");

function createAnalysisRuntime(options) {
  return createAnalysisRuntimeV2(options);
}

module.exports = {
  createAnalysisRuntime,
  assertExpectedArtifact,
  buildActiveThreadMessage,
  isPendingTurnStatus,
};
