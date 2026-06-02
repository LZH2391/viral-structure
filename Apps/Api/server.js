const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createLocalStore } = require("../../Infrastructure/Storage/local-store");
const { createStageLogger } = require("../../Infrastructure/Observability/stage-logger");
const { createTraceContext } = require("../../Core/Workspace/sample-video-contracts");
const { createTraceIds } = require("../../Infrastructure/Observability/trace");
const { parseMultipartUpload, parseMultipartUploads } = require("./lib/http/multipart");
const { createJobStore } = require("./lib/stores/job-store");
const { createWorkflowRunStore } = require("./lib/stores/workflow-run-store");
const { createSampleProcessingService } = require("./lib/sample-processing/service");
const { createArtifactIndex } = require("../../Infrastructure/ArtifactIndex/artifact-index");
const { hashBuffer } = require("../../Infrastructure/ArtifactIndex/artifact-index");
const { createArtifactCacheParamBuilders } = require("./lib/modules/cache-param-builders");
const { sendJson, notFound } = require("./lib/http/utils");
const { createWorkbenchStaticHandler } = require("./lib/http/static-files");
const { sendRuntimeFile } = require("./lib/http/runtime-files");
const { readDebugTraces, readDebugTraceDetail } = require("./lib/observability/debug-traces");
const { readJsonBody, ingestUiDebugEvent } = require("./lib/observability/ui-debug-events");
const { recordApiRequestFailure } = require("./lib/observability/api-request-debug");
const { readCapabilities } = require("./lib/http/capabilities");
const { createThreadPoolProxy } = require("./lib/gateways/threadpool/proxy");
const { createShotBoundaryService } = require("./lib/shot-boundary/service");
const { createAppServerBridge } = require("./lib/gateways/appserver/bridge");
const { createActiveTurnRuntime } = require("./lib/active-turns/runtime");
const { createActiveTurnOwnerHandlers } = require("./lib/active-turns/owner-handlers");
const { handleActiveTurnsList, handleActiveTurnRetry, handleActiveTurnStop, handleActiveTurnStopThread } = require("./lib/http/active-turn-routes");
const { handleForceUpdateSeeds, handleOwnerLeaseRelease, handleThreadConversation, handleThreadDiscard, handleThreadPoolRead, handleThreadTurnTimeline } = require("./lib/http/threadpool-routes");
const { handleAgentChatConversationArchive, handleAgentChatConversationConfirm, handleAgentChatConversationDialogueReview, handleAgentChatConversationDialogueRework, handleAgentChatConversationList, handleAgentChatConversationResume, handleAgentChatConversationSystemMessage, handleAgentChatLeaseRelease, handleAgentChatManualReplacementSubmit, handleAgentChatThreadCompact, handleAgentChatThreadStart, handleAgentChatThreadStop, handleAgentChatTurnCollect, handleAgentChatTurnRetry, handleAgentChatTurnSubmit, handleAgentChatTurnStop, handleAgentChatTurnTimeline } = require("./lib/http/agent-chat-routes");
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
const { createFunctionSlotReplacementCandidateService } = require("./lib/function-slot-library/replacement-candidates");
const { buildFunctionSlotLibraryGraph } = require("./lib/function-slot-library/graph");
const { buildFunctionSlotGovernanceGraph } = require("./lib/function-slot-library/governance-graph");
const { createFunctionSlotAtomizationManualEditService } = require("./lib/function-slot-atomization/manual-edit-service");
const { createRestructureDisplayOverlayService } = require("./lib/function-slot-workflow/display-overlay-service");
const { createShotStoryboardAutoPipelineService } = require("./lib/agent-chat/shot-storyboard-auto-pipeline");

