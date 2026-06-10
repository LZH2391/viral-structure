const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createLocalStore } = require("../../Infrastructure/Storage/local-store");
const { createStageLogger } = require("../../Infrastructure/Observability/stage-logger");
const { parseMultipartUpload } = require("./lib/http/multipart");
const { createJobStore } = require("./lib/stores/job-store");
const { createWorkflowRunStore } = require("./lib/stores/workflow-run-store");
const { createSampleProcessingService } = require("./lib/sample-processing/service");
const { createArtifactIndex } = require("../../Infrastructure/ArtifactIndex/artifact-index");
const { createArtifactCacheParamBuilders } = require("./lib/modules/cache-param-builders");
const { sendJson, notFound } = require("./lib/http/utils");
const { createWorkbenchStaticHandler } = require("./lib/http/static-files");
const { sendRuntimeFile } = require("./lib/http/runtime-files");
const { readDebugTraces, readDebugTraceDetail } = require("./lib/observability/debug-traces");
const { createCodexRolloutReader } = require("./lib/observability/codex-rollout-reader");
const { readJsonBody, ingestUiDebugEvent } = require("./lib/observability/ui-debug-events");
const { recordApiRequestFailure } = require("./lib/observability/api-request-debug");
const { readCapabilities } = require("./lib/http/capabilities");
const { handlePlatformRoute } = require("./lib/http/platform-routes");
const { platformErrorBody } = require("./lib/http/platform-errors");
const { handleLibraryDeleteCache, handleLibraryItem, handleLibraryItems, handleLibraryLoad } = require("./lib/http/library-routes");
const { handleDebugTraceDetail, handleDebugTraces, handleUiDebugEvent } = require("./lib/http/debug-routes");
const { createThreadPoolProxy } = require("./lib/gateways/threadpool/proxy");
const { createShotBoundaryService } = require("./lib/shot-boundary/service");
const { createAppServerBridge } = require("./lib/gateways/appserver/bridge");
const { createActiveTurnRuntime } = require("./lib/active-turns/runtime");
const { createActiveTurnOwnerHandlers } = require("./lib/active-turns/owner-handlers");
const { handleActiveTurnsList, handleActiveTurnRetry, handleActiveTurnStop, handleActiveTurnStopThread } = require("./lib/http/active-turn-routes");
const { handleFunctionSlotRoute } = require("./lib/http/function-slot-routes");
const { handleWorkflowRoute } = require("./lib/http/workflow-routes");
const { handleForceUpdateSeeds, handleOwnerLeaseRelease, handleThreadConversation, handleThreadDiscard, handleThreadPoolRead, handleThreadTurnTimeline } = require("./lib/http/threadpool-routes");
const { handleAgentChatConversationArchive, handleAgentChatConversationAutoAdvance, handleAgentChatConversationConfirm, handleAgentChatConversationDialogueReview, handleAgentChatConversationDialogueRework, handleAgentChatConversationList, handleAgentChatConversationResume, handleAgentChatConversationSystemMessage, handleAgentChatLeaseRelease, handleAgentChatManualReplacementSubmit, handleAgentChatThreadCompact, handleAgentChatThreadStart, handleAgentChatThreadStop, handleAgentChatTurnCollect, handleAgentChatTurnRetry, handleAgentChatTurnSubmit, handleAgentChatTurnStop, handleAgentChatTurnTimeline } = require("./lib/http/agent-chat-routes");
const { handleAgentChatStoryboardImage, handleAgentChatStoryboardResult } = require("./lib/http/agent-chat-storyboard-result-routes");
const { createAgentConversationStore } = require("./lib/agent-chat/conversation-store");
const { createSubtitleRevisionService } = require("./lib/sample-processing/subtitle-revision-service");
const { createAnalysisRoleRegistry } = require("./lib/compatibility/analysis-role-registry");
const { createModuleRegistry } = require("./lib/modules/registry");
const { createExecutorRegistry } = require("./lib/executors/registry");
const { createFullAnalysisWorkflowService } = require("./lib/workflows/full-analysis/service");
const { createMaterialRecognitionWorkflowService } = require("./lib/workflows/material-recognition/service");
const { createFullAnalysisBatchQueue } = require("./lib/workflows/full-analysis/batch-queue");
const { loadCurrentSampleArtifact } = require("./lib/stores/artifact-reader");
const { createFunctionSlotProjectionService } = require("./lib/function-slot-projection/service");
const { createFunctionSlotLibraryService } = require("./lib/function-slot-library/service");
const { createFunctionSlotLibraryBuilderService } = require("./lib/function-slot-library/builder-service");
const { createFunctionSlotGovernanceService } = require("./lib/function-slot-library/governance-service");
const { createSemanticGovernanceScheduler } = require("./lib/function-slot-library/governance-scheduler");
const { createFunctionSlotReplacementCandidateService } = require("./lib/function-slot-library/replacement-candidates");
const { createFunctionSlotAtomizationManualEditService } = require("./lib/function-slot-atomization/manual-edit-service");
const { createRestructureDisplayOverlayService } = require("./lib/function-slot-workflow/display-overlay-service");
const { createShotStoryboardAutoPipelineService } = require("./lib/agent-chat/shot-storyboard-auto-pipeline");
const { bindConversationDefaultMaterialPack } = require("./lib/agent-chat/material-pack-binding");
const { initializeServerRuntime: initializeServerRuntimeImpl } = require("./lib/server-runtime");
const { createPlatformHandlers } = require("./lib/platform/factory");
const { loadAppConfig } = require("./lib/config/app-config");

