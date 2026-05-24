const { renderTurnTemplate } = require("../role-profile-loader");
const { sanitizeForAppServerText } = require("../shot-boundary-analysis/shared");

const CANDIDATE_CHECK_FRAMES = ["t-3f", "t-1f", "t", "t+1f", "t+3f"];

function buildV2Manifest({ artifact, prepared = null, agentWorkspace }) {
  const durationSeconds = Number(
    agentWorkspace?.durationSeconds
      ?? prepared?.durationSeconds
      ?? artifact?.metadata?.durationSeconds
      ?? 0
  );
  return sanitizeForAppServerText({
    schemaVersion: "shot-boundary-v2.agent-driven.v1",
    durationSeconds,
    video: {
      sourceVideoPath: agentWorkspace.sourceVideoPath,
      evidenceOutputDir: agentWorkspace.outputDir,
      evidenceOutputDirUri: agentWorkspace.outputDirUri,
      width: agentWorkspace.metadata?.width ?? artifact?.metadata?.width ?? null,
      height: agentWorkspace.metadata?.height ?? artifact?.metadata?.height ?? null,
      fps: agentWorkspace.metadata?.fps ?? artifact?.metadata?.fps ?? null,
      originalName: artifact.sampleVideo?.original?.summary ?? null,
    },
    workflow: {
      mode: "agent_driven",
      useExistingProjectShotAnalysis: false,
      serviceProvidedCandidates: false,
      serviceProvidedSheets: false,
      scratchOutputRoot: agentWorkspace.outputDir,
      candidateCheckFrames: CANDIDATE_CHECK_FRAMES,
      imageReturnConvention: "When a shell_command creates an image you need to inspect, print LOCAL_IMAGE: <absolute path> on its own line.",
      requiredStandard: "Only hard cuts, obvious jump cuts, transitions, or abrupt subject/scene/composition changes are final shot boundaries.",
    },
    suggestedProcess: [
      "Use ffprobe on sourceVideoPath to confirm duration, fps, width, and height.",
      "Use ffmpeg scene-score and/or frame-diff commands to discover possible high-change moments.",
      "Generate overview sheets, dense interval sheets, and candidate check sheets only as needed under evidenceOutputDir.",
      "For each ambiguous candidate, inspect frames at t-3f, t-1f, t, t+1f, and t+3f.",
      "Return final JSON only after your own evidence review.",
    ],
    subtitleContextSummary: prepared?.subtitleContextSummary ?? null,
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
    rejectedCandidates: "array of high-change times that you checked but rejected as final cuts",
    "rejectedCandidates[].id": "optional short candidate id assigned by you during analysis, such as C004",
    "rejectedCandidates[].time": "number seconds",
    "rejectedCandidates[].reason": "why it is not a cut, e.g. same-camera continuous motion",
    methodSummary: "short object explaining final cut count and review standard",
  };
}

function renderV2AnalyzeTurnInputs({ artifact, prepared, agentWorkspace, roleProfile }) {
  const manifest = buildV2Manifest({ artifact, prepared, agentWorkspace });
  const outputContract = buildOutputContract();
  const prompt = renderTurnTemplate(roleProfile, "analyze", {
    manifestJson: JSON.stringify(manifest),
    outputContractJson: JSON.stringify(outputContract),
  });
  const inputs = [{ type: "text", text: prompt.text, text_elements: [] }];
  return {
    ...prompt,
    inputs: sanitizeForAppServerText(inputs),
    manifest,
    outputContract,
  };
}

module.exports = {
  CANDIDATE_CHECK_FRAMES,
  buildV2Manifest,
  buildOutputContract,
  renderV2AnalyzeTurnInputs,
};
