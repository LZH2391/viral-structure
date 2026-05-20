(function () {
  const { state, formatTime } = window.WorkbenchState;

  function listItem(item) {
    return `
      <div class="list-item">
        <strong>${item.name}</strong>
        <span>${item.type} / ${item.summary}</span>
      </div>
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
    return `
      <button class="frame-cell ${frame.id === state.selectedFrameId ? "active" : ""}" type="button" data-frame-id="${frame.id}">
        <img alt="" src="${frame.thumbnail}" />
        <span>${formatTime(frame.time)}</span>
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
      return `
        <div class="detail-row"><b>样例</b><span>${state.sampleVideo.fileName}</span></div>
        <div class="detail-row"><b>时长</b><span>${formatTime(state.sampleVideo.duration)}</span></div>
        <div class="detail-row"><b>状态</b><span>${state.sampleVideo.processingStatus}</span></div>
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
    return `
      <div class="log-item ${item.level}">
        ${item.time} / ${item.event}<br />
        run ${item.fields.runId.slice(-8)} / stage ${item.fields.stageId.slice(-6)} / artifact ${item.fields.artifactId.slice(-8)}
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
    segmentBlock,
    transferBlock,
    currentSegment,
    version,
    log,
  };
})();
