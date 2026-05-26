const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const { createTraceContext } = require("../../../../Core/Workspace/sample-video-contracts");
const { createTraceIds } = require("../../../../Infrastructure/Observability/trace");
const { createFunctionSlotProjectionService } = require("../function-slot-projection/service");

const SCHEMA_VERSION = "function_slot_library.v1";
const FILES = {
  manifest: "manifest.json",
  slots: "slots.json",
  scriptAtoms: "atoms.script.json",
  rhythmAtoms: "atoms.rhythm.json",
  packagingAtoms: "atoms.packaging.json",
  bindings: "bindings.json",
  rules: "rules.json",
  templates: "templates.json",
};

function createFunctionSlotLibraryService({
  rootDir = null,
  store,
  projectionService = null,
  logger = null,
  libraryRoot = null,
  now = () => new Date().toISOString(),
} = {}) {
  if (!store) throw new Error("FunctionSlotLibraryService requires store");
  const workspaceRoot = rootDir ?? path.dirname(store.runtimeRoot);
  const activeLibraryRoot = libraryRoot ?? path.join(workspaceRoot, "Artifacts", "FunctionSlotLibrary");
  const activeProjectionService = projectionService ?? createFunctionSlotProjectionService({ store });

  async function exportSampleArtifact(sampleVideoId, { mode = "replace" } = {}) {
    assertMode(mode);
    return withStage({
      logger,
      stageName: "function_slot_library.export",
      inputSummary: { sampleVideoId, mode },
      action: async () => {
        const sourceArtifact = await store.readJson(path.join(store.sampleDir(sampleVideoId), "artifact.json")).catch(() => null);
        const analysis = sourceArtifact?.functionSlotAtomizationAnalysis ?? null;
        if (!analysis?.artifactId) return null;

        const artifactId = sanitizeArtifactId(analysis.artifactId);
        const itemDir = libraryItemDir(artifactId);
        const existingManifest = await readManifest(artifactId).catch(() => null);
        if (existingManifest && mode === "skip-existing") {
          return {
            exported: false,
            skipped: true,
            existedBefore: true,
            itemPath: libraryItemPath(artifactId),
            manifest: existingManifest,
          };
        }

        const payload = buildLibraryPayload({ artifact: sourceArtifact, analysis, exportedAt: now() });
        await fs.rm(itemDir, { recursive: true, force: true });
        await fs.mkdir(itemDir, { recursive: true });
        await writeJson(path.join(itemDir, FILES.slots), payload.slots);
        await writeJson(path.join(itemDir, FILES.scriptAtoms), payload.scriptAtoms);
        await writeJson(path.join(itemDir, FILES.rhythmAtoms), payload.rhythmAtoms);
        await writeJson(path.join(itemDir, FILES.packagingAtoms), payload.packagingAtoms);
        await writeJson(path.join(itemDir, FILES.bindings), payload.bindings);
        await writeJson(path.join(itemDir, FILES.rules), payload.rules);
        await writeJson(path.join(itemDir, FILES.templates), payload.templates);
        await writeJson(path.join(itemDir, FILES.manifest), payload.manifest);

        return {
          exported: true,
          skipped: false,
          existedBefore: Boolean(existingManifest),
          itemPath: libraryItemPath(artifactId),
          manifest: payload.manifest,
        };
      },
      outputSummary: (result) => result ? summarizeManifest(result.manifest, { exported: result.exported, skipped: result.skipped }) : { found: false },
    });
  }

  async function listLibraryItems() {
    return withStage({
      logger,
      stageName: "function_slot_library.list",
      inputSummary: { libraryRoot: "Artifacts/FunctionSlotLibrary" },
      action: async () => {
        const entries = await fs.readdir(activeLibraryRoot, { withFileTypes: true }).catch((error) => {
          if (error.code === "ENOENT") return [];
          throw error;
        });
        const manifests = [];
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const manifest = await readManifest(entry.name).catch(() => null);
          if (manifest?.schemaVersion === SCHEMA_VERSION) manifests.push(manifest);
        }
        return manifests.sort(compareManifests);
      },
      outputSummary: (items) => ({ itemCount: items.length }),
    });
  }

  async function projectLibraryArtifact(artifactId) {
    const safeArtifactId = sanitizeArtifactId(artifactId);
    return withStage({
      logger,
      stageName: "function_slot_library.project",
      inputSummary: { artifactId: safeArtifactId },
      action: async () => {
        const libraryArtifact = await readLibraryArtifact(safeArtifactId);
        if (!libraryArtifact) return null;
        const summary = await activeProjectionService.projectArtifact(libraryArtifact);
        return {
          projected: true,
          source: "function-slot-library",
          ...summary,
        };
      },
      outputSummary: (result) => result ? {
        artifactId: result.artifactId,
        sampleVideoId: result.sampleVideoId,
        slotCount: result.slotCount,
        atomCount: result.atomCount,
        bindingCount: result.bindingCount,
        ruleCount: result.ruleCount,
      } : { found: false },
    });
  }

  async function deleteLibraryItem(artifactId) {
    const safeArtifactId = sanitizeArtifactId(artifactId);
    return withStage({
      logger,
      stageName: "function_slot_library.delete",
      inputSummary: { artifactId: safeArtifactId },
      action: async () => {
        const manifest = await readManifest(safeArtifactId).catch(() => null);
        if (!manifest) return null;
        await fs.rm(libraryItemDir(safeArtifactId), { recursive: true, force: true });
        return { deleted: true, manifest };
      },
      outputSummary: (result) => result ? summarizeManifest(result.manifest, { deleted: true }) : { found: false },
    });
  }

  async function readLibraryArtifact(artifactId) {
    const safeArtifactId = sanitizeArtifactId(artifactId);
    const manifest = await readManifest(safeArtifactId).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!manifest) return null;
    if (manifest.schemaVersion !== SCHEMA_VERSION) throwHttpError(400, "function_slot_library_schema_unsupported", "FunctionSlotLibrary schemaVersion 不支持");
    const dir = libraryItemDir(safeArtifactId);
    const [slots, scriptAtoms, rhythmAtoms, packagingAtoms, bindings, rules, templates] = await Promise.all([
      readJson(path.join(dir, FILES.slots)),
      readJson(path.join(dir, FILES.scriptAtoms)),
      readJson(path.join(dir, FILES.rhythmAtoms)),
      readJson(path.join(dir, FILES.packagingAtoms)),
      readJson(path.join(dir, FILES.bindings)),
      readJson(path.join(dir, FILES.rules)),
      readJson(path.join(dir, FILES.templates)),
    ]);
    return {
      sampleVideoId: manifest.sampleVideoId,
      functionSlotAtomizationAnalysis: {
        type: "function-slot-atomization-analysis",
        schemaVersion: "function-slot-atomization.v1",
        artifactId: manifest.artifactId,
        sampleVideoId: manifest.sampleVideoId,
        traceId: manifest.traceId ?? null,
        parentArtifactId: manifest.parentArtifactId ?? null,
        sourceScriptSegmentArtifactId: manifest.sourceScriptSegmentArtifactId ?? null,
        sourceRhythmStructureArtifactId: manifest.sourceRhythmStructureArtifactId ?? null,
        sourcePackagingStructureArtifactId: manifest.sourcePackagingStructureArtifactId ?? null,
        sourceShotBoundaryArtifactId: manifest.sourceShotBoundaryArtifactId ?? null,
        status: manifest.status ?? null,
        createdAt: manifest.createdAt ?? null,
        atomInventory: { scriptAtoms, rhythmAtoms, packagingAtoms },
        slotMap: { slots },
        bindingGraph: { bindings },
        conflictChecks: rules.conflictChecks ?? [],
        recombinationRules: rules.recombinationRules ?? [],
        recompositionTemplates: templates,
      },
    };
  }

  function libraryItemDir(artifactId) {
    return path.join(activeLibraryRoot, artifactId);
  }

  function libraryItemPath(artifactId) {
    return `Artifacts/FunctionSlotLibrary/${artifactId}`;
  }

  async function readManifest(artifactId) {
    return readJson(path.join(libraryItemDir(sanitizeArtifactId(artifactId)), FILES.manifest));
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    libraryRoot: activeLibraryRoot,
    exportSampleArtifact,
    listLibraryItems,
    projectLibraryArtifact,
    deleteLibraryItem,
    readLibraryArtifact,
  };
}

