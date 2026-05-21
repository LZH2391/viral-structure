const { spawn } = require("child_process");
const path = require("path");

const DEFAULT_CEP_ROOT = "C:\\Users\\Administrator\\AppData\\Roaming\\Adobe\\CEP\\extensions\\AE_WorkspaceCore";

function createAppServerBridge({ cepRoot = process.env.CEP_WORKSPACE_CORE_ROOT || DEFAULT_CEP_ROOT, python = process.env.PYTHON || "python" } = {}) {
  const bridgePath = path.join(__dirname, "appserver_bridge.py");

  async function runTurnWithInputs({ workspaceRoot, threadId, inputs, skillPath, timeoutSeconds = 180 }) {
    const payload = {
      cepRoot,
      workspaceRoot,
      threadId,
      inputs,
      skillPath,
      timeoutSeconds,
      transportUrl: process.env.CODEX_APP_SERVER_WS_URL || "ws://127.0.0.1:8146",
    };
    const result = await runPythonJson({ python, script: bridgePath, payload, timeoutMs: (timeoutSeconds + 30) * 1000 });
    if (!result?.ok) {
      const error = new Error(result?.message || "AppServer turn failed");
      error.code = result?.error || "appserver_turn_failed";
      error.debugPayload = result;
      throw error;
    }
    return result;
  }

  return { runTurnWithInputs };
}

function runPythonJson({ python, script, payload, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = spawn(python, [script], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      const error = new Error("AppServer bridge timed out");
      error.code = "appserver_bridge_timeout";
      error.debugPayload = { stderr: stderr.slice(-2000) };
      reject(error);
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      error.debugPayload = { stderr: stderr.slice(-2000) };
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        const error = new Error(`AppServer bridge exited with ${code}`);
        error.code = "appserver_bridge_failed";
        error.debugPayload = { stderr: stderr.slice(-2000), stdout: stdout.slice(-2000) };
        reject(error);
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        error.debugPayload = { stdout: stdout.slice(-2000), stderr: stderr.slice(-2000) };
        reject(error);
      }
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

module.exports = { DEFAULT_CEP_ROOT, createAppServerBridge };
