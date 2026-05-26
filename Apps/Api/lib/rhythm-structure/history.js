const { appendAnalysisHistory } = require("../analysis-runtime-v2/analysis-history");

function appendRhythmStructureHistory(history, analysis, traceMeta) {
  return appendAnalysisHistory(history, analysis, {
    ...traceMeta,
    sourceArtifactId: traceMeta?.sourceArtifactId ?? analysis?.sourceRhythmStructureArtifactId ?? null,
  }, (item) => ({
    sectionCount: item?.sections?.length ?? 0,
  }));
}

module.exports = {
  appendRhythmStructureHistory,
};
