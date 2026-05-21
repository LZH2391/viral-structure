const path = require("path");
const { randomUUID } = require("crypto");
const { runCommand } = require("./ffmpeg-runner");
const { planFrameTimestamps } = require("../../Core/Workspace/frame-timestamps");
const { createArtifactRef, createFrameArtifact, PROCESSING_ERRORS } = require("../../Core/Workspace/sample-video-contracts");

async function probeMetadata(inputPath) {
  try {
    const { stdout } = await runCommand("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", inputPath]);
    const data = JSON.parse(stdout);
    return normalizeMetadata(data);
  } catch (error) {
    throw structuredMediaError(PROCESSING_ERRORS.metadataProbeFailed, "视频元信息读取失败", error, "metadata.probe");
  }
}

async function processMedia({ inputPath, sampleVideoId, sampleArtifactId, sampleDir, store }) {
  const metadata = await probeMetadata(inputPath);
  const coverPath = path.join(sampleDir, "cover.jpg");
  const audioPath = path.join(sampleDir, "audio.m4a");
  const framesDir = path.join(sampleDir, "frames");
  const cover = await extractCover({ inputPath, coverPath, parentArtifactId: sampleArtifactId, store });
  const frames = await extractFrames({ inputPath, framesDir, durationSeconds: metadata.durationSeconds, parentArtifactId: sampleArtifactId, store });
  const audio = await extractAudio({ inputPath, audioPath, parentArtifactId: sampleArtifactId, store });
  return {
    metadata,
    cover,
    frames,
    audio,
    sampleVideoId,
  };
}

function normalizeMetadata(data) {
  const videoStream = (data.streams || []).find((stream) => stream.codec_type === "video") || {};
  const format = data.format || {};
  return {
    durationSeconds: Number(format.duration || videoStream.duration || 0),
    width: videoStream.width ?? null,
    height: videoStream.height ?? null,
    formatName: format.format_name ?? null,
    bitrate: Number(format.bit_rate || 0) || null,
    hasAudio: (data.streams || []).some((stream) => stream.codec_type === "audio"),
  };
}

async function extractCover({ inputPath, coverPath, artifactId = `artifact_${randomUUID()}`, parentArtifactId, store }) {
  try {
    await runCommand("ffmpeg", ["-y", "-ss", "0", "-i", inputPath, "-frames:v", "1", coverPath]);
    return createArtifactRef({
      artifactId,
      parentArtifactId,
      type: "cover-frame",
      uri: store.runtimeUri(coverPath),
      summary: "封面帧",
    });
  } catch (error) {
    throw structuredMediaError(PROCESSING_ERRORS.frameExtractFailed, "封面帧生成失败", error, "cover.extract");
  }
}

async function extractFrames({ inputPath, framesDir, durationSeconds, frameSampleRateFps = 0.25, maxFrames, parentArtifactId, store }) {
  const timestamps = planFrameTimestamps(durationSeconds, { frameSampleRateFps, maxFrames });
  const frames = [];
  for (let index = 0; index < timestamps.length; index += 1) {
    const timestamp = timestamps[index];
    const imagePath = path.join(framesDir, `frame-${String(index + 1).padStart(3, "0")}.jpg`);
    try {
      await runCommand("ffmpeg", ["-y", "-ss", String(timestamp), "-i", inputPath, "-frames:v", "1", imagePath]);
    } catch (error) {
      throw structuredMediaError(PROCESSING_ERRORS.frameExtractFailed, "抽帧失败", error, "frames.extract");
    }
    frames.push(createFrameArtifact({
      frameId: `frame_${randomUUID()}`,
      artifactId: `artifact_${randomUUID()}`,
      parentArtifactId,
      timestamp,
      imageUri: store.runtimeUri(imagePath),
    }));
  }
  return frames;
}

async function extractAudio({ inputPath, audioPath, parentArtifactId, store }) {
  try {
    await runCommand("ffmpeg", ["-y", "-i", inputPath, "-vn", "-acodec", "aac", audioPath]);
    return createArtifactRef({
      artifactId: `artifact_${randomUUID()}`,
      parentArtifactId,
      type: "audio-track",
      uri: store.runtimeUri(audioPath),
      summary: "音频轨",
    });
  } catch (error) {
    const ref = createArtifactRef({
      artifactId: `artifact_${randomUUID()}`,
      parentArtifactId,
      type: "audio-track",
      uri: null,
      summary: "未检测到可抽取音频轨",
    });
    ref.debugSummary = createMediaDebug(error, "audio.extract");
    return ref;
  }
}

function structuredMediaError(code, message, cause, mediaOperation) {
  const error = new Error(message);
  error.code = code;
  error.safeSummary = message;
  error.causeName = cause?.code || cause?.name;
  error.mediaDebug = createMediaDebug(cause, mediaOperation);
  return error;
}

function createMediaDebug(cause, mediaOperation) {
  return {
    commandSummary: cause?.commandSummary ?? null,
    stderrSummary: cause?.stderrSummary ?? null,
    exitCode: cause?.exitCode ?? null,
    retryable: false,
    mediaOperation,
  };
}

module.exports = {
  probeMetadata,
  processMedia,
  normalizeMetadata,
  extractCover,
  extractFrames,
  extractAudio,
  structuredMediaError,
  createMediaDebug,
};
