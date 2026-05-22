const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createLocalStore } = require("../../Infrastructure/Storage/local-store");
const { createStageLogger, expandStageLogLines } = require("../../Infrastructure/Observability/stage-logger");
const { createArtifactIndex, hashBuffer } = require("../../Infrastructure/ArtifactIndex/artifact-index");
const { createSubtitleRevisionService, STAGE_NAME, buildSubtitleTextHash } = require("../../Apps/Api/lib/subtitle-revision-service");

test("subtitle revision writes new artifact, appends history, and records stage logs", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bd-subtitle-revision-"));
  const store = createLocalStore(tempRoot);
  await store.ensureRuntimeDirs();
  const logger = createStageLogger(store);
  const artifactIndex = createArtifactIndex({ store, processorVersion: "test-v1" });
  const sampleVideoId = "sample_1";
  const artifactPath = path.join(store.sampleDir(sampleVideoId), "artifact.json");
  const artifact = createArtifact();
  await store.writeJson(artifactPath, artifact);
  await artifactIndex.registerSampleArtifact({ artifact, fileHash: hashBuffer(Buffer.from("video")), traceId: "trace_source" });
  const service = createSubtitleRevisionService({ store, logger, artifactIndex });

  const result = await service.saveRevision({
    sampleVideoId,
    segments: [
      { id: "subtitle_1", start: 0, end: 1.2, text: "第一版手改字幕", confidence: null },
      { id: "subtitle_2", start: 1.2, end: 2.5, text: "第二句保持", confidence: null },
    ],
  });

  assert.equal(result.changed, true);
  assert.ok(result.traceId);
  assert.equal(result.sampleArtifact.subtitles.source, "manual_edit");
  assert.equal(result.sampleArtifact.subtitles.revisionIndex, 1);
  assert.equal(result.sampleArtifact.subtitles.parentArtifactId, "artifact_subtitle_recognition");
  assert.equal(result.sampleArtifact.subtitles.revisionOfArtifactId, "artifact_subtitle_recognition");
  assert.equal(result.sampleArtifact.subtitles.textHash, buildSubtitleTextHash(result.sampleArtifact.subtitles.segments));
  assert.equal(result.sampleArtifact.subtitlesRevisionHistory.length, 1);
  assert.equal(result.sampleArtifact.subtitlesRevisionHistory[0].artifactId, "artifact_subtitle_recognition");

  const persisted = await store.readJson(artifactPath);
  assert.equal(persisted.subtitles.artifactId, result.sampleArtifact.subtitles.artifactId);
  assert.equal(persisted.subtitlesRevisionHistory.length, 1);

  const logText = await fs.readFile(path.join(store.runtimeRoot, "DebugSnapshots", `${result.traceId}.log.jsonl`), "utf8");
  const logs = expandStageLogLines(logText.trim().split("\n").map(JSON.parse));
  assert.deepEqual(logs.map((line) => line.event), ["stage.start", "stage.end"]);
  assert.equal(logs[0].stageName, STAGE_NAME);
  assert.equal(logs[0].inputSummary.sourceSubtitleArtifactId, "artifact_subtitle_recognition");
  assert.equal(logs[1].outputSummary.source, "manual_edit");
  assert.equal(logs[1].outputSummary.segmentCount, 2);
});

test("subtitle revision rejects invalid ranges and writes fail log with snapshot", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bd-subtitle-revision-fail-"));
  const store = createLocalStore(tempRoot);
  await store.ensureRuntimeDirs();
  const logger = createStageLogger(store);
  const artifactIndex = createArtifactIndex({ store, processorVersion: "test-v1" });
  const sampleVideoId = "sample_1";
  const artifact = createArtifact();
  await store.writeJson(path.join(store.sampleDir(sampleVideoId), "artifact.json"), artifact);
  await artifactIndex.registerSampleArtifact({ artifact, fileHash: hashBuffer(Buffer.from("video")), traceId: "trace_source" });
  const service = createSubtitleRevisionService({ store, logger, artifactIndex });

  await assert.rejects(
    () => service.saveRevision({
      sampleVideoId,
      segments: [{ id: "subtitle_1", start: 1.1, end: 1.1, text: "坏数据", confidence: null }],
    }),
    (error) => {
      assert.equal(error.code, "subtitle_end_invalid");
      assert.ok(error.debugSnapshotUri);
      assert.ok(error.traceId);
      return true;
    },
  );
});

