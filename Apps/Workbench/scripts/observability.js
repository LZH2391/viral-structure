(function () {
  const { STAGES, state, createId, sanitizeText } = window.WorkbenchState;

  function createObservability(renderHooks) {
    function beginStage(stageName, parentArtifactId = null) {
      const stageId = createId("stage");
      const artifactId = createId("artifact");
      state.activeStageId = stageId;
      writeLog("stage.start", "info", {
        runId: state.workspace.id,
        uiTraceId: state.uiTraceId,
        backendTraceId: state.processingJob?.traceId ?? null,
        stageId,
        artifactId,
        parentArtifactId,
        stageName,
      });
      return { stageName, stageId, artifactId, parentArtifactId };
    }

    function finishStage(stage, artifactId = stage.artifactId) {
      writeLog("stage.end", "done", {
        runId: state.workspace.id,
        uiTraceId: state.uiTraceId,
        backendTraceId: state.processingJob?.traceId ?? null,
        stageId: stage.stageId,
        artifactId,
        parentArtifactId: stage.parentArtifactId,
        stageName: stage.stageName,
      });
      state.activeStageId = stage.stageId;
    }

    function failStage(stage, error, details = {}) {
      const errorInfo = buildErrorInfo(error, details);
      const snapshot = captureStageSnapshot(stage, {
        kind: "stage-failure",
        ...errorInfo,
        processingJob: details.processingJob ?? null,
      });
      writeLog("stage.fail", "fail", {
        runId: state.workspace.id,
        uiTraceId: state.uiTraceId,
        backendTraceId: details.backendTraceId ?? details.processingJob?.traceId ?? state.processingJob?.traceId ?? null,
        stageId: stage.stageId,
        artifactId: stage.artifactId,
        parentArtifactId: stage.parentArtifactId,
        stageName: stage.stageName,
        ...errorInfo,
        debugSnapshotId: snapshot.id,
        debugSnapshotUri: details.debugSnapshotUri ?? null,
      });
      renderHooks.renderAll();
    }

    function writeLog(event, level, fields) {
      state.logs.unshift({
        id: createId("log"),
        event,
        level,
        time: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
        fields,
      });
      state.logs = state.logs.slice(0, 60);
      renderHooks.renderLogs();
      renderHooks.updateRunStatus(level, fields);
    }

    function captureDebugSnapshot(stageName, payload) {
      const parentArtifactId = state.generatedPlan?.artifactId ?? state.sampleVideo?.artifactId ?? null;
      const stage = beginStage(STAGES.snapshot, parentArtifactId);
      const snapshot = captureStageSnapshot({ ...stage, stageName }, payload);
      finishStage(stage, snapshot.artifactId);
      renderHooks.renderAll();
      return snapshot;
    }

    function captureStageSnapshot(stage, payload) {
      const snapshot = {
        id: createId("snapshot"),
        runId: state.workspace.id,
        uiTraceId: state.uiTraceId,
        backendTraceId: state.processingJob?.traceId ?? null,
        stageId: stage.stageId,
        stageName: stage.stageName,
        artifactId: stage.artifactId,
        parentArtifactId: stage.parentArtifactId,
        createdAt: new Date().toISOString(),
        payload,
      };
      state.debugSnapshots.unshift(snapshot);
      return snapshot;
    }

    function buildErrorInfo(error, details) {
      return {
        errorName: error?.name ?? "Error",
        errorCode: details.errorCode ?? error?.code ?? "unknown_error",
        errorStage: details.errorStage ?? details.processingJob?.stage ?? null,
        errorMessage: sanitizeText(details.errorMessage ?? error?.message ?? "未知错误", 120),
        canRetry: details.canRetry ?? true,
      };
    }

    return { beginStage, finishStage, failStage, captureDebugSnapshot };
  }

  window.WorkbenchObservability = { createObservability };
})();
