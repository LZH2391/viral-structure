const { hasCommand } = require("../../../Infrastructure/MediaProcessing/ffmpeg-runner");

async function readCapabilities(env = process.env) {
  const [demucsAvailable, ffmpegAvailable] = await Promise.all([hasCommand("demucs"), hasCommand("ffmpeg")]);
  return {
    demucsAvailable,
    ffmpegAvailable,
    xfyunIatConfigured: hasXfyunCredentials(env),
    xfyunRequiredEnv: ["XFYUN_APP_ID", "XFYUN_API_KEY", "XFYUN_API_SECRET"],
  };
}

function hasXfyunCredentials(env = process.env) {
  return Boolean(env.XFYUN_APP_ID && env.XFYUN_API_KEY && env.XFYUN_API_SECRET);
}

module.exports = { readCapabilities, hasXfyunCredentials };
