const assert = require("node:assert/strict");
const test = require("node:test");
const { loadRoleProfileByRole } = require("../../Apps/Api/lib/role-profile-loader");
const { buildV2Manifest, buildV2ProcessedAnalysis } = require("../../Apps/Api/lib/shot-boundary-v2");

test("shot boundary v2 role profile loads isolated analyzer prompt", async () => {
  const profile = await loadRoleProfileByRole("shot-boundary-v2-analyzer");
  assert.equal(profile.role, "shot-boundary-v2-analyzer");
  assert.ok(profile.turnTemplates.analyze);
  assert.match(profile.skillPath, /shot-boundary-v2-analyzer/);
});

test("shot boundary v2 manifest gives original video and agent-owned workdir", () => {
  const manifest = buildV2Manifest({
    artifact: { metadata: { width: 960, height: 720 }, sampleVideo: { original: { summary: "sample.mp4" } } },
    prepared: { durationSeconds: 10, subtitleContextSummary: { subtitleSegmentCount: 0 } },
    agentWorkspace: {
      sourceVideoPath: "C:\\Runtime\\Artifacts\\sample\\source.mp4",
      outputDir: "C:\\Runtime\\Artifacts\\sample\\shot-boundary-v2\\agent-work",
      outputDirUri: "/runtime/Artifacts/sample/shot-boundary-v2/agent-work",
      metadata: { width: 960, height: 720, fps: null },
    },
  });
  assert.equal(manifest.schemaVersion, "shot-boundary-v2.agent-driven.v1");
  assert.equal(manifest.workflow.mode, "agent_driven");
  assert.equal(manifest.workflow.serviceProvidedCandidates, false);
  assert.equal(manifest.workflow.serviceProvidedSheets, false);
  assert.deepEqual(manifest.workflow.candidateCheckFrames, ["t-3f", "t-1f", "t", "t+1f", "t+3f"]);
  assert.match(manifest.video.sourceVideoPath, /source\.mp4$/);
});

test("shot boundary v2 result builder keeps agent-driven method metadata", () => {
  const prepared = {
    sourceArtifactId: "artifact_source",
    durationSeconds: 6,
    frames: [],
    extractSampling: {},
    analysisSampling: {},
    subtitleContextSummary: null,
  };
  const agentWorkspace = {
    outputDirUri: "/runtime/Artifacts/sample/shot-boundary-v2/agent-work",
    generatedSheets: [
      { sheetId: "v2-agent-001", sheetPurpose: "v2_agent_generated", uri: "/runtime/sheet.jpg", imagePath: "/runtime/sheet.jpg" },
    ],
  };
  const message = JSON.stringify({
    shots: [
      { summary: "opening shot", start: 0, end: 2, endBoundary: { timestamp: 2, confidence: 0.8, reason: "hard cut" } },
      { summary: "ending shot", start: 2, end: 6, endBoundary: null },
    ],
    rejectedCandidates: [{ time: 2.8, reason: "same camera continuous motion" }],
    methodSummary: { shotCount: 2 },
  });
  const analysis = buildV2ProcessedAnalysis(
    message,
    prepared,
    agentWorkspace,
    {
      artifactId: "artifact_v2",
      artifact: { sampleVideo: { original: { uri: "/runtime/Artifacts/sample/source.mp4" } } },
      role: "shot-boundary-v2-analyzer",
      roleProfile: { profilePath: "profile", profileVersion: "v" },
      skillPath: "skill",
      skillHash: "hash",
      promptTemplate: { promptTemplateId: "analyze", promptTemplateVersion: "analyze.v1", promptTemplateHash: "prompt-hash" },
    },
    { thread_id: "thread_1", lease_id: "lease_1" },
    { turnId: "turn_1" },
  );
  assert.equal(analysis.method, "shot_boundary_v2_agent_driven_single_turn");
  assert.equal(analysis.evidence.mode, "agent_driven");
  assert.equal(analysis.evidence.generatedSheetCount, 1);
  assert.equal(analysis.agent.inputMode, "v2_original_video_agent_driven_single_turn");
  assert.equal(analysis.validation.schemaVersion, "shot-boundary-v2.result.v1");
  assert.equal(analysis.rejectedCandidates.length, 1);
});
