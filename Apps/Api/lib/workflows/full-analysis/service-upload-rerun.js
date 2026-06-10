const fs = require("fs/promises");
const path = require("path");

function createUploadRerunBuilder({ store, readArtifact }) {
  async function buildUploadRerunInputForSample(sampleVideoId) {
    const artifact = await readArtifact(sampleVideoId);
    const original = artifact?.sampleVideo?.original ?? null;
    const filePath = resolveRuntimeFilePath(original?.uri);
    if (!filePath) {
      const error = new Error("原始视频文件不可用，不能刷新上传素材");
      error.statusCode = 400;
      error.code = "workflow_upload_rerun_source_unavailable";
      error.retryable = false;
      throw error;
    }
    let buffer;
    try {
      buffer = await fs.readFile(filePath);
    } catch {
      const error = new Error("原始视频文件不可读，不能刷新上传素材");
      error.statusCode = 400;
      error.code = "workflow_upload_rerun_source_unreadable";
      error.retryable = false;
      throw error;
    }
    const filename = path.basename(original?.summary || filePath);
    return {
      workspaceId: artifact?.workspaceId ?? "default-workspace",
      file: {
        filename,
        name: filename,
        mimeType: mimeTypeForVideoPath(filePath),
        type: mimeTypeForVideoPath(filePath),
        extension: path.extname(filePath),
        size: buffer.length,
        buffer,
      },
      fields: {
        frameSampleRateFps: artifact?.processingOptions?.frameSampleRateFps ?? 10,
        enableAudioSeparation: Boolean(artifact?.processingOptions?.enableAudioSeparation),
        enableSubtitleRecognition: Boolean(artifact?.processingOptions?.enableSubtitleRecognition),
        enableAudioFeatureAnalysis: Boolean(artifact?.processingOptions?.enableAudioFeatureAnalysis),
        cacheDecision: "refresh",
      },
    };
  }

  function resolveRuntimeFilePath(uri) {
    const text = String(uri ?? "").trim();
    if (!text.startsWith("/runtime/") || !store?.runtimeRoot) return null;
    const relative = text.slice("/runtime/".length).split("/").filter(Boolean);
    const filePath = path.resolve(store.runtimeRoot, ...relative);
    const root = path.resolve(store.runtimeRoot);
    return filePath === root || filePath.startsWith(`${root}${path.sep}`) ? filePath : null;
  }

  return { buildUploadRerunInputForSample };
}

function mimeTypeForVideoPath(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".mov") return "video/quicktime";
  if (extension === ".webm") return "video/webm";
  if (extension === ".m4v") return "video/x-m4v";
  return "video/mp4";
}

module.exports = {
  createUploadRerunBuilder,
};
