import type { AgentChatArtifactRef, AgentChatConversation, AgentChatDialogueRoboticReview, AgentChatSlotAtomDisplay, AgentTurnTimeline, AnalysisRoleSummary, AtomReplacement, BackendCapabilities, DebugTraceDetail, DebugTraceSummary, FullAnalysisBatchRun, FunctionSlotLibraryGraph, LibraryItemDetail, LibraryItemSummary, ModuleSummary, ProcessingJob, ReplacementCandidate, SampleArtifact, SlotReplacement, ThreadConversation, ThreadPoolHealth, ThreadPoolRoleDetail, ThreadPoolRoleSummary, UiDebugEventRequest, WorkflowRun } from "../types";

const WORKSPACE_ID = "default-workspace";

export const API_BASE_URL = location.protocol.startsWith("http") ? location.origin : "http://127.0.0.1:5177";

export type UploadSampleResponse =
  | { cacheHit: true; cachedItem: LibraryItemSummary; fileHash?: string }
  | { processingJobId: string; sampleVideoId: string; traceId: string; cacheHit?: false };

export type ShotBoundaryStartResponse =
  | { cacheHit: true; cachedItem: LibraryItemSummary }
  | { processingJobId: string; sampleVideoId: string; traceId: string; cacheHit?: false };

export type AnalysisStartResponse =
  | { cacheHit: true; cachedItem: LibraryItemSummary }
  | { processingJobId: string; sampleVideoId: string; traceId: string; cacheHit?: false };

export type ScriptSegmentStartResponse = AnalysisStartResponse;
export type RhythmStructureStartResponse = AnalysisStartResponse;
export type PackagingStructureStartResponse = AnalysisStartResponse;
export type FunctionSlotAtomizationStartResponse = AnalysisStartResponse;

export type FunctionSlotWorkflowPlaceholderResponse = {
  processingJobId?: string;
  sampleVideoId: string;
  traceId: string;
  runId: string;
  stageId: string;
  artifactId: string | null;
  parentArtifactId: string | null;
  status: "placeholder" | "submitted" | "running" | "processing" | string;
  message: string;
  role?: string | null;
  threadId?: string | null;
  turnId?: string | null;
  leaseId?: string | null;
  ownerId?: string | null;
  workspaceRoot?: string | null;
};

export type AgentChatSessionResponse = {
  ok: boolean;
  source: "direct" | "threadpool-role";
  status: string;
  threadId: string | null;
  traceId: string;
  runId: string;
  stageId: string;
  role?: string | null;
  ownerId?: string | null;
  leaseId?: string | null;
  parentThreadId?: string | null;
  workspaceRoot?: string | null;
  skillPath?: string | null;
  conversationId?: string | null;
  conversationStatus?: "active" | "archived" | string | null;
  conversationRevision?: number | null;
  error?: string;
  message?: string;
  retryable?: boolean;
};

export type AgentChatTurnResponse = {
  ok: boolean;
  source?: "direct" | "threadpool-role" | string;
  role?: string | null;
  leaseId?: string | null;
  parentThreadId?: string | null;
  conversationId?: string | null;
  workspaceRoot?: string | null;
  threadId: string;
  turnId: string;
  status: string;
  traceId: string;
  runId: string;
  stageId: string;
  conversationRevision?: number | null;
  latestTurnId?: string | null;
  threadStopped?: boolean | null;
  retryable?: boolean | null;
  activeTurnStatus?: string | null;
  actionProjection?: AgentChatActionProjection;
  finalMessage?: string | null;
  userTurnText?: string | null;
  activeThreadMessage?: { text?: string; role?: string | null; createdAt?: string | null } | string | null;
  materializedDisplay?: { ok: boolean; planId?: string | null; displayJsonPath?: string | null; traceGraphPath?: string | null; error?: string | null; message?: string | null } | null;
  autoDisplayTransform?: {
    ok: boolean;
    status: string;
    artifactId?: string | null;
    traceId?: string | null;
    runId?: string | null;
    stageId?: string | null;
    stageName?: string | null;
    restructureFinalPath?: string | null;
    displayJsonPath?: string | null;
    repairRequestPath?: string | null;
    missingSections?: string[];
    repairAttemptCount?: number;
    error?: string | null;
    message?: string | null;
    slotAtomDisplay?: AgentChatSlotAtomDisplay | null;
  } | null;
  autoDialogueRoboticReview?: AgentChatDialogueRoboticReview | null;
  autoDialogueRework?: {
    ok: boolean;
    source?: "direct" | "threadpool-role";
    role?: string | null;
    conversationId?: string | null;
    conversationRevision?: number | null;
    workspaceRoot?: string | null;
    threadId?: string | null;
    turnId?: string | null;
    status?: string | null;
    userTurnText?: string | null;
    latestTurnId?: string | null;
    threadStopped?: boolean | null;
    retryable?: boolean | null;
    activeTurnStatus?: string | null;
    actionProjection?: AgentChatActionProjection;
    error?: string | null;
    message?: string | null;
  } | null;
};

export type AgentChatCompactResponse = {
  ok: boolean;
  threadId: string;
  status: string;
  compactStatus?: string | null;
  traceId: string;
  runId: string;
  stageId: string;
  conversationRevision?: number | null;
};

export type AgentChatActionProjection = {
  flags: {
    stopTurn: boolean;
    stopThread: boolean;
    retrySameThread: boolean;
    retryNewThread: boolean;
  };
  availableActions: Array<"stop_turn" | "stop_thread" | "retry_same_thread" | "retry_new_thread" | string>;
};

