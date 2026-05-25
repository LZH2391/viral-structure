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
    const text = normalizeFinalText(finalOutputText, analysis);
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
        source: finalOutputText ? "turn-final-message" : "analysis-json-fallback",
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

function normalizeFinalText(finalOutputText, analysis) {
  const text = String(finalOutputText ?? "").trim();
  if (text) return `${text}\n`;
  return `${JSON.stringify(analysis ?? {}, null, 2)}\n`;
}

module.exports = {
  ANALYSIS_OUTPUTS,
  createAnalysisFinalOutputStore,
};
