(function () {
  const STAGES = {
    ingest: "sample-ingest",
    understand: "sample-understanding",
    transfer: "structure-transfer",
    rerun: "stage-rerun",
    snapshot: "debug-snapshot",
  };

  const state = {
    workspace: {
      id: createId("workspace"),
      name: "结构迁移工作台",
      currentVersionId: null,
    },
    uiTraceId: createId("uiTrace"),
    activeStageId: null,
    activePreviewMode: "sample",
    activeMediaKind: "video",
    selectedDerivativeId: null,
    selectedFrameId: null,
    sampleVideo: null,
    mediaDerivatives: [],
    structureCards: [],
    contentProfile: null,
    generatedPlan: null,
    mappings: [],
    versions: [],
    logs: [],
    debugSnapshots: [],
    processingJob: null,
    sampleArtifact: null,
    errorSummary: null,
  };

  function createId(prefix) {
    const randomPart =
      globalThis.crypto?.randomUUID?.() ??
      `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    return `${prefix}_${randomPart}`;
  }

  function formatTime(value) {
    if (!Number.isFinite(value)) return "00:00";
    const minutes = Math.floor(value / 60).toString().padStart(2, "0");
    const seconds = Math.floor(value % 60).toString().padStart(2, "0");
    return `${minutes}:${seconds}`;
  }

  function formatFileSize(value) {
    if (!Number.isFinite(value)) return "未知大小";
    if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
  }

  function sanitizeText(value, maxLength = 72) {
    const text = String(value ?? "").replace(/\s+/g, " ").trim();
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength)}...`;
  }

  window.WorkbenchState = {
    STAGES,
    state,
    createId,
    formatTime,
    formatFileSize,
    sanitizeText,
  };
})();
