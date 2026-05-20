(function () {
  const { state, formatTime } = window.WorkbenchState;
  const templates = window.WorkbenchRenderTemplates;
  const { fitMediaViewport } = window.WorkbenchMediaViewportFitter;

  function createRenderer(els, actions, audioWaveform) {
    const timeline = window.WorkbenchTimelineRenderer.createTimelineRenderer(els, actions, audioWaveform);

    function updateRunStatus(level, fields) {
      const labelMap = { info: "运行中", done: "阶段完成", fail: "阶段失败" };
      const backendTraceId = fields.backendTraceId ?? state.processingJob?.traceId ?? null;
      const traceLabel = backendTraceId ? `trace ${backendTraceId.slice(-8)}` : `uiTrace ${fields.uiTraceId.slice(-8)}`;
      els.runStatus.textContent = labelMap[level] ?? "等待输入";
      els.traceLabel.textContent = `${traceLabel} / stage ${fields.stageId.slice(-6)}`;
    }

    function renderAll() {
      renderTimeline();
      renderPreview();
      renderProperties();
      renderVersions();
      renderLogs();
    }

    function renderPreview() {
      const hasMedia = Boolean(state.sampleVideo);
      hideMediaPreviews();
      els.previewMeta.textContent = state.sampleVideo
        ? `${mediaLabel()} / ${state.sampleVideo.fileName} / ${formatTime(state.sampleVideo.duration)}`
        : state.processingJob
          ? `${state.uploadStatusText ?? state.processingJob.stage} / ${state.processingJob.progress}%`
          : "未加载样例";
      if (!hasMedia) {
        renderWaitingPreview();
        els.emptyPreview.style.display = "grid";
        applyMediaViewport();
        return;
      }
      applyMediaViewport();
      renderActiveMedia();
    }

    function renderTimeline() { timeline.render(); }

    function renderTimelinePlayhead() {
      timeline.renderPlayhead();
    }

    function renderMediaSelection() {
      timeline.renderActiveState();
      renderPreview();
      renderProperties();
    }

    function renderProcessingState() {
      els.sampleFileLabel.textContent = state.isUploadingSample
        ? `${state.uploadStatusText ?? "处理中"} ${state.processingJob ? `${state.processingJob.progress}%` : ""}`.trim()
        : state.sampleVideo?.fileName ?? "未选择文件";
      renderPreview();
      renderProperties();
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

    function renderWaitingPreview() {
      if (!state.processingJob && !state.isUploadingSample && !state.errorSummary) return;
      const status = state.errorSummary
        ? `处理失败 / ${state.errorSummary.message ?? "请查看 trace"}`
        : `${state.uploadStatusText ?? "处理中"} / ${state.processingJob?.progress ?? 0}%`;
      els.emptyPreview.querySelector("strong").textContent = status;
      els.emptyPreview.querySelector("span").textContent = state.processingJob?.traceId
        ? `trace ${state.processingJob.traceId.slice(-8)}`
        : "等待后端返回 trace";
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
      els.audioWaveformPanel.classList.remove("active");
      els.audioPreview.classList.remove("active");
      els.mediaEmptyPreview.classList.remove("active");
      if (state.activeMediaKind !== "audio") audioWaveform?.stop();
    }

    function renderActiveMedia() {
      const derivative = findSelectedDerivative();
      if (state.activeMediaKind === "cover") return renderImage(derivative?.uri ?? state.sampleVideo.coverUri, "封面帧");
      if (state.activeMediaKind === "frame") {
        const frame = state.sampleVideo.frameArtifacts.find((item) => item.id === state.selectedFrameId) ?? state.sampleVideo.frameArtifacts[0];
        return renderImage(frame?.imageUri, "抽帧图片");
      }
      if (state.activeMediaKind === "audio") return renderAudio(derivative ?? findAudioDerivative());
      const videoUri = isVideoDerivative(derivative) ? derivative.uri : state.sampleVideo.videoUri;
      const videoUrl = window.WorkbenchApiClient.runtimeUrl(videoUri);
      if (!videoUrl) return renderEmpty("暂无可播放视频");
      if (els.sampleVideo.src !== videoUrl) els.sampleVideo.src = videoUrl;
      els.audioPreview.pause?.();
      els.sampleVideo.classList.add("active");
    }

    function renderImage(uri, alt) {
      const url = window.WorkbenchApiClient.runtimeUrl(uri);
      if (!url) return renderEmpty("暂无可预览图片");
      els.mediaImagePreview.alt = alt;
      if (els.mediaImagePreview.src !== url) els.mediaImagePreview.src = url;
      els.mediaImagePreview.classList.add("active");
    }

    function renderAudio(derivative) {
      const url = window.WorkbenchApiClient.runtimeUrl(derivative?.uri ?? state.sampleVideo.audioUri);
      if (!url) return renderEmpty(derivative?.summary || state.sampleVideo.audioSummary || "未检测到可抽取音频轨");
      els.sampleVideo.pause?.();
      if (els.audioPreview.src !== url) els.audioPreview.src = url;
      els.audioWaveformPanel.classList.add("active");
      audioWaveform?.update({ url, active: true, miniCanvas: timeline.miniWaveformCanvas() });
    }

    function renderEmpty(text) {
      els.mediaEmptyPreview.textContent = text;
      els.mediaEmptyPreview.classList.add("active");
    }

    function mediaLabel() {
      const labels = { video: "原视频", cover: "封面", frame: "抽帧", audio: "音频" };
      return labels[state.activeMediaKind] ?? "媒体";
    }

    function applyMediaViewport() {
      const leftPanel = document.querySelector(".resource-panel");
      const rightPanel = document.querySelector(".property-panel");
      const timeline = document.querySelector(".timeline-panel");
      const previewRect = els.previewPanel?.getBoundingClientRect?.() ?? els.previewStage.getBoundingClientRect();
      const stageRect = els.previewStage.getBoundingClientRect();
      const leftRect = leftPanel?.getBoundingClientRect?.() ?? { width: 0 };
      const rightRect = rightPanel?.getBoundingClientRect?.() ?? { width: 0 };
      const timelineHeight = timeline?.getBoundingClientRect?.().height ?? 0;
      const fit = fitMediaViewport({
        viewportWidth: stageRect.width + sidePanelWidth(leftRect, previewRect) + sidePanelWidth(rightRect, previewRect),
        viewportHeight: stageRect.height + timelineHeight,
        leftPanelWidth: overlapsVertically(leftRect, previewRect) ? leftRect.width : 0,
        rightPanelWidth: overlapsVertically(rightRect, previewRect) ? rightRect.width : 0,
        timelineHeight,
        mediaWidth: state.sampleVideo?.width ?? 16,
        mediaHeight: state.sampleVideo?.height ?? 9,
      });
      els.previewStage.style.setProperty("--media-content-width", `${fit.contentWidth}px`);
      els.previewStage.style.setProperty("--media-content-height", `${fit.contentHeight}px`);
      els.previewStage.dataset.letterboxInsets = JSON.stringify(fit.letterboxInsets);
    }

    function overlapsVertically(first, second) {
      if (!Number.isFinite(first.top) || !Number.isFinite(second.top)) return false;
      return first.bottom > second.top && first.top < second.bottom;
    }

    function sidePanelWidth(panelRect, previewRect) {
      return overlapsVertically(panelRect, previewRect) ? panelRect.width : 0;
    }

    function findSelectedDerivative() {
      return state.mediaDerivatives.find((item) => item.artifactId === state.selectedDerivativeId) ?? null;
    }

    function findAudioDerivative() {
      return state.mediaDerivatives.find((item) => item.type === "audio-track") ?? null;
    }

    function isVideoDerivative(item) {
      return item?.type === "original-video" || item?.type === "normalized-video";
    }

    return { updateRunStatus, renderAll, renderPreview, renderProperties, renderVersions, renderLogs, renderMediaSelection, renderProcessingState, renderTimeline, renderTimelinePlayhead, startTimelinePlayback: timeline.startPlayback, stopTimelinePlayback: timeline.stopPlayback };
  }

  window.WorkbenchRender = { createRenderer };
})();
