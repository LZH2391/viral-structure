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

    els.sampleVideoInput?.addEventListener("change", actions.handleSampleUpload);
    els.rerunStageBtn?.addEventListener("click", actions.handleRerunStage);
    els.snapshotBtn?.addEventListener("click", actions.captureManualSnapshot);
    els.frameTrackVisibleInput?.addEventListener("change", () => actions.setFrameTrackVisible(els.frameTrackVisibleInput.checked));
    els.timelineVisibleSecondsInput?.addEventListener("input", () => actions.setTimelineVisibleSeconds(els.timelineVisibleSecondsInput.value));
    els.sampleVideo?.addEventListener("timeupdate", () => {
      renderer.renderProperties();
      renderer.renderTimelinePlayhead();
    });
    els.sampleVideo?.addEventListener("play", renderer.startTimelinePlayback);
    els.sampleVideo?.addEventListener("pause", renderer.stopTimelinePlayback);
    els.sampleVideo?.addEventListener("ended", renderer.stopTimelinePlayback);
    window.addEventListener("resize", renderer.renderPreview);
  }

  window.WorkbenchEvents = { bindEvents };
})();
