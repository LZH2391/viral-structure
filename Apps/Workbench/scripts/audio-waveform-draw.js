(function () {
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

  function drawCanvas(canvas, input) {
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
    drawBars(context, width, height, input);
    drawCursor(context, width, height, input);
  }

  function drawBars(context, width, height, input) {
    const center = height / 2;
    const progressX = width * clamp(input.progress);
    for (let x = 0; x < width; x += 2) {
      const peak = input.peaks[Math.floor((x / width) * input.peaks.length)] || 0.16;
      const barHeight = Math.max(2, peak * height * 0.82);
      context.fillStyle = x <= progressX ? "#42d8ff" : "#385166";
      context.fillRect(x, center - barHeight / 2, 1.4, barHeight);
    }
  }

  function drawCursor(context, width, height, input) {
    context.fillStyle = "#f8fbff";
    context.fillRect(width * clamp(input.progress), 0, 2, height);
    if (input.hoverRatio !== null) {
      context.fillStyle = "rgba(255, 255, 255, 0.32)";
      context.fillRect(width * input.hoverRatio, 0, 1, height);
    }
  }

  function clamp(value) {
    return Math.max(0, Math.min(1, value || 0));
  }

  window.WorkbenchAudioWaveformDraw = { buildPeaks, drawCanvas };
})();