const rootDir = path.resolve(__dirname, "../..");
const appConfig = loadAppConfig({ rootDir });
applyProcessEnvFromAppConfig(appConfig);
const port = Number(process.env.PORT || 5177);
const store = createLocalStore(rootDir);
const logger = createStageLogger(store);
const jobStore = createJobStore({ filePath: path.join(store.runtimeRoot, "Jobs", "active-jobs.json") });
const workflowRunStore = createWorkflowRunStore({ filePath: path.join(store.runtimeRoot, "WorkflowRuns", "workflow-runs.json") });
const agentConversationStore = createAgentConversationStore({ store });
const artifactIndex = createArtifactIndex({ store, cacheParamBuilders: createArtifactCacheParamBuilders() });
const service = createSampleProcessingService({ store, logger, jobStore, artifactIndex, subtitleRecognition: appConfig.subtitleRecognition, mediaConfig: appConfig.media });
const appServer = createAppServerBridge();
const codexRolloutReader = createCodexRolloutReader();
const activeTurnOwnerHandlers = createActiveTurnOwnerHandlers({ agentConversationStore, jobStore, workflowRunStore });
const activeTurnRuntime = createActiveTurnRuntime({ store, appServer, ownerHandlers: activeTurnOwnerHandlers });
const threadPool = createThreadPoolProxy({
  readThreadImpl: async (threadId, options = {}) => appServer.readThread({ workspaceRoot: options.workspaceRoot ?? rootDir, threadId }),
  codexRolloutReader,
});
const subtitleRevisionService = createSubtitleRevisionService({ store, logger, artifactIndex });
const executorRegistry = createExecutorRegistry({ appServer, activeTurnRuntime });
const shotBoundaryService = createShotBoundaryService({
  rootDir,
  store,
  logger,
  jobStore,
  artifactIndex,
  threadPool,
  appServer,
  activeTurnRuntime,
  executorRegistry,
  rawAnalysisWorkspaceRoot: appConfig.shotBoundary.rawAnalysisWorkspaceRoot,
  skillPath: appConfig.shotBoundary.videoShotSkillPath,
});
const functionSlotProjectionService = createFunctionSlotProjectionService({ store });
const functionSlotLibraryService = createFunctionSlotLibraryService({ rootDir, store, logger, projectionService: functionSlotProjectionService });
const moduleRegistry = createModuleRegistry({
  store,
  logger,
  jobStore,
  artifactIndex,
  functionSlotProjectionService,
  executorRegistry,
  imageGenerationProvider: appConfig.imageGeneration,
  serviceOverrides: {
    shotBoundaryService,
    sampleProcessingService: service,
  },
});
const analysisRegistry = createAnalysisRoleRegistry({ moduleRegistry });
const fullAnalysisWorkflowService = createFullAnalysisWorkflowService({ workflowRunStore, service, shotBoundaryService, moduleRegistry, jobStore, logger, store, artifactIndex, threadPool, activeTurnRuntime });
const materialRecognitionWorkflowService = createMaterialRecognitionWorkflowService({ workflowRunStore, service, shotBoundaryService, moduleRegistry, jobStore, logger, store, artifactIndex, threadPool, activeTurnRuntime });
const fullAnalysisBatchQueue = createFullAnalysisBatchQueue({
  workflowService: fullAnalysisWorkflowService,
  runtimeRoot: store.runtimeRoot,
  loadSampleArtifact: ({ sampleVideoId }) => loadCurrentSampleArtifact({ sampleVideoId, store, artifactIndex }),
  logger,
});
const materialRecognitionBatchQueue = createFullAnalysisBatchQueue({
  workflowService: materialRecognitionWorkflowService,
  runtimeRoot: store.runtimeRoot,
  filePath: path.join(store.runtimeRoot, "WorkflowRuns", "material-recognition-queue.json"),
  uploadRoot: path.join(store.runtimeRoot, "WorkflowRuns", "material-recognition-batch-uploads"),
  workflowKey: "material-recognition",
  workflowLabel: "素材识别",
  errorCode: "material_recognition_batch_item_failed",
  stageName: "workflow.material_recognition.batch.dispatch",
  buildOptions: () => ({}),
  loadSampleArtifact: ({ sampleVideoId }) => loadCurrentSampleArtifact({ sampleVideoId, store, artifactIndex }),
  onItemCompleted: (batch, item, context) => bindCompletedMaterialRecognitionItem({
    agentConversationStore,
    logger,
    batch,
    item,
    context,
  }),
  logger,
});
const staticWorkbench = createWorkbenchStaticHandler(rootDir);