export type AgentChatStopResponse = {
  ok: boolean;
  action: "stop_turn" | "stop_thread";
  threadId: string;
  turnId?: string | null;
  activeTurnId?: string | null;
  status?: string | null;
  conversationStatus?: string | null;
  conversationRevision?: number | null;
  latestTurnId?: string | null;
  threadStopped?: boolean | null;
  retryable?: boolean | null;
  activeTurnStatus?: string | null;
  actionProjection?: AgentChatActionProjection;
  traceId: string;
  runId: string;
  stageId: string;
};

export type AgentChatRetryResponse = {
  ok: boolean;
  action: "retry_same_thread" | "retry_new_thread";
  sourceTurnId: string;
  previousThreadId: string;
  threadId: string;
  turnId: string;
  status: string;
  conversationRevision?: number | null;
  latestTurnId?: string | null;
  threadStopped?: boolean | null;
  retryable?: boolean | null;
  activeTurnStatus?: string | null;
  actionProjection?: AgentChatActionProjection;
  traceId: string;
  runId: string;
  stageId: string;
};

export type ActiveTurnSummary = {
  bindingId?: string | null;
  threadId: string;
  turnId: string;
  ownerType: string;
  ownerId: string;
  currentAttemptId?: string | null;
  stageName?: string | null;
  traceId?: string | null;
  runId?: string | null;
  stageId?: string | null;
  artifactId?: string | null;
  parentArtifactId?: string | null;
  leaseId?: string | null;
  threadPoolOwnerId?: string | null;
  replayRef?: {
    type?: string | null;
    sourceTurnId?: string | null;
    messageId?: string | null;
    refId?: string | null;
    textSummary?: { length?: number | null; preview?: string | null } | null;
  } | null;
  status: string;
  activeThreadMessageSummary?: { length?: number | null; preview?: string | null } | null;
  finalMessageSummary?: { length?: number | null; preview?: string | null } | null;
  actionProjection?: AgentChatActionProjection | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type FunctionSlotLibraryBuilderRefreshResponse = {
  ok: boolean;
  traceId: string;
  runId: string;
  stageId: string;
  exported: {
    sampleCount: number;
    exportedCount: number;
    skippedCount: number;
    items: Array<{ sampleVideoId: string; artifactId: string | null; exported: boolean; skipped: boolean; itemPath: string | null }>;
  };
  validation: { exitCode: number; path: string; stdout?: string | null; stderr?: string | null };
  slotIndex: { path: string; stdout?: string | null };
  governance: { path: string; stdout?: string | null } | null;
};

export type FunctionSlotGovernanceRunResponse = {
  processingJobId: string;
  sampleVideoId: string;
  traceId: string;
  runId: string;
  stageId: string;
  artifactId: string;
  parentArtifactId: string | null;
  status: "submitted" | string;
  message: string;
};

export async function uploadSampleVideo(file: File, options: { frameSampleRateFps?: number; enableAudioSeparation?: boolean; enableSubtitleRecognition?: boolean; enableAudioFeatureAnalysis?: boolean; cacheDecision?: "ask" | "refresh" } = {}) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("frameSampleRateFps", String(options.frameSampleRateFps ?? 10));
  formData.append("enableAudioSeparation", String(Boolean(options.enableAudioSeparation)));
  formData.append("enableSubtitleRecognition", String(Boolean(options.enableSubtitleRecognition)));
  formData.append("enableAudioFeatureAnalysis", String(Boolean(options.enableAudioFeatureAnalysis)));
  formData.append("cacheDecision", options.cacheDecision ?? "ask");
  const response = await fetch(`${API_BASE_URL}/api/workspaces/${WORKSPACE_ID}/sample-videos`, {
    method: "POST",
    body: formData,
  });
  return readJsonResponse<UploadSampleResponse>(response);
}

export async function startFullAnalysisRun(file: File, options: { frameSampleRateFps?: number; enableAudioSeparation?: boolean; enableSubtitleRecognition?: boolean; enableAudioFeatureAnalysis?: boolean; enableFunctionSlotAtomization?: boolean; cacheDecision?: "ask" | "reuse" | "refresh" } = {}) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("workspaceId", WORKSPACE_ID);
  formData.append("frameSampleRateFps", String(options.frameSampleRateFps ?? 10));
  formData.append("enableAudioSeparation", String(options.enableAudioSeparation ?? true));
  formData.append("enableSubtitleRecognition", String(options.enableSubtitleRecognition ?? true));
  formData.append("enableAudioFeatureAnalysis", String(options.enableAudioFeatureAnalysis ?? true));
  formData.append("enableFunctionSlotAtomization", String(options.enableFunctionSlotAtomization ?? true));
  formData.append("cacheDecision", options.cacheDecision ?? "ask");
  const response = await fetch(`${API_BASE_URL}/api/workflows/full-analysis/runs`, {
    method: "POST",
    body: formData,
  });
  return readJsonResponse<WorkflowRun>(response);
}

export async function startMaterialRecognitionRun(file: File, options: { frameSampleRateFps?: number; enableAudioSeparation?: boolean; enableSubtitleRecognition?: boolean; enableAudioFeatureAnalysis?: boolean; cacheDecision?: "ask" | "reuse" | "refresh" } = {}) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("workspaceId", WORKSPACE_ID);
  formData.append("frameSampleRateFps", String(options.frameSampleRateFps ?? 10));
  formData.append("enableAudioSeparation", String(options.enableAudioSeparation ?? true));
  formData.append("enableSubtitleRecognition", String(options.enableSubtitleRecognition ?? true));
  formData.append("enableAudioFeatureAnalysis", String(options.enableAudioFeatureAnalysis ?? true));
  formData.append("cacheDecision", options.cacheDecision ?? "ask");
  const response = await fetch(`${API_BASE_URL}/api/workflows/material-recognition/runs`, {
    method: "POST",
    body: formData,
  });
  return readJsonResponse<WorkflowRun>(response);
}

