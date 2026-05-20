const STAGES = {
  ingest: "sample-ingest",
  understand: "sample-understanding",
  transfer: "structure-transfer",
  rerun: "stage-rerun",
  snapshot: "debug-snapshot",
};

const state = {
  workspace: {
    id: createId("workspace"),
    name: "结构迁移工作台",
    currentVersionId: null,
  },
  activeStageId: null,
  activePreviewMode: "sample",
  selectedFrameId: null,
  sampleVideo: null,
  mediaDerivatives: [],
  structureCards: [],
  contentProfile: null,
  generatedPlan: null,
  mappings: [],
  versions: [],
  logs: [],
  debugSnapshots: [],
};

const els = {
  saveStatus: document.querySelector("#saveStatus"),
  runStatus: document.querySelector("#runStatus"),
  traceLabel: document.querySelector("#traceLabel"),
  sampleVideoInput: document.querySelector("#sampleVideoInput"),
  sampleFileLabel: document.querySelector("#sampleFileLabel"),
  derivativeList: document.querySelector("#derivativeList"),
  structureList: document.querySelector("#structureList"),
  versionList: document.querySelector("#versionList"),
  sampleVideo: document.querySelector("#sampleVideo"),
  emptyPreview: document.querySelector("#emptyPreview"),
  previewMeta: document.querySelector("#previewMeta"),
  structureOverlay: document.querySelector("#structureOverlay"),
  generatedPreview: document.querySelector("#generatedPreview"),
  mappingList: document.querySelector("#mappingList"),
  currentSegment: document.querySelector("#currentSegment"),
  understandingBlock: document.querySelector("#understandingBlock"),
  understandBtn: document.querySelector("#understandBtn"),
  profileForm: document.querySelector("#profileForm"),
  profileTopic: document.querySelector("#profileTopic"),
  profileSellingPoints: document.querySelector("#profileSellingPoints"),
  profileAudience: document.querySelector("#profileAudience"),
  profilePlatform: document.querySelector("#profilePlatform"),
  profileDuration: document.querySelector("#profileDuration"),
  profileTone: document.querySelector("#profileTone"),
  logList: document.querySelector("#logList"),
  frameTrack: document.querySelector("#frameTrack"),
  segmentTrack: document.querySelector("#segmentTrack"),
  transferTrack: document.querySelector("#transferTrack"),
  captionTrack: document.querySelector("#captionTrack"),
  previewStage: document.querySelector("#previewStage"),
  sampleModeBtn: document.querySelector("#sampleModeBtn"),
  generatedModeBtn: document.querySelector("#generatedModeBtn"),
  compareModeBtn: document.querySelector("#compareModeBtn"),
  rerunStageBtn: document.querySelector("#rerunStageBtn"),
  snapshotBtn: document.querySelector("#snapshotBtn"),
};