function createServer(deps = {}) {
  const isolatedRootDir = !deps.store && !deps.rootDir && deps.appServer && deps.appServer !== appServer
    ? fs.mkdtempSync(path.join(os.tmpdir(), "bd-api-server-isolated-"))
    : null;
  const activeRootDir = deps.rootDir ?? isolatedRootDir;
  const activeStore = deps.store ?? (activeRootDir ? createLocalStore(path.resolve(activeRootDir)) : store);
  const activeLogger = deps.logger ?? logger;
  const activeJobStore = deps.jobStore ?? jobStore;
  const activeWorkflowRunStore = deps.workflowRunStore ?? workflowRunStore;
  const activeAgentConversationStore = deps.agentConversationStore ?? (activeStore === store ? agentConversationStore : createAgentConversationStore({ store: activeStore }));
  const activeArtifactIndex = deps.artifactIndex ?? artifactIndex;
  const activeFunctionSlotProjectionService = deps.functionSlotProjectionService ?? createFunctionSlotProjectionService({ store: activeStore });
  const activeTurnOwnerHandlers = deps.activeTurnOwnerHandlers ?? createActiveTurnOwnerHandlers({
    agentConversationStore: activeAgentConversationStore,
    jobStore: activeJobStore,
    workflowRunStore: activeWorkflowRunStore,
  });
  const activeActiveTurnRuntime = deps.activeTurnRuntime ?? (activeStore === store && (deps.appServer ?? appServer) === appServer ? activeTurnRuntime : createActiveTurnRuntime({ store: activeStore, appServer: deps.appServer ?? appServer, ownerHandlers: activeTurnOwnerHandlers }));
  const activeExecutorRegistry = deps.executorRegistry ?? createExecutorRegistry({
    appServer: deps.appServer ?? appServer,
    activeTurnRuntime: activeActiveTurnRuntime,
  });
  const activeFunctionSlotLibraryService = deps.functionSlotLibraryService ?? createFunctionSlotLibraryService({
    rootDir: activeRootDir ?? rootDir,
    store: activeStore,
    logger: activeLogger,
    projectionService: activeFunctionSlotProjectionService,
  });
  const activeFunctionSlotLibraryBuilderService = deps.functionSlotLibraryBuilderService ?? createFunctionSlotLibraryBuilderService({
    rootDir: activeRootDir ?? rootDir,
    store: activeStore,
    logger: activeLogger,
    libraryService: activeFunctionSlotLibraryService,
  });
  const activeFunctionSlotGovernanceService = deps.functionSlotGovernanceService ?? createFunctionSlotGovernanceService({
    rootDir: activeRootDir ?? rootDir,
    store: activeStore,
    logger: activeLogger,
    jobStore: activeJobStore,
    threadPool: deps.threadPool ?? threadPool,
    appServer: deps.appServer ?? appServer,
    codexRolloutReader: deps.codexRolloutReader ?? codexRolloutReader,
    activeTurnRuntime: activeActiveTurnRuntime,
  });
  const activeSemanticGovernanceScheduler = deps.semanticGovernanceScheduler ?? createSemanticGovernanceScheduler({
    rootDir: activeRootDir ?? rootDir,
    runtimeRoot: activeStore.runtimeRoot,
    governanceService: activeFunctionSlotGovernanceService,
    builderService: activeFunctionSlotLibraryBuilderService,
    jobStore: activeJobStore,
    loadSampleArtifact: ({ sampleVideoId }) => (deps.loadCurrentSampleArtifact ?? loadCurrentSampleArtifact)({ sampleVideoId, store: activeStore, artifactIndex: activeArtifactIndex }),
  });
  const activeFunctionSlotReplacementCandidateService = deps.functionSlotReplacementCandidateService ?? createFunctionSlotReplacementCandidateService({
    rootDir: activeRootDir ?? rootDir,
  });
  const activeFunctionSlotAtomizationManualEditService = deps.functionSlotAtomizationManualEditService ?? createFunctionSlotAtomizationManualEditService({
    rootDir: activeRootDir ?? rootDir,
    store: activeStore,
    logger: activeLogger,
    artifactIndex: activeArtifactIndex,
    projectionService: activeFunctionSlotProjectionService,
  });
  const activeRestructureDisplayOverlayService = deps.restructureDisplayOverlayService ?? createRestructureDisplayOverlayService({
    rootDir: activeRootDir ?? rootDir,
    logger: activeLogger,
  });
  const activeSampleService = deps.service ?? (activeStore === store ? service : createSampleProcessingService({
    store: activeStore,
    logger: activeLogger,
    jobStore: activeJobStore,
    artifactIndex: activeArtifactIndex,
    subtitleRecognition: deps.subtitleRecognition ?? appConfig.subtitleRecognition,
    mediaConfig: deps.mediaConfig ?? appConfig.media,
  }));
  const activeShotBoundaryService = deps.shotBoundaryService ?? (activeStore === store && activeExecutorRegistry === executorRegistry
    ? shotBoundaryService
    : createShotBoundaryService({
        rootDir: activeRootDir ?? rootDir,
        store: activeStore,
        logger: activeLogger,
        jobStore: activeJobStore,
        artifactIndex: activeArtifactIndex,
        threadPool: deps.threadPool ?? threadPool,
        appServer: deps.appServer ?? appServer,
        activeTurnRuntime: activeActiveTurnRuntime,
        executorRegistry: activeExecutorRegistry,
        rawAnalysisWorkspaceRoot: (deps.shotBoundary ?? appConfig.shotBoundary).rawAnalysisWorkspaceRoot,
        skillPath: (deps.shotBoundary ?? appConfig.shotBoundary).videoShotSkillPath,
      }));
  const activeModuleRegistry = deps.moduleRegistry ?? createModuleRegistry({
    rootDir: activeRootDir ?? rootDir,
    store: activeStore,
    logger: activeLogger,
    jobStore: activeJobStore,
    artifactIndex: activeArtifactIndex,
    functionSlotProjectionService: activeFunctionSlotProjectionService,
    threadPool: deps.threadPool ?? threadPool,
    appServer: deps.appServer ?? appServer,
    activeTurnRuntime: activeActiveTurnRuntime,
    executorRegistry: activeExecutorRegistry,
    imageGenerationProvider: deps.imageGenerationProvider ?? appConfig.imageGeneration,
    serviceOverrides: {
      scriptSegmentService: deps.scriptSegmentService,
      rhythmStructureService: deps.rhythmStructureService,
      packagingStructureService: deps.packagingStructureService,
      functionSlotAtomizationService: deps.functionSlotAtomizationService,
      shotBoundaryService: activeShotBoundaryService,
      sampleProcessingService: activeSampleService,
    },
  });
  const activeShotStoryboardAutoPipelineService = deps.shotStoryboardAutoPipelineService ?? createShotStoryboardAutoPipelineService({
    rootDir: activeRootDir ?? rootDir,
    store: activeStore,
    logger: activeLogger,
    jobStore: activeJobStore,
    moduleRegistry: activeModuleRegistry,
    agentConversationStore: activeAgentConversationStore,
    threadPool: deps.threadPool ?? threadPool,
    appServer: deps.appServer ?? appServer,
    activeTurnRuntime: activeActiveTurnRuntime,
  });
  const activeAnalysisRegistry = deps.analysisRegistry ?? createAnalysisRoleRegistry({ moduleRegistry: activeModuleRegistry });
  const activeFullAnalysisWorkflowService = deps.fullAnalysisWorkflowService ?? createFullAnalysisWorkflowService({
    workflowRunStore: activeWorkflowRunStore,
    service: activeSampleService,
    shotBoundaryService: activeShotBoundaryService,
    moduleRegistry: activeModuleRegistry,
    jobStore: activeJobStore,
    logger: activeLogger,
    store: activeStore,
    artifactIndex: activeArtifactIndex,
    threadPool: deps.threadPool ?? threadPool,
    activeTurnRuntime: activeActiveTurnRuntime,
    loadSampleArtifact: deps.loadCurrentSampleArtifact ?? loadCurrentSampleArtifact,
  });
  const activeMaterialRecognitionWorkflowService = deps.materialRecognitionWorkflowService ?? createMaterialRecognitionWorkflowService({
    workflowRunStore: activeWorkflowRunStore,
    service: activeSampleService,
    shotBoundaryService: activeShotBoundaryService,
    moduleRegistry: activeModuleRegistry,
    jobStore: activeJobStore,
    logger: activeLogger,
    store: activeStore,
    artifactIndex: activeArtifactIndex,
    threadPool: deps.threadPool ?? threadPool,
    activeTurnRuntime: activeActiveTurnRuntime,
    loadSampleArtifact: deps.loadCurrentSampleArtifact ?? loadCurrentSampleArtifact,
  });
  const activeFullAnalysisBatchQueue = deps.fullAnalysisBatchQueue ?? createFullAnalysisBatchQueue({
    workflowService: activeFullAnalysisWorkflowService,
    runtimeRoot: activeStore.runtimeRoot,
    loadSampleArtifact: ({ sampleVideoId }) => (deps.loadCurrentSampleArtifact ?? loadCurrentSampleArtifact)({ sampleVideoId, store: activeStore, artifactIndex: activeArtifactIndex }),
    onQueueChanged: activeSemanticGovernanceScheduler.handleQueueChanged,
    logger: activeLogger,
  });
  const activeMaterialRecognitionBatchQueue = deps.materialRecognitionBatchQueue ?? createFullAnalysisBatchQueue({
    workflowService: activeMaterialRecognitionWorkflowService,
    runtimeRoot: activeStore.runtimeRoot,
    filePath: path.join(activeStore.runtimeRoot, "WorkflowRuns", "material-recognition-queue.json"),
    uploadRoot: path.join(activeStore.runtimeRoot, "WorkflowRuns", "material-recognition-batch-uploads"),
    workflowKey: "material-recognition",
    workflowLabel: "素材识别",
    errorCode: "material_recognition_batch_item_failed",
    stageName: "workflow.material_recognition.batch.dispatch",
    buildOptions: () => ({}),
    loadSampleArtifact: ({ sampleVideoId }) => (deps.loadCurrentSampleArtifact ?? loadCurrentSampleArtifact)({ sampleVideoId, store: activeStore, artifactIndex: activeArtifactIndex }),
    onItemCompleted: (batch, item, context) => bindCompletedMaterialRecognitionItem({
      agentConversationStore: activeAgentConversationStore,
      logger: activeLogger,
      batch,
      item,
      context,
    }),
    logger: activeLogger,
  });
  const activePlatformHandlers = createPlatformHandlers({
    deps,
    store: activeStore,
    rootDir: activeRootDir ?? rootDir,
    artifactIndex: activeArtifactIndex,
    workflowRunStore: activeWorkflowRunStore,
    jobStore: activeJobStore,
    activeTurnRuntime: activeActiveTurnRuntime,
    agentConversationStore: activeAgentConversationStore,
    moduleRegistry: activeModuleRegistry,
    fullAnalysisWorkflowService: activeFullAnalysisWorkflowService,
    materialRecognitionWorkflowService: activeMaterialRecognitionWorkflowService,
    shotBoundaryService: activeShotBoundaryService,
  });
  const handlers = {
    logger: activeLogger,
    store: activeStore,
    jobStore: activeJobStore,
    workflowRunStore: activeWorkflowRunStore,
    agentConversationStore: activeAgentConversationStore,
    artifactIndex: activeArtifactIndex,
    ...activePlatformHandlers,
    service: activeSampleService,
    threadPool: deps.threadPool ?? threadPool,
    appServer: deps.appServer ?? appServer,
    codexRolloutReader: deps.codexRolloutReader ?? codexRolloutReader,
    activeTurnRuntime: activeActiveTurnRuntime,
    shotBoundaryService: activeShotBoundaryService,
    subtitleRevisionService: deps.subtitleRevisionService ?? subtitleRevisionService,
    moduleRegistry: activeModuleRegistry,
    shotStoryboardAutoPipelineService: activeShotStoryboardAutoPipelineService,
    analysisRegistry: activeAnalysisRegistry,
    functionSlotProjectionService: activeFunctionSlotProjectionService,
    functionSlotLibraryService: activeFunctionSlotLibraryService,
    functionSlotLibraryBuilderService: activeFunctionSlotLibraryBuilderService,
    functionSlotGovernanceService: activeFunctionSlotGovernanceService,
    semanticGovernanceScheduler: activeSemanticGovernanceScheduler,
    functionSlotReplacementCandidateService: activeFunctionSlotReplacementCandidateService,
    functionSlotAtomizationManualEditService: activeFunctionSlotAtomizationManualEditService,
    restructureDisplayOverlayService: activeRestructureDisplayOverlayService,
    fullAnalysisWorkflowService: activeFullAnalysisWorkflowService,
    materialRecognitionWorkflowService: activeMaterialRecognitionWorkflowService,
    fullAnalysisBatchQueue: activeFullAnalysisBatchQueue,
    materialRecognitionBatchQueue: activeMaterialRecognitionBatchQueue,
    staticWorkbench: deps.staticWorkbench ?? staticWorkbench,
    rootDir: activeRootDir ?? rootDir,
    sendRuntimeFileImpl: deps.sendRuntimeFile ?? sendRuntimeFile,
    readDebugTracesImpl: deps.readDebugTraces ?? readDebugTraces,
    readDebugTraceDetailImpl: deps.readDebugTraceDetail ?? readDebugTraceDetail,
    readJsonBodyImpl: deps.readJsonBody ?? readJsonBody,
    ingestUiDebugEventImpl: deps.ingestUiDebugEvent ?? ingestUiDebugEvent,
    recordApiRequestFailureImpl: deps.recordApiRequestFailure ?? recordApiRequestFailure,
    readCapabilitiesImpl: deps.readCapabilities ?? readCapabilities,
    loadCurrentSampleArtifactImpl: deps.loadCurrentSampleArtifact ?? loadCurrentSampleArtifact,
  };

  const apiServer = http.createServer(async (req, res) => {
    let url = null;
    try {
      if (req.method === "OPTIONS") return sendJson(res, 200, {});
      url = new URL(req.url, `http://${req.headers.host}`);
      if (req.method === "GET" && url.pathname === "/api/capabilities") return await handleCapabilities(res, handlers);
      if (await handlePlatformRoute(req, res, url, handlers)) return undefined;
      if (req.method === "GET" && url.pathname === "/api/active-turns") return await handleActiveTurnsList(res, handlers, url);
      if (req.method === "POST" && /^\/api\/active-turns\/[^/]+\/stop$/.test(url.pathname)) return await handleActiveTurnStop(req, res, decodeURIComponent(url.pathname.split("/").at(-2)), handlers);
      if (req.method === "POST" && /^\/api\/active-turns\/[^/]+\/stop-thread$/.test(url.pathname)) return await handleActiveTurnStopThread(req, res, decodeURIComponent(url.pathname.split("/").at(-2)), handlers);
      if (req.method === "POST" && /^\/api\/active-turns\/[^/]+\/retry$/.test(url.pathname)) return await handleActiveTurnRetry(req, res, decodeURIComponent(url.pathname.split("/").at(-2)), handlers);
      if (req.method === "GET" && url.pathname === "/api/modules") return await handleModules(res, handlers);
      if (req.method === "GET" && url.pathname === "/api/analysis-roles") return await handleAnalysisRoles(res, handlers);
      if (await handleFunctionSlotRoute(req, res, url, handlers)) return undefined;
      if (await handleWorkflowRoute(req, res, url, handlers)) return undefined;
      if (req.method === "POST" && url.pathname === "/api/agent-chat/threads") return await handleAgentChatThreadStart(req, res, handlers);
      if (req.method === "GET" && url.pathname === "/api/agent-chat/conversations") return await handleAgentChatConversationList(res, handlers, url);
      if (req.method === "GET" && /^\/api\/agent-chat\/conversations\/[^/]+\/storyboard-result$/.test(url.pathname)) return await handleAgentChatStoryboardResult(req, res, decodeURIComponent(url.pathname.split("/").at(-2)), handlers);
      if (req.method === "GET" && /^\/api\/agent-chat\/conversations\/[^/]+\/storyboard-result\/images\/[^/]+$/.test(url.pathname)) return await handleAgentChatStoryboardImage(req, res, decodeURIComponent(url.pathname.split("/").at(-4)), decodeURIComponent(url.pathname.split("/").at(-1)), handlers);
      if (req.method === "POST" && /^\/api\/agent-chat\/conversations\/[^/]+\/resume$/.test(url.pathname)) return await handleAgentChatConversationResume(res, decodeURIComponent(url.pathname.split("/").at(-2)), handlers);
      if (req.method === "POST" && /^\/api\/agent-chat\/conversations\/[^/]+\/archive$/.test(url.pathname)) return await handleAgentChatConversationArchive(req, res, decodeURIComponent(url.pathname.split("/").at(-2)), handlers);
      if (req.method === "POST" && /^\/api\/agent-chat\/conversations\/[^/]+\/confirm$/.test(url.pathname)) return await handleAgentChatConversationConfirm(req, res, decodeURIComponent(url.pathname.split("/").at(-2)), handlers);
      if (req.method === "POST" && /^\/api\/agent-chat\/conversations\/[^/]+\/auto-advance$/.test(url.pathname)) return await handleAgentChatConversationAutoAdvance(req, res, decodeURIComponent(url.pathname.split("/").at(-2)), handlers);
      if (req.method === "POST" && /^\/api\/agent-chat\/conversations\/[^/]+\/dialogue-review$/.test(url.pathname)) return await handleAgentChatConversationDialogueReview(req, res, decodeURIComponent(url.pathname.split("/").at(-2)), handlers);
      if (req.method === "POST" && /^\/api\/agent-chat\/conversations\/[^/]+\/dialogue-rework$/.test(url.pathname)) return await handleAgentChatConversationDialogueRework(req, res, decodeURIComponent(url.pathname.split("/").at(-2)), handlers);
      if (req.method === "POST" && /^\/api\/agent-chat\/conversations\/[^/]+\/system-messages$/.test(url.pathname)) return await handleAgentChatConversationSystemMessage(req, res, decodeURIComponent(url.pathname.split("/").at(-2)), handlers);
      if (req.method === "POST" && /^\/api\/agent-chat\/threads\/[^/]+\/compact$/.test(url.pathname)) return await handleAgentChatThreadCompact(req, res, decodeURIComponent(url.pathname.split("/").at(-2)), handlers);
      if (req.method === "POST" && /^\/api\/agent-chat\/threads\/[^/]+\/stop$/.test(url.pathname)) return await handleAgentChatThreadStop(req, res, decodeURIComponent(url.pathname.split("/").at(-2)), handlers);
      if (req.method === "POST" && /^\/api\/agent-chat\/threads\/[^/]+\/turns\/manual-replacement$/.test(url.pathname)) return await handleAgentChatManualReplacementSubmit(req, res, decodeURIComponent(url.pathname.split("/").at(-3)), handlers);
      if (req.method === "POST" && /^\/api\/agent-chat\/threads\/[^/]+\/turns$/.test(url.pathname)) return await handleAgentChatTurnSubmit(req, res, decodeURIComponent(url.pathname.split("/").at(-2)), handlers);
      if (req.method === "POST" && /^\/api\/agent-chat\/threads\/[^/]+\/turns\/[^/]+\/stop$/.test(url.pathname)) return await handleAgentChatTurnStop(req, res, decodeURIComponent(url.pathname.split("/").at(-4)), decodeURIComponent(url.pathname.split("/").at(-2)), handlers);
      if (req.method === "POST" && /^\/api\/agent-chat\/threads\/[^/]+\/turns\/[^/]+\/retry$/.test(url.pathname)) return await handleAgentChatTurnRetry(req, res, decodeURIComponent(url.pathname.split("/").at(-4)), decodeURIComponent(url.pathname.split("/").at(-2)), handlers);
      if (req.method === "GET" && /^\/api\/agent-chat\/threads\/[^/]+\/turns\/[^/]+$/.test(url.pathname)) return await handleAgentChatTurnCollect(res, decodeURIComponent(url.pathname.split("/").at(-3)), decodeURIComponent(url.pathname.split("/").at(-1)), handlers, url);
      if (req.method === "GET" && /^\/api\/agent-chat\/threads\/[^/]+\/turns\/[^/]+\/timeline$/.test(url.pathname)) return await handleAgentChatTurnTimeline(res, decodeURIComponent(url.pathname.split("/").at(-4)), decodeURIComponent(url.pathname.split("/").at(-2)), handlers, url);
      if (req.method === "POST" && url.pathname === "/api/agent-chat/threadpool/leases/release") return await handleAgentChatLeaseRelease(req, res, handlers);
      if (req.method === "POST" && /^\/api\/workspaces\/[^/]+\/sample-videos$/.test(url.pathname)) return await handleUpload(req, res, url, handlers);
      if (req.method === "GET" && /^\/api\/processing-jobs\/[^/]+$/.test(url.pathname)) return handleJob(res, url.pathname.split("/").at(-1), handlers);
      if (req.method === "POST" && /^\/api\/processing-jobs\/[^/]+\/cache-decision$/.test(url.pathname)) return await handleJobCacheDecision(req, res, url.pathname.split("/").at(-2), handlers);
      if (req.method === "GET" && /^\/api\/sample-videos\/[^/]+\/artifact$/.test(url.pathname)) return await handleArtifact(res, url.pathname.split("/").at(-2), handlers);
      if (req.method === "POST" && /^\/api\/sample-videos\/[^/]+\/subtitles\/revisions$/.test(url.pathname)) return await handleSubtitleRevision(req, res, decodeURIComponent(url.pathname.split("/").at(-3)), handlers);
      if (req.method === "POST" && /^\/api\/sample-videos\/[^/]+\/shot-boundary$/.test(url.pathname)) return await handleShotBoundary(req, res, decodeURIComponent(url.pathname.split("/").at(-2)), handlers);
      if (req.method === "POST" && /^\/api\/sample-videos\/[^/]+\/analyses\/[^/]+$/.test(url.pathname)) return await handleAnalysis(req, res, decodeURIComponent(url.pathname.split("/").at(-3)), decodeURIComponent(url.pathname.split("/").at(-1)), handlers);
      if (req.method === "POST" && /^\/api\/sample-videos\/[^/]+\/script-segments$/.test(url.pathname)) return await handleScriptSegments(req, res, decodeURIComponent(url.pathname.split("/").at(-2)), handlers);
      if (req.method === "POST" && /^\/api\/sample-videos\/[^/]+\/rhythm-structure$/.test(url.pathname)) return await handleRhythmStructure(req, res, decodeURIComponent(url.pathname.split("/").at(-2)), handlers);
      if (req.method === "POST" && /^\/api\/sample-videos\/[^/]+\/packaging-structure$/.test(url.pathname)) return await handlePackagingStructure(req, res, decodeURIComponent(url.pathname.split("/").at(-2)), handlers);
      if (req.method === "GET" && url.pathname === "/api/threadpool/health") return await handleThreadPoolRead(res, "health", () => handlers.threadPool.health(), handlers);
      if (req.method === "GET" && url.pathname === "/api/threadpool/config") return await handleThreadPoolRead(res, "config", () => handlers.threadPool.config(), handlers);
      if (req.method === "GET" && url.pathname === "/api/threadpool/roles") return await handleThreadPoolRead(res, "roles", () => handlers.threadPool.roles(), handlers);
      if (req.method === "GET" && /^\/api\/threadpool\/roles\/[^/]+\/status$/.test(url.pathname)) return await handleThreadPoolRead(res, "role-status", () => handlers.threadPool.roleStatus(decodeURIComponent(url.pathname.split("/").at(-2))), handlers);
      if (req.method === "GET" && /^\/api\/threadpool\/threads\/[^/]+\/turns\/[^/]+\/timeline$/.test(url.pathname)) return await handleThreadTurnTimeline(res, decodeURIComponent(url.pathname.split("/").at(-4)), decodeURIComponent(url.pathname.split("/").at(-2)), handlers);
      if (req.method === "GET" && /^\/api\/threadpool\/threads\/[^/]+\/conversation$/.test(url.pathname)) return await handleThreadConversation(res, decodeURIComponent(url.pathname.split("/").at(-2)), handlers);
      if (req.method === "POST" && /^\/api\/threadpool\/threads\/[^/]+\/discard$/.test(url.pathname)) return await handleThreadDiscard(req, res, decodeURIComponent(url.pathname.split("/").at(-2)), handlers);
      if (req.method === "POST" && url.pathname === "/api/threadpool/maintenance/force-update-seeds") return await handleForceUpdateSeeds(req, res, handlers);
      if (req.method === "POST" && url.pathname === "/api/threadpool/leases/release-owner") return await handleOwnerLeaseRelease(req, res, handlers);
      if (req.method === "GET" && url.pathname === "/api/library/items") return await handleLibraryItems(res, handlers);
      if (req.method === "GET" && /^\/api\/library\/items\/[^/]+$/.test(url.pathname)) return await handleLibraryItem(res, decodeURIComponent(url.pathname.split("/").at(-1)), handlers);
      if (req.method === "POST" && /^\/api\/library\/items\/[^/]+\/load$/.test(url.pathname)) return await handleLibraryLoad(res, decodeURIComponent(url.pathname.split("/").at(-2)), handlers);
      if (req.method === "DELETE" && /^\/api\/library\/items\/[^/]+\/cache$/.test(url.pathname)) return await handleLibraryDeleteCache(res, decodeURIComponent(url.pathname.split("/").at(-2)), handlers);
      if (req.method === "POST" && url.pathname === "/api/debug/ui-events") return await handleUiDebugEvent(req, res, handlers);
      if (req.method === "GET" && url.pathname === "/api/debug/traces") return await handleDebugTraces(res, handlers);
      if (req.method === "GET" && /^\/api\/debug\/traces\/[^/]+$/.test(url.pathname)) return await handleDebugTraceDetail(res, decodeURIComponent(url.pathname.split("/").at(-1)), handlers);
      if (req.method === "GET" && url.pathname.startsWith("/runtime/")) return handlers.sendRuntimeFileImpl(req, res, handlers.store.runtimeRoot, url.pathname);
      if (req.method === "GET" && handlers.staticWorkbench.handle(req, res, url.pathname)) return undefined;
      return notFound(res);
    } catch (error) {
      const failure = await handlers.recordApiRequestFailureImpl(handlers.logger, req, error).catch(() => null);
      if (url?.pathname?.startsWith("/api/platform/v1/")) {
        const statusCode = error.statusCode ?? 500;
        return sendJson(res, statusCode, platformErrorBody({
          code: error.code ?? (statusCode === 400 ? "bad_request" : "platform_request_failed"),
          message: statusCode >= 500 ? "平台请求处理失败" : error.message,
          retryable: typeof error.retryable === "boolean" ? error.retryable : statusCode >= 500,
          traceId: error.traceId ?? failure?.traceContext?.traceId ?? null,
          debugSnapshotUri: error.debugSnapshotUri ?? failure?.snapshot?.uri ?? null,
          stageName: error.stageName ?? failure?.errorSummary?.stageName ?? null,
        }));
      }
      if (error.statusCode) {
        return sendJson(res, error.statusCode, {
          error: error.code ?? (error.statusCode === 400 ? "bad_request" : "request_failed"),
          code: error.code ?? null,
          message: error.message,
          traceId: error.traceId ?? failure?.traceContext?.traceId ?? null,
          debugSnapshotUri: error.debugSnapshotUri ?? failure?.snapshot?.uri ?? null,
          stageName: error.stageName ?? failure?.errorSummary?.stageName ?? null,
          retryable: typeof error.retryable === "boolean" ? error.retryable : error.statusCode >= 500,
        });
      }
      return sendJson(res, 500, {
        error: "internal_error",
        code: "internal_error",
        message: "请求处理失败",
        traceId: failure?.traceContext?.traceId ?? null,
        debugSnapshotUri: failure?.snapshot?.uri ?? null,
        stageName: "api.request.handle",
        retryable: true,
      });
    }
  });
  if (isolatedRootDir) {
    apiServer.once("close", () => {
      fs.rm(isolatedRootDir, { recursive: true, force: true }, () => undefined);
    });
  }
  return apiServer;
}

