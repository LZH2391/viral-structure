const fs = require("fs/promises");
const { createHash, randomUUID } = require("crypto");
const path = require("path");

const ANALYSIS_OUTPUTS = {
  "script-segment-analysis": { outputKey: "script-segments", fileName: "script-segments.final.txt" },
  "rhythm-structure-analysis": { outputKey: "rhythm-structure", fileName: "rhythm-structure.final.txt" },
  "packaging-structure-analysis": { outputKey: "packaging-structure", fileName: "packaging-structure.final.txt" },
  "function-slot-atomization-analysis": { outputKey: "function-slot-atomization", fileName: "function-slot-atomization.final.txt" },
};

function createAnalysisFinalOutputStore({ store, rootDir = null } = {}) {
  const projectRoot = rootDir ?? path.dirname(store.runtimeRoot);
  const outputRoot = path.join(projectRoot, "Artifacts", "AnalysisFinalOutputs");

  async function writeFinalOutput({ sampleVideoId, analysis, finalOutputText, traceId, stageName, source = "turn-final-message" }) {
    const config = ANALYSIS_OUTPUTS[analysis?.type];
    if (!config || !sampleVideoId) return null;
    const sampleDir = path.join(outputRoot, sampleVideoId);
    const outputPath = path.join(sampleDir, config.fileName);
    const manifestPath = path.join(sampleDir, "manifest.json");
    await fs.mkdir(sampleDir, { recursive: true });
    const text = normalizeFinalText(finalOutputText);
    if (!text) {
      const existing = await keepExistingFinalOutput({
        manifestPath,
        outputPath,
        sampleVideoId,
        analysis,
        config,
        traceId,
        stageName,
      });
      if (existing) return existing;
      const reused = await copyReusedFinalOutput({
        sampleVideoId,
        analysis,
        config,
        outputPath,
        manifestPath,
        traceId,
        stageName,
      });
      if (reused) return reused;
      await removeFinalOutput({ manifestPath, outputPath, sampleVideoId, analysis, config, traceId, stageName });
      return null;
    }
    await fs.writeFile(outputPath, text, "utf8");
    const fileSummary = summarizeText(text);
    const manifest = await readManifest(manifestPath, sampleVideoId);
    const event = buildManifestEvent({
      action: "write",
      source,
      sampleVideoId,
      analysis,
      config,
      traceId,
      stageName,
      fileSummary,
    });
    manifest.outputs = {
      ...manifest.outputs,
      [config.outputKey]: buildOutputEntry(event),
    };
    appendHistory(manifest, event);
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
    return {
      outputKey: config.outputKey,
      filePath: outputPath,
      manifestPath,
    };
  }

  return { outputRoot, writeFinalOutput };
}

async function keepExistingFinalOutput({ manifestPath, outputPath, sampleVideoId, analysis, config, traceId, stageName }) {
  try {
    const text = normalizeFinalText(await fs.readFile(outputPath, "utf8"));
    if (!text) return null;
    const manifest = await readManifest(manifestPath, sampleVideoId);
    const event = buildManifestEvent({
      action: "keep_existing",
      source: "existing-final-message",
      sampleVideoId,
      analysis,
      config,
      traceId,
      stageName,
      fileSummary: summarizeText(text),
    });
    if (!manifest.outputs?.[config.outputKey]) {
      manifest.outputs = {
        ...manifest.outputs,
        [config.outputKey]: buildOutputEntry(event),
      };
    }
    appendHistory(manifest, event);
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
    return {
      outputKey: config.outputKey,
      filePath: outputPath,
      manifestPath,
      source: "existing-final-message",
    };
  } catch {
    return null;
  }
}

async function copyReusedFinalOutput({ sampleVideoId, analysis, config, outputPath, manifestPath, traceId, stageName }) {
  const sourceSampleVideoId = analysis?.sourceSampleVideoId;
  if (!sourceSampleVideoId || sourceSampleVideoId === sampleVideoId) return null;
  const sourcePath = path.join(path.dirname(path.dirname(outputPath)), sourceSampleVideoId, config.fileName);
  let sourceText = null;
  try {
    sourceText = await fs.readFile(sourcePath, "utf8");
  } catch {
    return null;
  }
  const text = normalizeFinalText(sourceText);
  if (!text) return null;
  await fs.writeFile(outputPath, text, "utf8");
  const fileSummary = summarizeText(text);
  const manifest = await readManifest(manifestPath, sampleVideoId);
  const event = buildManifestEvent({
    action: "copy_reuse",
    source: "cache-reuse-final-message",
    sampleVideoId,
    analysis,
    config,
    traceId,
    stageName,
    fileSummary,
    sourceDetails: {
      sourceSampleVideoId,
      sourceFileName: config.fileName,
    },
  });
  manifest.outputs = {
    ...manifest.outputs,
    [config.outputKey]: buildOutputEntry(event),
  };
  appendHistory(manifest, event);
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  return {
    outputKey: config.outputKey,
    filePath: outputPath,
    manifestPath,
    sourceFilePath: sourcePath,
  };
}

