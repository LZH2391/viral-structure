const { createShotBoundaryDependentCacheHandlers } = require("../analysis-runtime-v2/shot-boundary-cache");
const { buildUserMaterialTaggerCacheParams } = require("../user-material-tagger-analysis/cache-params");

module.exports = createShotBoundaryDependentCacheHandlers({
  cacheKind: "user_material_pack",
  cacheTag: "素材识别",
  buildCacheParams: buildUserMaterialTaggerCacheParams,
  selectAnalysis: (artifact) => artifact?.userMaterialPack ?? null,
  buildCounts: (analysis) => ({
    shotCardCount: analysis?.shotCards?.length ?? 0,
    materialGroupCount: analysis?.materialGroups?.length ?? 0,
    proofCoverageCount: analysis?.proofCoverage?.length ?? 0,
  }),
  missingSourceCode: "user_material_pack_cache_source_missing",
  missingSourceMessage: "素材识别缓存来源缺失，请重新生成",
  notReusableCode: "user_material_pack_cache_not_reusable",
  notReusableMessage: "素材识别缓存不可复用，请重新生成",
});
