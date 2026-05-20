(function () {
  const { STAGES, state, createId, sanitizeText } = window.WorkbenchState;

  function createObservability(renderHooks) {
    function beginStage(stageName, parentArtifactId = null) {
      const stageId = createId("stage");
      const artifactId = createId("artifact");
      state.activeStageId = stageId;
      writeLog("stage.start", "info", {
        runId: state.workspace.id,
        traceId: state.workspace.id,
        stageId,
        artifactId,
        parentArtifactId,
        stage: stageName,
      });
      return { stageName, stageId, artifactId, parentArtifactId };
    }

    function finishStage(stage, artifactId = stage.artifactId) {
      writeLog("stage.end", "done", {
        runId: state.workspace.id,
        traceId: state.workspace.id,
        stageId: stage.stageId,
        artifactId,
        parentArtifactId: stage.parentArtifactId,
        stage: stage.stageName,
      });
      state.activeStageId = stage.stageId;
    }

    function failStage(stage, error) {
      writeLog("stage.fail", "fail", {
        runId: state.workspace.id,
        traceId: state.workspace.id,
        stageId: stage.stageId,
        artifactId: stage.artifactId,
        parentArtifactId: stage.parentArtifactId,
        stage: stage.stageName,
        errorName: error?.name ?? "Error",
        errorMessage: sanitizeText(error?.message ?? "未知错误"),
      });
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
      const snapshot = {
        id: createId("snapshot"),
        runId: state.workspace.id,
        traceId: state.workspace.id,
        stageId: stage.stageId,
        stageName,
        artifactId: stage.artifactId,
        parentArtifactId: stage.parentArtifactId,
        createdAt: new Date().toISOString(),
        payload,
      };
      state.debugSnapshots.unshift(snapshot);
      finishStage(stage, snapshot.artifactId);
      renderHooks.renderAll();
      return snapshot;
    }

    return { beginStage, finishStage, failStage, captureDebugSnapshot };
  }

  window.WorkbenchObservability = { createObservability };
})();