function buildLibraryPayload({ artifact, analysis, exportedAt }) {
  const slots = analysis.slotMap?.slots ?? [];
  const scriptAtoms = analysis.atomInventory?.scriptAtoms ?? [];
  const rhythmAtoms = analysis.atomInventory?.rhythmAtoms ?? [];
  const packagingAtoms = analysis.atomInventory?.packagingAtoms ?? [];
  const bindings = analysis.bindingGraph?.bindings ?? [];
  const rules = {
    conflictChecks: analysis.conflictChecks ?? [],
    recombinationRules: analysis.recombinationRules ?? [],
  };
  const templates = analysis.recompositionTemplates ?? [];
  const counts = {
    slotCount: slots.length,
    scriptAtomCount: scriptAtoms.length,
    rhythmAtomCount: rhythmAtoms.length,
    packagingAtomCount: packagingAtoms.length,
    atomCount: scriptAtoms.length + rhythmAtoms.length + packagingAtoms.length,
    bindingCount: bindings.length,
    conflictRuleCount: rules.conflictChecks.length,
    recombinationRuleCount: rules.recombinationRules.length,
    ruleCount: rules.conflictChecks.length + rules.recombinationRules.length,
    templateCount: templates.length,
  };
  const manifestBase = {
    schemaVersion: SCHEMA_VERSION,
    artifactId: analysis.artifactId,
    sampleVideoId: analysis.sampleVideoId ?? artifact?.sampleVideoId ?? null,
    traceId: analysis.traceId ?? artifact?.trace?.traceId ?? null,
    parentArtifactId: analysis.parentArtifactId ?? null,
    sourceScriptSegmentArtifactId: analysis.sourceScriptSegmentArtifactId ?? null,
    sourceRhythmStructureArtifactId: analysis.sourceRhythmStructureArtifactId ?? null,
    sourcePackagingStructureArtifactId: analysis.sourcePackagingStructureArtifactId ?? null,
    sourceShotBoundaryArtifactId: analysis.sourceShotBoundaryArtifactId ?? null,
    status: analysis.status ?? null,
    createdAt: analysis.createdAt ?? null,
    exportedAt,
    counts,
    files: FILES,
  };
  const contentHash = sha256Stable({
    manifest: { ...manifestBase, exportedAt: null },
    slots,
    scriptAtoms,
    rhythmAtoms,
    packagingAtoms,
    bindings,
    rules,
    templates,
  });
  return {
    manifest: { ...manifestBase, contentHash },
    slots,
    scriptAtoms,
    rhythmAtoms,
    packagingAtoms,
    bindings,
    rules,
    templates,
  };
}

