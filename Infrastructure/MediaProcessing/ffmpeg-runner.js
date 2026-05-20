const { spawn } = require("child_process");
const path = require("path");

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveCommand(command), args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => {
      stdout += data.toString("utf8");
    });
    child.stderr.on("data", (data) => {
      stderr += data.toString("utf8");
    });
    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const error = new Error(`${command} exited with code ${code}`);
      error.stderr = stderr;
      reject(error);
    });
  });
}

async function hasCommand(command) {
  try {
    await runCommand(command, ["-version"]);
    return true;
  } catch {
    return false;
  }
}

function resolveCommand(command) {
  const binDir = process.env.FFMPEG_BIN_DIR;
  if (!binDir || !["ffmpeg", "ffprobe"].includes(command)) return command;
  return path.join(binDir, `${command}.exe`);
}

module.exports = { runCommand, hasCommand };
