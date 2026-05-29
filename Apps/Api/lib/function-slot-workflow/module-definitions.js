const { createModuleDefinition } = require("../modules/definition");
const { MODULES, createFunctionSlotWorkflowPlaceholderService } = require("./placeholder-service");

function createFunctionSlotSemanticGovernanceModuleDefinition() {
  return createPlaceholderModuleDefinition(MODULES["function-slot-semantic-governance"], {
    route: "/api/function-slot-workflow/semantic-governance/run",
    stageKind: "functionSlotSemanticGovernance",
    stageId: MODULES["function-slot-semantic-governance"].stageName,
  });
}

function createFunctionSlotRestructureModuleDefinition() {
  return createPlaceholderModuleDefinition(MODULES["function-slot-restructure"], {
    route: "/api/function-slot-workflow/restructure/run",
    stageKind: "functionSlotRestructure",
    stageId: MODULES["function-slot-restructure"].stageName,
  });
}

function createShotStoryboardPrepModuleDefinition() {
  return createPlaceholderModuleDefinition(MODULES["shot-storyboard-prep"], {
    route: "/api/function-slot-workflow/shot-storyboard-prep/run",
    stageKind: "shotStoryboardPrep",
    stageId: MODULES["shot-storyboard-prep"].stageName,
  });
}

function createPlaceholderModuleDefinition(definition, ui) {
  return createModuleDefinition({
    moduleId: definition.moduleId,
    moduleKind: "function-slot-workflow",
    serviceKey: "functionSlotWorkflowPlaceholderService",
    executorKind: "local-service",
    route: ui.route,
    dependencies: [],
    artifact: {
      key: null,
      historyKey: null,
      type: definition.artifactType,
    },
    role: definition.role,
    stages: {
      placeholder: definition.stageName,
    },
    ui: {
      label: definition.moduleId,
      stageKind: ui.stageKind,
      displayName: definition.displayName,
      stageId: ui.stageId,
      completeReason: `${definition.displayName} 占位任务完成`,
      invalidResultMessage: `${definition.displayName} 暂未接入真实产物`,
      failureMessage: `${definition.displayName} 占位任务失败`,
      placeholder: true,
    },
    supportsCacheReuse: false,
    supportsRerun: false,
    artifactPolicy: "optional",
    getArtifact: () => null,
    startOptionsFromBody: ({ sampleVideoId, body = {} }) => ({
      moduleId: definition.moduleId,
      sampleVideoId,
      parentArtifactId: body.parentArtifactId ?? null,
      body,
    }),
    createService: (options = {}) => {
      if (options.functionSlotWorkflowPlaceholderService) return options.functionSlotWorkflowPlaceholderService;
      return createFunctionSlotWorkflowPlaceholderService(options);
    },
  });
}

module.exports = {
  createFunctionSlotSemanticGovernanceModuleDefinition,
  createFunctionSlotRestructureModuleDefinition,
  createShotStoryboardPrepModuleDefinition,
};