const rootDir = path.resolve(__dirname, "../..");
const port = Number(process.env.PORT || 5177);
const store = createLocalStore(rootDir);
const logger = createStageLogger(store);
const jobStore = createJobStore({ filePath: path.join(store.runtimeRoot, "Jobs", "active-jobs.json") });
const workflowRunStore = createWorkflowRunStore({ filePath: path.join(store.runtimeRoot, "WorkflowRuns", "workflow-runs.json") });
const agentConversationStore = createAgentConversationStore({ store });
const artifactIndex = createArtifactIndex({ store, cacheParamBuilders: createArtifactCacheParamBuilders() });
const service = createSampleProcessingService({ store, logger, jobStore, artifactIndex });
const appServer = createAppServerBridge();
const activeTurnOwnerHandlers = createActiveTurnOwnerHandlers({ agentConversationStore, jobStore, workflowRunStore });
const activeTurnRuntime = createActiveTurnRuntime({ store, appServer, ownerHandlers: activeTurnOwnerHandlers });
const threadPool = createThreadPoolProxy({
  readThreadImpl: async (threadId, options = {}) => appServer.readThread({ workspaceRoot: options.workspaceRoot ?? rootDir, threadId }),
});
const subtitleRevisionService = createSubtitleRevisionService({ store, logger, artifactIndex });
const executorRegistry = createExecutorRegistry({ appServer, activeTurnRuntime });
const shotBoundaryService = createShotBoundaryService({ rootDir, store, logger, jobStore, artifactIndex, threadPool, appServer, activeTurnRuntime, executorRegistry });
const functionSlotProjectionService = createFunctionSlotProjectionService({ store });
const functionSlotLibraryService = createFunctionSlotLibraryService({ rootDir, store, logger, projectionService: functionSlotProjectionService });
const moduleRegistry = createModuleRegistry({
  store,
  logger,
  jobStore,
  artifactIndex,
  functionSlotProjectionService,
  executorRegistry,
  serviceOverrides: {
    shotBoundaryService,
    sampleProcessingService: service,
  },
});
const analysisRegistry = createAnalysisRoleRegistry({ moduleRegistry });
const fullAnalysisWorkflowService = createFullAnalysisWorkflowService({ workflowRunStore, service, shotBoundaryService, moduleRegistry, jobStore, logger, store, artifactIndex });
const materialRecognitionWorkflowService = createMaterialRecognitionWorkflowService({ workflowRunStore, service, shotBoundaryService, moduleRegistry, jobStore, logger, store, artifactIndex });
const fullAnalysisBatchQueue = createFullAnalysisBatchQueue({ workflowService: fullAnalysisWorkflowService, runtimeRoot: store.runtimeRoot, logger });
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
    activeTurnRuntime: activeActiveTurnRuntime,
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
  const activeSampleService = deps.service ?? service;
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
    threadPool: deps.threadPool ?? threadPool,
    appServer: deps.appServer ?? appServer,
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
    loadSampleArtifact: deps.loadCurrentSampleArtifact ?? loadCurrentSampleArtifact,
  });
  const activeFullAnalysisBatchQueue = deps.fullAnalysisBatchQueue ?? createFullAnalysisBatchQueue({
    workflowService: activeFullAnalysisWorkflowService,
    runtimeRoot: activeStore.runtimeRoot,
    logger: activeLogger,
  });
  const handlers = {
    logger: activeLogger,
    store: activeStore,
    jobStore: activeJobStore,
    workflowRunStore: activeWorkflowRunStore,
    agentConversationStore: activeAgentConversationStore,
    artifactIndex: activeArtifactIndex,
    service: activeSampleService,
    threadPool: deps.threadPool ?? threadPool,
    appServer: deps.appServer ?? appServer,
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
    functionSlotReplacementCandidateService: activeFunctionSlotReplacementCandidateService,
    functionSlotAtomizationManualEditService: activeFunctionSlotAtomizationManualEditService,
    restructureDisplayOverlayService: activeRestructureDisplayOverlayService,
    fullAnalysisWorkflowService: activeFullAnalysisWorkflowService,
    materialRecognitionWorkflowService: activeMaterialRecognitionWorkflowService,
    fullAnalysisBatchQueue: activeFullAnalysisBatchQueue,
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
    try {
      if (req.method === "OPTIONS") return sendJson(res, 200, {});
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (req.method === "GET" && url.pathname === "/api/capabilities") return await handleCapabilities(res, handlers);
      if (req.method === "GET" && url.pathname === "/api/active-turns") return await handleActiveTurnsList(res, handlers, url);
      if (req.method === "POST" && /^\/api\/active-turns\/[^/]+\/stop$/.test(url.pathname)) return await handleActiveTurnStop(req, res, decodeURIComponent(url.pathname.split("/").at(-2)), handlers);
      if (req.method === "POST" && /^\/api\/active-turns\/[^/]+\/stop-thread$/.test(url.pathname)) return await handleActiveTurnStopThread(req, res, decodeURIComponent(url.pathname.split("/").at(-2)), handlers);
      if (req.method === "POST" && /^\/api\/active-turns\/[^/]+\/retry$/.test(url.pathname)) return await handleActiveTurnRetry(req, res, decodeURIComponent(url.pathname.split("/").at(-2)), handlers);
      if (req.method === "GET" && url.pathname === "/api/modules") return await handleModules(res, handlers);
      if (req.method === "GET" && url.pathname === "/api/analysis-roles") return await handleAnalysisRoles(res, handlers);
      if (req.method === "GET" && /^\/api\/function-slot-projection\/artifacts\/[^/]+$/.test(url.pathname)) return await handleFunctionSlotProjectionArtifact(res, decodeURIComponent(url.pathname.split("/").at(-1)), handlers);
      if (req.method === "DELETE" && /^\/api\/function-slot-projection\/artifacts\/[^/]+$/.test(url.pathname)) return await handleFunctionSlotProjectionDelete(res, decodeURIComponent(url.pathname.split("/").at(-1)), handlers);
      if (req.method === "GET" && url.pathname.startsWith("/api/function-slot-projection/")) return await handleFunctionSlotProjectionQuery(res, url, handlers);
      if (req.method === "GET" && url.pathname === "/api/function-slot-library") return await handleFunctionSlotLibraryList(res, handlers);
      if (req.method === "GET" && url.pathname === "/api/function-slot-library/replacement-candidates") return await handleFunctionSlotReplacementCandidates(res, url, handlers);
      if (req.method === "GET" && url.pathname === "/api/function-slot-library/governance/graph") return await handleFunctionSlotGovernanceGraph(res, handlers);
      if (req.method === "POST" && url.pathname === "/api/function-slot-library/governance/run") return await handleFunctionSlotGovernanceRun(req, res, handlers);
      if (req.method === "GET" && url.pathname === "/api/function-slot-restructure/confirmed-plan-trace/graph") return await handleConfirmedPlanTraceGraph(res, handlers);
      if (req.method === "POST" && url.pathname === "/api/function-slot-restructure/confirmed-plan-trace/register") return await handleConfirmedPlanTraceRegister(req, res, handlers);
      if (req.method === "GET" && url.pathname === "/api/function-slot-governance/plan-overlays") return await handleFunctionSlotGovernancePlanOverlays(res);
      if (req.method === "POST" && url.pathname === "/api/function-slot-library/builder/refresh") return await handleFunctionSlotLibraryBuilderRefresh(req, res, handlers);
      if (req.method === "GET" && /^\/api\/function-slot-library\/[^/]+\/graph$/.test(url.pathname)) return await handleFunctionSlotLibraryGraph(res, decodeURIComponent(url.pathname.split("/").at(-2)), handlers);
      if (req.method === "POST" && /^\/api\/function-slot-library\/[^/]+\/project$/.test(url.pathname)) return await handleFunctionSlotLibraryProject(res, decodeURIComponent(url.pathname.split("/").at(-2)), handlers);
      if (req.method === "DELETE" && /^\/api\/function-slot-library\/[^/]+$/.test(url.pathname)) return await handleFunctionSlotLibraryDelete(res, decodeURIComponent(url.pathname.split("/").at(-1)), handlers);
      if (req.method === "POST" && /^\/api\/function-slot-workflow\/[^/]+\/run$/.test(url.pathname)) return await handleFunctionSlotWorkflowPlaceholder(req, res, decodeURIComponent(url.pathname.split("/").at(-2)), handlers);
      if (req.method === "POST" && url.pathname === "/api/function-slot-workflow/storyboard-prep/auto-run") return await handleStoryboardPrepAutoRun(req, res, handlers);
      if (req.method === "POST" && url.pathname === "/api/agent-chat/threads") return await handleAgentChatThreadStart(req, res, handlers);
      if (req.method === "GET" && url.pathname === "/api/agent-chat/conversations") return await handleAgentChatConversationList(res, handlers, url);
      if (req.method === "POST" && /^\/api\/agent-chat\/conversations\/[^/]+\/resume$/.test(url.pathname)) return await handleAgentChatConversationResume(res, decodeURIComponent(url.pathname.split("/").at(-2)), handlers);
      if (req.method === "POST" && /^\/api\/agent-chat\/conversations\/[^/]+\/archive$/.test(url.pathname)) return await handleAgentChatConversationArchive(req, res, decodeURIComponent(url.pathname.split("/").at(-2)), handlers);
      if (req.method === "POST" && /^\/api\/agent-chat\/conversations\/[^/]+\/confirm$/.test(url.pathname)) return await handleAgentChatConversationConfirm(req, res, decodeURIComponent(url.pathname.split("/").at(-2)), handlers);
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
      if (req.method === "POST" && url.pathname === "/api/workflows/full-analysis/runs") return await handleFullAnalysisRun(req, res, handlers);
      if (req.method === "POST" && url.pathname === "/api/workflows/full-analysis/batch-runs") return await handleFullAnalysisBatchRun(req, res, handlers);
      if (req.method === "GET" && url.pathname === "/api/workflows/full-analysis/batch-runs/latest") return await handleFullAnalysisBatchLatest(res, handlers, url);
      if (req.method === "GET" && /^\/api\/workflows\/full-analysis\/batch-runs\/[^/]+$/.test(url.pathname)) return await handleFullAnalysisBatchRead(res, decodeURIComponent(url.pathname.split("/").at(-1)), handlers);
      if (req.method === "POST" && /^\/api\/workflows\/full-analysis\/batch-runs\/[^/]+\/items\/[^/]+\/retry$/.test(url.pathname)) return await handleFullAnalysisBatchItemRetry(res, decodeURIComponent(url.pathname.split("/").at(-4)), decodeURIComponent(url.pathname.split("/").at(-2)), handlers);
      if (req.method === "POST" && url.pathname === "/api/workflows/full-analysis/cache-check") return await handleFullAnalysisCacheCheck(req, res, handlers);
      if (req.method === "GET" && url.pathname === "/api/workflows/full-analysis/latest") return await handleLatestFullAnalysisRun(res, handlers);
      if (req.method === "GET" && /^\/api\/sample-videos\/[^/]+\/workflows\/full-analysis\/latest$/.test(url.pathname)) return await handleLatestFullAnalysisRunForSample(res, decodeURIComponent(url.pathname.split("/").at(-4)), handlers);
      if (req.method === "POST" && url.pathname === "/api/workflows/material-recognition/runs") return await handleMaterialRecognitionRun(req, res, handlers);
      if (req.method === "POST" && url.pathname === "/api/workflows/material-recognition/cache-check") return await handleFullAnalysisCacheCheck(req, res, handlers);
      if (req.method === "GET" && url.pathname === "/api/workflows/material-recognition/latest") return await handleLatestMaterialRecognitionRun(res, handlers);
      if (req.method === "GET" && /^\/api\/sample-videos\/[^/]+\/workflows\/material-recognition\/latest$/.test(url.pathname)) return await handleLatestMaterialRecognitionRunForSample(res, decodeURIComponent(url.pathname.split("/").at(-4)), handlers);
      if (req.method === "GET" && /^\/api\/workflows\/runs\/[^/]+$/.test(url.pathname)) return await handleWorkflowRun(res, decodeURIComponent(url.pathname.split("/").at(-1)), handlers);
      if (req.method === "POST" && /^\/api\/workflows\/runs\/[^/]+\/stages\/[^/]+\/rerun$/.test(url.pathname)) return await handleWorkflowStageRerun(res, decodeURIComponent(url.pathname.split("/").at(-4)), decodeURIComponent(url.pathname.split("/").at(-2)), handlers);
      if (req.method === "POST" && /^\/api\/workspaces\/[^/]+\/sample-videos$/.test(url.pathname)) return await handleUpload(req, res, url, handlers);
      if (req.method === "GET" && /^\/api\/processing-jobs\/[^/]+$/.test(url.pathname)) return handleJob(res, url.pathname.split("/").at(-1), handlers);
      if (req.method === "POST" && /^\/api\/processing-jobs\/[^/]+\/cache-decision$/.test(url.pathname)) return await handleJobCacheDecision(req, res, url.pathname.split("/").at(-2), handlers);
      if (req.method === "GET" && /^\/api\/sample-videos\/[^/]+\/artifact$/.test(url.pathname)) return await handleArtifact(res, url.pathname.split("/").at(-2), handlers);
      if (req.method === "POST" && /^\/api\/sample-videos\/[^/]+\/function-slot-projection$/.test(url.pathname)) return await handleFunctionSlotProjectionProjectSample(res, decodeURIComponent(url.pathname.split("/").at(-2)), url, handlers);
      if (req.method === "POST" && /^\/api\/sample-videos\/[^/]+\/function-slot-library\/export$/.test(url.pathname)) return await handleFunctionSlotLibraryExport(res, decodeURIComponent(url.pathname.split("/").at(-3)), url, handlers);
      if (req.method === "POST" && /^\/api\/sample-videos\/[^/]+\/function-slot-atomization\/manual-boundary-edit$/.test(url.pathname)) return await handleFunctionSlotAtomizationManualBoundaryEdit(req, res, decodeURIComponent(url.pathname.split("/").at(-3)), handlers);
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
  const activeStore = runtime.store ?? store;
  const activeShotBoundaryService = runtime.shotBoundaryService ?? shotBoundaryService;
  await activeStore.ensureRuntimeDirs();
  if (typeof activeShotBoundaryService.interruptActiveAgentRuns === "function") {
    await activeShotBoundaryService.interruptActiveAgentRuns("server-startup");
    return;
  }
  await activeShotBoundaryService.recoverActiveAgentRuns();
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

async function handleFunctionSlotProjectionQuery(res, url, handlers = {}) {
  const service = handlers.functionSlotProjectionService ?? functionSlotProjectionService;
  const resource = url.pathname.split("/").at(-1);
  const filters = Object.fromEntries(url.searchParams.entries());
  if (resource === "slots") return sendJson(res, 200, { items: await service.querySlots(filters) });
  if (resource === "atoms") return sendJson(res, 200, { items: await service.queryAtoms(filters) });
  if (resource === "bindings") return sendJson(res, 200, { items: await service.queryBindings(filters) });
  if (resource === "rules") return sendJson(res, 200, { items: await service.queryRules(filters) });
  return notFound(res);
}

async function handleFunctionSlotProjectionArtifact(res, artifactId, handlers = {}) {
  const service = handlers.functionSlotProjectionService ?? functionSlotProjectionService;
  const summary = await service.getArtifactProjectionSummary(artifactId);
  if (!summary) return notFound(res);
  return sendJson(res, 200, { exists: true, ...summary });
}

async function handleFunctionSlotProjectionProjectSample(res, sampleVideoId, url, handlers = {}) {
  const service = handlers.functionSlotProjectionService ?? functionSlotProjectionService;
  const mode = url.searchParams.get("mode") === "skip-existing" ? "skip-existing" : "replace";
  const summary = await service.projectSampleCurrentArtifact(sampleVideoId, { mode });
  if (!summary) {
    return sendJson(res, 404, {
      error: "function_slot_projection_source_missing",
      code: "function_slot_projection_source_missing",
      message: "样例不存在或没有功能槽位原子化 artifact",
    });
  }
  return sendJson(res, 200, summary);
}

async function handleFunctionSlotProjectionDelete(res, artifactId, handlers = {}) {
  const service = handlers.functionSlotProjectionService ?? functionSlotProjectionService;
  const summary = await service.deleteArtifactProjection(artifactId);
  if (!summary) return notFound(res);
  return sendJson(res, 200, { deleted: true, ...summary });
}

async function handleFunctionSlotLibraryExport(res, sampleVideoId, url, handlers = {}) {
  const service = handlers.functionSlotLibraryService ?? functionSlotLibraryService;
  const requestedMode = url.searchParams.get("mode");
  const mode = requestedMode ?? "replace";
  const result = await service.exportSampleArtifact(sampleVideoId, { mode });
  if (!result) {
    return sendJson(res, 404, {
      error: "function_slot_library_source_missing",
      code: "function_slot_library_source_missing",
      message: "样例不存在或没有功能槽位原子化 artifact",
    });
  }
  return sendJson(res, 200, result);
}

async function handleFunctionSlotLibraryList(res, handlers = {}) {
  const service = handlers.functionSlotLibraryService ?? functionSlotLibraryService;
  return sendJson(res, 200, { items: await service.listLibraryItems() });
}

async function handleFunctionSlotReplacementCandidates(res, url, handlers = {}) {
  const service = handlers.functionSlotReplacementCandidateService;
  if (!service?.listCandidates) {
    return sendJson(res, 503, {
      error: "function_slot_replacement_candidates_unavailable",
      code: "function_slot_replacement_candidates_unavailable",
      message: "FunctionSlotLibrary replacement candidate 服务不可用",
    });
  }
  const result = await service.listCandidates({
    kind: url.searchParams.get("kind"),
    atomKind: url.searchParams.get("atomKind"),
    slotSubtypeId: url.searchParams.get("slotSubtypeId"),
    q: url.searchParams.get("q"),
    limit: url.searchParams.get("limit"),
  });
  return sendJson(res, 200, result);
}

async function handleFunctionSlotLibraryBuilderRefresh(req, res, handlers = {}) {
  const body = await (handlers.readJsonBodyImpl ?? readJsonBody)(req).catch(() => ({}));
  const service = handlers.functionSlotLibraryBuilderService;
  if (!service?.refresh) {
    return sendJson(res, 503, {
      error: "function_slot_library_builder_unavailable",
      code: "function_slot_library_builder_unavailable",
      message: "FunctionSlotLibrary builder 服务不可用",
    });
  }
  const result = await service.refresh({
    mode: body.mode === "replace" ? "replace" : "skip-existing",
    updateGovernance: body.updateGovernance !== false,
  });
  return sendJson(res, 200, result);
}

async function handleFunctionSlotGovernanceRun(req, res, handlers = {}) {
  const body = await (handlers.readJsonBodyImpl ?? readJsonBody)(req).catch(() => ({}));
  const service = handlers.functionSlotGovernanceService;
  if (!service?.enqueue) {
    return sendJson(res, 503, {
      error: "function_slot_governance_unavailable",
      code: "function_slot_governance_unavailable",
      message: "FunctionSlotLibrary 语义治理服务不可用",
    });
  }
  const result = await service.enqueue({
    refreshEvidence: body.refreshEvidence !== false,
  });
  return sendJson(res, 202, result);
}

async function handleStoryboardPrepAutoRun(req, res, handlers = {}) {
  const body = await (handlers.readJsonBodyImpl ?? readJsonBody)(req).catch(() => ({}));
  const sampleVideoId = body.sampleVideoId ?? "function-slot-workflow";
  const parentArtifactId = body.parentArtifactId ?? body.restructureArtifactId ?? null;
  const resolvedInputs = await resolveStoryboardPrepInputs(body, handlers);
  if (!resolvedInputs.restructureFinalPath) {
    return sendJson(res, 400, {
      error: "storyboard_prep_restructure_required",
      code: "storyboard_prep_restructure_required",
      message: "需要可解析到文件的 restructureFinalPath；仅有 artifactId 时不会让 agent 猜路径",
      missing: ["restructureFinalPath"],
    });
  }
  if (!handlers.shotStoryboardAutoPipelineService?.enqueue) {
    return sendJson(res, 503, {
      error: "storyboard_prep_pipeline_unavailable",
      code: "storyboard_prep_pipeline_unavailable",
      message: "Shot Storyboard Prep pipeline 服务不可用",
    });
  }
  const result = await handlers.shotStoryboardAutoPipelineService.enqueue({
    ...body,
    ...resolvedInputs,
    sampleVideoId,
    parentArtifactId,
  });
  return sendJson(res, 202, result);
}

async function resolveStoryboardPrepInputs(body, handlers = {}) {
  const conversationId = normalizeOptionalText(body.conversationId);
  const conversation = conversationId ? await handlers.agentConversationStore?.get?.(conversationId) : null;
  const confirmed = conversation?.confirmedPlan ?? {};
  return {
    restructureFinalPath: normalizeOptionalText(body.restructureFinalPath) ?? normalizeOptionalText(confirmed.sourceRestructurePath),
    shotDesignFinalPath: normalizeOptionalText(body.shotDesignFinalPath) ?? normalizeOptionalText(confirmed.sourceShotDesignPath),
    materialFrameMaps: normalizeStringArray(body.materialFrameMaps),
    materialFrameMap: normalizeOptionalText(body.materialFrameMap),
    visualManifest: normalizeOptionalText(body.visualManifest),
    frameMap: normalizeOptionalText(body.frameMap),
    userMaterialPackPath: normalizeOptionalText(body.userMaterialPackPath),
    conversationId,
  };
}

async function startFunctionSlotAutoRunTurn({ handlers, role, stageName, sampleVideoId, parentArtifactId, body }) {
  const traceContext = createTraceContext(createTraceIds());
  const startedAt = Date.now();
  const job = handlers.jobStore?.createJob?.({ sampleVideoId, traceId: traceContext.traceId });
  const inputSummary = {
    role,
    sampleVideoId,
    parentArtifactId,
    restructureArtifactId: normalizeOptionalText(body.restructureArtifactId),
    restructureFinalPath: normalizeOptionalText(body.restructureFinalPath),
    confirmationId: normalizeOptionalText(body.confirmationId),
    trigger: "restructure-confirmed",
  };
  await handlers.logger.writeStageLog({
    traceContext,
    stageName,
    event: "stage.start",
    parentArtifactId,
    inputSummary,
  });
  let acquiredLease = null;
  let acquiredOwnerId = null;
  try {
    const readiness = await handlers.threadPool.ensureRoleReady(role);
    if (!readiness?.ok) throw codedWorkflowError(readiness?.error ?? "threadpool_role_unavailable", readiness?.message ?? "ThreadPool role 暂不可用", readiness);
    const ownerId = `${role}:${traceContext.traceId}`;
    acquiredOwnerId = ownerId;
    const lease = await handlers.threadPool.acquireLease({ role, ownerId });
    acquiredLease = lease;
    const threadId = lease.thread_id ?? lease.threadId ?? null;
    if (!threadId) throw codedWorkflowError("threadpool_lease_missing_thread", "ThreadPool lease 未返回 threadId", { leaseStatus: lease.status ?? null });
    const workspaceRoot = readiness.status?.workspaceRoot ?? handlers.rootDir;
    const skillPath = readiness.status?.skillPath ?? null;
    const turnInputs = buildFunctionSlotAutoRunInputs({ role, body: { ...body, sampleVideoId, parentArtifactId } });
    const activeTurnBinding = {
      ownerType: "processing-job",
      ownerId: job?.jobId ?? ownerId,
      currentAttemptId: job?.jobId ? `${job.jobId}:${traceContext.stageId}` : `${ownerId}:${traceContext.stageId}`,
      stageName,
      traceId: traceContext.traceId,
      runId: traceContext.runId,
      stageId: traceContext.stageId,
      artifactId: job?.jobId ?? null,
      parentArtifactId,
      leaseId: lease.lease_id ?? lease.leaseId ?? null,
      threadPoolOwnerId: ownerId,
      replayRef: {
        type: "processing-job-input",
        refId: job?.jobId ?? ownerId,
      },
    };
    const started = typeof handlers.activeTurnRuntime?.start === "function"
      ? await handlers.activeTurnRuntime.start({
          workspaceRoot,
          threadId,
          skillPath,
          inputs: turnInputs,
          timeoutSeconds: 240,
          binding: activeTurnBinding,
          enforceThreadId: true,
        })
      : await handlers.appServer.startTurnWithInputs({
          workspaceRoot,
          threadId,
          skillPath,
          inputs: turnInputs,
          timeoutSeconds: 240,
        });
    assertExpectedAutoRunThread(started, threadId);
    const artifactId = job?.jobId ?? started.turnId ?? started.turn?.id ?? null;
    const result = {
      ok: true,
      sampleVideoId,
      traceId: traceContext.traceId,
      runId: traceContext.runId,
      stageId: traceContext.stageId,
      artifactId,
      parentArtifactId,
      confirmationId: normalizeOptionalText(body.confirmationId),
      status: started.status ?? "submitted",
      role,
      threadId: started.threadId ?? threadId,
      turnId: artifactId,
      leaseId: lease.lease_id ?? lease.leaseId ?? null,
      ownerId,
      workspaceRoot,
      message: `${role} 已提交真实 ThreadPool turn。`,
    };
    await handlers.logger.writeStageLog({
      traceContext,
      stageName,
      event: "stage.end",
      artifactId,
      parentArtifactId,
      outputSummary: {
        role,
        status: result.status,
        threadId: result.threadId,
        turnId: result.turnId,
        leaseId: result.leaseId,
      },
      durationMs: Date.now() - startedAt,
    });
    if (job?.jobId) {
      handlers.jobStore.updateJob(job.jobId, {
        stage: stageName,
        status: "processing",
        progress: 15,
        runId: traceContext.runId,
        stageId: traceContext.stageId,
        artifactId,
        parentArtifactId,
        agentRun: {
          role,
          threadId: result.threadId,
          turnId: result.turnId,
          currentAttemptId: `${job.jobId}:${traceContext.stageId}`,
          leaseId: result.leaseId,
          ownerId,
          confirmationId: result.confirmationId,
          status: "turn_submitted",
          startedAt: new Date().toISOString(),
        },
        activeTurnReplay: {
          type: "function-slot-auto-run-input",
          inputs: turnInputs,
          sourceTurnId: result.turnId,
          createdAt: new Date().toISOString(),
        },
      });
      result.processingJobId = job.jobId;
    }
    return result;
  } catch (error) {
    await releaseAutoRunLeaseOnFailure({ handlers, lease: acquiredLease, ownerId: acquiredOwnerId });
    const safeError = {
      code: error?.code ?? "function_slot_auto_run_failed",
      message: safePreview(error instanceof Error ? error.message : "自动触发失败", 240),
      stageName,
      retryable: error?.statusCode ? error.statusCode >= 500 : true,
      debugSnapshotUri: null,
    };
    const snapshot = await handlers.logger.writeDebugSnapshot({
      traceContext,
      stageName,
      parentArtifactId,
      reason: safeError.code,
      inputSummary,
      debugPayload: {
        code: safeError.code,
        message: safeError.message,
        detail: summarizeErrorDebugPayload(error?.debugPayload ?? error?.payload ?? null),
      },
    });
    safeError.debugSnapshotUri = snapshot.uri;
    await handlers.logger.writeStageLog({
      traceContext,
      stageName,
      event: "stage.fail",
      parentArtifactId,
      errorSummary: safeError,
      durationMs: Date.now() - startedAt,
    });
    error.code = safeError.code;
    error.statusCode = error.statusCode ?? 503;
    error.debugSnapshotUri = snapshot.uri;
    throw error;
  }
}

function buildFunctionSlotAutoRunInputs({ role, body }) {
  const title = "请基于已确认的重组方案执行 Shot Storyboard Prep，并在生成 prompt 后继续触发 image-generation 故事板生图。";
  const payload = {
    trigger: "restructure-confirmed",
    restructureFinalPath: body.restructureFinalPath ?? null,
    restructureArtifactId: body.restructureArtifactId ?? null,
    parentArtifactId: body.parentArtifactId ?? null,
    confirmationId: body.confirmationId ?? null,
    sampleVideoId: body.sampleVideoId ?? null,
    runImageGeneration: body.runImageGeneration !== false,
  };
  return [{
    type: "text",
    text: `${title}\n\n输入摘要：\n${JSON.stringify(payload, null, 2)}`,
    text_elements: [],
  }];
}

function codedWorkflowError(code, message, debugPayload = null, statusCode = null) {
  const error = new Error(message);
  error.code = code;
  error.debugPayload = debugPayload;
  if (statusCode) error.statusCode = statusCode;
  return error;
}

function assertExpectedAutoRunThread(result, expectedThreadId) {
  const actualThreadId = normalizeOptionalText(result?.threadId ?? result?.thread?.id);
  const expected = normalizeOptionalText(expectedThreadId);
  if (!actualThreadId || !expected || actualThreadId === expected) return;
  throw codedWorkflowError("appserver_turn_start_thread_mismatch", "AppServer turn/start 返回了非目标 thread", {
    expectedThreadId: expected,
    actualThreadId,
    turnId: result?.turnId ?? result?.turn?.id ?? null,
    status: result?.status ?? null,
  }, 502);
}

async function releaseAutoRunLeaseOnFailure({ handlers, lease, ownerId }) {
  const leaseId = lease?.lease_id ?? lease?.leaseId ?? null;
  if (!leaseId || !ownerId || typeof handlers.threadPool?.releaseLease !== "function") return null;
  return handlers.threadPool.releaseLease({ leaseId, ownerId }).catch(() => null);
}

function normalizeOptionalText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeOptionalText).filter(Boolean);
}

