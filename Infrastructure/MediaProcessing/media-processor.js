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
    throw structuredMediaError(PROCESSING_ERRORS.metadataProbeFailed, "视频元信息读取失败", error);
  }
}

async function processMedia({ inputPath, sampleVideoId, sampleArtifactId, sampleDir, store }) {
  const metadata = await probeMetadata(inputPath);
  const coverPath = path.join(sampleDir, "cover.jpg");
  const audioPath = path.join(sampleDir, "audio.m4a");
  const framesDir = path.join(sampleDir, "frames");
  await extractCover(inputPath, coverPath);
  const frames = await extractFrames(inputPath, framesDir, metadata.durationSeconds, sampleArtifactId, store);
  const audio = await extractAudio(inputPath, audioPath, sampleArtifactId, store);
  return {
    metadata,
    cover: createArtifactRef({
      artifactId: `artifact_${randomUUID()}`,
      parentArtifactId: sampleArtifactId,
      type: "cover-frame",
      uri: store.runtimeUri(coverPath),
      summary: "封面帧",
    }),
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

async function extractCover(inputPath, coverPath) {
  try {
    await runCommand("ffmpeg", ["-y", "-ss", "0", "-i", inputPath, "-frames:v", "1", coverPath]);
  } catch (error) {
    throw structuredMediaError(PROCESSING_ERRORS.frameExtractFailed, "封面帧生成失败", error);
  }
}

async function extractFrames(inputPath, framesDir, durationSeconds, parentArtifactId, store) {
  const timestamps = planFrameTimestamps(durationSeconds);
  const frames = [];
  for (let index = 0; index < timestamps.length; index += 1) {
    const timestamp = timestamps[index];
    const imagePath = path.join(framesDir, `frame-${String(index + 1).padStart(3, "0")}.jpg`);
    try {
      await runCommand("ffmpeg", ["-y", "-ss", String(timestamp), "-i", inputPath, "-frames:v", "1", imagePath]);
    } catch (error) {
      throw structuredMediaError(PROCESSING_ERRORS.frameExtractFailed, "抽帧失败", error);
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

async function extractAudio(inputPath, audioPath, parentArtifactId, store) {
  try {
    await runCommand("ffmpeg", ["-y", "-i", inputPath, "-vn", "-acodec", "aac", audioPath]);
    return createArtifactRef({
      artifactId: `artifact_${randomUUID()}`,
      parentArtifactId,
      type: "audio-track",
      uri: store.runtimeUri(audioPath),
      summary: "音频轨",
    });
  } catch {
    return createArtifactRef({
      artifactId: `artifact_${randomUUID()}`,
      parentArtifactId,
      type: "audio-track",
      uri: null,
      summary: "未检测到可抽取音频轨",
    });
  }
}

function structuredMediaError(code, message, cause) {
  const error = new Error(message);
  error.code = code;
  error.safeSummary = message;
  error.causeName = cause?.code || cause?.name;
  return error;
}

module.exports = { probeMetadata, processMedia, normalizeMetadata };
