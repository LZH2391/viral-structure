const { createAgentRunBuilders } = require("../analysis-runtime-v2/agent-run");
const { ROLE, SKILL_PATH } = require("./shared");

module.exports = createAgentRunBuilders({
  role: ROLE,
  skillPath: SKILL_PATH,
  buildPreparedInputSummary: ({ input }) => ({
    scriptSegmentCount: input.scriptSegmentAnalysis?.segments?.length ?? 0,
    rhythmSectionCount: input.rhythmStructureAnalysis?.sections?.length ?? 0,
    packagingBlockCount: input.packagingStructureAnalysis?.packagingBlocks?.length ?? 0,
  }),
});