function safePreview(value, limit = 240) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length <= limit ? text : `${text.slice(0, limit)}...`;
}

function summarizeErrorDebugPayload(value) {
  if (!value) return null;
  try {
    return safePreview(JSON.stringify(value), 500);
  } catch {
    return safePreview(value, 500);
  }
}

async function handleFunctionSlotLibraryProject(res, artifactId, handlers = {}) {
  const service = handlers.functionSlotLibraryService ?? functionSlotLibraryService;
  const result = await service.projectLibraryArtifact(artifactId);
  if (!result) return notFound(res);
  return sendJson(res, 200, result);
}

async function handleFunctionSlotLibraryGraph(res, artifactId, handlers = {}) {
  const service = handlers.functionSlotLibraryService ?? functionSlotLibraryService;
  const libraryArtifact = await service.readLibraryArtifact(artifactId);
  if (!libraryArtifact) return notFound(res);
  return sendJson(res, 200, buildFunctionSlotLibraryGraph(libraryArtifact));
}

async function handleFunctionSlotGovernanceGraph(res, handlers = {}) {
  const service = handlers.functionSlotLibraryService ?? functionSlotLibraryService;
  const governance = await service.readSemanticGovernance();
  if (!governance) return notFound(res);
  return sendJson(res, 200, buildFunctionSlotGovernanceGraph(governance));
}