test("subtitle revision rejects stale expected revision with 409 conflict and fail log", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bd-subtitle-revision-conflict-"));
  const store = createLocalStore(tempRoot);
  await store.ensureRuntimeDirs();
  const logger = createStageLogger(store);
  const artifactIndex = createArtifactIndex({ store, processorVersion: "test-v1" });
  const sampleVideoId = "sample_1";
  const artifact = createArtifact();
  await store.writeJson(path.join(store.sampleDir(sampleVideoId), "artifact.json"), artifact);
  await artifactIndex.registerSampleArtifact({ artifact, fileHash: hashBuffer(Buffer.from("video")), traceId: "trace_source" });
  const service = createSubtitleRevisionService({ store, logger, artifactIndex });

  try {
    await service.saveRevision({
      sampleVideoId,
      segments: [{ id: "subtitle_1", start: 0, end: 1, text: "原始字幕一", confidence: null }],
      expectedSubtitleArtifactId: "artifact_subtitle_stale",
      expectedRevisionIndex: 9,
    });
    assert.fail("expected subtitle revision conflict");
  } catch (error) {
    assert.equal(error.code, "subtitle_revision_conflict");
    assert.equal(error.statusCode, 409);
    assert.equal(error.retryable, true);
    assert.ok(error.debugSnapshotUri);
    assert.ok(error.traceId);
    const logText = await fs.readFile(path.join(store.runtimeRoot, "DebugSnapshots", `${error.traceId}.log.jsonl`), "utf8");
    const logs = expandStageLogLines(logText.trim().split("\n").map(JSON.parse));
    const failLog = logs.find((line) => line.event === "stage.fail");
    assert.equal(failLog.errorSummary.code, "subtitle_revision_conflict");
    assert.equal(failLog.errorSummary.retryable, true);
  }
});

function createArtifact() {
  return {
    sampleVideoId: "sample_1",
    workspaceId: "workspace_1",
    status: "processed",
    trace: { runId: "run_source", traceId: "trace_source", stageId: "stage_source" },
    processingOptions: { frameSampleRateFps: 3, enableSubtitleRecognition: true },
    sampleVideo: {
      artifactId: "artifact_sample",
      parentArtifactId: null,
      original: { artifactId: "artifact_sample", parentArtifactId: null, type: "original-video", uri: "/runtime/source.mp4", summary: "sample.mp4" },
      normalized: { artifactId: "artifact_normalized", parentArtifactId: "artifact_sample", type: "normalized-video", uri: "/runtime/source.mp4", summary: "本地标准化引用" },
    },
    cover: null,
    frames: [],
    audio: { artifactId: "artifact_audio", parentArtifactId: "artifact_sample", type: "audio-track", uri: "/runtime/audio.m4a", summary: "音频轨" },
    subtitles: {
      artifactId: "artifact_subtitle_recognition",
      parentArtifactId: "artifact_audio",
      type: "subtitle-track",
      source: "recognition",
      revisionIndex: 0,
      revisionOfArtifactId: null,
      textHash: buildSubtitleTextHash([
        { id: "subtitle_1", start: 0, end: 1, text: "原始字幕一" },
        { id: "subtitle_2", start: 1.2, end: 2.5, text: "原始字幕二" },
      ]),
      segments: [
        { id: "subtitle_1", start: 0, end: 1, text: "原始字幕一", confidence: null },
        { id: "subtitle_2", start: 1.2, end: 2.5, text: "原始字幕二", confidence: null },
      ],
      status: "processed",
      reason: null,
      debugSnapshotUri: null,
      createdAt: "2026-05-22T00:00:00.000Z",
      traceId: "trace_source",
    },
    subtitlesRevisionHistory: null,
    metadata: { durationSeconds: 3, width: 720, height: 1280 },
  };
}
