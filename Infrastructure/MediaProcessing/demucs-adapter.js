const fs = require("fs/promises");
const path = require("path");
const { randomUUID } = require("crypto");
const { createArtifactRef } = require("../../Core/Workspace/sample-video-contracts");
const { runCommand } = require("./ffmpeg-runner");

async function separateAudio({ audioPath, outputDir, parentArtifactId, store }) {
  await fs.mkdir(outputDir, { recursive: true });
  try {
    await runCommand(resolvePython(), [path.join(__dirname, "demucs_separate.py"), "--two-stems", "vocals", "--out", outputDir, audioPath]);
    const stems = await findDemucsStems(outputDir);
    if (!stems.vocals || !stems.noVocals) throw demucsError("demucs_output_missing", "Demucs 未产出完整人声/伴奏文件", null);
    return {
      original: createArtifactRef({
        artifactId: parentArtifactId,
        parentArtifactId: null,
        type: "audio-track",
        uri: store.runtimeUri(audioPath),
        summary: "原音频",
      }),
      vocal: createArtifactRef({
        artifactId: `artifact_${randomUUID()}`,
        parentArtifactId,
        type: "audio-vocal",
        uri: store.runtimeUri(stems.vocals),
        summary: "人声",
      }),
      music: createArtifactRef({
        artifactId: `artifact_${randomUUID()}`,
        parentArtifactId,
        type: "audio-music",
        uri: store.runtimeUri(stems.noVocals),
        summary: "伴奏",
      }),
      status: "processed",
      reason: null,
    };
  } catch (error) {
    throw demucsError("audio_separation_failed", "人声/音乐分离失败", error);
  }
}

async function findDemucsStems(outputDir) {
  const files = await listFiles(outputDir);
  return {
    vocals: files.find((file) => path.basename(file).toLowerCase() === "vocals.wav") ?? null,
    noVocals: files.find((file) => path.basename(file).toLowerCase() === "no_vocals.wav") ?? null,
  };
}

async function listFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const next = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(next)));
    else files.push(next);
  }
  return files;
}

function demucsError(code, message, cause) {
  const error = new Error(message);
  error.code = code;
  error.safeSummary = message;
  error.mediaDebug = {
    commandSummary: cause?.commandSummary ?? { command: "demucs", args: ["--two-stems", "vocals", "--out", "<path:demucs>", "<path:audio>"] },
    stderrSummary: cause?.stderrSummary ?? null,
    exitCode: cause?.exitCode ?? null,
    retryable: false,
    mediaOperation: "audio.separate",
  };
  return error;
}

function resolvePython() {
  return process.env.PYTHON || "python";
}

module.exports = { separateAudio, findDemucsStems };