async function handleConfirmedPlanTraceGraph(res, handlers = {}) {
  const traceService = handlers.restructureDisplayOverlayService;
  if (!traceService?.readConfirmedPlanTraceGraph) {
    return sendJson(res, 503, {
      error: "confirmed_plan_trace_unavailable",
      code: "confirmed_plan_trace_unavailable",
      message: "确定方案溯源图服务不可用",
    });
  }
  return sendJson(res, 200, await traceService.readConfirmedPlanTraceGraph());
}

async function handleConfirmedPlanTraceRegister(req, res, handlers = {}) {
  const body = await (handlers.readJsonBodyImpl ?? readJsonBody)(req).catch(() => ({}));
  const traceService = handlers.restructureDisplayOverlayService;
  if (!traceService?.registerDisplayJson) {
    return sendJson(res, 503, {
      error: "confirmed_plan_trace_register_unavailable",
      code: "confirmed_plan_trace_register_unavailable",
      message: "确定方案溯源登记服务不可用",
    });
  }
  const traceContext = createTraceIds();
  const result = await traceService.registerDisplayJson({
    displayJsonPath: body.displayJsonPath,
    restructureFinalPath: body.restructureFinalPath,
    sourceTurnId: body.sourceTurnId,
    parentArtifactId: body.parentArtifactId,
    confirmationId: body.confirmationId,
    traceContext,
  });
  return sendJson(res, result.ok ? 200 : 422, {
    ...result,
    traceId: traceContext.traceId,
    runId: traceContext.runId,
    stageId: traceContext.stageId,
  });
}

