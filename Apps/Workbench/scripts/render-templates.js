(function () {
  const { state, formatTime } = window.WorkbenchState;

  function listItem(item) {
    return `
      <button class="list-item ${item.artifactId === state.selectedDerivativeId ? "active" : ""}" type="button" data-artifact-id="${item.artifactId}">
        <strong>${item.name}</strong>
        <span>${item.type} / ${item.summary}</span>
      </button>
    `;
  }

  function structureButton(item) {
    return `<button class="list-item" type="button" data-segment-id="${item.id}"><strong>${item.order}. ${item.name}</strong><span>${formatTime(item.start)} - ${formatTime(item.end)} / ${item.explanation}</span></button>`;
  }

  function frameCell(frame) {
    const src = window.WorkbenchApiClient.runtimeUrl(frame.imageUri);
    return `
      <button class="frame-cell ${frame.id === state.selectedFrameId ? "active" : ""}" type="button" data-frame-id="${frame.id}">
        <img alt="" src="${src}" />
        <span>${formatTime(frame.time)}</span>
      </button>
    `;
  }

  function audioTrackButton(audio) {
    const status = audio?.uri ? audio.summary : audio?.summary || "未检测到可抽取音频轨";
    const waveform = audio?.uri ? `<canvas class="audio-mini-waveform" data-audio-wave-mini width="360" height="42"></canvas>` : "";
    return `
      <button class="audio-track-button ${state.activeMediaKind === "audio" ? "active" : ""}" type="button">
        <strong>字幕/语音轨</strong>
        <span>${status}</span>
        ${waveform}
      </button>
    `;
  }

  function mediaDetailRows({ label, time, artifactId, parentArtifactId, resolution }) {
    return `
      <div class="detail-row"><b>媒体类型</b><span>${label}</span></div>
      <div class="detail-row"><b>时间点</b><span>${time}</span></div>
      <div class="detail-row"><b>artifact</b><span>${artifactId ?? "无"}</span></div>
      <div class="detail-row"><b>parent</b><span>${parentArtifactId ?? "无"}</span></div>
      <div class="detail-row"><b>分辨率</b><span>${resolution}</span></div>
    `;
  }

  function resolutionText() {
    const { width, height, aspectRatio } = state.sampleVideo ?? {};
    if (!width || !height) return "未知";
    const ratio = Number.isFinite(aspectRatio) ? ` / ${aspectRatio.toFixed(2)}:1` : "";
    return `${width} x ${height}${ratio}`;
  }

  function currentSegment(card) {
    if (card) {
      return `
        <div class="detail-row"><b>片段</b><span>${card.name}</span></div>
        <div class="detail-row"><b>时间</b><span>${formatTime(card.start)} - ${formatTime(card.end)}</span></div>
        <div class="detail-row"><b>解释</b><span>${card.explanation}</span></div>
        <div class="detail-row"><b>规则</b><span>${card.transferableRule}</span></div>
      `;
    }
    if (state.sampleVideo) {
      const frame = state.sampleVideo.frameArtifacts.find((item) => item.id === state.selectedFrameId);
      const derivative = state.mediaDerivatives.find((item) => item.artifactId === state.selectedDerivativeId);
      if (state.activeMediaKind === "frame" && frame) {
        return mediaDetailRows({
          label: "抽帧图片",
          time: formatTime(frame.time),
          artifactId: frame.artifactId,
          parentArtifactId: frame.parentArtifactId,
          resolution: resolutionText(),
        });
      }
      if (state.activeMediaKind === "audio") {
        return mediaDetailRows({
          label: derivative?.summary || state.sampleVideo.audioSummary || "音频轨",
          time: "不适用",
          artifactId: derivative?.artifactId,
          parentArtifactId: derivative?.parentArtifactId ?? state.sampleVideo.artifactId,
          resolution: "不适用",
        });
      }
      if (derivative) {
        return mediaDetailRows({
          label: derivative.name,
          time: state.activeMediaKind === "video" ? "可播放" : "独立图片",
          artifactId: derivative.artifactId,
          parentArtifactId: derivative.parentArtifactId,
          resolution: resolutionText(),
        });
      }
      return `
        <div class="detail-row"><b>样例</b><span>${state.sampleVideo.fileName}</span></div>
        <div class="detail-row"><b>时长</b><span>${formatTime(state.sampleVideo.duration)}</span></div>
        <div class="detail-row"><b>分辨率</b><span>${resolutionText()}</span></div>
        <div class="detail-row"><b>状态</b><span>${state.sampleVideo.processingStatus}</span></div>
        <div class="detail-row"><b>采样率</b><span>${state.sampleVideo.processingOptions?.frameSampleRateFps ?? 1} fps</span></div>
        <div class="detail-row"><b>trace</b><span>${state.processingJob?.traceId ?? "无"}</span></div>
      `;
    }
    if (state.errorSummary) return `<div class="detail-row"><b>错误</b><span>${state.errorSummary.message}</span></div>`;
    if (state.processingJob) {
      return `
        <div class="detail-row"><b>任务</b><span>${state.processingJob.status}</span></div>
        <div class="detail-row"><b>阶段</b><span>${state.processingJob.stage}</span></div>
        <div class="detail-row"><b>进度</b><span>${state.processingJob.progress}%</span></div>
        <div class="detail-row"><b>trace</b><span>${state.processingJob.traceId}</span></div>
      `;
    }
    return "暂无片段";
  }

  function version(item) {
    const parent = item.parentArtifactId ? item.parentArtifactId.slice(-8) : "none";
    return `
      <div class="version-item">
        <strong>${item.label}</strong>
        <span>${item.stageName} / ${item.createdAt}</span>
        <span>artifact ${item.artifactId.slice(-8)} / parent ${parent}</span>
      </div>
    `;
  }

  function log(item) {
    const fields = item.fields;
    const details = [
      fields.stageName ? `stage ${fields.stageName}` : null,
      fields.errorStage ? `failedAt ${fields.errorStage}` : null,
      fields.errorCode ? `code ${fields.errorCode}` : null,
      fields.debugSnapshotId ? `snapshot ${fields.debugSnapshotId.slice(-8)}` : null,
      fields.backendTraceId ? `trace ${fields.backendTraceId.slice(-8)}` : null,
    ].filter(Boolean);
    return `
      <div class="log-item ${item.level}">
        ${item.time} / ${item.event}<br />
        run ${fields.runId.slice(-8)} / uiTrace ${fields.uiTraceId.slice(-8)} / stage ${fields.stageId.slice(-6)} / artifact ${fields.artifactId.slice(-8)}
        ${details.length ? `<br />${details.join(" / ")}` : ""}
        ${fields.errorMessage ? `<br /><strong>${fields.errorMessage}</strong>` : ""}
      </div>
    `;
  }

  window.WorkbenchRenderTemplates = {
    listItem,
    structureButton,
    frameCell,
    audioTrackButton,
    currentSegment,
    version,
    log,
  };
})();
