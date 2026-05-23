const { spawn } = require("child_process");
const path = require("path");

const DEFAULT_PYTHON_RUNTIME_ROOT = path.resolve(__dirname, "..", "..", "..", "Infrastructure", "AgentRuntime");

function createAppServerBridge({
  pythonRuntimeRoot = process.env.PYTHON_RUNTIME_ROOT || DEFAULT_PYTHON_RUNTIME_ROOT,
  python = process.env.PYTHON || "python",
} = {}) {
  const bridgePath = path.join(__dirname, "appserver_bridge.py");

  async function runTurnWithInputs({ workspaceRoot, threadId, inputs, skillPath, timeoutSeconds = 180 }) {
    const payload = {
      operation: "runTurnWithInputs",
      pythonRuntimeRoot,
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

  async function startTurnWithInputs({ workspaceRoot, threadId, inputs, skillPath, timeoutSeconds = 180 }) {
    const payload = {
      operation: "startTurnWithInputs",
      pythonRuntimeRoot,
      workspaceRoot,
      threadId,
      inputs,
      skillPath,
      timeoutSeconds,
      transportUrl: process.env.CODEX_APP_SERVER_WS_URL || "ws://127.0.0.1:8146",
    };
    const result = await runPythonJson({ python, script: bridgePath, payload, timeoutMs: 45000 });
    if (!result?.ok) throw appServerError(result, "appserver_turn_start_failed");
    return result;
  }

  async function collectTurnResult({ workspaceRoot, threadId, turnId, timeoutSeconds = 180 }) {
    const payload = {
      operation: "collectTurnResult",
      pythonRuntimeRoot,
      workspaceRoot,
      threadId,
      turnId,
      timeoutSeconds,
      transportUrl: process.env.CODEX_APP_SERVER_WS_URL || "ws://127.0.0.1:8146",
    };
    const result = await runPythonJson({ python, script: bridgePath, payload, timeoutMs: 45000 });
    if (!result?.ok && !isNonTerminalTurnStatus(result?.status)) throw appServerError(result, "appserver_turn_collect_failed");
    return result;
  }

  async function readThread({ workspaceRoot, threadId, timeoutSeconds = 60 }) {
    const payload = {
      operation: "readThread",
      pythonRuntimeRoot,
      workspaceRoot,
      threadId,
      timeoutSeconds,
      transportUrl: process.env.CODEX_APP_SERVER_WS_URL || "ws://127.0.0.1:8146",
    };
    const result = await runPythonJson({ python, script: bridgePath, payload, timeoutMs: 45000 });
    if (!result?.ok) throw appServerError(result, "appserver_thread_read_failed");
    return result;
  }

  return { pythonRuntimeRoot, runTurnWithInputs, startTurnWithInputs, collectTurnResult, readThread };
}

function appServerError(result, fallbackCode) {
  const error = new Error(result?.message || "AppServer turn failed");
  error.code = result?.error || fallbackCode;
  error.debugPayload = result;
  return error;
}

function runPythonJson({ python, script, payload, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = spawn(python, [script], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PYTHONIOENCODING: process.env.PYTHONIOENCODING || "utf-8" },
    });
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
        const parsed = tryParseJson(stdout);
        const structured = parsed && typeof parsed === "object" ? parsed : null;
        const error = new Error(structured?.message || `AppServer bridge exited with ${code}`);
        error.code = structured?.error || "appserver_bridge_failed";
        error.debugPayload = {
          stderr: stderr.slice(-2000),
          stdout: stdout.slice(-2000),
          structured: structured ?? null,
        };
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

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

module.exports = { DEFAULT_PYTHON_RUNTIME_ROOT, createAppServerBridge, isNonTerminalTurnStatus };

function isNonTerminalTurnStatus(status) {
  return ["created", "pending", "queued", "submitted", "running", "inprogress", "in_progress"].includes(String(status ?? "").trim().toLowerCase());
}