async function handleFunctionSlotGovernancePlanOverlays(res) {
  return sendJson(res, 410, {
    error: "governance_plan_overlay_removed",
    code: "governance_plan_overlay_removed",
    message: "治理图方案投影已解耦，请使用 /api/function-slot-restructure/confirmed-plan-trace/graph",
  });
}

async function handleFunctionSlotLibraryDelete(res, artifactId, handlers = {}) {
  const service = handlers.functionSlotLibraryService ?? functionSlotLibraryService;
  const result = await service.deleteLibraryItem(artifactId);
  if (!result) return notFound(res);
  return sendJson(res, 200, result);
}

async function handleFunctionSlotWorkflowPlaceholder(req, res, workflowKey, handlers = {}) {
  const body = await (handlers.readJsonBodyImpl ?? readJsonBody)(req).catch(() => ({}));
  const moduleId = resolveFunctionSlotWorkflowModuleId(workflowKey);
  if (!moduleId) {
    return sendJson(res, 404, {
      error: "function_slot_workflow_placeholder_not_found",
      code: "function_slot_workflow_placeholder_not_found",
      message: "未知功能槽位工作流占位入口",
    });
  }
  const result = await (handlers.moduleRegistry ?? moduleRegistry).startModule({
    moduleId,
    sampleVideoId: body.sampleVideoId ?? "function-slot-workflow",
    body,
  });
  return sendJson(res, 202, result);
}

