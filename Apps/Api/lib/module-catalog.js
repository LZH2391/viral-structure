const { createScriptSegmentAnalysisDefinition } = require("./script-segment/analysis-definition");
const { createRhythmStructureAnalysisDefinition } = require("./rhythm-structure/analysis-definition");
const { createPackagingStructureAnalysisDefinition } = require("./packaging-structure/analysis-definition");

const MODULE_DEFINITIONS = [
  createScriptSegmentAnalysisDefinition(),
  createRhythmStructureAnalysisDefinition(),
  createPackagingStructureAnalysisDefinition(),
];

module.exports = {
  MODULE_DEFINITIONS,
};
