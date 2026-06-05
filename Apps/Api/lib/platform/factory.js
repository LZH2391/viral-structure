const { readDebugTraces, readDebugTraceDetail } = require("../observability/debug-traces");
const { createActionRegistry } = require("./action-registry");
const { createArtifactResolver } = require("./artifact-resolver");
const { createCommandDispatcher } = require("./command-dispatcher");
const { createLineageResolver } = require("./lineage-resolver");
const { createProjectionResolver } = require("./projection-resolver");
const { createResourceCatalog } = require("./resource-catalog");
const { createResourceResolver } = require("./resource-resolver");
const { createRuntimeStateResolver } = require("./runtime-state-resolver");
const { createTraceResolver } = require("./trace-resolver");

function createPlatformHandlers({
  deps = {},
  store,
  rootDir,
  artifactIndex,
  workflowRunStore,
  jobStore,
  activeTurnRuntime,
  agentConversationStore,
  moduleRegistry,
  fullAnalysisWorkflowService,
  materialRecognitionWorkflowService,
  shotBoundaryService,
} = {}) {
  const resourceCatalog = deps.resourceCatalog ?? createResourceCatalog();
  const artifactResolver = deps.artifactResolver ?? createArtifactResolver({ artifactIndex });
  const lineageResolver = deps.lineageResolver ?? createLineageResolver({ artifactIndex });
  const projectionResolver = deps.projectionResolver ?? createProjectionResolver({ artifactIndex, workflowRunStore });
  const runtimeStateResolver = deps.runtimeStateResolver ?? createRuntimeStateResolver({
    workflowRunStore,
    jobStore,
    activeTurnRuntime,
  });
  const actionRegistry = deps.actionRegistry ?? createActionRegistry({
    workflowRunStore,
    jobStore,
    activeTurnRuntime,
    agentConversationStore,
  });
  const resourceResolver = deps.resourceResolver ?? createResourceResolver({
    artifactIndex,
    workflowRunStore,
    jobStore,
    activeTurnRuntime,
    agentConversationStore,
    moduleRegistry,
    runtimeRoot: store.runtimeRoot,
    readDebugTracesImpl: deps.readDebugTraces ?? readDebugTraces,
    readDebugTraceDetailImpl: deps.readDebugTraceDetail ?? readDebugTraceDetail,
  });
  const traceResolver = deps.traceResolver ?? createTraceResolver({
    runtimeRoot: store.runtimeRoot,
    readDebugTracesImpl: deps.readDebugTraces ?? readDebugTraces,
    readDebugTraceDetailImpl: deps.readDebugTraceDetail ?? readDebugTraceDetail,
  });
  const commandDispatcher = deps.commandDispatcher ?? createCommandDispatcher({
    workflowRunStore,
    jobStore,
    fullAnalysisWorkflowService,
    materialRecognitionWorkflowService,
    moduleRegistry,
    shotBoundaryService,
    activeTurnRuntime,
    rootDir,
    agentConversationStore,
  });

  return {
    resourceCatalog,
    artifactResolver,
    lineageResolver,
    projectionResolver,
    resourceResolver,
    traceResolver,
    runtimeStateResolver,
    actionRegistry,
    commandDispatcher,
  };
}

module.exports = {
  createPlatformHandlers,
};
