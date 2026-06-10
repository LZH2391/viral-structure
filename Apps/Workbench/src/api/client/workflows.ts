import type { AnalysisRoleSummary, BackendCapabilities, FullAnalysisBatchRun, LibraryItemSummary, ModuleSummary, ProcessingJob, SampleArtifact, WorkflowRun } from "../../types";
import type { AnalysisStartResponse, FunctionSlotAtomizationStartResponse, PackagingStructureStartResponse, RhythmStructureStartResponse, ScriptSegmentStartResponse, ShotBoundaryStartResponse, UploadSampleResponse } from "./types";
import { API_BASE_URL, WORKSPACE_ID, readJsonResponse } from "./shared";

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

export async function startMaterialRecognitionRun(file: File, options: { frameSampleRateFps?: number; enableAudioSeparation?: boolean; enableSubtitleRecognition?: boolean; enableAudioFeatureAnalysis?: boolean; cacheDecision?: "ask" | "reuse" | "refresh"; targetConversationId?: string | null; bindMaterialToConversation?: boolean } = {}) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("workspaceId", WORKSPACE_ID);
  formData.append("frameSampleRateFps", String(options.frameSampleRateFps ?? 10));
  formData.append("enableAudioSeparation", String(options.enableAudioSeparation ?? true));
  formData.append("enableSubtitleRecognition", String(options.enableSubtitleRecognition ?? true));
  formData.append("enableAudioFeatureAnalysis", String(options.enableAudioFeatureAnalysis ?? true));
  formData.append("cacheDecision", options.cacheDecision ?? "ask");
  if (options.targetConversationId) formData.append("targetConversationId", options.targetConversationId);
  if (options.bindMaterialToConversation != null) formData.append("bindMaterialToConversation", String(options.bindMaterialToConversation));
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

export async function startMaterialRecognitionBatchRun(files: File[], options: { frameSampleRateFps?: number; enableAudioSeparation?: boolean; enableSubtitleRecognition?: boolean; enableAudioFeatureAnalysis?: boolean; cacheDecision?: "ask" | "reuse" | "refresh"; maxConcurrentRuns?: number; targetConversationId?: string | null; bindMaterialToConversation?: boolean } = {}) {
  const formData = new FormData();
  for (const file of files) formData.append("files", file);
  formData.append("workspaceId", WORKSPACE_ID);
  formData.append("frameSampleRateFps", String(options.frameSampleRateFps ?? 10));
  formData.append("enableAudioSeparation", String(options.enableAudioSeparation ?? true));
  formData.append("enableSubtitleRecognition", String(options.enableSubtitleRecognition ?? true));
  formData.append("enableAudioFeatureAnalysis", String(options.enableAudioFeatureAnalysis ?? true));
  formData.append("cacheDecision", options.cacheDecision ?? "ask");
  formData.append("maxConcurrentRuns", String(options.maxConcurrentRuns ?? 2));
  if (options.targetConversationId) formData.append("targetConversationId", options.targetConversationId);
  if (options.bindMaterialToConversation != null) formData.append("bindMaterialToConversation", String(options.bindMaterialToConversation));
  const response = await fetch(`${API_BASE_URL}/api/workflows/material-recognition/batch-runs`, {
    method: "POST",
    body: formData,
  });
  return readJsonResponse<FullAnalysisBatchRun>(response);
}

export async function getFullAnalysisBatchRun(batchRunId: string) {
  return readJsonResponse<FullAnalysisBatchRun>(await fetch(`${API_BASE_URL}/api/workflows/full-analysis/batch-runs/${encodeURIComponent(batchRunId)}`, { cache: "no-store" }));
}

export async function getMaterialRecognitionBatchRun(batchRunId: string) {
  return readJsonResponse<FullAnalysisBatchRun>(await fetch(`${API_BASE_URL}/api/workflows/material-recognition/batch-runs/${encodeURIComponent(batchRunId)}`, { cache: "no-store" }));
}

export async function getLatestFullAnalysisBatchRun(options: { active?: boolean } = {}) {
  const query = options.active ? "?active=true" : "";
  return readJsonResponse<FullAnalysisBatchRun>(await fetch(`${API_BASE_URL}/api/workflows/full-analysis/batch-runs/latest${query}`, { cache: "no-store" }));
}

export async function getLatestMaterialRecognitionBatchRun(options: { active?: boolean } = {}) {
  const query = options.active ? "?active=true" : "";
  return readJsonResponse<FullAnalysisBatchRun>(await fetch(`${API_BASE_URL}/api/workflows/material-recognition/batch-runs/latest${query}`, { cache: "no-store" }));
}

export async function retryFullAnalysisBatchItem(batchRunId: string, queueItemId: string) {
  return readJsonResponse<FullAnalysisBatchRun>(
    await fetch(`${API_BASE_URL}/api/workflows/full-analysis/batch-runs/${encodeURIComponent(batchRunId)}/items/${encodeURIComponent(queueItemId)}/retry`, {
      method: "POST",
    }),
  );
}

export async function cancelFullAnalysisBatchItem(batchRunId: string, queueItemId: string, reason = "user_requested") {
  return readJsonResponse<FullAnalysisBatchRun>(
    await fetch(`${API_BASE_URL}/api/workflows/full-analysis/batch-runs/${encodeURIComponent(batchRunId)}/items/${encodeURIComponent(queueItemId)}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason }),
    }),
  );
}

export async function retryMaterialRecognitionBatchItem(batchRunId: string, queueItemId: string) {
  return readJsonResponse<FullAnalysisBatchRun>(
    await fetch(`${API_BASE_URL}/api/workflows/material-recognition/batch-runs/${encodeURIComponent(batchRunId)}/items/${encodeURIComponent(queueItemId)}/retry`, {
      method: "POST",
    }),
  );
}

export async function cancelMaterialRecognitionBatchItem(batchRunId: string, queueItemId: string, reason = "user_requested") {
  return readJsonResponse<FullAnalysisBatchRun>(
    await fetch(`${API_BASE_URL}/api/workflows/material-recognition/batch-runs/${encodeURIComponent(batchRunId)}/items/${encodeURIComponent(queueItemId)}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason }),
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

export async function cancelWorkflowRun(workflowRunId: string, reason = "user_requested") {
  return readJsonResponse<WorkflowRun>(
    await fetch(`${API_BASE_URL}/api/workflows/runs/${encodeURIComponent(workflowRunId)}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason }),
    }),
  );
}

export async function resumeWorkflowRun(workflowRunId: string) {
  return readJsonResponse<WorkflowRun>(
    await fetch(`${API_BASE_URL}/api/workflows/runs/${encodeURIComponent(workflowRunId)}/resume`, {
      method: "POST",
    }),
  );
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