export async function startFullAnalysisBatchRun(files: File[], options: { frameSampleRateFps?: number; enableAudioSeparation?: boolean; enableSubtitleRecognition?: boolean; enableAudioFeatureAnalysis?: boolean; enableFunctionSlotAtomization?: boolean; cacheDecision?: "ask" | "reuse" | "refresh"; maxConcurrentRuns?: number } = {}) {
  const formData = new FormData();
  for (const file of files) formData.append("files", file);
  formData.append("workspaceId", WORKSPACE_ID);
  formData.append("frameSampleRateFps", String(options.frameSampleRateFps ?? 10));
  formData.append("enableAudioSeparation", String(options.enableAudioSeparation ?? true));
  formData.append("enableSubtitleRecognition", String(options.enableSubtitleRecognition ?? true));
  formData.append("enableAudioFeatureAnalysis", String(options.enableAudioFeatureAnalysis ?? true));
  formData.append("enableFunctionSlotAtomization", String(options.enableFunctionSlotAtomization ?? true));
  formData.append("cacheDecision", options.cacheDecision ?? "ask");
  formData.append("maxConcurrentRuns", String(options.maxConcurrentRuns ?? 2));
  const response = await fetch(`${API_BASE_URL}/api/workflows/full-analysis/batch-runs`, {
    method: "POST",
    body: formData,
  });
  return readJsonResponse<FullAnalysisBatchRun>(response);
}

export async function getFullAnalysisBatchRun(batchRunId: string) {
  return readJsonResponse<FullAnalysisBatchRun>(await fetch(`${API_BASE_URL}/api/workflows/full-analysis/batch-runs/${encodeURIComponent(batchRunId)}`, { cache: "no-store" }));
}

export async function getLatestFullAnalysisBatchRun(options: { active?: boolean } = {}) {
  const query = options.active ? "?active=true" : "";
  return readJsonResponse<FullAnalysisBatchRun>(await fetch(`${API_BASE_URL}/api/workflows/full-analysis/batch-runs/latest${query}`, { cache: "no-store" }));
}

export async function retryFullAnalysisBatchItem(batchRunId: string, queueItemId: string) {
  return readJsonResponse<FullAnalysisBatchRun>(
    await fetch(`${API_BASE_URL}/api/workflows/full-analysis/batch-runs/${encodeURIComponent(batchRunId)}/items/${encodeURIComponent(queueItemId)}/retry`, {
      method: "POST",
    }),
  );
}

export async function checkFullAnalysisUploadCache(file: File, options: { frameSampleRateFps?: number; cacheDecision?: "ask" | "refresh" } = {}) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("workspaceId", WORKSPACE_ID);
  formData.append("frameSampleRateFps", String(options.frameSampleRateFps ?? 10));
  formData.append("cacheDecision", options.cacheDecision ?? "ask");
  const response = await fetch(`${API_BASE_URL}/api/workflows/full-analysis/cache-check`, {
    method: "POST",
    body: formData,
  });
  return readJsonResponse<{ cacheHit: true; cachedItem: LibraryItemSummary } | { cacheHit: false }>(response);
}

export async function checkMaterialRecognitionUploadCache(file: File, options: { frameSampleRateFps?: number; cacheDecision?: "ask" | "refresh" } = {}) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("workspaceId", WORKSPACE_ID);
  formData.append("frameSampleRateFps", String(options.frameSampleRateFps ?? 10));
  formData.append("cacheDecision", options.cacheDecision ?? "ask");
  const response = await fetch(`${API_BASE_URL}/api/workflows/material-recognition/cache-check`, {
    method: "POST",
    body: formData,
  });
  return readJsonResponse<{ cacheHit: true; cachedItem: LibraryItemSummary } | { cacheHit: false }>(response);
}

export async function getWorkflowRun(workflowRunId: string) {
  return readJsonResponse<WorkflowRun>(await fetch(`${API_BASE_URL}/api/workflows/runs/${encodeURIComponent(workflowRunId)}`, { cache: "no-store" }));
}

export async function getLatestFullAnalysisRun() {
  return readJsonResponse<WorkflowRun>(await fetch(`${API_BASE_URL}/api/workflows/full-analysis/latest`, { cache: "no-store" }));
}

export async function getLatestFullAnalysisRunForSample(sampleVideoId: string) {
  return readJsonResponse<WorkflowRun>(await fetch(`${API_BASE_URL}/api/sample-videos/${encodeURIComponent(sampleVideoId)}/workflows/full-analysis/latest`, { cache: "no-store" }));
}

export async function getLatestMaterialRecognitionRun() {
  return readJsonResponse<WorkflowRun>(await fetch(`${API_BASE_URL}/api/workflows/material-recognition/latest`, { cache: "no-store" }));
}

export async function getLatestMaterialRecognitionRunForSample(sampleVideoId: string) {
  return readJsonResponse<WorkflowRun>(await fetch(`${API_BASE_URL}/api/sample-videos/${encodeURIComponent(sampleVideoId)}/workflows/material-recognition/latest`, { cache: "no-store" }));
}

