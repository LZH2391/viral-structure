const { createShotBoundaryDependentCacheHandlers } = require("../analysis-runtime-v2/shot-boundary-cache");
const { buildScriptSegmentCacheParams } = require("../script-segment-analysis/cache-params");

module.exports = createShotBoundaryDependentCacheHandlers({
  cacheKind: "script_segment",
  cacheTag: "脚本段落",
  buildCacheParams: buildScriptSegmentCacheParams,
  selectAnalysis: (artifact) => artifact?.scriptSegmentAnalysis ?? null,
  buildCounts: (analysis) => ({
    segmentCount: analysis?.segments?.length ?? 0,
  }),
  buildInputSummaryExtra: (context, input) => ({
    hasCommerceBrief: Boolean(input.commerceBrief),
  }),
  missingSourceCode: "script_segment_cache_source_missing",
  missingSourceMessage: "脚本段落缓存来源缺失，请重新生成",
  notReusableCode: "script_segment_cache_not_reusable",
  notReusableMessage: "脚本段落缓存不可复用，请重新生成",
});
