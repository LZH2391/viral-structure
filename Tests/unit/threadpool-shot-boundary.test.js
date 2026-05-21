const test = require("node:test");
const assert = require("node:assert/strict");
const { prepareInput, normalizeShots } = require("../../Apps/Api/lib/shot-boundary-service");
const { sanitizeRoleStatus } = require("../../Apps/Api/lib/threadpool-proxy");

test("shot boundary sampling computes stride and rejects oversampling", () => {
  const artifact = createArtifact();
  const input = prepareInput(artifact, 1);
  assert.equal(input.analysisSampling.stride, 3);
  assert.equal(input.frames.length, 2);
  assert.throws(() => prepareInput(artifact, 4), /高于抽帧采样率/);
});

test("shot boundary normalizes agent shots to frame ids and safe ranges", () => {
  const frames = [
    { frameId: "frame_1" },
    { frameId: "frame_2" },
  ];
  const shots = normalizeShots([{ start: -1, end: 9, representativeFrameId: "missing", confidence: 2, reason: "x".repeat(300) }], frames, 6);
  assert.equal(shots[0].start, 0);
  assert.equal(shots[0].end, 6);
  assert.equal(shots[0].representativeFrameId, "frame_1");
  assert.equal(shots[0].confidence, 1);
  assert.equal(shots[0].reason.length, 160);
});

test("threadpool role status removes init prompt and keeps safe summary", () => {
  const status = sanitizeRoleStatus({
    ok: true,
    role: "shot-boundary-analyzer",
    min_idle: 1,
    init_prompt: "very long prompt",
    skill_path: "C:\\x\\shot-boundary-analyzer\\SKILL.md",
    counts: { idle: 1, leased: 0 },
    seed_thread_id: "thread_seed",
    can_acquire: true,
    thread_entries: [{ thread_id: "thread_1", thread_status: "idle", lease_id: null }],
    active_leases: [],
  });
  assert.equal(status.config.skill_path, "SKILL.md");
  assert.equal("init_prompt" in status, false);
  assert.equal(status.threads[0].status, "idle");
});

function createArtifact() {
  return {
    sampleVideoId: "sample_1",
    trace: { traceId: "trace_1" },
    processingOptions: { frameSampleRateFps: 3 },
    sampleVideo: { artifactId: "artifact_sample" },
    metadata: { durationSeconds: 2 },
    frameOutputSummary: { frameSampleRateFps: 3, targetFrameCount: 6, actualFrameCount: 6, maxFrames: 120 },
    frames: Array.from({ length: 6 }, (_, index) => ({
      frameId: `frame_${index}`,
      artifactId: `artifact_frame_${index}`,
      parentArtifactId: "artifact_sample",
      timestamp: index / 3,
      imageUri: `/runtime/Artifacts/sample_1/frames/frame-${index}.jpg`,
    })),
  };
}