export async function rerunWorkflowStage(workflowRunId: string, stageKey: string) {
  return readJsonResponse<WorkflowRun>(
    await fetch(`${API_BASE_URL}/api/workflows/runs/${encodeURIComponent(workflowRunId)}/stages/${encodeURIComponent(stageKey)}/rerun`, {
      method: "POST",
    }),
  );
}

export async function getCapabilities() {
  return readJsonResponse<BackendCapabilities>(await fetch(`${API_BASE_URL}/api/capabilities`));
}

export async function getAnalysisRoles() {
  return readJsonResponse<{ roles: AnalysisRoleSummary[] }>(await fetch(`${API_BASE_URL}/api/analysis-roles`));
}

export async function getModules() {
  return readJsonResponse<{ modules: ModuleSummary[] }>(await fetch(`${API_BASE_URL}/api/modules`));
}

export async function getProcessingJob(jobId: string) {
  return readJsonResponse<ProcessingJob>(await fetch(`${API_BASE_URL}/api/processing-jobs/${jobId}`, { cache: "no-store" }));
}

export async function getSampleArtifact(sampleVideoId: string) {
  return readJsonResponse<SampleArtifact>(await fetch(`${API_BASE_URL}/api/sample-videos/${sampleVideoId}/artifact`, { cache: "no-store" }));
}

export async function startShotBoundaryAnalysis(sampleVideoId: string, options: { analysisFps?: number; cacheDecision?: "ask" | "reuse" | "refresh"; enableReview?: boolean } = {}) {
  return readJsonResponse<ShotBoundaryStartResponse>(
    await fetch(`${API_BASE_URL}/api/sample-videos/${encodeURIComponent(sampleVideoId)}/shot-boundary`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ analysisFps: options.analysisFps ?? 10, cacheDecision: options.cacheDecision ?? "ask", enableReview: options.enableReview ?? true }),
    }),
  );
}

export async function saveSubtitleRevision(
  sampleVideoId: string,
  segments: Array<{ id: string; start: number; end: number; text: string; confidence?: number | null }>,
  options: { expectedSubtitleArtifactId?: string | null; expectedRevisionIndex?: number | null } = {},
) {
  return readJsonResponse<{ sampleArtifact: SampleArtifact; traceId: string; changed: boolean }>(
    await fetch(`${API_BASE_URL}/api/sample-videos/${encodeURIComponent(sampleVideoId)}/subtitles/revisions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        segments,
        expectedSubtitleArtifactId: options.expectedSubtitleArtifactId ?? null,
        expectedRevisionIndex: options.expectedRevisionIndex ?? null,
      }),
    }),
  );
}

export async function startAnalysisRole(
  analysisId: string,
  sampleVideoId: string,
  options: {
    cacheDecision?: "ask" | "reuse" | "refresh";
    expectedShotBoundaryArtifactId?: string | null;
    expectedScriptSegmentArtifactId?: string | null;
    expectedRhythmStructureArtifactId?: string | null;
    expectedPackagingStructureArtifactId?: string | null;
  } = {},
) {
  const dependencies = {
    shotBoundaryArtifactId: options.expectedShotBoundaryArtifactId ?? null,
    scriptSegmentArtifactId: options.expectedScriptSegmentArtifactId ?? null,
    rhythmStructureArtifactId: options.expectedRhythmStructureArtifactId ?? null,
    packagingStructureArtifactId: options.expectedPackagingStructureArtifactId ?? null,
  };
  return readJsonResponse<AnalysisStartResponse>(
    await fetch(`${API_BASE_URL}/api/sample-videos/${encodeURIComponent(sampleVideoId)}/analyses/${encodeURIComponent(analysisId)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        cacheDecision: options.cacheDecision ?? "ask",
        dependencies,
        expectedShotBoundaryArtifactId: options.expectedShotBoundaryArtifactId ?? null,
        expectedScriptSegmentArtifactId: options.expectedScriptSegmentArtifactId ?? null,
        expectedRhythmStructureArtifactId: options.expectedRhythmStructureArtifactId ?? null,
        expectedPackagingStructureArtifactId: options.expectedPackagingStructureArtifactId ?? null,
      }),
    }),
  );
}

export async function startScriptSegmentAnalysis(sampleVideoId: string, options: { cacheDecision?: "ask" | "reuse" | "refresh"; expectedShotBoundaryArtifactId?: string | null } = {}) {
  return startAnalysisRole("script-segments", sampleVideoId, options);
}

export async function startRhythmStructureAnalysis(sampleVideoId: string, options: { cacheDecision?: "ask" | "reuse" | "refresh"; expectedShotBoundaryArtifactId?: string | null } = {}) {
  return startAnalysisRole("rhythm-structure", sampleVideoId, options);
}

export async function startPackagingStructureAnalysis(sampleVideoId: string, options: { cacheDecision?: "ask" | "reuse" | "refresh"; expectedShotBoundaryArtifactId?: string | null } = {}) {
  return startAnalysisRole("packaging-structure", sampleVideoId, options);
}

export async function startFunctionSlotAtomizationAnalysis(
  sampleVideoId: string,
  options: {
    expectedScriptSegmentArtifactId?: string | null;
    expectedRhythmStructureArtifactId?: string | null;
    expectedPackagingStructureArtifactId?: string | null;
  } = {},
) {
  return startAnalysisRole("function-slot-atomization", sampleVideoId, {
    cacheDecision: "refresh",
    ...options,
  });
}

