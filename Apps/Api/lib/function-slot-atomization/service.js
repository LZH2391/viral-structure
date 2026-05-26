const { createFunctionSlotAtomizationAnalysisDefinition } = require("./analysis-definition");
const { prepareInput } = require("../function-slot-atomization-analysis/input");
const { ROLE, SKILL_PATH, STAGES } = require("../function-slot-atomization-analysis/shared");

function createFunctionSlotAtomizationService(options = {}) {
  return createFunctionSlotAtomizationAnalysisDefinition().createService(options);
}

module.exports = {
  ROLE,
  SKILL_PATH,
  STAGES,
  createFunctionSlotAtomizationAnalysisDefinition,
  createFunctionSlotAtomizationService,
  prepareInput,
};
