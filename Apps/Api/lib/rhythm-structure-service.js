const { createRhythmStructureAnalysisDefinition } = require("./rhythm-structure/analysis-definition");
const { prepareInput } = require("./rhythm-structure-analysis/input");
const { ROLE, SKILL_PATH, STAGES } = require("./rhythm-structure-analysis/shared");

function createRhythmStructureService(options = {}) {
  return createRhythmStructureAnalysisDefinition().createService(options);
}

module.exports = {
  ROLE,
  SKILL_PATH,
  STAGES,
  createRhythmStructureAnalysisDefinition,
  createRhythmStructureService,
  prepareInput,
};
