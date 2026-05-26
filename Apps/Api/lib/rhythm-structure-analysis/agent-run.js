const { createAgentRunBuilders } = require("../analysis-runtime-v2/agent-run");
const { ROLE, SKILL_PATH } = require("./shared");

module.exports = createAgentRunBuilders({
  role: ROLE,
  skillPath: SKILL_PATH,
  buildPreparedInputSummary: ({ context, input }) => ({
    shotCount: input.shots.length,
    sheetCount: context.inputPackage?.sheetCount ?? 0,
    emptyShotCount: context.inputPackage?.emptyShotCount ?? 0,
  }),
});
