const { createShotBoundaryDependentCacheHandlers } = require("../analysis-runtime-v2/shot-boundary-cache");
const { buildRhythmStructureCacheParams } = require("../rhythm-structure-analysis/cache-params");

module.exports = createShotBoundaryDependentCacheHandlers({
  cacheKind: "rhythm_structure",
  cacheTag: "节奏结构",
  buildCacheParams: buildRhythmStructureCacheParams,
  selectAnalysis: (artifact) => artifact?.rhythmStructureAnalysis ?? null,
  buildCounts: (analysis) => ({
    sectionCount: analysis?.sections?.length ?? 0,
  }),
  missingSourceCode: "rhythm_structure_cache_source_missing",
  missingSourceMessage: "节奏结构缓存来源缺失，请重新生成",
  notReusableCode: "rhythm_structure_cache_not_reusable",
  notReusableMessage: "节奏结构缓存不可复用，请重新生成",
});
