const { loadCurrentSampleArtifact } = require("../../stores/artifact-reader");
const { createWorkflowService } = require("../full-analysis/service");
const { MATERIAL_RECOGNITION_WORKFLOW_DESCRIPTOR } = require("./descriptor");

const WORKFLOW_KEY = MATERIAL_RECOGNITION_WORKFLOW_DESCRIPTOR.workflowId;
const WORKFLOW_VERSION = MATERIAL_RECOGNITION_WORKFLOW_DESCRIPTOR.version;

function createMaterialRecognitionWorkflowService(options) {
  return createWorkflowService({
    ...options,
    workflowDescriptor: MATERIAL_RECOGNITION_WORKFLOW_DESCRIPTOR,
    loadSampleArtifact: options.loadSampleArtifact ?? loadCurrentSampleArtifact,
    buildOptions: () => ({}),
  });
}

module.exports = {
  WORKFLOW_KEY,
  WORKFLOW_VERSION,
  MATERIAL_RECOGNITION_WORKFLOW_DESCRIPTOR,
  createMaterialRecognitionWorkflowService,
};
