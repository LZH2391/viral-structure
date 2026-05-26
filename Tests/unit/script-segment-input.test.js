const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { prepareInput } = require("../../Apps/Api/lib/script-segment/service");
const {
  prepareInputPackage,
  renderAnalyzeTurnInputs,
  frameBelongsToShot,
} = require("../../Apps/Api/lib/script-segment-analysis/input");
const { loadRoleProfileByRole } = require("../../Apps/Api/lib/gateways/threadpool/role-profile-loader");
const { createLocalStore } = require("../../Infrastructure/Storage/local-store");
const { createArtifact, seedFrameFiles } = require("./script-segment-test-helpers");

test("prepareInput requires processed shot boundary shots", () => {
  assert.throws(() => prepareInput(createArtifact({ shotBoundaryAnalysis: null })), /可分析的切镜结果/);
});

test("script segment analyze turn uses file paths plus localImage inputs", async () => {
  const artifact = createArtifact();
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bd-script-segment-input-"));
  const store = createLocalStore(tempRoot);
  await store.ensureRuntimeDirs();
  await store.ensureSampleDirs(artifact.sampleVideoId);
  await seedFrameFiles(store, artifact);
  const prepared = prepareInput(artifact, { runtimeRoot: store.runtimeRoot });
  const inputPackage = await prepareInputPackage({
    input: prepared,
    sampleDir: store.sampleDir(artifact.sampleVideoId),
    store,
  });
  const roleProfile = await loadRoleProfileByRole("script-segment-analyzer");
  const turnInputs = renderAnalyzeTurnInputs({ input: prepared, inputPackage, roleProfile });
  const promptText = turnInputs.inputs[0].text;
  const imageItems = turnInputs.inputs.filter((item) => item.type === "localImage");

  assert.match(promptText, /manifestPath/);
  assert.match(promptText, /outputContractPath/);
  assert.match(promptText, /visualManifestPath/);
  assert.match(promptText, /本次包含 3 个镜头/);
  assert.match(promptText, /subtitleContextText/);
  assert.doesNotMatch(promptText, /"shots":\[/);
  assert.doesNotMatch(promptText, /"segments":\[/);
  assert.equal(imageItems.length, inputPackage.visualManifest.sheetCount);
  assert.equal(imageItems.length, inputPackage.visualAttachments.length);
  assert.equal("localImagePath" in inputPackage.visualManifest.sheets[0], false);
  assert.equal("uri" in inputPackage.visualManifest.sheets[0], false);
  assert.equal("displayLabel" in inputPackage.visualManifest.sheets[0].cells[0], false);
  assert.equal("frameId" in inputPackage.visualManifest.sheets[0].cells[0], false);
  assert.equal("pageCount" in inputPackage.visualManifest.sheets[0], false);
  assert.equal("frameCount" in inputPackage.visualManifest.sheets[0], false);
  assert.equal(inputPackage.visualManifest.sheets[0].attachmentIndex, 0);
  assert.equal(typeof inputPackage.visualManifest.sheets[0].timeRange.start, "number");
  assert.equal(Array.isArray(inputPackage.visualManifest.shotSheets), true);
  assert.equal("shots" in inputPackage.visualManifest, false);
  assert.equal("sampleVideoId" in inputPackage.manifest, false);
  assert.equal("parentArtifactId" in inputPackage.manifest, false);
  assert.equal("sampleVideoId" in inputPackage.lineage, true);
  assert.equal("parentArtifactId" in inputPackage.lineage, true);
  assert.match(JSON.stringify(inputPackage.outputContract), /模型无需返回这些字段/);
});

test("prepareInput aligns shot subtitles by words while preserving segment punctuation", () => {
  const artifact = createArtifact({
    subtitles: {
      artifactId: "artifact_subtitle",
      parentArtifactId: "artifact_audio",
      type: "subtitle-track",
      status: "processed",
      segments: [
        { id: "subtitle_1", start: 0.98, end: 3, text: "一整句跨镜头，", confidence: null },
      ],
      utterances: [
        {
          start: 0.98,
          end: 3,
          text: "一整句跨镜头字幕。",
          definite: true,
          words: [
            { start: 0.98, end: 1.02, text: "一" },
            { start: 1.02, end: 1.2, text: "整" },
            { start: 1.2, end: 1.5, text: "句" },
            { start: 1.5, end: 2.1, text: "跨" },
            { start: 2.1, end: 2.6, text: "镜" },
            { start: 2.6, end: 3, text: "头" },
          ],
        },
      ],
      words: [
        { start: 0.98, end: 1.02, text: "一" },
        { start: 1.02, end: 1.2, text: "整" },
        { start: 1.2, end: 1.5, text: "句" },
        { start: 1.5, end: 2.1, text: "跨" },
        { start: 2.1, end: 2.6, text: "镜" },
        { start: 2.6, end: 3, text: "头" },
      ],
    },
    shotBoundaryAnalysis: {
      artifactId: "artifact_shot_boundary",
      parentArtifactId: "artifact_sample",
      type: "shot-boundary-analysis",
      status: "processed",
      shots: [
        { id: "shot_1", shotNo: "S001", start: 0, end: 1, reason: "开场", summary: "开场镜头" },
        { id: "shot_2", shotNo: "S002", start: 1, end: 3, reason: "主体", summary: "主体镜头" },
      ],
      commerceBrief: null,
    },
  });

  const prepared = prepareInput(artifact);

  assert.equal(prepared.shots[0].subtitleText, "一");
  assert.equal(prepared.shots[1].subtitleText, "整句跨镜头，");
  assert.equal(prepared.shots[0].subtitleContextText, "一整句跨镜头字幕。");
  assert.equal(prepared.shots[1].subtitleContextText, "一整句跨镜头字幕。");
});

test("prepareInput falls back to word text when segment text cannot align", () => {
  const artifact = createArtifact({
    subtitles: {
      artifactId: "artifact_subtitle",
      parentArtifactId: "artifact_audio",
      type: "subtitle-track",
      status: "processed",
      segments: [
        { id: "subtitle_1", start: 0, end: 2, text: "完全不匹配，", confidence: null },
      ],
      utterances: [],
      words: [
        { start: 0, end: 0.6, text: "原" },
        { start: 1.05, end: 1.4, text: "词" },
      ],
    },
    shotBoundaryAnalysis: {
      artifactId: "artifact_shot_boundary",
      parentArtifactId: "artifact_sample",
      type: "shot-boundary-analysis",
      status: "processed",
      shots: [
        { id: "shot_1", shotNo: "S001", start: 0, end: 1, reason: "开场", summary: "开场镜头" },
        { id: "shot_2", shotNo: "S002", start: 1, end: 2, reason: "主体", summary: "主体镜头" },
      ],
      commerceBrief: null,
    },
  });

  const prepared = prepareInput(artifact);

  assert.equal(prepared.shots[0].subtitleText, "原");
  assert.equal(prepared.shots[1].subtitleText, "词");
});

test("prepareInput copies source subtitle punctuation without punctuation allowlist", () => {
  const artifact = createArtifact({
    subtitles: {
      artifactId: "artifact_subtitle",
      parentArtifactId: "artifact_audio",
      type: "subtitle-track",
      status: "processed",
      segments: [
        { id: "subtitle_1", start: 0, end: 2, text: "“真的吗？好！”", confidence: null },
      ],
      utterances: [],
      words: [
        { start: 0, end: 0.9, text: "真的吗" },
        { start: 1.05, end: 1.6, text: "好" },
      ],
    },
    shotBoundaryAnalysis: {
      artifactId: "artifact_shot_boundary",
      parentArtifactId: "artifact_sample",
      type: "shot-boundary-analysis",
      status: "processed",
      shots: [
        { id: "shot_1", shotNo: "S001", start: 0, end: 1, reason: "开场", summary: "开场镜头" },
        { id: "shot_2", shotNo: "S002", start: 1, end: 2, reason: "主体", summary: "主体镜头" },
      ],
      commerceBrief: null,
    },
  });

  const prepared = prepareInput(artifact);

  assert.equal(prepared.shots[0].subtitleText, "“真的吗？");
  assert.equal(prepared.shots[1].subtitleText, "好！”");
});

test("script segment frame ownership keeps half-open ranges and last shot closed", () => {
  const shot1 = { shotId: "shot_1", start: 0, end: 1.2 };
  const shot2 = { shotId: "shot_2", start: 1.2, end: 3.8 };
  const shot3 = { shotId: "shot_3", start: 3.8, end: 6 };

  assert.equal(frameBelongsToShot({ timestamp: 1.2 }, shot1, false), false);
  assert.equal(frameBelongsToShot({ timestamp: 1.2 }, shot2, false), true);
  assert.equal(frameBelongsToShot({ timestamp: 3.8 }, shot2, false), false);
  assert.equal(frameBelongsToShot({ timestamp: 3.8 }, shot3, true), true);
  assert.equal(frameBelongsToShot({ timestamp: 6 }, shot3, true), true);
});

test("script segment input package records empty shots without failing", async () => {
  const artifact = createArtifact();
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bd-script-segment-empty-shot-"));
  const store = createLocalStore(tempRoot);
  await store.ensureRuntimeDirs();
  await store.ensureSampleDirs(artifact.sampleVideoId);
  artifact.frames = [
    { frameId: "frame_1", artifactId: "artifact_frame_1", parentArtifactId: "artifact_sample", timestamp: 0, imageUri: "/runtime/Artifacts/sample_script_1/frames/frame-1.jpg" },
  ];
  await seedFrameFiles(store, artifact);
  const prepared = prepareInput(artifact, { runtimeRoot: store.runtimeRoot });
  const inputPackage = await prepareInputPackage({
    input: prepared,
    sampleDir: store.sampleDir(artifact.sampleVideoId),
    store,
  });

  assert.equal(inputPackage.emptyShotCount, 2);
  assert.equal(inputPackage.visualManifest.shotSheets.filter((shot) => shot.empty).length, 2);
  assert.equal(inputPackage.visualManifest.sheetCount, 1);
});
