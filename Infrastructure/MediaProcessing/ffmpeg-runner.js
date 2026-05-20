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
    child.on("error", (error) => reject(attachCommandDebug(error, command, args, null, stderr)));
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const error = new Error(`${command} exited with code ${code}`);
      reject(attachCommandDebug(error, command, args, code, stderr));
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

function attachCommandDebug(error, command, args, exitCode, stderr) {
  error.stderr = stderr;
  error.exitCode = exitCode;
  error.commandSummary = summarizeCommand(command, args);
  error.stderrSummary = summarizeStderr(stderr);
  error.retryable = false;
  return error;
}

function summarizeCommand(command, args) {
  return {
    command,
    args: args.map(summarizeArg),
  };
}

function summarizeArg(arg) {
  const value = String(arg);
  if (/^[A-Za-z]:[\\/]/.test(value) || value.includes("/") || value.includes("\\")) {
    return `<path:${path.basename(value)}>`;
  }
  return value.length > 80 ? `${value.slice(0, 77)}...` : value;
}

function summarizeStderr(stderr, maxLength = 1200) {
  const safe = String(stderr ?? "").replace(/([A-Za-z]:)?[^\s'"]*[\\/][^\s'"]+/g, (match) => `<path:${path.basename(match)}>`).trim();
  if (safe.length <= maxLength) return safe;
  return `${safe.slice(0, maxLength)}...`;
}

module.exports = { runCommand, hasCommand, summarizeCommand, summarizeStderr };
