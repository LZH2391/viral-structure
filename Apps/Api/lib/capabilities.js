const { hasCommand, runCommand } = require("../../../Infrastructure/MediaProcessing/ffmpeg-runner");
const { isLibrosaAvailable } = require("../../../Infrastructure/MediaProcessing/librosa-adapter");

async function readCapabilities(env = process.env) {
  const [demucsAvailable, ffmpegAvailable, librosaAvailable] = await Promise.all([hasDemucs(), hasCommand("ffmpeg"), isLibrosaAvailable()]);
  return {
    demucsAvailable,
    ffmpegAvailable,
    librosaAvailable,
    doubaoSaucConfigured: hasDoubaoCredentials(env),
    doubaoSaucRequiredEnv: ["DOUBAO_SAUC_APP_ID", "DOUBAO_SAUC_ACCESS_TOKEN"],
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

function hasDoubaoCredentials(env = process.env) {
  return Boolean((env.DOUBAO_SAUC_APP_ID || env.VOLCENGINE_APP_ID) && (env.DOUBAO_SAUC_ACCESS_TOKEN || env.VOLCENGINE_ACCESS_TOKEN));
}

module.exports = { readCapabilities, hasDoubaoCredentials, hasDemucs };
