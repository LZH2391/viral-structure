const { appendAnalysisHistory } = require("../analysis-runtime-v2/analysis-history");

function appendUserMaterialPackHistory(history, analysis, traceMeta) {
  return appendAnalysisHistory(history, analysis, {
    ...traceMeta,
    sourceArtifactId: traceMeta?.sourceArtifactId ?? analysis?.sourceUserMaterialPackArtifactId ?? null,
  }, (item) => ({
    shotCardCount: item?.shotCards?.length ?? 0,
    materialGroupCount: item?.materialGroups?.length ?? 0,
    proofCoverageCount: item?.proofCoverage?.length ?? 0,
  }));
}

module.exports = {
  appendUserMaterialPackHistory,
};
