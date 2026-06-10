const fs = require("fs/promises");
const path = require("path");

function createArtifact(overrides = {}) {
  const sampleVideoId = overrides.sampleVideoId ?? "sample_1";
  const subtitleStatus = overrides.subtitleStatus ?? null;
  return {
    sampleVideoId,
    workspaceId: "workspace_1",
    status: "processed",
    trace: { runId: "run_1", traceId: "trace_1", stageId: "stage_1" },
    processingOptions: { frameSampleRateFps: 1 },
    sampleVideo: {
      artifactId: "artifact_sample",
      parentArtifactId: null,
      original: { artifactId: "artifact_sample", parentArtifactId: null, type: "original-video", uri: "/runtime/source.mp4", summary: "sample.mp4" },
      normalized: { artifactId: "artifact_norm", parentArtifactId: "artifact_sample", type: "normalized-video", uri: "/runtime/source.mp4", summary: "本地标准化引用" },
    },
    cover: { artifactId: "artifact_cover", parentArtifactId: "artifact_sample", type: "cover-frame", uri: "/runtime/cover.jpg", summary: "封面帧" },
    frames: [{ frameId: "frame_1", artifactId: "artifact_frame", parentArtifactId: "artifact_sample", timestamp: 0, imageUri: "/runtime/frame.jpg" }],
    audio: { artifactId: "artifact_audio", parentArtifactId: "artifact_sample", type: "audio-track", uri: "/runtime/audio.m4a", summary: "音频轨" },
    subtitles: subtitleStatus ? {
      artifactId: `artifact_subtitle_${sampleVideoId}`,
      parentArtifactId: "artifact_audio",
      type: "subtitle-track",
      uri: null,
      provider: "doubao-sauc",
      providerMeta: { resourceId: "volc.bigasr.sauc.duration", connectId: "connect_1", requestId: "request_1", logId: "log_1" },
      utterances: subtitleStatus === "processed" ? [{ start: 0, end: 1, text: "你好", definite: true, words: [{ start: 0, end: 0.4, text: "你" }, { start: 0.4, end: 1, text: "好" }] }] : [],
      words: subtitleStatus === "processed" ? [{ start: 0, end: 0.4, text: "你" }, { start: 0.4, end: 1, text: "好" }] : [],
      summary: subtitleStatus === "processed" ? "1 条字幕" : "字幕识别未产出",
      segments: subtitleStatus === "processed" ? [{ id: "subtitle_1", start: 0, end: 1, text: "你好", confidence: null }] : [],
      status: subtitleStatus,
      reason: subtitleStatus === "degraded" ? "豆包字幕识别响应超时" : null,
      debugSnapshotUri: subtitleStatus === "degraded" ? "/runtime/snapshot.json" : null,
    } : null,
    metadata: { durationSeconds: 3, width: 720, height: 1280 },
  };
}

