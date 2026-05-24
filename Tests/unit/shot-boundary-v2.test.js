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

test("shot boundary v2 manifest exposes five-frame candidate check policy", () => {
  const manifest = buildV2Manifest({
    artifact: { sampleVideo: { original: { summary: "sample.mp4" } } },
    evidence: {
      metadata: { durationSeconds: 10, width: 960, height: 720, fps: 30 },
      config: {
        sceneWeakThreshold: 0.15,
        sceneStrongThreshold: 0.35,
        diffFps: 10,
        candidateFrameOffsets: [-3, -1, 0, 1, 3],
      },
      candidates: [{ id: "C001", time: 3.1, strength: "strong", maxSceneScore: 0.5, maxDiffScore: 80, sources: [] }],
      denseWindows: [{ id: "Z001", start: 2, end: 4, candidateIds: ["C001"] }],
      sheets: [{ sheetId: "candidate-check-5frames", sheetPurpose: "v2_candidate_check_5frames", window: null }],
    },
  });
  assert.deepEqual(manifest.method.candidateCheckFrames, ["t-3f", "t-1f", "t", "t+1f", "t+3f"]);
  assert.equal(manifest.candidates[0].id, "C001");
});

test("shot boundary v2 result builder keeps v2 method metadata", () => {
  const prepared = {
    sourceArtifactId: "artifact_source",
    durationSeconds: 6,
    frames: [],
    extractSampling: {},
    analysisSampling: {},
    subtitleContextSummary: null,
  };
  const evidence = {
    metadata: { durationSeconds: 6 },
    candidates: [{ id: "C001", time: 2, strength: "strong" }],
    denseWindows: [],
    sheets: [],
  };
  const message = JSON.stringify({
    shots: [
      { summary: "开场", start: 0, end: 2, endBoundary: { timestamp: 2, confidence: 0.8, reason: "硬切" } },
      { summary: "结尾", start: 2, end: 6, endBoundary: null },
    ],
    rejectedCandidates: [{ id: "C001", time: 2.8, reason: "同机位连续动作" }],
    methodSummary: { shotCount: 2 },
  });
  const analysis = buildV2ProcessedAnalysis(
    message,
    prepared,
    evidence,
    {
      artifactId: "artifact_v2",
      role: "shot-boundary-v2-analyzer",
      roleProfile: { profilePath: "profile", profileVersion: "v" },
      skillPath: "skill",
      skillHash: "hash",
      promptTemplate: { promptTemplateId: "analyze", promptTemplateVersion: "analyze.v1", promptTemplateHash: "prompt-hash" },
    },
    { thread_id: "thread_1", lease_id: "lease_1" },
    { turnId: "turn_1" },
  );
  assert.equal(analysis.method, "shot_boundary_v2_evidence_single_turn");
  assert.equal(analysis.agent.role, "shot-boundary-v2-analyzer");
  assert.equal(analysis.validation.schemaVersion, "shot-boundary-v2.result.v1");
  assert.equal(analysis.rejectedCandidates.length, 1);
});
