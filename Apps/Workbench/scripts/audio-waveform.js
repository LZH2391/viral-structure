(function () {
  const { formatTime } = window.WorkbenchState;
  const { buildPeaks, drawCanvas } = window.WorkbenchAudioWaveformDraw;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;

  function createAudioWaveform(els) {
    const state = {
      url: null,
      peaks: [],
      active: false,
      rafId: 0,
      hoverRatio: null,
      decodeToken: 0,
      boundMiniCanvas: null,
      externalProgress: null,
    };

    bindControls();

    function update({ url, active, miniCanvas, externalProgress = null }) {
      state.active = Boolean(active && url);
      state.externalProgress = externalProgress;
      bindCanvas(els.audioWaveformCanvas);
      bindMiniCanvas(miniCanvas);
      els.audioWaveformPanel.classList.toggle("active", state.active);
      if (!url) {
        stopLoop();
        state.url = null;
        state.peaks = [];
        render();
        return;
      }
      if (state.url !== url) {
        state.url = url;
        state.peaks = [];
        if (els.audioPreview.src !== url) els.audioPreview.src = url;
        decodePeaks(url);
      }
      if (state.active && !els.audioPreview.paused) startLoop();
      if (!state.active) stopLoop();
      render();
    }

    function renderWithProgress(progress) {
      state.externalProgress = clamp(progress);
      drawWaveform(state.boundMiniCanvas, state.externalProgress);
    }

    function stop() {
      stopLoop();
      els.audioPreview.pause();
      state.active = false;
      els.audioWaveformPanel.classList.remove("active");
      render();
    }

    async function decodePeaks(url) {
      const token = state.decodeToken + 1;
      state.decodeToken = token;
      if (!AudioContextClass) return render();
      try {
        const response = await fetch(url);
        const buffer = await response.arrayBuffer();
        const context = new AudioContextClass();
        const audioBuffer = await context.decodeAudioData(buffer);
        if (context.close) context.close();
        if (state.decodeToken !== token) return;
        state.peaks = buildPeaks(audioBuffer, 900);
        render();
      } catch (error) {
        if (state.decodeToken === token) state.peaks = [];
        render();
      }
    }

    function bindControls() {
      els.audioWaveformPlayBtn.addEventListener("click", () => {
        if (!state.url) return;
        if (els.audioPreview.paused) els.audioPreview.play().catch(render);
        else els.audioPreview.pause();
      });
      els.audioPreview.addEventListener("play", startLoop);
      els.audioPreview.addEventListener("pause", () => {
        stopLoop();
        render();
      });
      els.audioPreview.addEventListener("timeupdate", render);
      els.audioPreview.addEventListener("loadedmetadata", render);
    }

    function bindMiniCanvas(canvas) {
      if (state.boundMiniCanvas === canvas) return;
      state.boundMiniCanvas = canvas;
      bindCanvas(canvas);
    }

    function bindCanvas(canvas) {
      if (!canvas || canvas.dataset.waveformBound) return;
      canvas.dataset.waveformBound = "true";
      canvas.addEventListener("pointerdown", (event) => {
        if (!state.url) return;
        canvas.setPointerCapture?.(event.pointerId);
        seekFromPointer(event, canvas);
      });
      canvas.addEventListener("pointermove", (event) => {
        const rect = canvas.getBoundingClientRect();
        state.hoverRatio = clamp((event.clientX - rect.left) / Math.max(rect.width, 1));
        if (event.buttons === 1) seekFromPointer(event, canvas);
        render();
      });
      canvas.addEventListener("pointerleave", () => {
        state.hoverRatio = null;
        render();
      });
    }

    function seekFromPointer(event, canvas) {
      const duration = safeDuration();
      if (!duration) return;
      const rect = canvas.getBoundingClientRect();
      els.audioPreview.currentTime = duration * clamp((event.clientX - rect.left) / Math.max(rect.width, 1));
      render();
    }

    function startLoop() {
      if (state.rafId) return;
      const tick = () => {
        render();
        if (!els.audioPreview.paused && state.active) state.rafId = requestAnimationFrame(tick);
        else state.rafId = 0;
      };
      state.rafId = requestAnimationFrame(tick);
    }

    function stopLoop() {
      if (!state.rafId) return;
      cancelAnimationFrame(state.rafId);
      state.rafId = 0;
    }

    function render() {
      els.audioWaveformPlayBtn.classList.toggle("playing", !els.audioPreview.paused);
      els.audioWaveformTime.textContent = `${formatTime(els.audioPreview.currentTime)} / ${formatTime(safeDuration())}`;
      drawWaveform(els.audioWaveformCanvas, progressRatio());
      drawWaveform(state.boundMiniCanvas, state.externalProgress ?? progressRatio());
    }

    function drawWaveform(canvas, progress) {
      drawCanvas(canvas, { peaks: state.peaks, progress, hoverRatio: state.hoverRatio });
    }

    function progressRatio() {
      return safeDuration() ? clamp(els.audioPreview.currentTime / safeDuration()) : 0;
    }

    function safeDuration() {
      return Number.isFinite(els.audioPreview.duration) ? els.audioPreview.duration : 0;
    }

    function clamp(value) {
      return Math.max(0, Math.min(1, value || 0));
    }

    return { update, stop, render, renderWithProgress, seekFromPointer };
  }

  window.WorkbenchAudioWaveform = { createAudioWaveform };
})();