function resolveFunctionSlotWorkflowModuleId(workflowKey) {
  if (workflowKey === "semantic-governance") return "function-slot-semantic-governance";
  if (workflowKey === "restructure") return "function-slot-restructure";
  if (workflowKey === "shot-storyboard-prep") return "shot-storyboard-prep";
  return null;
}

async function handleFunctionSlotAtomizationManualBoundaryEdit(req, res, sampleVideoId, handlers = {}) {
  const body = await (handlers.readJsonBodyImpl ?? readJsonBody)(req);
  const service = handlers.functionSlotAtomizationManualEditService;
  if (!service?.applyBoundaryManualEdit) {
    return sendJson(res, 503, {
      error: "function_slot_atomization_manual_edit_unavailable",
      code: "function_slot_atomization_manual_edit_unavailable",
      message: "功能槽位原子化手动修正服务不可用",
    });
  }
  const result = await service.applyBoundaryManualEdit({
    sampleVideoId,
    editedJsonText: body.editedJsonText ?? body.jsonText ?? null,
    editedJson: body.editedJson ?? null,
    expectedArtifactId: body.expectedArtifactId ?? null,
    sourceBoundaryReviewArtifactId: body.sourceBoundaryReviewArtifactId ?? null,
  });
  return sendJson(res, 200, result);
}

