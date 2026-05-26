const { createShotBoundaryDependentCacheHandlers } = require("../analysis-runtime-v2/shot-boundary-cache");
const { buildPackagingStructureCacheParams } = require("../packaging-structure-analysis/cache-params");

module.exports = createShotBoundaryDependentCacheHandlers({
  cacheKind: "packaging_structure",
  cacheTag: "包装结构",
  buildCacheParams: buildPackagingStructureCacheParams,
  selectAnalysis: (artifact) => artifact?.packagingStructureAnalysis ?? null,
  buildCounts: (analysis) => ({
    packagingBlockCount: analysis?.packagingBlocks?.length ?? 0,
    shotPackagingNoteCount: analysis?.shotPackagingNotes?.length ?? 0,
  }),
  missingSourceCode: "packaging_structure_cache_source_missing",
  missingSourceMessage: "包装结构缓存来源缺失，请重新生成",
  notReusableCode: "packaging_structure_cache_not_reusable",
  notReusableMessage: "包装结构缓存不可复用，请重新生成",
});
