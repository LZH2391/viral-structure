(function () {
  const STORAGE_KEY = "workbench:last-sample";
  const { state } = window.WorkbenchState;
  const { applySampleArtifact } = window.WorkbenchSampleIngest;

  function createWorkspaceDraft(els, renderer) {
    function save() {
      if (!state.sampleArtifact || !state.sampleVideo) return;
      write({
        sampleVideoId: state.sampleVideo.id,
        artifactId: state.sampleVideo.artifactId,
        traceId: state.processingJob?.traceId ?? null,
        sampleArtifact: state.sampleArtifact,
        selectedFrameId: state.selectedFrameId,
        selectedDerivativeId: state.selectedDerivativeId,
        versions: state.versions,
      });
      els.saveStatus.textContent = "已保存样例处理完成";
    }

    function restore() {
      const draft = read();
      if (!draft?.sampleArtifact) return false;
      try {
        applySampleArtifact(draft.sampleArtifact);
        state.processingJob = buildRestoredJob(draft);
        state.selectedFrameId = draft.selectedFrameId ?? state.selectedFrameId;
        state.selectedDerivativeId = draft.selectedDerivativeId ?? state.selectedDerivativeId;
        state.versions = Array.isArray(draft.versions) ? draft.versions : [];
        els.saveStatus.textContent = "已恢复最近样例";
        renderer.renderAll();
        return true;
      } catch {
        clear();
        els.saveStatus.textContent = "本地草稿已清理";
        return false;
      }
    }

    return { save, restore, clear };
  }

  function buildRestoredJob(draft) {
    if (!draft.traceId) return null;
    return {
      jobId: null,
      sampleVideoId: draft.sampleVideoId ?? draft.sampleArtifact?.sampleVideoId ?? null,
      status: "processed",
      stage: "restored",
      progress: 100,
      traceId: draft.traceId,
    };
  }

  function read() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY));
    } catch {
      clear();
      return null;
    }
  }

  function write(value) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  }

  function clear() {
    localStorage.removeItem(STORAGE_KEY);
  }

  window.WorkbenchDraft = { createWorkspaceDraft };
})();
