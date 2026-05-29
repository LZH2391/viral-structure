const { spawn } = require("child_process");
const fs = require("fs/promises");
const path = require("path");
const { createTraceContext } = require("../../../../Core/Workspace/sample-video-contracts");
const { createTraceIds } = require("../../../../Infrastructure/Observability/trace");

const STAGE_NAME = "function_slot_library.builder_refresh";
const DEFAULT_SKILL_SCRIPT_DIR = path.join(process.cwd(), ".agents", "skills", "function-slot-library-builder", "scripts");

function createFunctionSlotLibraryBuilderService({
  rootDir,
  store,
  logger,
  libraryService,
  python = process.env.PYTHON || "python",
  skillScriptDir = DEFAULT_SKILL_SCRIPT_DIR,
} = {}) {
  if (!rootDir) throw new Error("rootDir is required for FunctionSlotLibraryBuilderService");
  if (!store) throw new Error("store is required for FunctionSlotLibraryBuilderService");
  if (!libraryService) throw new Error("libraryService is required for FunctionSlotLibraryBuilderService");

  async function refresh({ mode = "skip-existing", updateGovernance = true } = {}) {
    const traceContext = createTraceContext(createTraceIds());
    const startedAt = Date.now();
    const inputSummary = { mode, updateGovernance };
    await logger?.writeStageLog?.({ traceContext, stageName: STAGE_NAME, event: "stage.start", inputSummary });
    try {
      await store.ensureRuntimeDirs?.();
      const exported = await exportAtomizationArtifacts(mode);
      const validation = await runBuilderScript("validate_corpus.py", [rootDir, "--out", runtimeTempPath("validation.json")], { allowNonZero: true });
      const slotIndex = await runBuilderScript("build_slot_index.py", [rootDir, "--out", runtimeTempPath("slot_index.json")]);
      const governance = updateGovernance
        ? await runBuilderScript("build_governance_skeleton.py", [rootDir, "--formal-out", "--update-existing"])
        : null;
      const result = {
        ok: validation.exitCode === 0,
        traceId: traceContext.traceId,
        runId: traceContext.runId,
        stageId: traceContext.stageId,
        exported,
        validation: {
          exitCode: validation.exitCode,
          path: "Runtime/Temp/FunctionSlotLibrary/validation.json",
          stdout: safePreview(validation.stdout, 500),
          stderr: safePreview(validation.stderr, 500),
        },
        slotIndex: {
          path: "Runtime/Temp/FunctionSlotLibrary/slot_index.json",
          stdout: safePreview(slotIndex.stdout, 500),
        },
        governance: governance ? {
          path: "Artifacts/FunctionSlotLibrary/_governance/semantic-governance.v1.json",
          stdout: safePreview(governance.stdout, 500),
        } : null,
      };
      await logger?.writeStageLog?.({
        traceContext,
        stageName: STAGE_NAME,
        event: "stage.end",
        outputSummary: summarizeResult(result),
        durationMs: Date.now() - startedAt,
      });
      return result;
    } catch (error) {
      const snapshot = await logger?.writeDebugSnapshot?.({
        traceContext,
        stageName: STAGE_NAME,
        reason: "function_slot_library_builder_refresh_failed",
        inputSummary,
        debugPayload: {
          code: error?.code ?? null,
          message: error instanceof Error ? error.message : "FunctionSlotLibrary builder refresh failed",
          detail: summarizeScriptError(error),
        },
      }).catch(() => null);
      await logger?.writeStageLog?.({
        traceContext,
        stageName: STAGE_NAME,
        event: "stage.fail",
        errorSummary: {
          code: error?.code ?? "function_slot_library_builder_refresh_failed",
          message: "FunctionSlotLibrary 构建刷新失败",
          retryable: true,
          debugSnapshotUri: snapshot?.uri ?? null,
        },
        durationMs: Date.now() - startedAt,
      });
      throw error;
    }
  }

  async function exportAtomizationArtifacts(mode) {
    const sampleIds = await listRuntimeSampleIds();
    const results = [];
    for (const sampleVideoId of sampleIds) {
      const artifact = await store.readJson(path.join(store.sampleDir(sampleVideoId), "artifact.json")).catch(() => null);
      if (!artifact?.functionSlotAtomizationAnalysis?.artifactId) continue;
      const result = await libraryService.exportSampleArtifact(sampleVideoId, { mode });
      if (result) {
        results.push({
          sampleVideoId,
          artifactId: result.manifest?.artifactId ?? null,
          exported: Boolean(result.exported),
          skipped: Boolean(result.skipped),
          itemPath: result.itemPath ?? null,
        });
      }
    }
    return {
      sampleCount: sampleIds.length,
      exportedCount: results.filter((item) => item.exported).length,
      skippedCount: results.filter((item) => item.skipped).length,
      items: results,
    };
  }

  async function listRuntimeSampleIds() {
    const runtimeArtifactsRoot = path.join(store.runtimeRoot, "Artifacts");
    const entries = await fs.readdir(runtimeArtifactsRoot, { withFileTypes: true }).catch((error) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  }

  function runtimeTempPath(filename) {
    return path.join(rootDir, "Runtime", "Temp", "FunctionSlotLibrary", filename);
  }

  async function runBuilderScript(scriptName, args, { allowNonZero = false } = {}) {
    const scriptPath = path.join(skillScriptDir, scriptName);
    const result = await runProcess(python, [scriptPath, ...args], { cwd: rootDir });
    if (result.exitCode !== 0 && !allowNonZero) {
      const error = new Error(`${scriptName} failed with ${result.exitCode}`);
      error.code = "function_slot_library_builder_script_failed";
      error.scriptName = scriptName;
      error.result = result;
      throw error;
    }
    return result;
  }

  return { refresh };
}

function runProcess(command, args, { cwd }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PYTHONIOENCODING: process.env.PYTHONIOENCODING || "utf-8" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
}

function summarizeResult(result) {
  return {
    ok: result.ok,
    exportedCount: result.exported.exportedCount,
    skippedCount: result.exported.skippedCount,
    validationExitCode: result.validation.exitCode,
    slotIndexPath: result.slotIndex.path,
    governancePath: result.governance?.path ?? null,
  };
}

function summarizeScriptError(error) {
  return {
    scriptName: error?.scriptName ?? null,
    exitCode: error?.result?.exitCode ?? null,
    stdout: safePreview(error?.result?.stdout, 500),
    stderr: safePreview(error?.result?.stderr, 500),
  };
}

function safePreview(value, limit = 240) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length <= limit ? text : `${text.slice(0, limit)}...`;
}

module.exports = {
  createFunctionSlotLibraryBuilderService,
};