export async function saveFunctionSlotAtomizationManualBoundaryEdit(
  sampleVideoId: string,
  payload: {
    editedJsonText: string;
    expectedArtifactId?: string | null;
    sourceBoundaryReviewArtifactId?: string | null;
  },
) {
  return readJsonResponse<{ sampleArtifact: SampleArtifact; traceId: string }>(
    await fetch(`${API_BASE_URL}/api/sample-videos/${encodeURIComponent(sampleVideoId)}/function-slot-atomization/manual-boundary-edit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

export async function resolveCacheDecision(jobId: string, decision: "reuse" | "refresh") {
  return readJsonResponse<ProcessingJob>(
    await fetch(`${API_BASE_URL}/api/processing-jobs/${encodeURIComponent(jobId)}/cache-decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision }),
    }),
  );
}

export async function resolveShotBoundaryCacheDecision(jobId: string, decision: "reuse" | "refresh") {
  return resolveCacheDecision(jobId, decision);
}

export async function getThreadPoolHealth() {
  return readJsonResponse<ThreadPoolHealth>(await fetch(`${API_BASE_URL}/api/threadpool/health`));
}

export async function getThreadPoolRoles() {
  return readJsonResponse<{ ok: boolean; roles: ThreadPoolRoleSummary[]; health?: ThreadPoolHealth }>(await fetch(`${API_BASE_URL}/api/threadpool/roles`));
}

export async function getThreadPoolRoleStatus(role: string) {
  return readJsonResponse<ThreadPoolRoleDetail>(await fetch(`${API_BASE_URL}/api/threadpool/roles/${encodeURIComponent(role)}/status`));
}

export async function discardThreadPoolThread(threadId: string) {
  return readJsonResponse<{ ok: boolean; thread_id: string; status: string }>(
    await fetch(`${API_BASE_URL}/api/threadpool/threads/${encodeURIComponent(threadId)}/discard`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "manual-discard-from-workbench" }),
    }),
  );
}

export async function getThreadConversation(threadId: string) {
  return readJsonResponse<ThreadConversation>(await fetch(`${API_BASE_URL}/api/threadpool/threads/${encodeURIComponent(threadId)}/conversation`));
}

export async function getAgentTurnTimeline(threadId: string, turnId: string) {
  return readJsonResponse<AgentTurnTimeline>(
    await fetch(`${API_BASE_URL}/api/threadpool/threads/${encodeURIComponent(threadId)}/turns/${encodeURIComponent(turnId)}/timeline`, { cache: "no-store" }),
  );
}

