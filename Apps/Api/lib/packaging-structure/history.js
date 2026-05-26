const { appendAnalysisHistory } = require("../analysis-runtime-v2/analysis-history");

function appendPackagingStructureHistory(history, analysis, traceMeta) {
  return appendAnalysisHistory(history, analysis, {
    ...traceMeta,
    sourceArtifactId: traceMeta?.sourceArtifactId ?? analysis?.sourcePackagingStructureArtifactId ?? null,
  }, (item) => ({
    packagingBlockCount: item?.packagingBlocks?.length ?? 0,
    shotPackagingNoteCount: item?.shotPackagingNotes?.length ?? 0,
  }));
}

module.exports = {
  appendPackagingStructureHistory,
};
