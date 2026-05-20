(function () {
  const { state, formatTime } = window.WorkbenchState;
  const templates = window.WorkbenchRenderTemplates;

  function createRenderer(els, actions) {
    function updateRunStatus(level, fields) {
      const labelMap = { info: "运行中", done: "阶段完成", fail: "阶段失败" };
      const backendTraceId = fields.backendTraceId ?? state.processingJob?.traceId ?? null;
      const traceLabel = backendTraceId ? `trace ${backendTraceId.slice(-8)}` : `uiTrace ${fields.uiTraceId.slice(-8)}`;
      els.runStatus.textContent = labelMap[level] ?? "等待输入";
      els.traceLabel.textContent = `${traceLabel} / stage ${fields.stageId.slice(-6)}`;
    }

    function renderAll() {
      renderResources();
      renderPreview();
      renderTimeline();
      renderProperties();
      renderVersions();
      renderLogs();
    }

    function renderResources() {
      els.derivativeList.innerHTML = state.mediaDerivatives.map(templates.listItem).join("");
      els.derivativeList.querySelectorAll("[data-artifact-id]").forEach((button) => {
        button.addEventListener("click", () => actions.selectDerivative(button.dataset.artifactId));
      });
    }

    function renderPreview() {
      const hasMedia = Boolean(state.sampleVideo);
      hideMediaPreviews();
      els.previewMeta.textContent = state.sampleVideo
        ? `${mediaLabel()} / ${state.sampleVideo.fileName} / ${formatTime(state.sampleVideo.duration)}`
        : state.processingJob
          ? `${state.processingJob.stage} / ${state.processingJob.progress}%`
          : "未加载样例";
      if (!hasMedia) {
        els.emptyPreview.style.display = "grid";
        return;
      }
      renderActiveMedia();
    }

    function renderTimeline() {
      const frames = state.sampleVideo?.frameArtifacts ?? [];
      els.frameTrack.innerHTML = frames.map(templates.frameCell).join("");
      els.frameTrack.querySelectorAll("[data-frame-id]").forEach((button) => {
        button.addEventListener("click", () => actions.selectFrame(button.dataset.frameId));
      });
      els.captionTrack.innerHTML = `<button class="audio-track-button" type="button">字幕/语音轨</button>`;
      els.captionTrack.querySelector("button")?.addEventListener("click", actions.selectAudioTrack);
    }

    function renderProperties(selectedCard = null) {
      const card = selectedCard ?? findCurrentStructureCard();
      els.currentSegment.innerHTML = templates.currentSegment(card);
    }

    function renderVersions() {
      if (!els.versionList) return;
      els.versionList.innerHTML = state.versions.length
        ? state.versions.map(templates.version).join("")
        : `<div class="empty-state"><strong>暂无版本</strong><span>处理完成后生成</span></div>`;
    }

    function renderLogs() {
      if (!els.logList) return;
      els.logList.innerHTML = state.logs.slice(0, 14).map(templates.log).join("");
    }

    function findCurrentStructureCard() {
      return state.structureCards.find((item) => {
        const currentTime = els.sampleVideo.currentTime || 0;
        return currentTime >= item.start && currentTime <= item.end;
      });
    }

    function hideMediaPreviews() {
      els.emptyPreview.style.display = "none";
      els.sampleVideo.classList.remove("active");
      els.mediaImagePreview.classList.remove("active");
      els.audioPreview.classList.remove("active");
      els.mediaEmptyPreview.classList.remove("active");
    }

    function renderActiveMedia() {
      if (state.activeMediaKind === "cover") return renderImage(state.sampleVideo.coverUri, "封面帧");
      if (state.activeMediaKind === "frame") {
        const frame = state.sampleVideo.frameArtifacts.find((item) => item.id === state.selectedFrameId);
        return renderImage(frame?.imageUri, "抽帧图片");
      }
      if (state.activeMediaKind === "audio") return renderAudio();
      const videoUrl = window.WorkbenchApiClient.runtimeUrl(state.sampleVideo.videoUri);
      if (els.sampleVideo.src !== videoUrl) els.sampleVideo.src = videoUrl;
      els.sampleVideo.classList.add("active");
    }

    function renderImage(uri, alt) {
      const url = window.WorkbenchApiClient.runtimeUrl(uri);
      if (!url) return renderEmpty("暂无可预览图片");
      els.mediaImagePreview.alt = alt;
      if (els.mediaImagePreview.src !== url) els.mediaImagePreview.src = url;
      els.mediaImagePreview.classList.add("active");
    }

    function renderAudio() {
      const url = window.WorkbenchApiClient.runtimeUrl(state.sampleVideo.audioUri);
      if (!url) return renderEmpty(state.sampleVideo.audioSummary || "未检测到可抽取音频轨");
      if (els.audioPreview.src !== url) els.audioPreview.src = url;
      els.audioPreview.classList.add("active");
    }

    function renderEmpty(text) {
      els.mediaEmptyPreview.textContent = text;
      els.mediaEmptyPreview.classList.add("active");
    }

    function mediaLabel() {
      const labels = { video: "原视频", cover: "封面", frame: "抽帧", audio: "音频" };
      return labels[state.activeMediaKind] ?? "媒体";
    }

    return { updateRunStatus, renderAll, renderPreview, renderProperties, renderVersions, renderLogs };
  }

  window.WorkbenchRender = { createRenderer };
})();