function createId(prefix) {
  const randomPart =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${randomPart}`;
}

function formatTime(value) {
  if (!Number.isFinite(value)) return "00:00";
  const minutes = Math.floor(value / 60)
    .toString()
    .padStart(2, "0");
  const seconds = Math.floor(value % 60)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function sanitizeText(value, maxLength = 72) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

function beginStage(stageName, parentArtifactId = null) {
  const stageId = createId("stage");
  state.activeStageId = stageId;
  const artifactId = createId("artifact");
  writeLog("stage.start", "info", {
    runId: state.workspace.id,
    traceId: state.workspace.id,
    stageId,
    artifactId,
    parentArtifactId,
    stage: stageName,
  });
  return { stageName, stageId, artifactId, parentArtifactId };
}

function finishStage(stage, artifactId = stage.artifactId) {
  writeLog("stage.end", "done", {
    runId: state.workspace.id,
    traceId: state.workspace.id,
    stageId: stage.stageId,
    artifactId,
    parentArtifactId: stage.parentArtifactId,
    stage: stage.stageName,
  });
  state.activeStageId = stage.stageId;
}

function failStage(stage, error) {
  writeLog("stage.fail", "fail", {
    runId: state.workspace.id,
    traceId: state.workspace.id,
    stageId: stage.stageId,
    artifactId: stage.artifactId,
    parentArtifactId: stage.parentArtifactId,
    stage: stage.stageName,
    errorName: error?.name ?? "Error",
    errorMessage: sanitizeText(error?.message ?? "未知错误"),
  });
}

function writeLog(event, level, fields) {
  state.logs.unshift({
    id: createId("log"),
    event,
    level,
    time: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
    fields,
  });
  state.logs = state.logs.slice(0, 60);
  renderLogs();
  updateRunStatus(level, fields);
}

function captureDebugSnapshot(stageName, payload) {
  const stage = beginStage(STAGES.snapshot, state.generatedPlan?.artifactId ?? state.sampleVideo?.artifactId ?? null);
  const snapshot = {
    id: createId("snapshot"),
    runId: state.workspace.id,
    traceId: state.workspace.id,
    stageId: stage.stageId,
    stageName,
    artifactId: stage.artifactId,
    parentArtifactId: stage.parentArtifactId,
    createdAt: new Date().toISOString(),
    payload,
  };
  state.debugSnapshots.unshift(snapshot);
  finishStage(stage, snapshot.artifactId);
  renderAll();
  return snapshot;
}

function updateRunStatus(level, fields) {
  const labelMap = {
    info: "运行中",
    done: "阶段完成",
    fail: "阶段失败",
  };
  els.runStatus.textContent = labelMap[level] ?? "等待输入";
  els.traceLabel.textContent = `trace ${fields.traceId.slice(-8)} / stage ${fields.stageId.slice(-6)}`;
}

function addVersion(label, stageName, artifactId, parentArtifactId) {
  const version = {
    id: createId("version"),
    label,
    stageName,
    artifactId,
    parentArtifactId,
    createdAt: new Date().toLocaleString("zh-CN", { hour12: false }),
  };
  state.versions.unshift(version);
  state.workspace.currentVersionId = version.id;
  els.saveStatus.textContent = `已保存 ${label}`;
  renderVersions();
  return version;
}

function buildDerivative(name, type, artifactId, parentArtifactId, summary) {
  return {
    id: createId("derivative"),
    name,
    type,
    artifactId,
    parentArtifactId,
    summary,
  };
}

async function handleSampleUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const stage = beginStage(STAGES.ingest);
  try {
    const videoUrl = URL.createObjectURL(file);
    els.sampleVideo.src = videoUrl;
    await waitForVideoMetadata(els.sampleVideo);
    const duration = els.sampleVideo.duration;
    const sampleArtifactId = stage.artifactId;

    state.sampleVideo = {
      id: createId("sample"),
      artifactId: sampleArtifactId,
      parentArtifactId: null,
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type || "video",
      duration,
      objectUrl: videoUrl,
      processingStatus: "processed",
      frameArtifacts: [],
    };

    state.mediaDerivatives = [
      buildDerivative("原始视频引用", "source", sampleArtifactId, null, `${formatFileSize(file.size)} / ${formatTime(duration)}`),
      buildDerivative("标准化视频引用", "normalized-video", createId("artifact"), sampleArtifactId, "本地预览格式"),
      buildDerivative("音频轨", "audio-track", createId("artifact"), sampleArtifactId, "等待 ASR"),
      buildDerivative("视频基础元信息", "metadata", createId("artifact"), sampleArtifactId, `${Math.round(duration)} 秒`),
    ];

    const frames = await extractFrames(els.sampleVideo, duration, sampleArtifactId);
    state.sampleVideo.frameArtifacts = frames;
    if (frames[0]) {
      state.selectedFrameId = frames[0].id;
      state.mediaDerivatives.splice(
        1,
        0,
        buildDerivative("封面帧", "cover-frame", frames[0].artifactId, sampleArtifactId, formatTime(frames[0].time)),
        buildDerivative("抽帧结果", "frame-set", createId("artifact"), sampleArtifactId, `${frames.length} 帧`),
      );
    }

    state.structureCards = [];
    state.generatedPlan = null;
    state.mappings = [];
    els.sampleFileLabel.textContent = file.name;
    addVersion("样例处理完成", stage.stageName, sampleArtifactId, null);
    captureDebugSnapshot(stage.stageName, {
      sampleArtifactId,
      derivativeCount: state.mediaDerivatives.length,
      frameCount: frames.length,
      durationSeconds: Math.round(duration),
      fileSummary: { type: state.sampleVideo.mimeType, size: state.sampleVideo.fileSize },
    });
    finishStage(stage, sampleArtifactId);
  } catch (error) {
    failStage(stage, error);
  }
  renderAll();
}

function waitForVideoMetadata(video) {
  return new Promise((resolve, reject) => {
    if (Number.isFinite(video.duration) && video.duration > 0) {
      resolve();
      return;
    }
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error("视频元信息读取失败"));
  });
}

async function extractFrames(video, duration, parentArtifactId) {
  const canvas = document.createElement("canvas");
  const ratio = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 16 / 9;
  canvas.width = 192;
  canvas.height = Math.round(canvas.width / ratio);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const count = Math.min(12, Math.max(4, Math.ceil(duration / 4)));
  const times = Array.from({ length: count }, (_, index) => {
    if (count === 1) return 0;
    return (duration * index) / (count - 1);
  });
  const frames = [];

  for (const time of times) {
    await seekVideo(video, Math.min(Math.max(time, 0), Math.max(duration - 0.1, 0)));
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    frames.push({
      id: createId("frame"),
      artifactId: createId("artifact"),
      parentArtifactId,
      time,
      thumbnail: canvas.toDataURL("image/jpeg", 0.74),
    });
  }
  await seekVideo(video, 0);
  return frames;
}

function seekVideo(video, time) {
  return new Promise((resolve, reject) => {
    const done = () => {
      video.removeEventListener("seeked", done);
      resolve();
    };
    video.addEventListener("seeked", done, { once: true });
    video.onerror = () => reject(new Error("视频定位失败"));
    video.currentTime = time;
  });
}

function formatFileSize(value) {
  if (!Number.isFinite(value)) return "未知大小";
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function createStructureCards() {
  const sample = state.sampleVideo;
  if (!sample) return [];
  const duration = Math.max(sample.duration, 12);
  const segments = [
    ["开头 hook", 0, Math.min(duration * 0.18, 4), "用冲突或强结果建立停留理由"],
    ["卖点推进", duration * 0.18, duration * 0.48, "用连续证据解释价值"],
    ["场景证明", duration * 0.48, duration * 0.76, "把卖点放进真实使用场景"],
    ["结尾转化", duration * 0.76, duration, "给出行动理由和记忆点"],
  ];
  return segments.map(([name, start, end, explanation], index) => ({
    id: createId("structure"),
    artifactId: createId("artifact"),
    parentArtifactId: sample.artifactId,
    name,
    start,
    end,
    order: index + 1,
    explanation,
    transferableRule: `${name} 保留节奏功能，替换为新主题证据`,
  }));
}

function handleUnderstand() {
  if (!state.sampleVideo) return;
  const stage = beginStage(STAGES.understand, state.sampleVideo.artifactId);
  try {
    state.structureCards = createStructureCards();
    const structureArtifactId = createId("artifact");
    addVersion("结构理解完成", stage.stageName, structureArtifactId, state.sampleVideo.artifactId);
    captureDebugSnapshot(stage.stageName, {
      parentArtifactId: state.sampleVideo.artifactId,
      structureCount: state.structureCards.length,
      structureNames: state.structureCards.map((item) => item.name),
    });
    finishStage(stage, structureArtifactId);
  } catch (error) {
    failStage(stage, error);
  }
  renderAll();
}

function buildContentProfile() {
  return {
    topic: sanitizeText(els.profileTopic.value, 60) || "新主题",
    sellingPoints: sanitizeText(els.profileSellingPoints.value, 120) || "核心卖点待补充",
    audience: sanitizeText(els.profileAudience.value, 60) || "目标人群待补充",
    platform: sanitizeText(els.profilePlatform.value, 60) || "短视频平台",
    duration: sanitizeText(els.profileDuration.value, 32) || "与样例接近",
    tone: sanitizeText(els.profileTone.value, 60) || "清晰、有节奏",
  };
}

function handleGeneratePlan(event) {
  event.preventDefault();
  if (!state.sampleVideo || state.structureCards.length === 0) return;
  const parentArtifactId = state.structureCards[state.structureCards.length - 1].artifactId;
  const stage = beginStage(STAGES.transfer, parentArtifactId);

  try {
    const profile = buildContentProfile();
    const generatedArtifactId = createId("artifact");
    state.contentProfile = profile;
    state.generatedPlan = {
      id: createId("generated"),
      artifactId: generatedArtifactId,
      parentArtifactId,
      title: `${profile.topic} 结构迁移方案`,
      coverTitle: `${profile.topic}：先给结果，再给理由`,
      shots: state.structureCards.map((card) => ({
        id: createId("shot"),
        sourceStructureId: card.id,
        start: card.start,
        end: card.end,
        beat: card.name,
        script: makeScriptLine(card, profile),
        subtitle: makeSubtitleLine(card, profile),
        camera: makeCameraLine(card),
      })),
    };
    state.mappings = state.generatedPlan.shots.map((shot) => {
      const source = state.structureCards.find((item) => item.id === shot.sourceStructureId);
      return {
        id: createId("mapping"),
        sourceName: source?.name ?? "样例结构",
        targetName: shot.beat,
        sourceArtifactId: source?.artifactId ?? parentArtifactId,
        targetArtifactId: generatedArtifactId,
        explanation: `${source?.name ?? "结构"} 的节奏功能迁移为 ${profile.topic} 的内容表达`,
      };
    });
    addVersion("迁移方案生成", stage.stageName, generatedArtifactId, parentArtifactId);
    captureDebugSnapshot(stage.stageName, {
      parentArtifactId,
      generatedArtifactId,
      promptTemplateVersion: "workbench.transfer.v1",
      inputSummary: {
        topic: profile.topic,
        sellingPoints: profile.sellingPoints,
        structureCount: state.structureCards.length,
      },
      outputSummary: {
        shotCount: state.generatedPlan.shots.length,
        mappingCount: state.mappings.length,
      },
      parseResult: "structured-plan",
      retryCount: 0,
    });
    finishStage(stage, generatedArtifactId);
    setPreviewMode("generated");
  } catch (error) {
    failStage(stage, error);
  }
  renderAll();
}

function makeScriptLine(card, profile) {
  const lines = {
    "开头 hook": `先抛出 ${profile.topic} 的高价值结果，让 ${profile.audience} 在第一秒知道为什么要看。`,
    "卖点推进": `围绕 ${profile.sellingPoints} 做连续解释，每个信息点都对应一个可见画面。`,
    "场景证明": `把 ${profile.topic} 放到 ${profile.platform} 的真实使用场景里，降低理解成本。`,
    "结尾转化": `用 ${profile.tone} 的语气收束，给出下一步行动和封面记忆点。`,
  };
  return lines[card.name] ?? `${card.name} 迁移到 ${profile.topic}`;
}

function makeSubtitleLine(card, profile) {
  if (card.name === "开头 hook") return `别先讲原理，先看 ${profile.topic} 的结果`;
  if (card.name === "结尾转化") return `${profile.topic} 的关键，是把价值讲得更快`;
  return `${profile.sellingPoints}`;
}

function makeCameraLine(card) {
  const lines = {
    "开头 hook": "快切结果画面，字幕前置。",
    "卖点推进": "中近景交替，保留节奏停顿。",
    "场景证明": "场景全景切到细节特写。",
    "结尾转化": "回到核心画面，封面标题同步出现。",
  };
  return lines[card.name] ?? "跟随结构节奏切换画面。";
}

function handleRerunStage() {
  const parentArtifactId = state.generatedPlan?.artifactId ?? state.structureCards.at(-1)?.artifactId ?? state.sampleVideo?.artifactId;
  if (!parentArtifactId) return;
  const stage = beginStage(STAGES.rerun, parentArtifactId);
  const artifactId = createId("artifact");
  addVersion("返工分支", stage.stageName, artifactId, parentArtifactId);
  captureDebugSnapshot(stage.stageName, {
    parentArtifactId,
    newArtifactId: artifactId,
    rerunPolicy: "preserve-history",
    currentVersionId: state.workspace.currentVersionId,
  });
  finishStage(stage, artifactId);
  renderAll();
}

function setPreviewMode(mode) {
  state.activePreviewMode = mode;
  const buttonByMode = {
    sample: els.sampleModeBtn,
    generated: els.generatedModeBtn,
    compare: els.compareModeBtn,
  };
  Object.entries(buttonByMode).forEach(([buttonMode, button]) => {
    button.classList.toggle("active", buttonMode === mode);
  });
  renderPreview();
}

function selectFrame(frameId) {
  const frame = state.sampleVideo?.frameArtifacts.find((item) => item.id === frameId);
  if (!frame) return;
  state.selectedFrameId = frame.id;
  els.sampleVideo.currentTime = frame.time;
  renderAll();
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
  els.derivativeList.innerHTML = state.mediaDerivatives
    .map(
      (item) => `
        <div class="list-item">
          <strong>${item.name}</strong>
          <span>${item.type} / ${item.summary}</span>
        </div>
      `,
    )
    .join("");

  els.structureList.innerHTML = state.structureCards.length
    ? state.structureCards
        .map(
          (item) => `
          <button class="list-item" type="button" data-segment-id="${item.id}">
            <strong>${item.order}. ${item.name}</strong>
            <span>${formatTime(item.start)} - ${formatTime(item.end)} / ${item.explanation}</span>
          </button>
        `,
        )
        .join("")
    : `<div class="empty-state"><strong>暂无结构卡</strong><span>完成视频理解后生成</span></div>`;

  els.structureList.querySelectorAll("[data-segment-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const card = state.structureCards.find((item) => item.id === button.dataset.segmentId);
      if (card) {
        els.sampleVideo.currentTime = card.start;
        renderProperties(card);
      }
    });
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
    : "未加载样例";

  if (!state.generatedPlan) {
    els.generatedPreview.innerHTML = `<div class="empty-state"><strong>暂无新方案</strong><span>生成迁移方案后展示</span></div>`;
  } else {
    els.generatedPreview.innerHTML = `
      <h2>${state.generatedPlan.title}</h2>
      <p><strong>封面标题：</strong>${state.generatedPlan.coverTitle}</p>
      ${state.generatedPlan.shots
        .map(
          (shot) => `
          <div class="script-shot">
            <time>${formatTime(shot.start)} - ${formatTime(shot.end)}</time>
            <div>
              <strong>${shot.beat}</strong>
              <div>${shot.script}</div>
              <div>字幕：${shot.subtitle}</div>
              <div>镜头：${shot.camera}</div>
            </div>
          </div>
        `,
        )
        .join("")}
    `;
  }

  els.mappingList.innerHTML = state.mappings.length
    ? state.mappings
        .map(
          (item) => `
          <div class="mapping-item">
            <strong>${item.sourceName} -> ${item.targetName}</strong>
            <span>${item.explanation}</span>
          </div>
        `,
        )
        .join("")
    : `<div class="empty-state"><strong>暂无映射</strong><span>迁移方案生成后展示</span></div>`;
}

function renderTimeline() {
  const frames = state.sampleVideo?.frameArtifacts ?? [];
  els.frameTrack.innerHTML = frames
    .map(
      (frame) => `
      <button class="frame-cell ${frame.id === state.selectedFrameId ? "active" : ""}" type="button" data-frame-id="${frame.id}">
        <img alt="" src="${frame.thumbnail}" />
        <span>${formatTime(frame.time)}</span>
      </button>
    `,
    )
    .join("");
  els.frameTrack.querySelectorAll("[data-frame-id]").forEach((button) => {
    button.addEventListener("click", () => selectFrame(button.dataset.frameId));
  });

  els.segmentTrack.innerHTML = state.structureCards
    .map((item) => `<div class="segment-block" style="min-width:${Math.max(120, (item.end - item.start) * 18)}px">${item.name}</div>`)
    .join("");

  els.transferTrack.innerHTML = state.mappings
    .map((item) => `<div class="transfer-block">${item.sourceName} -> ${item.targetName}</div>`)
    .join("");
}

function renderProperties(selectedCard = null) {
  const card =
    selectedCard ??
    state.structureCards.find((item) => {
      const currentTime = els.sampleVideo.currentTime || 0;
      return currentTime >= item.start && currentTime <= item.end;
    });

  if (card) {
    els.currentSegment.innerHTML = `
      <div class="detail-row"><b>片段</b><span>${card.name}</span></div>
      <div class="detail-row"><b>时间</b><span>${formatTime(card.start)} - ${formatTime(card.end)}</span></div>
      <div class="detail-row"><b>解释</b><span>${card.explanation}</span></div>
      <div class="detail-row"><b>规则</b><span>${card.transferableRule}</span></div>
    `;
  } else if (state.sampleVideo) {
    els.currentSegment.innerHTML = `
      <div class="detail-row"><b>样例</b><span>${state.sampleVideo.fileName}</span></div>
      <div class="detail-row"><b>时长</b><span>${formatTime(state.sampleVideo.duration)}</span></div>
      <div class="detail-row"><b>状态</b><span>${state.sampleVideo.processingStatus}</span></div>
    `;
  } else {
    els.currentSegment.innerHTML = "暂无片段";
  }

  els.understandingBlock.innerHTML = state.structureCards.length
    ? state.structureCards
        .map((item) => `<div class="detail-row"><b>${item.name}</b><span>${item.explanation}</span></div>`)
        .join("")
    : "等待视频理解";
}

function renderVersions() {
  els.versionList.innerHTML = state.versions.length
    ? state.versions
        .map(
          (item) => `
          <div class="version-item">
            <strong>${item.label}</strong>
            <span>${item.stageName} / ${item.createdAt}</span>
            <span>artifact ${item.artifactId.slice(-8)} / parent ${item.parentArtifactId ? item.parentArtifactId.slice(-8) : "none"}</span>
          </div>
        `,
        )
        .join("")
    : `<div class="empty-state"><strong>暂无版本</strong><span>处理完成后生成</span></div>`;
}

function renderLogs() {
  els.logList.innerHTML = state.logs
    .slice(0, 14)
    .map(
      (item) => `
      <div class="log-item ${item.level}">
        ${item.time} / ${item.event}<br />
        run ${item.fields.runId.slice(-8)} / stage ${item.fields.stageId.slice(-6)} / artifact ${item.fields.artifactId.slice(-8)}
      </div>
    `,
    )
    .join("");
}

document.querySelectorAll(".tab-button").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".tab-button").forEach((item) => item.classList.remove("active"));
    document.querySelectorAll(".resource-view").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    document.querySelector(`[data-view="${button.dataset.tab}"]`)?.classList.add("active");
  });
});

els.sampleVideoInput.addEventListener("change", handleSampleUpload);
els.understandBtn.addEventListener("click", handleUnderstand);
els.profileForm.addEventListener("submit", handleGeneratePlan);
els.rerunStageBtn.addEventListener("click", handleRerunStage);
els.snapshotBtn.addEventListener("click", () => {
  captureDebugSnapshot("manual", {
    currentVersionId: state.workspace.currentVersionId,
    sampleArtifactId: state.sampleVideo?.artifactId ?? null,
    generatedArtifactId: state.generatedPlan?.artifactId ?? null,
    logCount: state.logs.length,
  });
});
els.sampleVideo.addEventListener("timeupdate", () => renderProperties());
els.sampleModeBtn.addEventListener("click", () => setPreviewMode("sample"));
els.generatedModeBtn.addEventListener("click", () => setPreviewMode("generated"));
els.compareModeBtn.addEventListener("click", () => setPreviewMode("compare"));

renderAll();
