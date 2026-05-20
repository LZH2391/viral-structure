(function () {
  function bindEvents(els, actions, renderer) {
    document.querySelectorAll(".tab-button").forEach((button) => {
      button.addEventListener("click", () => {
        document.querySelectorAll(".tab-button").forEach((item) => item.classList.remove("active"));
        document.querySelectorAll(".resource-view").forEach((item) => item.classList.remove("active"));
        button.classList.add("active");
        document.querySelector(`[data-view="${button.dataset.tab}"]`)?.classList.add("active");
      });
    });

    els.sampleVideoInput.addEventListener("change", actions.handleSampleUpload);
    els.understandBtn.addEventListener("click", actions.handleUnderstand);
    els.profileForm.addEventListener("submit", actions.handleGeneratePlan);
    els.rerunStageBtn.addEventListener("click", actions.handleRerunStage);
    els.snapshotBtn.addEventListener("click", actions.captureManualSnapshot);
    els.sampleVideo.addEventListener("timeupdate", () => renderer.renderProperties());
    els.sampleModeBtn.addEventListener("click", () => actions.setPreviewMode("sample"));
    els.generatedModeBtn.addEventListener("click", () => actions.setPreviewMode("generated"));
    els.compareModeBtn.addEventListener("click", () => actions.setPreviewMode("compare"));
  }

  window.WorkbenchEvents = { bindEvents };
})();