export async function startAgentChatThread(payload: { source?: "direct" | "threadpool-role"; role?: string | null; conversationId?: string | null; sampleVideoId?: string | null; expectedRevision?: number | null } = {}) {
  return readJsonResponse<AgentChatSessionResponse>(
    await fetch(`${API_BASE_URL}/api/agent-chat/threads`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

export async function sendAgentChatMessage(
  threadId: string,
  payload: {
    message: string;
    source?: "direct" | "threadpool-role";
    role?: string | null;
    leaseId?: string | null;
    parentThreadId?: string | null;
    conversationId?: string | null;
    expectedRevision?: number | null;
    workspaceRoot?: string | null;
    skillPath?: string | null;
  },
) {
  return readJsonResponse<AgentChatTurnResponse>(
    await fetch(`${API_BASE_URL}/api/agent-chat/threads/${encodeURIComponent(threadId)}/turns`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

export async function submitAgentChatManualReplacement(
  threadId: string,
  payload: {
    conversationId?: string | null;
    expectedRevision?: number | null;
    workspaceRoot?: string | null;
    skillPath?: string | null;
    source?: "direct" | "threadpool-role";
    sourceRestructureFinalPath: string;
    sourceDisplayJsonPath: string;
    displayFingerprint?: AgentChatSlotAtomDisplay["fileFingerprint"];
    replacements: Array<SlotReplacement | AtomReplacement>;
  },
) {
  return readJsonResponse<AgentChatTurnResponse>(
    await fetch(`${API_BASE_URL}/api/agent-chat/threads/${encodeURIComponent(threadId)}/turns/manual-replacement`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

export async function compactAgentChatThread(
  threadId: string,
  payload: {
    conversationId?: string | null;
    expectedRevision?: number | null;
    workspaceRoot?: string | null;
    contextUsage?: Record<string, unknown> | null;
  } = {},
) {
  return readJsonResponse<AgentChatCompactResponse>(
    await fetch(`${API_BASE_URL}/api/agent-chat/threads/${encodeURIComponent(threadId)}/compact`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

export async function stopAgentChatTurn(
  threadId: string,
  turnId: string,
  payload: { conversationId?: string | null; expectedRevision?: number | null; workspaceRoot?: string | null; reason?: string | null } = {},
) {
  return readJsonResponse<AgentChatStopResponse>(
    await fetch(`${API_BASE_URL}/api/agent-chat/threads/${encodeURIComponent(threadId)}/turns/${encodeURIComponent(turnId)}/stop`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

export async function stopAgentChatThread(
  threadId: string,
  payload: { conversationId?: string | null; expectedRevision?: number | null; workspaceRoot?: string | null; activeTurnId?: string | null; source?: "direct" | "threadpool-role"; leaseId?: string | null; ownerId?: string | null; discardThread?: boolean; archiveConversation?: boolean; reason?: string | null } = {},
) {
  return readJsonResponse<AgentChatStopResponse>(
    await fetch(`${API_BASE_URL}/api/agent-chat/threads/${encodeURIComponent(threadId)}/stop`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

export async function retryAgentChatTurn(
  threadId: string,
  turnId: string,
  payload: { mode?: "same_thread" | "new_thread"; conversationId: string; expectedRevision?: number | null; workspaceRoot?: string | null; source?: "direct" | "threadpool-role"; role?: string | null; skillPath?: string | null } ,
) {
  return readJsonResponse<AgentChatRetryResponse>(
    await fetch(`${API_BASE_URL}/api/agent-chat/threads/${encodeURIComponent(threadId)}/turns/${encodeURIComponent(turnId)}/retry`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

export async function listActiveTurns(payload: { ownerType?: string | null; ownerId?: string | null } = {}) {
  const query = buildQuery({ ownerType: payload.ownerType, ownerId: payload.ownerId });
  return readJsonResponse<{ ok: boolean; activeTurns: ActiveTurnSummary[]; count: number }>(
    await fetch(`${API_BASE_URL}/api/active-turns${query}`, { cache: "no-store" }),
  );
}

export async function stopActiveTurn(bindingId: string, payload: { turnId?: string | null; workspaceRoot?: string | null } = {}) {
  return readJsonResponse<{ ok: boolean; action: "stop"; bindingId: string; ownerType: string; ownerId: string; threadId: string; turnId: string; status: string; ownerResult?: unknown }>(
    await fetch(`${API_BASE_URL}/api/active-turns/${encodeURIComponent(bindingId)}/stop`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

export async function stopActiveThread(bindingId: string, payload: { turnId?: string | null; workspaceRoot?: string | null; reason?: string | null } = {}) {
  return readJsonResponse<{ ok: boolean; action: "stop_thread"; bindingId: string; ownerType: string; ownerId: string; threadId: string; turnId: string; status: string; ownerResult?: unknown }>(
    await fetch(`${API_BASE_URL}/api/active-turns/${encodeURIComponent(bindingId)}/stop-thread`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

export async function retryActiveTurn(bindingId: string, payload: { workspaceRoot?: string | null; mode?: "same_thread" | "new_thread"; role?: string | null } = {}) {
  return readJsonResponse<{ ok: boolean; action: "retry" | "retry_new_thread"; bindingId: string; ownerType: string; ownerId: string; threadId: string; previousThreadId?: string | null; turnId: string | null; status: string }>(
    await fetch(`${API_BASE_URL}/api/active-turns/${encodeURIComponent(bindingId)}/retry`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

export async function collectAgentChatTurn(
  threadId: string,
  turnId: string,
  workspaceRoot?: string | null,
  conversationId?: string | null,
  extra: { role?: string | null; restructureFinalPath?: string | null; parentArtifactId?: string | null; confirmationId?: string | null } = {},
) {
  const query = buildQuery({ workspaceRoot, conversationId, role: extra.role, restructureFinalPath: extra.restructureFinalPath, parentArtifactId: extra.parentArtifactId, confirmationId: extra.confirmationId });
  return readJsonResponse<AgentChatTurnResponse>(
    await fetch(`${API_BASE_URL}/api/agent-chat/threads/${encodeURIComponent(threadId)}/turns/${encodeURIComponent(turnId)}${query}`, { cache: "no-store" }),
  );
}

export async function getAgentChatTurnTimeline(threadId: string, turnId: string, workspaceRoot?: string | null) {
  const query = buildQuery({ workspaceRoot });
  return readJsonResponse<AgentTurnTimeline>(
    await fetch(`${API_BASE_URL}/api/agent-chat/threads/${encodeURIComponent(threadId)}/turns/${encodeURIComponent(turnId)}/timeline${query}`, { cache: "no-store" }),
  );
}

export async function listAgentChatConversations(payload: { role?: string | null; status?: "active" | "archived" | string | null } = {}) {
  const query = buildQuery({ role: payload.role, status: payload.status ?? "active" });
  return readJsonResponse<{ ok: boolean; conversations: AgentChatConversation[]; traceId: string; runId: string; stageId: string }>(
    await fetch(`${API_BASE_URL}/api/agent-chat/conversations${query}`, { cache: "no-store" }),
  );
}

export async function resumeAgentChatConversation(conversationId: string) {
  return readJsonResponse<{ ok: boolean; conversation: AgentChatConversation; refreshed?: ThreadConversation | null; refreshError?: { code?: string; message?: string | null } | null; deleted?: boolean; traceId: string; runId: string; stageId: string }>(
    await fetch(`${API_BASE_URL}/api/agent-chat/conversations/${encodeURIComponent(conversationId)}/resume`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    }),
  );
}

export async function archiveAgentChatConversation(conversationId: string, expectedRevision?: number | null) {
  return readJsonResponse<{ ok: boolean; conversation: AgentChatConversation; traceId: string; runId: string; stageId: string }>(
    await fetch(`${API_BASE_URL}/api/agent-chat/conversations/${encodeURIComponent(conversationId)}/archive`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedRevision: expectedRevision ?? null }),
    }),
  );
}

export async function recordAgentChatSystemMessage(conversationId: string, message: string, expectedRevision?: number | null) {
  return readJsonResponse<{ ok: boolean; conversation: AgentChatConversation; traceId: string; runId: string; stageId: string }>(
    await fetch(`${API_BASE_URL}/api/agent-chat/conversations/${encodeURIComponent(conversationId)}/system-messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message, expectedRevision: expectedRevision ?? null }),
    }),
  );
}

export async function reviewAgentChatDialogue(
  conversationId: string,
  payload: {
    turnId?: string | null;
    shotDesignFinalPath?: string | null;
    parentArtifactId?: string | null;
    expectedRevision?: number | null;
    force?: boolean;
  } = {},
) {
  return readJsonResponse<{ ok: boolean; review: AgentChatDialogueRoboticReview; conversation: AgentChatConversation; conversationRevision?: number | null; traceId: string; runId: string; stageId: string }>(
    await fetch(`${API_BASE_URL}/api/agent-chat/conversations/${encodeURIComponent(conversationId)}/dialogue-review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

export async function submitAgentChatDialogueRework(
  conversationId: string,
  payload: {
    threadId?: string | null;
    turnId?: string | null;
    shotDesignFinalPath?: string | null;
    reviewOutputPath?: string | null;
    decision?: string | null;
    issueCount?: number | null;
    userInstruction?: string | null;
    expectedRevision?: number | null;
    workspaceRoot?: string | null;
    skillPath?: string | null;
    source?: "direct" | "threadpool-role";
    role?: string | null;
    leaseId?: string | null;
    parentArtifactId?: string | null;
  } = {},
) {
  return readJsonResponse<AgentChatTurnResponse>(
    await fetch(`${API_BASE_URL}/api/agent-chat/conversations/${encodeURIComponent(conversationId)}/dialogue-rework`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

export async function confirmAgentChatConversation(
  conversationId: string,
  payload: {
    turnId?: string | null;
    note?: string | null;
    confirmationId?: string | null;
    sourceRestructurePath?: string | null;
    sourceShotDesignPath?: string | null;
    displayArtifact?: AgentChatArtifactRef | null;
    storyboardArtifact?: AgentChatArtifactRef | null;
    expectedRevision?: number | null;
  } = {},
) {
  return readJsonResponse<{ ok: boolean; conversation: AgentChatConversation; traceId: string; runId: string; stageId: string }>(
    await fetch(`${API_BASE_URL}/api/agent-chat/conversations/${encodeURIComponent(conversationId)}/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

export async function releaseAgentChatLease(leaseId: string, ownerId?: string | null, conversationId?: string | null) {
  return readJsonResponse<{ ok: boolean; leaseId: string; ownerId: string; status: string; conversationDeleted?: boolean }>(
    await fetch(`${API_BASE_URL}/api/agent-chat/threadpool/leases/release`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ leaseId, ownerId, conversationId }),
    }),
  );
}

export async function releaseThreadPoolOwnerLeases(ownerId: string) {
  return readJsonResponse<{ ok: boolean }>(
    await fetch(`${API_BASE_URL}/api/threadpool/leases/release-owner`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ownerId }),
    }),
  );
}

export async function forceUpdateThreadPoolSeeds(options: { roles?: string[]; reason?: string } = {}) {
  const roles = (options.roles ?? []).map((role) => String(role).trim()).filter(Boolean);
  return readJsonResponse<{ ok: boolean; roles: string[]; deleted_count: number; retiring_count: number }>(
    await fetch(`${API_BASE_URL}/api/threadpool/maintenance/force-update-seeds`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        reason: options.reason ?? "manual-force-update-seeds-from-workbench",
        ...(roles.length ? { roles } : {}),
      }),
    }),
  );
}

export async function getDebugTraces() {
  return readJsonResponse<{ traces: DebugTraceSummary[] }>(await fetch(`${API_BASE_URL}/api/debug/traces`));
}

export async function getDebugTraceDetail(traceId: string) {
  return readJsonResponse<DebugTraceDetail>(await fetch(`${API_BASE_URL}/api/debug/traces/${encodeURIComponent(traceId)}`));
}

export async function getLibraryItems() {
  return readJsonResponse<{ items: LibraryItemSummary[] }>(await fetch(`${API_BASE_URL}/api/library/items`));
}

export async function getFunctionSlotLibraryItems() {
  return readJsonResponse<{ items: Array<{ artifactId: string; sampleVideoId?: string | null; traceId?: string | null; counts?: Record<string, number> }> }>(
    await fetch(`${API_BASE_URL}/api/function-slot-library`),
  );
}

export async function getFunctionSlotReplacementCandidates(payload: { kind: "slot" | "atom"; atomKind?: "script" | "rhythm" | "packaging" | null; slotSubtypeId?: string | null; q?: string | null; limit?: number | null }) {
  const query = buildQuery({
    kind: payload.kind,
    atomKind: payload.atomKind,
    slotSubtypeId: payload.slotSubtypeId,
    q: payload.q,
    limit: payload.limit,
  });
  return readJsonResponse<{ ok: boolean; schemaVersion: string; kind: string; atomKind?: string | null; candidates: ReplacementCandidate[]; source?: Record<string, unknown> }>(
    await fetch(`${API_BASE_URL}/api/function-slot-library/replacement-candidates${query}`, { cache: "no-store" }),
  );
}

export async function getFunctionSlotLibraryGraph(artifactId: string) {
  return readJsonResponse<FunctionSlotLibraryGraph>(await fetch(`${API_BASE_URL}/api/function-slot-library/${encodeURIComponent(artifactId)}/graph`, { cache: "no-store" }));
}

export async function getFunctionSlotGovernanceGraph() {
  return readJsonResponse<FunctionSlotLibraryGraph>(await fetch(`${API_BASE_URL}/api/function-slot-library/governance/graph`, { cache: "no-store" }));
}

export async function refreshFunctionSlotLibraryBuilder(payload: { mode?: "skip-existing" | "replace"; updateGovernance?: boolean } = {}) {
  return readJsonResponse<FunctionSlotLibraryBuilderRefreshResponse>(
    await fetch(`${API_BASE_URL}/api/function-slot-library/builder/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

export async function startFunctionSlotGovernanceRun(payload: { refreshEvidence?: boolean } = {}) {
  return readJsonResponse<FunctionSlotGovernanceRunResponse>(
    await fetch(`${API_BASE_URL}/api/function-slot-library/governance/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

export async function autoRunShotStoryboardPrep(payload: { sampleVideoId?: string | null; restructureFinalPath?: string | null; shotDesignFinalPath?: string | null; restructureArtifactId?: string | null; parentArtifactId?: string | null; confirmationId?: string | null; conversationId?: string | null; runImageGeneration?: boolean } = {}) {
  return readJsonResponse<FunctionSlotWorkflowPlaceholderResponse>(
    await fetch(`${API_BASE_URL}/api/function-slot-workflow/storyboard-prep/auto-run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

export async function getFunctionSlotConfirmedPlanTraceGraph() {
  return readJsonResponse<FunctionSlotLibraryGraph>(
    await fetch(`${API_BASE_URL}/api/function-slot-restructure/confirmed-plan-trace/graph`, { cache: "no-store" }),
  );
}

export async function registerFunctionSlotConfirmedPlanTrace(payload: { restructureFinalPath?: string | null; displayJsonPath?: string | null; sourceTurnId?: string | null; parentArtifactId?: string | null; confirmationId?: string | null }) {
  return readJsonResponse<{ ok: boolean; artifactId?: string | null; planId?: string | null; traceId?: string | null; runId?: string | null; stageId?: string | null; traceGraphPath?: string | null; error?: string | null; message?: string | null }>(
    await fetch(`${API_BASE_URL}/api/function-slot-restructure/confirmed-plan-trace/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

export async function startFunctionSlotWorkflowPlaceholder(
  workflowKey: "semantic-governance" | "restructure" | "shot-storyboard-prep",
  payload: { sampleVideoId?: string | null; parentArtifactId?: string | null } = {},
) {
  return readJsonResponse<FunctionSlotWorkflowPlaceholderResponse>(
    await fetch(`${API_BASE_URL}/api/function-slot-workflow/${encodeURIComponent(workflowKey)}/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

export async function getLibraryItemDetail(sampleVideoId: string) {
  return readJsonResponse<LibraryItemDetail>(await fetch(`${API_BASE_URL}/api/library/items/${encodeURIComponent(sampleVideoId)}`));
}

export async function loadLibraryItem(sampleVideoId: string) {
  return readJsonResponse<{ sampleArtifact: SampleArtifact }>(
    await fetch(`${API_BASE_URL}/api/library/items/${encodeURIComponent(sampleVideoId)}/load`, {
      method: "POST",
    }),
  );
}

export async function deleteLibraryItemCache(sampleVideoId: string) {
  return readJsonResponse<{ ok: true; removedSampleVideoIds: string[] }>(
    await fetch(`${API_BASE_URL}/api/library/items/${encodeURIComponent(sampleVideoId)}/cache`, {
      method: "DELETE",
    }),
  );
}

export async function postUiDebugEvent(event: UiDebugEventRequest) {
  return readJsonResponse<{ ok: true; debugSnapshotUri?: string | null }>(
    await fetch(`${API_BASE_URL}/api/debug/ui-events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(event),
    }),
  );
}

export function runtimeUrl(uri?: string | null): string | null {
  if (!uri) return null;
  return `${API_BASE_URL}${uri}`;
}

export async function readJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  const body = parseJsonResponse(text);
  if (!response.ok) {
    const error = new Error(resolveApiErrorMessage(body.value, text, response.status)) as Error & {
      code?: string;
      traceId?: string | null;
      debugSnapshotUri?: string | null;
      stageName?: string | null;
      retryable?: boolean | null;
      statusCode?: number;
      responseBodySnippet?: string | null;
      responseContentType?: string | null;
    };
    const payload = isRecord(body.value) ? body.value : null;
    error.code = payload ? String(payload.code || payload.error || "api_request_failed") : "api_request_failed";
    error.traceId = payload ? toNullableString(payload.traceId) : null;
    error.debugSnapshotUri = payload ? toNullableString(payload.debugSnapshotUri) : null;
    error.stageName = payload ? toNullableString(payload.stageName) : null;
    error.retryable = payload && typeof payload.retryable === "boolean" ? payload.retryable : null;
    error.statusCode = response.status;
    error.responseBodySnippet = summarizeResponseText(text);
    error.responseContentType = response.headers.get("content-type");
    throw error;
  }
  if (!body.ok && text.trim()) {
    throw new Error(`API 返回了非 JSON 响应: ${summarizeResponseText(text) ?? response.status}`);
  }
  return (body.value ?? {}) as T;
}

function parseJsonResponse(text: string): { ok: boolean; value: unknown | null } {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return { ok: true, value: null };
  try {
    return { ok: true, value: JSON.parse(trimmed) as unknown };
  } catch {
    return { ok: false, value: { raw: trimmed } };
  }
}

function resolveApiErrorMessage(body: unknown, text: string, status: number): string {
  const payload = isRecord(body) ? body : null;
  const candidate = payload ? String(payload.message || payload.error || "") : "";
  if (candidate.trim()) return candidate.slice(0, 240);
  const rawSnippet = summarizeResponseText(text);
  if (rawSnippet) return rawSnippet;
  return `API 请求失败: ${status}`;
}

function summarizeResponseText(text: string): string | null {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return null;
  return trimmed.replace(/\s+/g, " ").slice(0, 240);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toNullableString(value: unknown): string | null {
  if (value == null) return null;
  return String(value);
}

function buildQuery(params: Record<string, string | number | boolean | null | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === "") continue;
    query.set(key, String(value));
  }
  const text = query.toString();
  return text ? `?${text}` : "";
}
