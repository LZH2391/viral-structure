const { hasCommand, runCommand } = require("../../../Infrastructure/MediaProcessing/ffmpeg-runner");
const { isLibrosaAvailable } = require("../../../Infrastructure/MediaProcessing/librosa-adapter");

async function readCapabilities(env = process.env) {
  const [demucsAvailable, ffmpegAvailable, librosaAvailable] = await Promise.all([hasDemucs(), hasCommand("ffmpeg"), isLibrosaAvailable()]);
  return {
    demucsAvailable,
    ffmpegAvailable,
    librosaAvailable,
    doubaoSaucConfigured: hasDoubaoCredentials(env),
    doubaoSaucRequiredEnv: ["DOUBAO_Api_App_Key", "DOUBAO_Api_Access_Key"],
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
  return Boolean(env.DOUBAO_Api_App_Key && env.DOUBAO_Api_Access_Key);
}

module.exports = { readCapabilities, hasDoubaoCredentials, hasDemucs };
