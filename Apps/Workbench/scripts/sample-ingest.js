(function () {
  const { state, createId, formatTime, formatFileSize } = window.WorkbenchState;
  const { waitForVideoMetadata, extractFrames } = window.WorkbenchMedia;

  async function ingestSampleVideo(file, stage, els) {
    const videoUrl = URL.createObjectURL(file);
    els.sampleVideo.src = videoUrl;
    await waitForVideoMetadata(els.sampleVideo);
    const duration = els.sampleVideo.duration;
    const sampleArtifactId = stage.artifactId;
    state.sampleVideo = buildSampleVideo(file, videoUrl, duration, sampleArtifactId);
    state.mediaDerivatives = buildMediaDerivatives(file, duration, sampleArtifactId);

    const frames = await extractFrames(els.sampleVideo, duration, sampleArtifactId);
    state.sampleVideo.frameArtifacts = frames;
    addFrameDerivatives(frames, sampleArtifactId);
    state.structureCards = [];
    state.generatedPlan = null;
    state.mappings = [];
    els.sampleFileLabel.textContent = file.name;
    return { sampleArtifactId, frames, duration };
  }

  function buildSampleVideo(file, objectUrl, duration, artifactId) {
    return {
      id: createId("sample"),
      artifactId,
      parentArtifactId: null,
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type || "video",
      duration,
      objectUrl,
      processingStatus: "processed",
      frameArtifacts: [],
    };
  }

  function buildMediaDerivatives(file, duration, sampleArtifactId) {
    return [
      buildDerivative("原始视频引用", "source", sampleArtifactId, null, `${formatFileSize(file.size)} / ${formatTime(duration)}`),
      buildDerivative("标准化视频引用", "normalized-video", createId("artifact"), sampleArtifactId, "本地预览格式"),
      buildDerivative("音频轨", "audio-track", createId("artifact"), sampleArtifactId, "等待 ASR"),
      buildDerivative("视频基础元信息", "metadata", createId("artifact"), sampleArtifactId, `${Math.round(duration)} 秒`),
    ];
  }

  function buildDerivative(name, type, artifactId, parentArtifactId, summary) {
    return { id: createId("derivative"), name, type, artifactId, parentArtifactId, summary };
  }

  function addFrameDerivatives(frames, sampleArtifactId) {
    if (!frames[0]) return;
    state.selectedFrameId = frames[0].id;
    state.mediaDerivatives.splice(
      1,
      0,
      buildDerivative("封面帧", "cover-frame", frames[0].artifactId, sampleArtifactId, formatTime(frames[0].time)),
      buildDerivative("抽帧结果", "frame-set", createId("artifact"), sampleArtifactId, `${frames.length} 帧`),
    );
  }

  window.WorkbenchSampleIngest = { ingestSampleVideo };
})();
