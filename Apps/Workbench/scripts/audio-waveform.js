(function () {
  const { formatTime } = window.WorkbenchState;
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
    };

    bindControls();

    function update({ url, active, miniCanvas }) {
      state.active = Boolean(active && url);
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

    function buildPeaks(audioBuffer, count) {
      const peaks = [];
      const channelCount = audioBuffer.numberOfChannels || 1;
      const step = Math.max(1, Math.floor(audioBuffer.length / count));
      for (let index = 0; index < count; index += 1) {
        let peak = 0;
        const start = index * step;
        const end = Math.min(start + step, audioBuffer.length);
        for (let channel = 0; channel < channelCount; channel += 1) {
          const data = audioBuffer.getChannelData(channel);
          for (let sample = start; sample < end; sample += 1) {
            peak = Math.max(peak, Math.abs(data[sample] || 0));
          }
        }
        peaks.push(Math.max(0.04, Math.min(1, peak)));
      }
      return peaks;
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
      drawCanvas(els.audioWaveformCanvas);
      drawCanvas(state.boundMiniCanvas);
    }

    function drawCanvas(canvas) {
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width || canvas.width));
      const height = Math.max(1, Math.round(rect.height || canvas.height));
      const ratio = window.devicePixelRatio || 1;
      if (canvas.width !== width * ratio || canvas.height !== height * ratio) {
        canvas.width = width * ratio;
        canvas.height = height * ratio;
      }
      const context = canvas.getContext("2d");
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      context.fillStyle = "#0b1118";
      context.fillRect(0, 0, width, height);
      drawBars(context, width, height);
      drawCursor(context, width, height);
    }

    function drawBars(context, width, height) {
      const center = height / 2;
      const progressX = width * progressRatio();
      for (let x = 0; x < width; x += 2) {
        const peak = state.peaks[Math.floor((x / width) * state.peaks.length)] || 0.16;
        const barHeight = Math.max(2, peak * height * 0.82);
        context.fillStyle = x <= progressX ? "#42d8ff" : "#385166";
        context.fillRect(x, center - barHeight / 2, 1.4, barHeight);
      }
    }

    function drawCursor(context, width, height) {
      const playhead = width * progressRatio();
      context.fillStyle = "#f8fbff";
      context.fillRect(playhead, 0, 2, height);
      if (state.hoverRatio !== null) {
        context.fillStyle = "rgba(255, 255, 255, 0.32)";
        context.fillRect(width * state.hoverRatio, 0, 1, height);
      }
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

    return { update, stop, render, seekFromPointer };
  }

  window.WorkbenchAudioWaveform = { createAudioWaveform };
})();