async function handleFullAnalysisRun(req, res, handlers = {}) {
  const { file, fields } = await parseMultipartUpload(req, req.headers["content-type"]);
  const result = await (handlers.fullAnalysisWorkflowService ?? fullAnalysisWorkflowService).start({
    workspaceId: fields.workspaceId || "default-workspace",
    file,
    fields,
  });
  return sendJson(res, 202, result);
}

async function handleMaterialRecognitionRun(req, res, handlers = {}) {
  const { file, fields } = await parseMultipartUpload(req, req.headers["content-type"]);
  const result = await (handlers.materialRecognitionWorkflowService ?? materialRecognitionWorkflowService).start({
    workspaceId: fields.workspaceId || "default-workspace",
    file,
    fields,
  });
  return sendJson(res, 202, result);
}

async function handleFullAnalysisBatchRun(req, res, handlers = {}) {
  const { files, fields } = await parseMultipartUploads(req, req.headers["content-type"]);
  const queue = handlers.fullAnalysisBatchQueue ?? fullAnalysisBatchQueue;
  const result = queue.createBatch({
    workspaceId: fields.workspaceId || "default-workspace",
    files,
    fields,
  });
  return sendJson(res, 202, result);
}

async function handleFullAnalysisBatchRead(res, batchRunId, handlers = {}) {
  const queue = handlers.fullAnalysisBatchQueue ?? fullAnalysisBatchQueue;
  await queue.advance?.(batchRunId).catch(() => undefined);
  const batch = queue.getBatch(batchRunId);
  if (!batch) return notFound(res);
  return sendJson(res, 200, batch);
}

async function handleFullAnalysisBatchLatest(res, handlers = {}, url = null) {
  const queue = handlers.fullAnalysisBatchQueue ?? fullAnalysisBatchQueue;
  const activeOnly = url?.searchParams?.get("active") === "true";
  const batch = activeOnly ? queue.getLatestActiveBatch?.() : queue.getLatestBatch?.();
  if (!batch) return notFound(res);
  await queue.advance?.(batch.batchRunId).catch(() => undefined);
  const updated = queue.getBatch?.(batch.batchRunId) ?? batch;
  return sendJson(res, 200, updated);
}

async function handleFullAnalysisBatchItemRetry(res, batchRunId, queueItemId, handlers = {}) {
  const queue = handlers.fullAnalysisBatchQueue ?? fullAnalysisBatchQueue;
  const batch = queue.retryItem?.(batchRunId, queueItemId);
  if (!batch) return notFound(res);
  return sendJson(res, 202, batch);
}

async function handleFullAnalysisCacheCheck(req, res, handlers = {}) {
  const { file, fields } = await parseMultipartUpload(req, req.headers["content-type"]);
  if (fields.cacheDecision === "refresh") return sendJson(res, 200, { cacheHit: false });
  const cachedItem = await (handlers.artifactIndex ?? artifactIndex).findLatestByFileHash(hashBuffer(file.buffer));
  return sendJson(res, 200, cachedItem ? { cacheHit: true, cachedItem } : { cacheHit: false });
}