const server = createServer();

async function initializeServerRuntime(runtime = {}) {
  return initializeServerRuntimeImpl({ store: runtime.store ?? store, shotBoundaryService: runtime.shotBoundaryService ?? shotBoundaryService, activeTurnRuntime: runtime.activeTurnRuntime ?? activeTurnRuntime, rootDir: runtime.rootDir ?? rootDir });
}

async function handleUpload(req, res, url, handlers = {}) {
  const workspaceId = url.pathname.split("/")[3];
  const { file, fields } = await parseMultipartUpload(req, req.headers["content-type"]);
  const result = await (handlers.service ?? service).enqueueUpload({ workspaceId, file, fields });
  sendJson(res, 202, result);
}

async function handleCapabilities(res, handlers = {}) {
  return sendJson(res, 200, await (handlers.readCapabilitiesImpl ?? readCapabilities)());
}

async function handleAnalysisRoles(res, handlers = {}) {
  return sendJson(res, 200, { roles: (handlers.analysisRegistry ?? analysisRegistry).list() });
}

async function handleModules(res, handlers = {}) {
  return sendJson(res, 200, { modules: (handlers.moduleRegistry ?? moduleRegistry).list() });
}

function handleJob(res, jobId, handlers = {}) {
  const activeJobStore = handlers.jobStore ?? jobStore;
  const job = activeJobStore.getJob(jobId) ?? activeJobStore.getArchivedJob?.(jobId) ?? null;
  if (!job) return notFound(res);
  return sendJson(res, 200, job);
}

