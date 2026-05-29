const { createSampleIngestModuleDefinition } = require("../sample-processing/module-definition");
const { createShotBoundaryModuleDefinition } = require("../shot-boundary/module-definition");
const { createScriptSegmentAnalysisDefinition } = require("../script-segment/analysis-definition");
const { createRhythmStructureAnalysisDefinition } = require("../rhythm-structure/analysis-definition");
const { createPackagingStructureAnalysisDefinition } = require("../packaging-structure/analysis-definition");
const { createFunctionSlotAtomizationAnalysisDefinition } = require("../function-slot-atomization/analysis-definition");
const { createImageGenerationModuleDefinition } = require("../image-generation/module-definition");
const {
  createFunctionSlotSemanticGovernanceModuleDefinition,
  createFunctionSlotRestructureModuleDefinition,
  createShotStoryboardPrepModuleDefinition,
} = require("../function-slot-workflow/module-definitions");

const MODULE_DEFINITIONS = [
  createSampleIngestModuleDefinition(),
  createShotBoundaryModuleDefinition(),
  createScriptSegmentAnalysisDefinition(),
  createRhythmStructureAnalysisDefinition(),
  createPackagingStructureAnalysisDefinition(),
  createFunctionSlotAtomizationAnalysisDefinition(),
  createFunctionSlotSemanticGovernanceModuleDefinition(),
  createFunctionSlotRestructureModuleDefinition(),
  createShotStoryboardPrepModuleDefinition(),
  createImageGenerationModuleDefinition(),
];

module.exports = {
  MODULE_DEFINITIONS,
};
