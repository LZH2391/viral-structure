const { appendAnalysisHistory } = require("../analysis-runtime-v2/analysis-history");

function appendScriptSegmentHistory(history, analysis, traceMeta) {
  return appendAnalysisHistory(history, analysis, {
    ...traceMeta,
    sourceArtifactId: traceMeta?.sourceArtifactId ?? analysis?.sourceScriptSegmentArtifactId ?? null,
  }, (item) => ({
    segmentCount: item?.segments?.length ?? 0,
  }));
}

module.exports = {
  appendScriptSegmentHistory,
};
