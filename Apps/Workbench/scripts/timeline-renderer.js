(function () {
  const { state } = window.WorkbenchState;
  const templates = window.WorkbenchRenderTemplates;
  const { createTimelineMetrics, frameLeft, visibleFrames } = window.WorkbenchTimelineMetrics;

  function createTimelineRenderer(els, actions, audioWaveform) {
    let cacheKey = null;

    function render() {
      const frames = state.sampleVideo?.frameArtifacts ?? [];
      const audio = findAudioDerivative();
      const metrics = createTimelineMetrics(state.sampleVideo);
      const nextKey = timelineKey(frames, audio, metrics);
      if (nextKey === cacheKey) return renderActiveState();
      cacheKey = nextKey;
      els.timelineContent.style.width = `${metrics.contentWidth}px`;
      els.timelineRuler.innerHTML = metrics.ticks.map((tick) => templates.rulerTick(tick.time, tick.left)).join("");
      els.videoTrack.innerHTML = templates.videoClip(state.sampleVideo, metrics.contentWidth);
      els.videoTrack.querySelector("button")?.addEventListener("click", actions.selectVideoTrack);
      els.frameTrack.innerHTML = visibleFrames(frames).map((frame) => templates.frameCell(frame, frameLeft(frame.time, metrics))).join("");
      els.frameTrack.querySelectorAll("[data-frame-id]").forEach((button) => {
        button.addEventListener("click", () => actions.selectFrame(button.dataset.frameId));
      });
      els.audioTrack.innerHTML = templates.audioTrackButton(audio, metrics.contentWidth);
      els.audioTrack.querySelector("button")?.addEventListener("click", actions.selectAudioTrack);
      syncAudioWaveform(audio);
      renderActiveState();
    }

    function renderActiveState() {
      els.videoTrack.querySelector(".video-clip")?.classList.toggle("active", state.activeMediaKind === "video");
      els.audioTrack.querySelector(".audio-track-button")?.classList.toggle("active", state.activeMediaKind === "audio");
      els.frameTrack.querySelectorAll("[data-frame-id]").forEach((button) => {
        button.classList.toggle("active", button.dataset.frameId === state.selectedFrameId);
      });
    }

    function miniWaveformCanvas() {
      return els.audioTrack.querySelector("[data-audio-wave-mini]");
    }

    function findAudioDerivative() {
      return state.mediaDerivatives.find((item) => item.type === "audio-track") ?? null;
    }

    function syncAudioWaveform(audio) {
      audioWaveform?.update({
        url: window.WorkbenchApiClient.runtimeUrl(audio?.uri),
        active: false,
        miniCanvas: miniWaveformCanvas(),
      });
    }

    function timelineKey(frames, audio, metrics) {
      const frameKey = frames.map((frame) => `${frame.id}:${frame.time}:${frame.imageUri}`).join("|");
      return [state.sampleVideo?.artifactId ?? "empty", state.sampleVideo?.duration ?? 0, metrics.contentWidth, frameKey, audio?.artifactId ?? "no-audio", audio?.uri ?? ""].join("::");
    }

    return { render, renderActiveState, miniWaveformCanvas };
  }

  window.WorkbenchTimelineRenderer = { createTimelineRenderer };
})();
