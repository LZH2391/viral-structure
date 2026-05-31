const { createAnalysisArtifactAttacher } = require("../analysis-runtime-v2/artifact-writer");
const { appendUserMaterialPackHistory } = require("./history");

const attachUserMaterialPack = createAnalysisArtifactAttacher({
  analysisKey: "userMaterialPack",
  analysisRefKey: "userMaterialPackRef",
  historyKey: "userMaterialPackHistory",
  resultKind: "user_material_pack",
  appendHistory: appendUserMaterialPackHistory,
  resolveSourceArtifactId: (analysis) => analysis?.sourceUserMaterialPackArtifactId ?? null,
});

module.exports = {
  attachUserMaterialPack,
};