async function handleArtifact(res, sampleVideoId, handlers = {}) {
  const artifact = await (handlers.loadCurrentSampleArtifactImpl ?? loadCurrentSampleArtifact)({
    sampleVideoId,
    store: handlers.store ?? store,
    artifactIndex: handlers.artifactIndex ?? artifactIndex,
  });
  if (!artifact) return sendJson(res, 202, { sampleVideoId, status: "processing" });
  return sendJson(res, 200, artifact);
}

async function handleShotBoundary(req, res, sampleVideoId, handlers = {}) {
  const body = await (handlers.readJsonBodyImpl ?? readJsonBody)(req);
  const result = await (handlers.moduleRegistry ?? moduleRegistry).startModule({ moduleId: "shot-boundary", sampleVideoId, body });
  return sendJson(res, 202, result);
}

async function handleSubtitleRevision(req, res, sampleVideoId, handlers = {}) {
  const body = await (handlers.readJsonBodyImpl ?? readJsonBody)(req);
  const result = await (handlers.subtitleRevisionService ?? subtitleRevisionService).saveRevision({
    sampleVideoId,
    segments: body.segments,
    expectedSubtitleArtifactId: body.expectedSubtitleArtifactId ?? null,
    expectedRevisionIndex: body.expectedRevisionIndex ?? null,
  });
  return sendJson(res, 200, result);
}

