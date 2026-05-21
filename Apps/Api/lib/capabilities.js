const { hasCommand, runCommand } = require("../../../Infrastructure/MediaProcessing/ffmpeg-runner");
const { isLibrosaAvailable } = require("../../../Infrastructure/MediaProcessing/librosa-adapter");

async function readCapabilities(env = process.env) {
  const [demucsAvailable, ffmpegAvailable, librosaAvailable] = await Promise.all([hasDemucs(), hasCommand("ffmpeg"), isLibrosaAvailable()]);
  return {
    demucsAvailable,
    ffmpegAvailable,
    librosaAvailable,
    xfyunIatConfigured: hasXfyunCredentials(env),
    xfyunRequiredEnv: ["XFYUN_APP_ID", "XFYUN_API_KEY", "XFYUN_API_SECRET"],
  };
}

async function hasDemucs() {
  try {
    await runCommand("demucs", ["--help"]);
    return true;
  } catch {
    return false;
  }
}

function hasXfyunCredentials(env = process.env) {
  return Boolean(env.XFYUN_APP_ID && env.XFYUN_API_KEY && env.XFYUN_API_SECRET);
}

module.exports = { readCapabilities, hasXfyunCredentials, hasDemucs };
