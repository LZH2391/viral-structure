const path = require("path");
const { runCommand } = require("./ffmpeg-runner");

async function transcodeForIat({ inputPath, outputPath }) {
  await runCommand("ffmpeg", ["-y", "-i", inputPath, "-ac", "1", "-ar", "16000", "-f", "s16le", outputPath]);
  return {
    path: outputPath,
    mimeType: "audio/L16;rate=16000",
    encoding: "raw",
    summary: { audioFormat: "pcm_s16le", sampleRate: 16000, channels: 1, filename: path.basename(outputPath) },
  };
}

module.exports = { transcodeForIat };
