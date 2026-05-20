(function () {
  const { state } = window.WorkbenchState;
  const api = window.WorkbenchApiClient;
  let activeUploadToken = null;

  async function uploadAndPollSampleVideo(file, options, onJobUpdate) {
    const token = createUploadToken();
    state.isUploadingSample = true;
    state.uploadStatusText = "上传中";
    state.processingJob = null;
    state.errorSummary = null;
    onJobUpdate(null);
    const upload = await api.uploadSampleVideo(file, options);
    if (!isActiveToken(token)) return { canceled: true };
    state.processingJob = {
      jobId: upload.processingJobId,
      sampleVideoId: upload.sampleVideoId,
      status: "pending",
      progress: 0,
      traceId: upload.traceId,
    };
    onJobUpdate(state.processingJob);

    for (let attempt = 0; attempt < 120; attempt += 1) {
      await delay(1000);
      if (!isActiveToken(token)) return { canceled: true };
      const job = await api.getProcessingJob(upload.processingJobId);
      if (!isActiveToken(token)) return { canceled: true };
      state.processingJob = job;
      state.uploadStatusText = stageLabel(job);
      onJobUpdate(job);
      if (job.status === "processed") {
        const artifact = await api.getSampleArtifact(upload.sampleVideoId);
        if (!isActiveToken(token)) return { canceled: true };
        applySampleArtifact(artifact);
        state.isUploadingSample = false;
        state.uploadStatusText = "生成产物完成";
        return { job, artifact };
      }
      if (job.status === "failed") {
        state.errorSummary = job.errorSummary;
        state.isUploadingSample = false;
        state.uploadStatusText = "处理失败";
        return { job, artifact: null };
      }
    }
    state.isUploadingSample = false;
    state.uploadStatusText = "处理超时";
    throw new Error("处理超时，请稍后查询任务状态");
  }

  function createUploadToken() {
    activeUploadToken = {};
    return activeUploadToken;
  }

  function isActiveToken(token) {
    return token === activeUploadToken;
  }

  function applySampleArtifact(artifact) {
    state.sampleArtifact = artifact;
    state.errorSummary = null;
    state.sampleVideo = {
      id: artifact.sampleVideoId,
      artifactId: artifact.sampleVideo.artifactId,
      parentArtifactId: artifact.sampleVideo.parentArtifactId,
      fileName: artifact.sampleVideo.original.summary,
      duration: artifact.metadata.durationSeconds,
      width: artifact.metadata.width ?? null,
      height: artifact.metadata.height ?? null,
      aspectRatio: buildAspectRatio(artifact.metadata.width, artifact.metadata.height),
      processingStatus: artifact.status,
      videoUri: artifact.sampleVideo.normalized.uri,
      coverUri: artifact.cover?.uri ?? null,
      audioUri: artifact.audio?.uri ?? null,
      audioSummary: artifact.audio?.summary ?? null,
      processingOptions: artifact.processingOptions ?? null,
      frameOutputSummary: artifact.frameOutputSummary ?? null,
      frameArtifacts: artifact.frames.map((frame) => ({
        id: frame.frameId,
        artifactId: frame.artifactId,
        parentArtifactId: frame.parentArtifactId,
        time: frame.timestamp,
        imageUri: frame.imageUri,
      })),
    };
    state.mediaDerivatives = buildDerivatives(artifact);
    state.selectedFrameId = state.sampleVideo.frameArtifacts[0]?.id ?? null;
    state.selectedDerivativeId = artifact.sampleVideo.normalized.artifactId;
    state.activeMediaKind = "video";
    state.structureCards = [];
    state.generatedPlan = null;
    state.mappings = [];
  }

  function buildDerivatives(artifact) {
    return [
      artifact.sampleVideo.original,
      artifact.sampleVideo.normalized,
      artifact.cover,
      { artifactId: "frame-set", type: "frame-set", summary: `${artifact.frames.length} 帧`, parentArtifactId: artifact.sampleVideo.artifactId },
      artifact.audio,
    ].filter(Boolean).map((item) => ({
      id: item.artifactId,
      name: artifactName(item.type),
      type: item.type,
      uri: item.uri,
      artifactId: item.artifactId,
      parentArtifactId: item.parentArtifactId,
      summary: item.summary,
    }));
  }

  function artifactName(type) {
    const names = {
      "original-video": "原始视频引用",
      "normalized-video": "标准化视频引用",
      "cover-frame": "封面帧",
      "frame-set": "抽帧结果",
      "audio-track": "音频轨",
    };
    return names[type] ?? type;
  }

  function buildAspectRatio(width, height) {
    if (!Number.isFinite(width) || !Number.isFinite(height) || height <= 0) return null;
    return width / height;
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function stageLabel(job) {
    const labels = {
      uploaded: "上传中",
      "sample.upload.received": "上传中",
      "sample.upload.validated": "校验上传",
      "sample.source.saved": "保存素材",
      "sample.metadata.probed": "读取元信息",
      "sample.cover.extracted": "生成封面",
      "sample.frames.extracted": "抽帧中",
      "sample.audio.extracted": "提取音频",
      "sample.artifact.written": "生成产物",
      processed: "生成产物完成",
    };
    return labels[job?.stage] ?? job?.stage ?? "处理中";
  }

  window.WorkbenchSampleIngest = { uploadAndPollSampleVideo, applySampleArtifact, stageLabel };
})();