function createProcessedShotAnalysis({ analysisFps, skillHash, contactSheets, agent = {} }) {
  const targetFrameCount = Math.ceil(3 * analysisFps);
  const selectedFrameCount = Math.min(targetFrameCount, 6);
  return {
    artifactId: "artifact_shot_processed",
    parentArtifactId: "artifact_sample",
    type: "shot-boundary-analysis",
    status: "processed",
    resultOrigin: "new_turn",
    sourceFrameArtifactIds: ["artifact_frame"],
    extractSampling: {
      requestedFps: 3,
      targetFrameCount: 6,
      actualFrameCount: 6,
      maxFrames: 6000,
      samplingPolicy: "fixed_interval_from_zero",
      cappedByMaxFrames: false,
    },
    analysisSampling: {
      fps: analysisFps,
      requestedFps: analysisFps,
      targetFrameCount,
      selectedFrameCount,
      effectiveFps: selectedFrameCount / 3,
      selectionPolicy: "target_grid_nearest_unique",
      duplicatePolicy: "nearest_unselected_tie_later",
      roundingPolicy: "target_grid_nearest_unique",
    },
    subtitleContextSummary: null,
    commerceBrief: {
      sellingObject: "产品样例",
      proofApproach: "画面展示",
      promisedOutcome: "快速理解卖点",
      persuasionTarget: "目标用户",
      conversionAction: "立即查看",
      uncertainties: [],
    },
    contactSheets,
    boundaries: [{ timestamp: 1, confidence: 0.8, boundaryType: "hard_cut", reason: "cut", needReview: false }],
    validation: { status: "passed", rawBoundaryCount: 1, normalizedBoundaryCount: 1, repairAttemptCount: 0, validatorCode: null },
    agent: {
      provider: "codex-appserver",
      role: "shot-boundary-raw-analyze-legacy",
      profilePath: "Assets/RoleProfiles/shot-boundary-raw-analyze-legacy/role.json",
      profileVersion: agent.profileVersion ?? null,
      promptTemplateId: agent.promptTemplateId ?? null,
      promptTemplateVersion: agent.promptTemplateVersion ?? null,
      promptTemplateHash: agent.promptTemplateHash ?? null,
      initFingerprint: agent.initFingerprint ?? null,
      skillPath: "SKILL.md",
      skillHash,
      threadId: "thread_1",
      leaseId: "lease_1",
      turnId: "turn_1",
    },
    shots: [
      { id: "shot_1", index: 0, shotNo: "S001", start: 0, end: 1, representativeFrameId: "frame_1", confidence: 0.8, reason: "cut", summary: "人物正脸中景", endBoundaryReason: "cut" },
      { id: "shot_2", index: 1, shotNo: "S002", start: 1, end: 3, representativeFrameId: "frame_2", confidence: 0.8, reason: "视觉连续", summary: "产品细节特写", endBoundaryReason: null },
    ],
    createdAt: new Date().toISOString(),
  };
}

function createContactSheet(sheetId, gridItems) {
  return {
    artifactId: `artifact_${sheetId}`,
    parentArtifactId: "artifact_sample",
    type: "contact_sheet",
    artifactType: "contact_sheet",
    status: "processed",
    sheetId,
    sheetIndex: 0,
    frameCount: gridItems.length,
    overlapFrameIds: [],
    gridItems: gridItems.map((item, index) => ({
      artifactId: `artifact_frame_${index}`,
      parentArtifactId: "artifact_sample",
      gridIndex: index,
      row: 0,
      col: index,
      ...item,
    })),
    layout: { rows: 1, cols: Math.max(1, gridItems.length), width: 600, height: 320, cellWidth: 300, cellHeight: 160, visibleFrameWidth: 300, visibleFrameHeight: 160, labelHeight: 24 },
    constraints: { maxDimension: 4096, minFrameShortSide: 144, minFrameLongSide: 256, labelHeight: 24, overlapFrameCount: 0 },
  };
}

async function waitForJob(jobStore, jobId, status) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const job = jobStore.getJob(jobId);
    if (job?.status === status) return job;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`job ${jobId} did not reach ${status}`);
}

function createCountingProcessor(store) {
  const counts = { cover: 0, frames: 0, audio: 0 };
  return {
    counts,
    async probeMetadata() {
      return { durationSeconds: 2, width: 720, height: 1280, hasAudio: true };
    },
    async extractCover({ coverPath, parentArtifactId }) {
      counts.cover += 1;
      return { artifactId: "artifact_cover", parentArtifactId, type: "cover-frame", uri: store.runtimeUri(coverPath), summary: "封面帧" };
    },
    async extractFrames({ framesDir, parentArtifactId }) {
      counts.frames += 1;
      return [{ frameId: "frame_1", artifactId: "artifact_frame", parentArtifactId, timestamp: 0, imageUri: store.runtimeUri(path.join(framesDir, "frame-00001.jpg")) }];
    },
    async extractAudio({ audioPath, parentArtifactId }) {
      counts.audio += 1;
      await fs.writeFile(audioPath, Buffer.from("audio"));
      return { artifactId: "artifact_audio", parentArtifactId, type: "audio-track", uri: store.runtimeUri(audioPath), summary: "音频轨" };
    },
  };
}

module.exports = { createArtifact, createProcessedShotAnalysis, createContactSheet, waitForJob, createCountingProcessor };
