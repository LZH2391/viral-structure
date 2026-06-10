const fs = require("fs");

function publicBatch(batch) {
  if (!batch) return null;
  return {
    batchRunId: batch.batchRunId,
    workflowKey: batch.workflowKey,
    status: batch.status,
    workspaceId: batch.workspaceId,
    maxConcurrentRuns: batch.maxConcurrentRuns,
    options: batch.options ?? {},
    createdAt: batch.createdAt,
    updatedAt: batch.updatedAt,
    completedAt: batch.completedAt ?? null,
    restored: Boolean(batch.restored),
    items: batch.items.map(publicBatchItem),
  };
}

function publicBatchItem(item) {
  return {
    queueItemId: item.queueItemId,
    batchRunId: item.batchRunId,
    workflowRunId: item.workflowRunId,
    sampleVideoId: item.sampleVideoId,
    filename: item.filename,
    mimeType: item.mimeType,
    size: item.size,
    status: item.status,
    position: item.position,
    currentStageKeys: item.currentStageKeys ?? [],
    currentStageLabel: item.currentStageLabel ?? null,
    errorSummary: item.errorSummary ?? null,
    retryable: isRetryableItem(item),
    sourceFileAvailable: Boolean(item.filePath && fs.existsSync(item.filePath)),
    lastFailure: item.status === "failed" || item.status === "partial_failed" ? item.errorSummary ?? null : null,
    completionNotifiedAt: item.completionNotifiedAt ?? null,
    createdAt: item.createdAt,
    startedAt: item.startedAt ?? null,
    completedAt: item.completedAt ?? null,
    updatedAt: item.updatedAt,
  };
}

function sanitizeWorkflowFields(fields = {}) {
  return {
    workspaceId: fields.workspaceId ?? null,
    frameSampleRateFps: fields.frameSampleRateFps ?? null,
    enableAudioSeparation: fields.enableAudioSeparation ?? "true",
    enableSubtitleRecognition: fields.enableSubtitleRecognition ?? "true",
    enableAudioFeatureAnalysis: fields.enableAudioFeatureAnalysis ?? "true",
    enableFunctionSlotAtomization: fields.enableFunctionSlotAtomization ?? "true",
    cacheDecision: fields.cacheDecision ?? "ask",
    targetConversationId: fields.targetConversationId ?? null,
    bindMaterialToConversation: fields.bindMaterialToConversation ?? null,
  };
}

function isRetryableItem(item) {
  return ["failed", "partial_failed", "canceled"].includes(String(item?.status ?? "")) && Boolean(item?.filePath && fs.existsSync(item.filePath));
}

module.exports = {
  publicBatch,
  publicBatchItem,
  sanitizeWorkflowFields,
};
