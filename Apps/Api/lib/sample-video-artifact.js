const { randomUUID } = require("crypto");
const { createArtifactRef, SAMPLE_STATUS } = require("../../../Core/Workspace/sample-video-contracts");

function buildArtifact({ context, inputPath, media, store }) {
  return {
    sampleVideoId: context.sampleVideoId,
    workspaceId: context.workspaceId,
    status: SAMPLE_STATUS.processed,
    trace: context.traceContext,
    processingOptions: {
      frameSampleRateFps: context.processingOptions.frameSampleRateFps,
      enableAudioSeparation: context.processingOptions.enableAudioSeparation,
      enableSubtitleRecognition: context.processingOptions.enableSubtitleRecognition,
    },
    sampleVideo: {
      artifactId: context.sampleArtifactId,
      parentArtifactId: null,
      original: createArtifactRef({
        artifactId: context.sampleArtifactId,
        parentArtifactId: null,
        type: "original-video",
        uri: store.runtimeUri(inputPath),
        summary: context.file.filename,
      }),
      normalized: createArtifactRef({
        artifactId: `artifact_${randomUUID()}`,
        parentArtifactId: context.sampleArtifactId,
        type: "normalized-video",
        uri: store.runtimeUri(inputPath),
        summary: "本地标准化引用",
      }),
    },
    cover: media.cover,
    frames: media.frames,
    frameOutputSummary: media.frameOutputSummary,
    audio: media.audio,
    audioSeparation: media.audioSeparation ?? null,
    subtitles: media.subtitles ?? null,
    metadata: media.metadata,
  };
}

module.exports = { buildArtifact };
