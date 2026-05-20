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
    return `
      <button class="list-item" type="button" data-segment-id="${item.id}">
        <strong>${item.order}. ${item.name}</strong>
        <span>${formatTime(item.start)} - ${formatTime(item.end)} / ${item.explanation}</span>
      </button>
    `;
  }

  function generatedPlan() {
    return `
      <h2>${state.generatedPlan.title}</h2>
      <p><strong>封面标题：</strong>${state.generatedPlan.coverTitle}</p>
      ${state.generatedPlan.shots.map(scriptShot).join("")}
    `;
  }

  function scriptShot(shot) {
    return `
      <div class="script-shot">
        <time>${formatTime(shot.start)} - ${formatTime(shot.end)}</time>
        <div>
          <strong>${shot.beat}</strong>
          <div>${shot.script}</div>
          <div>字幕：${shot.subtitle}</div>
          <div>镜头：${shot.camera}</div>
        </div>
      </div>
    `;
  }

  function emptyGenerated() {
    return `<div class="empty-state"><strong>暂无新方案</strong><span>生成迁移方案后展示</span></div>`;
  }

  function mapping(item) {
    return `
      <div class="mapping-item">
        <strong>${item.sourceName} -> ${item.targetName}</strong>
        <span>${item.explanation}</span>
      </div>
    `;
  }

  function emptyMapping() {
    return `<div class="empty-state"><strong>暂无映射</strong><span>迁移方案生成后展示</span></div>`;
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
    return `
      <button class="audio-track-button ${state.activeMediaKind === "audio" ? "active" : ""}" type="button">
        <strong>字幕/语音轨</strong>
        <span>${status}</span>
      </button>
    `;
  }

  function segmentBlock(item) {
    const width = Math.max(120, (item.end - item.start) * 18);
    return `<div class="segment-block" style="min-width:${width}px">${item.name}</div>`;
  }

  function transferBlock(item) {
    return `<div class="transfer-block">${item.sourceName} -> ${item.targetName}</div>`;
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
        return `
          <div class="detail-row"><b>帧时间</b><span>${formatTime(frame.time)}</span></div>
          <div class="detail-row"><b>artifact</b><span>${frame.artifactId}</span></div>
          <div class="detail-row"><b>parent</b><span>${frame.parentArtifactId}</span></div>
        `;
      }
      if (state.activeMediaKind === "audio") {
        return `
          <div class="detail-row"><b>语音轨</b><span>${derivative?.summary || state.sampleVideo.audioSummary || "未检测到可抽取音频轨"}</span></div>
          <div class="detail-row"><b>artifact</b><span>${derivative?.artifactId ?? "无"}</span></div>
          <div class="detail-row"><b>parent</b><span>${derivative?.parentArtifactId ?? state.sampleVideo.artifactId}</span></div>
        `;
      }
      if (state.activeMediaKind === "video" && derivative) {
        return `
          <div class="detail-row"><b>视频引用</b><span>${derivative.name}</span></div>
          <div class="detail-row"><b>artifact</b><span>${derivative.artifactId}</span></div>
          <div class="detail-row"><b>parent</b><span>${derivative.parentArtifactId ?? "无"}</span></div>
        `;
      }
      return `
        <div class="detail-row"><b>样例</b><span>${state.sampleVideo.fileName}</span></div>
        <div class="detail-row"><b>时长</b><span>${formatTime(state.sampleVideo.duration)}</span></div>
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
    generatedPlan,
    emptyGenerated,
    mapping,
    emptyMapping,
    frameCell,
    audioTrackButton,
    segmentBlock,
    transferBlock,
    currentSegment,
    version,
    log,
  };
})();