async function handleScriptSegments(req, res, sampleVideoId, handlers = {}) {
  return handleLegacyAnalysis(req, res, sampleVideoId, "script-segments", handlers);
}

async function handleRhythmStructure(req, res, sampleVideoId, handlers = {}) {
  return handleLegacyAnalysis(req, res, sampleVideoId, "rhythm-structure", handlers);
}

async function handlePackagingStructure(req, res, sampleVideoId, handlers = {}) {
  return handleLegacyAnalysis(req, res, sampleVideoId, "packaging-structure", handlers);
}

async function handleAnalysis(req, res, sampleVideoId, analysisId, handlers = {}) {
  const body = await (handlers.readJsonBodyImpl ?? readJsonBody)(req).catch(() => ({}));
  const result = await (handlers.analysisRegistry ?? analysisRegistry).startAnalysis({
    analysisId,
    sampleVideoId,
    body,
  });
  return sendJson(res, 202, result);
}

async function handleLegacyAnalysis(req, res, sampleVideoId, legacyPathSegment, handlers = {}) {
  const body = await (handlers.readJsonBodyImpl ?? readJsonBody)(req).catch(() => ({}));
  const result = await (handlers.analysisRegistry ?? analysisRegistry).startLegacyAnalysis({
    legacyPathSegment,
    sampleVideoId,
    body,
  });
  return sendJson(res, 202, result);
}