async function withStage({ logger, stageName, inputSummary, action, outputSummary }) {
  if (!logger?.writeStageLog) return action();
  const traceContext = createTraceContext(createTraceIds());
  const startedAt = Date.now();
  await logger.writeStageLog({ traceContext, stageName, event: "stage.start", inputSummary });
  try {
    const result = await action();
    await logger.writeStageLog({
      traceContext,
      stageName,
      event: "stage.end",
      outputSummary: outputSummary(result),
      durationMs: Date.now() - startedAt,
    });
    return result;
  } catch (error) {
    const snapshot = logger.writeDebugSnapshot ? await logger.writeDebugSnapshot({
      traceContext,
      stageName,
      reason: `${stageName.replaceAll(".", "_")}_failed`,
      inputSummary,
      debugPayload: {
        code: error.code ?? null,
        message: error instanceof Error ? error.message : "FunctionSlotLibrary 操作失败",
      },
    }).catch(() => null) : null;
    await logger.writeStageLog({
      traceContext,
      stageName,
      event: "stage.fail",
      errorSummary: {
        code: error.code ?? "function_slot_library_failed",
        message: safeErrorMessage(error),
        retryable: error.statusCode ? error.statusCode >= 500 : true,
        debugSnapshotUri: snapshot?.uri ?? null,
      },
      durationMs: Date.now() - startedAt,
    });
    throw error;
  }
}

function summarizeManifest(manifest, extra = {}) {
  return {
    ...extra,
    artifactId: manifest.artifactId,
    sampleVideoId: manifest.sampleVideoId,
    traceId: manifest.traceId,
    counts: manifest.counts,
    contentHash: manifest.contentHash,
  };
}

function compareManifests(left, right) {
  const byExportedAt = String(right.exportedAt ?? "").localeCompare(String(left.exportedAt ?? ""));
  if (byExportedAt !== 0) return byExportedAt;
  return String(left.artifactId ?? "").localeCompare(String(right.artifactId ?? ""));
}

function sanitizeArtifactId(artifactId) {
  if (!artifactId || artifactId === "." || artifactId === ".." || !/^[A-Za-z0-9_.-]+$/.test(artifactId)) {
    throwHttpError(400, "function_slot_library_invalid_artifact_id", "artifactId 不合法");
  }
  return artifactId;
}

function assertMode(mode) {
  if (mode !== "replace" && mode !== "skip-existing") {
    throwHttpError(400, "function_slot_library_invalid_mode", "mode 只支持 replace 或 skip-existing");
  }
}

function throwHttpError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.retryable = false;
  throw error;
}

function safeErrorMessage(error) {
  if (error?.statusCode) return error.message;
  return "FunctionSlotLibrary 操作失败";
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function sha256Stable(value) {
  return crypto.createHash("sha256").update(stableStringify(value), "utf8").digest("hex");
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

module.exports = {
  createFunctionSlotLibraryService,
  buildLibraryPayload,
  SCHEMA_VERSION,
  FILES,
};
