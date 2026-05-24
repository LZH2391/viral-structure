const { renderTurnTemplate } = require("../role-profile-loader");
const { sanitizeForAppServerText } = require("../shot-boundary-analysis/shared");

function buildV2Manifest({ artifact, evidence }) {
  return sanitizeForAppServerText({
    schemaVersion: "shot-boundary-v2.evidence.v1",
    durationSeconds: evidence.metadata.durationSeconds,
    video: {
      width: evidence.metadata.width,
      height: evidence.metadata.height,
      fps: evidence.metadata.fps,
      originalName: artifact.sampleVideo?.original?.summary ?? null,
    },
    method: {
      sceneScore: {
        weakThreshold: evidence.config.sceneWeakThreshold,
        strongThreshold: evidence.config.sceneStrongThreshold,
      },
      frameDiff: {
        fps: evidence.config.diffFps,
      },
      candidateCheckFrames: evidence.config.candidateFrameOffsets.map((offset) => offset === 0 ? "t" : `t${offset > 0 ? "+" : ""}${offset}f`),
    },
    candidates: evidence.candidates.map((candidate) => ({
      id: candidate.id,
      time: candidate.time,
      strength: candidate.strength,
      maxSceneScore: candidate.maxSceneScore,
      maxDiffScore: candidate.maxDiffScore,
      sources: candidate.sources,
    })),
    denseWindows: evidence.denseWindows.map((window) => ({
      id: window.id,
      start: window.start,
      end: window.end,
      candidateIds: window.candidateIds,
    })),
    sheets: evidence.sheets.map((sheet, index) => ({
      index,
      sheetId: sheet.sheetId,
      purpose: sheet.sheetPurpose,
      window: sheet.window ? { id: sheet.window.id, start: sheet.window.start, end: sheet.window.end, candidateIds: sheet.window.candidateIds } : null,
    })),
  });
}

function buildOutputContract() {
  return {
    schemaVersion: "shot-boundary-v2.result.v1",
    shots: "non-empty array, first starts at 0, last ends at durationSeconds, adjacent shots are contiguous",
    "shots[].summary": "short visual description",
    "shots[].start": "number seconds",
    "shots[].end": "number seconds",
    "shots[].endBoundary": "object|null, null only for the last shot",
    "shots[].endBoundary.timestamp": "number seconds equal to shot.end",
    "shots[].endBoundary.confidence": "0..1",
    "shots[].endBoundary.reason": "why this is a hard cut / obvious jump cut",
    rejectedCandidates: "array of high-change candidates that are not final cuts",
    "rejectedCandidates[].id": "candidate id such as C004",
    "rejectedCandidates[].time": "number seconds",
    "rejectedCandidates[].reason": "why it is not a cut, e.g. same-camera continuous motion",
    methodSummary: "short object explaining final cut count and review standard",
  };
}

function renderV2AnalyzeTurnInputs({ artifact, evidence, roleProfile }) {
  const manifest = buildV2Manifest({ artifact, evidence });
  const outputContract = buildOutputContract();
  const prompt = renderTurnTemplate(roleProfile, "analyze", {
    manifestJson: JSON.stringify(manifest),
    outputContractJson: JSON.stringify(outputContract),
  });
  const inputs = [{ type: "text", text: prompt.text, text_elements: [] }];
  for (const sheet of evidence.sheets) {
    inputs.push({ type: "localImage", path: sheet.localImagePath });
  }
  return {
    ...prompt,
    inputs: sanitizeForAppServerText(inputs),
    manifest,
    outputContract,
  };
}

module.exports = {
  buildV2Manifest,
  buildOutputContract,
  renderV2AnalyzeTurnInputs,
};
