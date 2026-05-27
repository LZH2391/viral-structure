function createTransformMessage() {
  return JSON.stringify({
    shots: [
      {
        summary: "turn_transform 人物半身面对镜头",
        start: 0,
        end: 1.2,
        endBoundary: { timestamp: 1.2, confidence: 0.8, boundaryType: "hard_cut", needReview: false },
      },
      {
        summary: "turn_transform 产品包装特写",
        start: 1.2,
        end: 2,
        endBoundary: null,
      },
    ],
    commerceBrief: {
      sellingObject: "产品样例",
      proofApproach: "画面展示",
      promisedOutcome: "快速理解卖点",
      persuasionTarget: "潜在购买用户",
      conversionAction: "未观察到明显转化动作",
      uncertainties: [],
    },
  });
}

function createInvalidTransformMessage() {
  return JSON.stringify({
    shots: [
      {
        summary: "人物半身面对镜头",
        start: 0,
        end: 1.2,
        endBoundary: { timestamp: 1.2, confidence: 0.8, boundaryType: "hard_cut", needReview: false },
      },
      {
        summary: "产品包装特写",
        start: 1.4,
        end: 2,
        endBoundary: null,
      },
    ],
    commerceBrief: {
      sellingObject: "产品样例",
      proofApproach: "画面展示",
      promisedOutcome: "快速理解卖点",
      persuasionTarget: "潜在购买用户",
      conversionAction: "未观察到明显转化动作",
      uncertainties: [],
    },
  });
}

function createShotMessage(label = "turn_shot") {
  return `补充说明\n${JSON.stringify({
    shots: [
      {
        summary: `${label} 人物半身口播`,
        start: 0,
        end: 1.2,
        endBoundary: { timestamp: 1.2, confidence: 0.8, boundaryType: "hard_cut", reason: "cut", needReview: false },
      },
      {
        summary: `${label} 产品特写镜头`,
        start: 1.2,
        end: 2,
        endBoundary: null,
      },
    ],
  })}\n已完成`;
}

function createCachedShotAnalysis() {
  return {
    artifactId: "artifact_cached_shot",
    parentArtifactId: "artifact_sample",
    type: "shot-boundary-analysis",
    status: "processed",
    sourceFrameArtifactIds: [],
    extractSampling: {
      requestedFps: 3,
      targetFrameCount: 6,
      actualFrameCount: 6,
      maxFrames: 120,
      samplingPolicy: "fixed_interval_from_zero",
      cappedByMaxFrames: false,
    },
    analysisSampling: {
      fps: 3,
      requestedFps: 3,
      targetFrameCount: 6,
      selectedFrameCount: 6,
      effectiveFps: 3,
      selectionPolicy: "target_grid_nearest_unique",
      duplicatePolicy: "nearest_unselected_tie_later",
      roundingPolicy: "target_grid_nearest_unique",
    },
    subtitleContextSummary: null,
    contactSheets: [],
    boundaries: [],
    validation: { status: "passed", rawBoundaryCount: 0, normalizedBoundaryCount: 0, repairAttemptCount: 0, validatorCode: null },
    agent: {
      provider: "codex-appserver",
      role: "shot-boundary-transformer",
      profilePath: "C:\\ByteDanceFullStack\\Assets\\RoleProfiles\\shot-boundary-transformer\\role.json",
      profileVersion: "2026-05-24.1",
      promptTemplateId: "transform",
      promptTemplateVersion: "transform.v1",
      promptTemplateHash: "cached_prompt_hash",
      initFingerprint: "cached_init_fingerprint",
      skillPath: "C:\\ByteDanceFullStack\\.agents\\skills\\shot-boundary-transformer\\SKILL.md",
      skillHash: "cached_hash",
      threadId: "review_thread_cached",
      leaseId: "review_lease_cached",
      turnId: "turn_transform_cached",
      sheetCount: 2,
      inputMode: "raw_video_path_text",
      rawAnalyzer: {
        phase: "raw_video_analyze",
        threadId: "thread_cached",
        leaseId: null,
        turnId: "turn_raw_cached",
        inputMode: "raw_video_path_text",
        rawResultPreview: "raw analyzer finished",
      },
    },
    shots: [{ id: "shot_1", index: 0, shotNo: "S001", start: 0, end: 2, representativeFrameId: "frame_0", confidence: 0.4, reason: "未检测到明确切镜边界", summary: "未检测到明确切镜边界", endBoundaryReason: null }],
    createdAt: new Date().toISOString(),
  };
}


module.exports = {
  createTransformMessage,
  createInvalidTransformMessage,
  createShotMessage,
  createCachedShotAnalysis,
};