async function handleJobCacheDecision(req, res, jobId, handlers = {}) {
  const body = await (handlers.readJsonBodyImpl ?? readJsonBody)(req);
  const activeJobStore = handlers.jobStore ?? jobStore;
  const job = activeJobStore.getJob(jobId);
  if (!job) return notFound(res);
  const cacheKind = job.cachePrompt?.cacheKind ?? inferCacheKindFromJob(job);
  const analysisResult = await (handlers.moduleRegistry ?? moduleRegistry).resolveModuleCacheDecision({ cacheKind, jobId, decision: body.decision });
  const result = analysisResult ?? await (handlers.shotBoundaryService ?? shotBoundaryService).resolveCacheDecision({ jobId, decision: body.decision });
  return sendJson(res, 200, result);
}

function inferCacheKindFromJob(job) {
  const stage = String(job?.stage ?? "");
  if (stage.startsWith("shot.") || stage.startsWith("shot_boundary") || job?.cachePrompt?.cachedItem?.tags?.includes("切镜")) return "shot_boundary";
  return null;
}

async function bindCompletedMaterialRecognitionItem({ agentConversationStore, logger, batch, item, context }) {
  const targetConversationId = normalizeServerText(context?.fields?.targetConversationId ?? batch?.fields?.targetConversationId);
  const shouldBind = normalizeServerBoolean(context?.fields?.bindMaterialToConversation ?? batch?.fields?.bindMaterialToConversation) || Boolean(targetConversationId);
  if (!targetConversationId || !shouldBind || !context?.artifact) return null;
  return bindConversationDefaultMaterialPack({
    handlers: { agentConversationStore },
    conversationId: targetConversationId,
    artifact: context.artifact,
    binding: {
      source: "material-recognition-batch",
      workflowKey: context.workflowKey ?? batch?.workflowKey ?? "material-recognition",
      workflowRunId: item?.workflowRunId ?? context.workflowRun?.workflowRunId ?? null,
      batchRunId: batch?.batchRunId ?? item?.batchRunId ?? null,
      queueItemId: item?.queueItemId ?? null,
      traceId: context.workflowRun?.traceId ?? null,
      runId: context.workflowRun?.runId ?? null,
      stageId: context.workflowRun?.stageId ?? null,
    },
    traceContext: {
      traceId: context.workflowRun?.traceId ?? batch?.batchRunId ?? "material-recognition-batch",
      runId: context.workflowRun?.runId ?? batch?.batchRunId ?? "material-recognition-batch",
      stageId: context.workflowRun?.stageId ?? item?.queueItemId ?? "material-recognition-batch-item",
    },
  }).catch(async (error) => {
    await logger?.writeDebugSnapshot?.({
      traceContext: {
        traceId: context.workflowRun?.traceId ?? batch?.batchRunId ?? "material-recognition-batch",
        runId: context.workflowRun?.runId ?? batch?.batchRunId ?? "material-recognition-batch",
        stageId: context.workflowRun?.stageId ?? item?.queueItemId ?? "material-recognition-batch-item",
      },
      stageName: "agentChat.materialPack.bindDefault",
      reason: error?.code ?? "material_pack_default_bind_failed",
      inputSummary: {
        conversationId: targetConversationId,
        sampleVideoId: item?.sampleVideoId ?? context.artifact?.sampleVideoId ?? null,
        workflowRunId: item?.workflowRunId ?? null,
        batchRunId: batch?.batchRunId ?? null,
        queueItemId: item?.queueItemId ?? null,
      },
      debugPayload: {
        message: error instanceof Error ? error.message : "素材包默认绑定失败",
      },
    }).catch(() => undefined);
    return null;
  });
}

function normalizeServerText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function normalizeServerBoolean(value) {
  return value === true || String(value ?? "").trim().toLowerCase() === "true";
}

function applyProcessEnvFromAppConfig(config) {
  if (config?.media?.ffmpegBinDir) process.env.FFMPEG_BIN_DIR = config.media.ffmpegBinDir;
  if (config?.subtitleRecognition?.resourceId) process.env.DOUBAO_SAUC_RESOURCE_ID = config.subtitleRecognition.resourceId;
  if (config?.subtitleRecognition?.wsUrl) process.env.DOUBAO_SAUC_WS_URL = config.subtitleRecognition.wsUrl;
  if (config?.subtitleRecognition?.modelName) process.env.DOUBAO_SAUC_MODEL_NAME = config.subtitleRecognition.modelName;
}

if (require.main === module) {
  initializeServerRuntime()
    .catch(() => undefined)
    .finally(() => {
      server.listen(port, () => process.stdout.write(`API server listening on http://127.0.0.1:${port}\n`));
    });
}

module.exports = { server, createServer, initializeServerRuntime };
