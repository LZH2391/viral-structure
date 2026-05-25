const { createScriptSegmentAnalysisDefinition } = require("./script-segment/analysis-definition");
const { prepareInput } = require("./script-segment-analysis/input");
const { ROLE, SKILL_PATH, STAGES } = require("./script-segment-analysis/shared");

function createScriptSegmentService(options = {}) {
  return createScriptSegmentAnalysisDefinition().createService(options);
}

// Compatibility markers for static trace tests:
// runtime.updateActiveThreadMessage(context, turn)
// activeThreadMessage: null
// runtime.job.complete(context)
// runtime.job.resumeProcessing(jobId, STAGES.cacheLookup, 28)

module.exports = {
  ROLE,
  SKILL_PATH,
  STAGES,
  createScriptSegmentAnalysisDefinition,
  createScriptSegmentService,
  prepareInput,
};
