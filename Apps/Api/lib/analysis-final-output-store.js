const fs = require("fs/promises");
const path = require("path");

const ANALYSIS_OUTPUTS = {
  "script-segment-analysis": { outputKey: "script-segments", fileName: "script-segments.final.txt" },
  "rhythm-structure-analysis": { outputKey: "rhythm-structure", fileName: "rhythm-structure.final.txt" },
  "packaging-structure-analysis": { outputKey: "packaging-structure", fileName: "packaging-structure.final.txt" },
};

function createAnalysisFinalOutputStore({ store, rootDir = null } = {}) {
  const projectRoot = rootDir ?? path.dirname(store.runtimeRoot);
  const outputRoot = path.join(projectRoot, "Artifacts", "AnalysisFinalOutputs");

  async function writeFinalOutput({ sampleVideoId, analysis, finalOutputText, traceId, stageName }) {
    const config = ANALYSIS_OUTPUTS[analysis?.type];
    if (!config || !sampleVideoId) return null;
    const sampleDir = path.join(outputRoot, sampleVideoId);
    const outputPath = path.join(sampleDir, config.fileName);
    const manifestPath = path.join(sampleDir, "manifest.json");
    await fs.mkdir(sampleDir, { recursive: true });
    const text = normalizeFinalText(finalOutputText);
    if (!text) {
      const existing = await keepExistingFinalOutput({ outputPath, manifestPath, outputKey: config.outputKey });
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
      await removeFinalOutput({ manifestPath, outputPath, sampleVideoId, outputKey: config.outputKey });
      return null;
    }
    await fs.writeFile(outputPath, text, "utf8");
    const manifest = await readManifest(manifestPath, sampleVideoId);
    manifest.outputs = {
      ...manifest.outputs,
      [config.outputKey]: {
        outputKey: config.outputKey,
        fileName: config.fileName,
        artifactId: analysis?.artifactId ?? null,
        artifactType: analysis?.type ?? null,
        parentArtifactId: analysis?.parentArtifactId ?? null,
        traceId: traceId ?? analysis?.traceId ?? null,
        stageName: stageName ?? analysis?.stageName ?? null,
        source: "turn-final-message",
        updatedAt: new Date().toISOString(),
      },
    };
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
    return {
      outputKey: config.outputKey,
      filePath: outputPath,
      manifestPath,
    };
  }

  return { outputRoot, writeFinalOutput };
}

async function keepExistingFinalOutput({ outputPath, manifestPath, outputKey }) {
  try {
    const text = normalizeFinalText(await fs.readFile(outputPath, "utf8"));
    if (!text) return null;
    return {
      outputKey,
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
  const manifest = await readManifest(manifestPath, sampleVideoId);
  manifest.outputs = {
    ...manifest.outputs,
    [config.outputKey]: {
      outputKey: config.outputKey,
      fileName: config.fileName,
      artifactId: analysis?.artifactId ?? null,
      artifactType: analysis?.type ?? null,
      parentArtifactId: analysis?.parentArtifactId ?? null,
      traceId: traceId ?? analysis?.traceId ?? null,
      stageName: stageName ?? analysis?.stageName ?? null,
      source: "cache-reuse-final-message",
      sourceSampleVideoId,
      updatedAt: new Date().toISOString(),
    },
  };
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  return {
    outputKey: config.outputKey,
    filePath: outputPath,
    manifestPath,
    sourceFilePath: sourcePath,
  };
}

async function removeFinalOutput({ manifestPath, outputPath, sampleVideoId, outputKey }) {
  await fs.rm(outputPath, { force: true });
  const manifest = await readManifest(manifestPath, sampleVideoId);
  if (!manifest.outputs?.[outputKey]) return;
  const { [outputKey]: _removed, ...outputs } = manifest.outputs;
  manifest.outputs = outputs;
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
}

async function readManifest(manifestPath, sampleVideoId) {
  try {
    const parsed = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    return {
      sampleVideoId,
      outputs: parsed.outputs && typeof parsed.outputs === "object" ? parsed.outputs : {},
    };
  } catch {
    return { sampleVideoId, outputs: {} };
  }
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
