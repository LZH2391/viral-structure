(function () {
  const { STAGES, state, createId, sanitizeText } = window.WorkbenchState;
  const { uploadAndPollSampleVideo } = window.WorkbenchSampleIngest;
  const { createStructureCards } = window.WorkbenchStructureStrategy;
  const { createGeneratedPlan } = window.WorkbenchTransferStrategy;

  function createWorkflow(els, renderer, observability, versioning) {
    const actions = {
      async handleSampleUpload(event) {
        const file = event.target.files?.[0];
        if (!file) return;
        const stage = observability.beginStage(STAGES.ingest);
        try {
          els.sampleFileLabel.textContent = file.name;
          const frameSampleRateFps = Number(els.frameSampleRateInput.value || 1);
          const ingestResult = await uploadAndPollSampleVideo(file, { frameSampleRateFps }, () => renderer.renderAll());
          if (ingestResult.job.status === "failed") throw buildIngestError(ingestResult.job);
          versioning.addVersion("样例处理完成", stage.stageName, state.sampleVideo.artifactId, null);
          observability.finishStage(stage, state.sampleVideo.artifactId);
        } catch (error) {
          observability.failStage(stage, error, error.observabilityDetails);
        }
        renderer.renderAll();
      },
      handleUnderstand() {
        if (!state.sampleVideo) return;
        const stage = observability.beginStage(STAGES.understand, state.sampleVideo.artifactId);
        try {
          state.structureCards = createStructureCards(state.sampleVideo);
          const structureArtifactId = createId("artifact");
          versioning.addVersion("结构理解完成", stage.stageName, structureArtifactId, state.sampleVideo.artifactId);
          observability.finishStage(stage, structureArtifactId);
        } catch (error) {
          observability.failStage(stage, error);
        }
        renderer.renderAll();
      },
      handleGeneratePlan(event) {
        event.preventDefault();
        if (!state.sampleVideo || state.structureCards.length === 0) return;
        const parentArtifactId = state.structureCards[state.structureCards.length - 1].artifactId;
        const stage = observability.beginStage(STAGES.transfer, parentArtifactId);
        try {
          const profile = buildContentProfile(els);
          const result = createGeneratedPlan(profile, state.structureCards, parentArtifactId);
          state.contentProfile = profile;
          state.generatedPlan = result.generatedPlan;
          state.mappings = result.mappings;
          versioning.addVersion("迁移方案生成", stage.stageName, result.generatedArtifactId, parentArtifactId);
          observability.finishStage(stage, result.generatedArtifactId);
          actions.setPreviewMode("generated");
        } catch (error) {
          observability.failStage(stage, error);
        }
        renderer.renderAll();
      },
      handleRerunStage() {
        const parentArtifactId = state.generatedPlan?.artifactId ?? state.structureCards.at(-1)?.artifactId ?? state.sampleVideo?.artifactId;
        if (!parentArtifactId) return;
        const stage = observability.beginStage(STAGES.rerun, parentArtifactId);
        const artifactId = createId("artifact");
        versioning.addVersion("返工分支", stage.stageName, artifactId, parentArtifactId);
        observability.finishStage(stage, artifactId);
        renderer.renderAll();
      },
      setPreviewMode(mode) {
        state.activePreviewMode = mode;
        const buttonByMode = {
          sample: els.sampleModeBtn,
          generated: els.generatedModeBtn,
          compare: els.compareModeBtn,
        };
        Object.entries(buttonByMode).forEach(([buttonMode, button]) => {
          button.classList.toggle("active", buttonMode === mode);
        });
        renderer.renderPreview();
      },
      selectFrame(frameId) {
        const frame = state.sampleVideo?.frameArtifacts.find((item) => item.id === frameId);
        if (!frame) return;
        state.selectedFrameId = frame.id;
        state.activeMediaKind = "frame";
        state.selectedDerivativeId = frame.artifactId;
        renderer.renderAll();
      },
      selectDerivative(artifactId) {
        const item = state.mediaDerivatives.find((entry) => entry.artifactId === artifactId);
        if (!item) return;
        state.selectedDerivativeId = item.artifactId;
        state.activeMediaKind = mediaKindForType(item.type);
        renderer.renderAll();
      },
      selectAudioTrack() {
        state.activeMediaKind = "audio";
        state.selectedDerivativeId = state.sampleArtifact?.audio?.artifactId ?? null;
        renderer.renderAll();
      },
      selectSegment(segmentId) {
        const card = state.structureCards.find((item) => item.id === segmentId);
        if (!card) return;
        els.sampleVideo.currentTime = card.start;
        renderer.renderProperties(card);
      },
      captureManualSnapshot() {
        observability.captureDebugSnapshot("manual", {
          currentVersionId: state.workspace.currentVersionId,
          sampleArtifactId: state.sampleVideo?.artifactId ?? null,
          generatedArtifactId: state.generatedPlan?.artifactId ?? null,
          logCount: state.logs.length,
        });
      },
    };
    return actions;
  }

  function buildContentProfile(els) {
    return {
      topic: sanitizeText(els.profileTopic.value, 60) || "新主题",
      sellingPoints: sanitizeText(els.profileSellingPoints.value, 120) || "核心卖点待补充",
      audience: sanitizeText(els.profileAudience.value, 60) || "目标人群待补充",
      platform: sanitizeText(els.profilePlatform.value, 60) || "短视频平台",
      duration: sanitizeText(els.profileDuration.value, 32) || "与样例接近",
      tone: sanitizeText(els.profileTone.value, 60) || "清晰、有节奏",
    };
  }

  function mediaKindForType(type) {
    if (type === "cover-frame") return "cover";
    if (type === "audio-track") return "audio";
    return "video";
  }

  function buildIngestError(job) {
    const summary = job.errorSummary ?? {};
    const error = new Error(summary.message || "样例处理失败");
    error.code = summary.code || "sample_ingest_failed";
    error.observabilityDetails = {
      errorCode: error.code,
      errorStage: job.stage,
      errorMessage: summary.message,
      debugSnapshotUri: summary.debugSnapshotUri ?? null,
      backendTraceId: job.traceId,
      processingJob: {
        jobId: job.jobId,
        sampleVideoId: job.sampleVideoId,
        stage: job.stage,
        status: job.status,
        progress: job.progress,
        traceId: job.traceId,
        errorSummary: summary,
      },
    };
    return error;
  }

  window.WorkbenchWorkflow = { createWorkflow };
})();
