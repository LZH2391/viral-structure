const { createPackagingStructureAnalysisDefinition } = require("./packaging-structure/analysis-definition");
const { prepareInput } = require("./packaging-structure-analysis/input");
const { ROLE, SKILL_PATH, STAGES } = require("./packaging-structure-analysis/shared");

function createPackagingStructureService(options = {}) {
  return createPackagingStructureAnalysisDefinition().createService(options);
}

module.exports = {
  ROLE,
  SKILL_PATH,
  STAGES,
  createPackagingStructureAnalysisDefinition,
  createPackagingStructureService,
  prepareInput,
};
