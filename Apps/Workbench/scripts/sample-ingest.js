(function () {
  const { state } = window.WorkbenchState;
  const api = window.WorkbenchApiClient;

  async function uploadAndPollSampleVideo(file, onJobUpdate) {
    const upload = await api.uploadSampleVideo(file);
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
      const job = await api.getProcessingJob(upload.processingJobId);
      state.processingJob = job;
      onJobUpdate(job);
      if (job.status === "processed") {
        const artifact = await api.getSampleArtifact(upload.sampleVideoId);
        applySampleArtifact(artifact);
        return { job, artifact };
      }
      if (job.status === "failed") {
        state.errorSummary = job.errorSummary;
        return { job, artifact: null };
      }
    }
    throw new Error("处理超时，请稍后查询任务状态");
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
      processingStatus: artifact.status,
      videoUri: artifact.sampleVideo.normalized.uri,
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

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  window.WorkbenchSampleIngest = { uploadAndPollSampleVideo, applySampleArtifact };
})();
