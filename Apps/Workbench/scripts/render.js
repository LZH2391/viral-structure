(function () {
  const { state, formatTime } = window.WorkbenchState;
  const templates = window.WorkbenchRenderTemplates;

  function createRenderer(els, actions) {
    function updateRunStatus(level, fields) {
      const labelMap = { info: "运行中", done: "阶段完成", fail: "阶段失败" };
      els.runStatus.textContent = labelMap[level] ?? "等待输入";
      els.traceLabel.textContent = `trace ${fields.traceId.slice(-8)} / stage ${fields.stageId.slice(-6)}`;
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
      els.structureList.innerHTML = state.structureCards.length
        ? state.structureCards.map(templates.structureButton).join("")
        : `<div class="empty-state"><strong>暂无结构卡</strong><span>完成视频理解后生成</span></div>`;
      els.structureList.querySelectorAll("[data-segment-id]").forEach((button) => {
        button.addEventListener("click", () => actions.selectSegment(button.dataset.segmentId));
      });
    }

    function renderPreview() {
      const hasVideo = Boolean(state.sampleVideo);
      els.previewStage.classList.toggle("compare-mode", state.activePreviewMode === "compare");
      els.emptyPreview.style.display = hasVideo || state.activePreviewMode !== "sample" ? "none" : "grid";
      els.sampleVideo.classList.toggle("active", hasVideo && state.activePreviewMode !== "generated");
      els.generatedPreview.classList.toggle("active", state.activePreviewMode === "generated" || state.activePreviewMode === "compare");
      els.structureOverlay.innerHTML = state.structureCards
        .slice(0, 2)
        .map((item) => `<div class="overlay-chip">${item.name}: ${item.transferableRule}</div>`)
        .join("");
      els.previewMeta.textContent = state.sampleVideo
        ? `${state.sampleVideo.fileName} / ${formatTime(state.sampleVideo.duration)}`
        : state.processingJob
          ? `${state.processingJob.stage} / ${state.processingJob.progress}%`
          : "未加载样例";
      if (state.sampleVideo?.videoUri) {
        const videoUrl = window.WorkbenchApiClient.runtimeUrl(state.sampleVideo.videoUri);
        if (els.sampleVideo.src !== videoUrl) els.sampleVideo.src = videoUrl;
      }
      els.generatedPreview.innerHTML = state.generatedPlan ? templates.generatedPlan() : templates.emptyGenerated();
      els.mappingList.innerHTML = state.mappings.length ? state.mappings.map(templates.mapping).join("") : templates.emptyMapping();
    }

    function renderTimeline() {
      const frames = state.sampleVideo?.frameArtifacts ?? [];
      els.frameTrack.innerHTML = frames.map(templates.frameCell).join("");
      els.frameTrack.querySelectorAll("[data-frame-id]").forEach((button) => {
        button.addEventListener("click", () => actions.selectFrame(button.dataset.frameId));
      });
      els.segmentTrack.innerHTML = state.structureCards.map(templates.segmentBlock).join("");
      els.transferTrack.innerHTML = state.mappings.map(templates.transferBlock).join("");
    }

    function renderProperties(selectedCard = null) {
      const card = selectedCard ?? findCurrentStructureCard();
      els.currentSegment.innerHTML = templates.currentSegment(card);
      els.understandingBlock.innerHTML = state.structureCards.length
        ? state.structureCards.map((item) => `<div class="detail-row"><b>${item.name}</b><span>${item.explanation}</span></div>`).join("")
        : "等待视频理解";
    }

    function renderVersions() {
      els.versionList.innerHTML = state.versions.length
        ? state.versions.map(templates.version).join("")
        : `<div class="empty-state"><strong>暂无版本</strong><span>处理完成后生成</span></div>`;
    }

    function renderLogs() {
      els.logList.innerHTML = state.logs.slice(0, 14).map(templates.log).join("");
    }

    function findCurrentStructureCard() {
      return state.structureCards.find((item) => {
        const currentTime = els.sampleVideo.currentTime || 0;
        return currentTime >= item.start && currentTime <= item.end;
      });
    }

    return { updateRunStatus, renderAll, renderPreview, renderProperties, renderVersions, renderLogs };
  }

  window.WorkbenchRender = { createRenderer };
})();