async function handleLatestFullAnalysisRun(res, handlers = {}) {
  const workflow = handlers.fullAnalysisWorkflowService ?? fullAnalysisWorkflowService;
  const latest = workflow.getLatest?.() ?? null;
  if (latest?.workflowRunId && typeof workflow.advance === "function") {
    await workflow.advance(latest.workflowRunId).catch(() => undefined);
  }
  const run = latest?.workflowRunId ? (workflow.get(latest.workflowRunId) ?? latest) : null;
  if (!run) return notFound(res);
  return sendJson(res, 200, run);
}

async function handleLatestFullAnalysisRunForSample(res, sampleVideoId, handlers = {}) {
  const workflow = handlers.fullAnalysisWorkflowService ?? fullAnalysisWorkflowService;
  const latest = workflow.getLatestBySampleVideoId?.(sampleVideoId) ?? null;
  if (latest?.workflowRunId && typeof workflow.advance === "function") {
    await workflow.advance(latest.workflowRunId).catch(() => undefined);
  }
  const run = latest?.workflowRunId ? (workflow.get(latest.workflowRunId) ?? latest) : null;
  if (!run) return notFound(res);
  return sendJson(res, 200, run);
}

async function handleLatestMaterialRecognitionRun(res, handlers = {}) {
  const workflow = handlers.materialRecognitionWorkflowService ?? materialRecognitionWorkflowService;
  const latest = workflow.getLatest?.() ?? null;
  if (latest?.workflowRunId && typeof workflow.advance === "function") {
    await workflow.advance(latest.workflowRunId).catch(() => undefined);
  }
  const run = latest?.workflowRunId ? (workflow.get(latest.workflowRunId) ?? latest) : null;
  if (!run) return notFound(res);
  return sendJson(res, 200, run);
}

async function handleLatestMaterialRecognitionRunForSample(res, sampleVideoId, handlers = {}) {
  const workflow = handlers.materialRecognitionWorkflowService ?? materialRecognitionWorkflowService;
  const latest = workflow.getLatestBySampleVideoId?.(sampleVideoId) ?? null;
  if (latest?.workflowRunId && typeof workflow.advance === "function") {
    await workflow.advance(latest.workflowRunId).catch(() => undefined);
  }
  const run = latest?.workflowRunId ? (workflow.get(latest.workflowRunId) ?? latest) : null;
  if (!run) return notFound(res);
  return sendJson(res, 200, run);
}

async function handleWorkflowRun(res, workflowRunId, handlers = {}) {
  const workflow = resolveWorkflowService(workflowRunId, handlers);
  if (typeof workflow.advance === "function") {
    await workflow.advance(workflowRunId).catch(() => undefined);
  }
  const run = workflow.get(workflowRunId);
  if (!run) return notFound(res);
  return sendJson(res, 200, run);
}

async function handleWorkflowStageRerun(res, workflowRunId, stageKey, handlers = {}) {
  const run = await resolveWorkflowService(workflowRunId, handlers).rerunStage({ workflowRunId, stageKey });
  if (!run) return notFound(res);
  return sendJson(res, 202, run);
}

function resolveWorkflowService(workflowRunId, handlers = {}) {
  const storedRun = (handlers.workflowRunStore ?? workflowRunStore).getRun?.(workflowRunId);
  if (storedRun?.workflowKey === "material-recognition") {
    return handlers.materialRecognitionWorkflowService ?? materialRecognitionWorkflowService;
  }
  return handlers.fullAnalysisWorkflowService ?? fullAnalysisWorkflowService;
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

async function handleLibraryItems(res, handlers = {}) {
  return sendJson(res, 200, { items: await (handlers.artifactIndex ?? artifactIndex).listItems() });
}

async function handleLibraryItem(res, sampleVideoId, handlers = {}) {
  const item = await (handlers.artifactIndex ?? artifactIndex).getItem(sampleVideoId);
  if (!item) return notFound(res);
  return sendJson(res, 200, item);
}

async function handleLibraryLoad(res, sampleVideoId, handlers = {}) {
  const artifact = await (handlers.artifactIndex ?? artifactIndex).loadItem(sampleVideoId);
  if (!artifact) return notFound(res);
  return sendJson(res, 200, { sampleArtifact: artifact });
}

async function handleLibraryDeleteCache(res, sampleVideoId, handlers = {}) {
  const activeArtifactIndex = handlers.artifactIndex ?? artifactIndex;
  const activeStore = handlers.store ?? store;
  const result = await activeArtifactIndex.deleteCacheForItem(sampleVideoId);
  if (!result) return notFound(res);
  for (const removedId of result.removedSampleVideoIds) {
    await fs.promises.rm(activeStore.sampleDir(removedId), { recursive: true, force: true }).catch(() => undefined);
  }
  return sendJson(res, 200, { ok: true, ...result });
}

async function handleDebugTraces(res, handlers = {}) {
  const activeStore = handlers.store ?? store;
  return sendJson(res, 200, await (handlers.readDebugTracesImpl ?? readDebugTraces)(activeStore.runtimeRoot));
}

async function handleUiDebugEvent(req, res, handlers = {}) {
  const body = await (handlers.readJsonBodyImpl ?? readJsonBody)(req);
  return sendJson(res, 200, await (handlers.ingestUiDebugEventImpl ?? ingestUiDebugEvent)(handlers.logger ?? logger, body));
}

async function handleDebugTraceDetail(res, traceId, handlers = {}) {
  const activeStore = handlers.store ?? store;
  const trace = await (handlers.readDebugTraceDetailImpl ?? readDebugTraceDetail)(activeStore.runtimeRoot, traceId);
  if (!trace) return notFound(res);
  return sendJson(res, 200, trace);
}

if (require.main === module) {
  initializeServerRuntime()
    .catch(() => undefined)
    .finally(() => {
      server.listen(port, () => process.stdout.write(`API server listening on http://127.0.0.1:${port}\n`));
    });
}

module.exports = { server, createServer, initializeServerRuntime };