async function removeFinalOutput({ manifestPath, outputPath, sampleVideoId, analysis, config, traceId, stageName }) {
  await fs.rm(outputPath, { force: true });
  const manifest = await readManifest(manifestPath, sampleVideoId);
  const event = buildManifestEvent({
    action: manifest.outputs?.[config.outputKey] ? "remove_missing_source" : "skip_missing_source",
    source: "missing-final-message",
    sampleVideoId,
    analysis,
    config,
    traceId,
    stageName,
    fileSummary: null,
    sourceDetails: {
      sourceSampleVideoId: analysis?.sourceSampleVideoId ?? null,
    },
  });
  if (manifest.outputs?.[config.outputKey]) {
    const { [config.outputKey]: _removed, ...outputs } = manifest.outputs;
    manifest.outputs = outputs;
  }
  appendHistory(manifest, event);
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
}

function buildOutputEntry(event) {
  return {
    outputKey: event.outputKey,
    fileName: event.fileName,
    artifactId: event.artifactId,
    artifactType: event.artifactType,
    parentArtifactId: event.parentArtifactId,
    traceId: event.traceId,
    stageName: event.stageName,
    source: event.source,
    sourceSampleVideoId: event.sourceSampleVideoId,
    sourceArtifactId: event.sourceArtifactId,
    sourceTraceId: event.sourceTraceId,
    sourceTurnId: event.sourceTurnId,
    sourceCreatedAt: event.sourceCreatedAt,
    agentThreadId: event.agentThreadId,
    agentTurnId: event.agentTurnId,
    contentHash: event.contentHash,
    byteLength: event.byteLength,
    updatedAt: event.createdAt,
    lastEventId: event.eventId,
  };
}

function buildManifestEvent({
  action,
  source,
  sampleVideoId,
  analysis,
  config,
  traceId,
  stageName,
  fileSummary,
  sourceDetails = {},
}) {
  return {
    eventId: `final_output_${randomUUID()}`,
    action,
    outputKey: config.outputKey,
    fileName: config.fileName,
    sampleVideoId,
    artifactId: analysis?.artifactId ?? null,
    artifactType: analysis?.type ?? null,
    parentArtifactId: analysis?.parentArtifactId ?? null,
    traceId: traceId ?? analysis?.traceId ?? null,
    stageName: stageName ?? analysis?.stageName ?? null,
    source,
    sourceSampleVideoId: sourceDetails.sourceSampleVideoId ?? analysis?.sourceSampleVideoId ?? null,
    sourceArtifactId: analysis?.sourceScriptSegmentArtifactId
      ?? analysis?.sourceRhythmStructureArtifactId
      ?? analysis?.sourcePackagingStructureArtifactId
      ?? null,
    sourceTraceId: analysis?.sourceTraceId ?? null,
    sourceTurnId: analysis?.sourceTurnId ?? null,
    sourceCreatedAt: analysis?.sourceCreatedAt ?? null,
    sourceFileName: sourceDetails.sourceFileName ?? null,
    agentThreadId: analysis?.agent?.threadId ?? null,
    agentTurnId: analysis?.agent?.turnId ?? null,
    contentHash: fileSummary?.contentHash ?? null,
    byteLength: fileSummary?.byteLength ?? null,
    createdAt: new Date().toISOString(),
  };
}

function appendHistory(manifest, event) {
  const history = Array.isArray(manifest.history) ? manifest.history : [];
  manifest.history = [...history, event].slice(-200);
}

function summarizeText(text) {
  const buffer = Buffer.from(text, "utf8");
  return {
    contentHash: createHash("sha256").update(buffer).digest("hex"),
    byteLength: buffer.length,
  };
}

function normalizeManifest(parsed, sampleVideoId) {
  const manifest = parsed && typeof parsed === "object" ? parsed : {};
  const outputs = manifest.outputs && typeof manifest.outputs === "object" ? manifest.outputs : {};
  const history = Array.isArray(manifest.history) ? manifest.history : [];
  return {
    schemaVersion: manifest.schemaVersion ?? "analysis_final_outputs.v1",
    sampleVideoId,
    outputs,
    history,
  };
}

async function readManifest(manifestPath, sampleVideoId) {
  try {
    const parsed = JSON.parse(stripBom(await fs.readFile(manifestPath, "utf8")));
    return normalizeManifest(parsed, sampleVideoId);
  } catch {
    return normalizeManifest(null, sampleVideoId);
  }
}

function stripBom(text) {
  return String(text ?? "").replace(/^\uFEFF/, "");
}

function normalizeFinalText(finalOutputText) {
  const text = String(finalOutputText ?? "").trim();
  if (text) return `${text}\n`;
  return null;
}

module.exports = {
  ANALYSIS_OUTPUTS,
  createAnalysisFinalOutputStore,
};
