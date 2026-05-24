const fs = require("fs/promises");
const path = require("path");
const { randomUUID, createHash } = require("crypto");
const sharp = require("sharp");
const { runCommand } = require("../../../../Infrastructure/MediaProcessing/ffmpeg-runner");
const { normalizeMetadata } = require("../../../../Infrastructure/MediaProcessing/media-processor");
const { createFrameArtifact } = require("../../../../Core/Workspace/sample-video-contracts");

const DEFAULTS = {
  sceneStrongThreshold: 0.35,
  sceneWeakThreshold: 0.15,
  diffFps: 10,
  overviewFps: 1,
  zoomFps: 5,
  maxCandidates: 32,
  mergeWindowSeconds: 0.18,
  denseGapSeconds: 1.2,
  denseMinCount: 3,
  candidateFrameOffsets: [-3, -1, 0, 1, 3],
};

async function buildEvidencePackage({ artifact, sampleDir, store, parentArtifactId, options = {} }) {
  const config = { ...DEFAULTS, ...options };
  const inputPath = resolveRuntimePath(artifact.sampleVideo?.original?.uri, store.runtimeRoot);
  if (!inputPath) throw new Error("V2 evidence missing original video path");
  const evidenceRoot = path.join(sampleDir, "shot-boundary-v2");
  const frameDir = path.join(evidenceRoot, "frames");
  const sheetDir = path.join(evidenceRoot, "sheets");
  await fs.mkdir(frameDir, { recursive: true });
  await fs.mkdir(sheetDir, { recursive: true });

  const metadata = await probeVideo(inputPath, artifact.metadata);
  const sceneCandidates = await detectSceneCandidates(inputPath, config);
  const diffResult = await detectFrameDiffCandidates({ inputPath, frameDir, metadata, config, parentArtifactId, store });
  const candidates = mergeCandidates({
    sceneCandidates,
    diffCandidates: diffResult.candidates,
    durationSeconds: metadata.durationSeconds,
    config,
  });
  const denseWindows = buildDenseWindows(candidates, metadata.durationSeconds, config);
  const overviewSheets = await buildOverviewSheets({ inputPath, sheetDir, metadata, config, store });
  const candidateSheets = await buildCandidateCheckSheets({ inputPath, sheetDir, candidates, metadata, config, store });
  const zoomSheets = await buildZoomSheets({ inputPath, sheetDir, denseWindows, metadata, config, store });
  return {
    inputPath,
    metadata,
    config: {
      sceneStrongThreshold: config.sceneStrongThreshold,
      sceneWeakThreshold: config.sceneWeakThreshold,
      diffFps: config.diffFps,
      overviewFps: config.overviewFps,
      zoomFps: config.zoomFps,
      candidateFrameOffsets: config.candidateFrameOffsets,
    },
    sceneCandidates,
    diffCandidates: diffResult.candidates,
    candidates,
    denseWindows,
    sheets: [...overviewSheets, ...candidateSheets, ...zoomSheets],
    frames: diffResult.frames,
  };
}

async function probeVideo(inputPath, fallbackMetadata = {}) {
  const { stdout } = await runCommand("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", inputPath]);
  const data = JSON.parse(stdout);
  const metadata = normalizeMetadata(data);
  const videoStream = (data.streams || []).find((stream) => stream.codec_type === "video") || {};
  return {
    ...metadata,
    durationSeconds: Number(metadata.durationSeconds || fallbackMetadata?.durationSeconds || 0),
    width: Number(metadata.width || fallbackMetadata?.width || 0),
    height: Number(metadata.height || fallbackMetadata?.height || 0),
    fps: parseRate(videoStream.avg_frame_rate) || parseRate(videoStream.r_frame_rate) || 30,
  };
}

async function detectSceneCandidates(inputPath, config) {
  const filter = `select='gt(scene,${config.sceneWeakThreshold})',metadata=print`;
  const { stderr } = await runCommand("ffmpeg", ["-hide_banner", "-i", inputPath, "-filter:v", filter, "-an", "-f", "null", "-"]);
  const lines = String(stderr).split(/\r?\n/);
  const candidates = [];
  let pendingTime = null;
  for (const line of lines) {
    const timeMatch = line.match(/pts_time:([0-9.]+)/);
    if (timeMatch) pendingTime = Number(timeMatch[1]);
    const scoreMatch = line.match(/lavfi\.scene_score=([0-9.]+)/);
    if (scoreMatch && Number.isFinite(pendingTime)) {
      const score = Number(scoreMatch[1]);
      candidates.push({
        time: roundTime(pendingTime),
        score: round(score, 6),
        strength: score >= config.sceneStrongThreshold ? "strong" : "weak",
        source: "scene_score",
      });
      pendingTime = null;
    }
  }
  return candidates;
}

async function detectFrameDiffCandidates({ inputPath, frameDir, metadata, config, parentArtifactId, store }) {
  const diffDir = path.join(frameDir, "diff-10fps");
  await fs.mkdir(diffDir, { recursive: true });
  await runCommand("ffmpeg", ["-hide_banner", "-y", "-i", inputPath, "-vf", `fps=${config.diffFps},scale=160:-1`, path.join(diffDir, "f_%05d.jpg")]);
  const files = (await fs.readdir(diffDir)).filter((name) => name.endsWith(".jpg")).sort();
  const frames = files.map((file, index) => createFrameArtifact({
    frameId: `frame_${randomUUID()}`,
    artifactId: `artifact_${randomUUID()}`,
    parentArtifactId,
    timestamp: roundTime(index / config.diffFps),
    imageUri: store.runtimeUri(path.join(diffDir, file)),
  }));
  const rawScores = [];
  let prev = null;
  for (let index = 0; index < files.length; index += 1) {
    const filePath = path.join(diffDir, files[index]);
    const current = await readImageStats(filePath);
    if (prev) {
      const score = compareStats(prev, current);
      rawScores.push({
        time: roundTime(index / config.diffFps),
        meanDiff: round(score.meanDiff, 3),
        histL1: round(score.histL1, 6),
        score: round(score.score, 3),
        source: "frame_diff",
      });
    }
    prev = current;
  }
  const ranked = rawScores
    .filter((item) => Number.isFinite(item.score) && item.time > 0 && item.time < metadata.durationSeconds)
    .sort((a, b) => b.score - a.score);
  const minScore = resolveDiffScoreThreshold(ranked);
  const candidates = [];
  for (const item of ranked) {
    if (item.score < minScore) continue;
    if (candidates.every((candidate) => Math.abs(candidate.time - item.time) > 0.35)) {
      candidates.push(item);
    }
    if (candidates.length >= config.maxCandidates) break;
  }
  return { candidates: candidates.sort((a, b) => a.time - b.time), frames };
}

function resolveDiffScoreThreshold(ranked) {
  if (!ranked.length) return Number.POSITIVE_INFINITY;
  const top = ranked[0].score;
  return Math.max(30, top * 0.28);
}

async function readImageStats(filePath) {
  const { data, info } = await sharp(filePath).raw().toBuffer({ resolveWithObject: true });
  const pixels = info.width * info.height;
  const hist = new Array(64).fill(0);
  let sum = 0;
  for (let offset = 0; offset < data.length; offset += info.channels) {
    const r = data[offset];
    const g = data[offset + 1];
    const b = data[offset + 2];
    sum += (r + g + b) / 3;
    const bin = (r >> 6) * 16 + (g >> 6) * 4 + (b >> 6);
    hist[bin] += 1;
  }
  return { data, channels: info.channels, pixels, mean: sum / pixels, hist };
}

function compareStats(prev, current) {
  let diff = 0;
  const length = Math.min(prev.data.length, current.data.length);
  for (let index = 0; index < length; index += prev.channels) {
    diff += Math.abs(prev.data[index] - current.data[index]);
    diff += Math.abs(prev.data[index + 1] - current.data[index + 1]);
    diff += Math.abs(prev.data[index + 2] - current.data[index + 2]);
  }
  const meanDiff = diff / (current.pixels * 3);
  let histDiff = 0;
  for (let index = 0; index < current.hist.length; index += 1) {
    histDiff += Math.abs((current.hist[index] || 0) - (prev.hist[index] || 0));
  }
  const histL1 = histDiff / current.pixels;
  return { meanDiff, histL1, score: meanDiff + histL1 * 18 };
}

function mergeCandidates({ sceneCandidates, diffCandidates, durationSeconds, config }) {
  const raw = [...sceneCandidates, ...diffCandidates]
    .filter((candidate) => candidate.time > 0 && candidate.time < durationSeconds)
    .sort((a, b) => a.time - b.time);
  const merged = [];
  for (const candidate of raw) {
    const last = merged[merged.length - 1];
    if (last && Math.abs(candidate.time - last.time) <= config.mergeWindowSeconds) {
      last.sources.push(summarizeCandidateSource(candidate));
      last.time = chooseRepresentativeTime(last, candidate);
      last.maxSceneScore = Math.max(last.maxSceneScore || 0, candidate.source === "scene_score" ? candidate.score : 0);
      last.maxDiffScore = Math.max(last.maxDiffScore || 0, candidate.source === "frame_diff" ? candidate.score : 0);
      last.strength = resolveStrength(last);
    } else {
      merged.push({
        id: `C${String(merged.length + 1).padStart(3, "0")}`,
        time: candidate.time,
        sources: [summarizeCandidateSource(candidate)],
        maxSceneScore: candidate.source === "scene_score" ? candidate.score : 0,
        maxDiffScore: candidate.source === "frame_diff" ? candidate.score : 0,
        strength: candidate.strength === "strong" ? "strong" : "weak",
      });
    }
  }
  return merged.map((candidate, index) => ({
    ...candidate,
    id: `C${String(index + 1).padStart(3, "0")}`,
    time: roundTime(candidate.time),
  })).slice(0, config.maxCandidates);
}

function chooseRepresentativeTime(existing, candidate) {
  if (candidate.source === "scene_score" && candidate.score >= (existing.maxSceneScore || 0)) return candidate.time;
  if (!existing.maxSceneScore && candidate.source === "frame_diff" && candidate.score >= (existing.maxDiffScore || 0)) return candidate.time;
  return existing.time;
}

function resolveStrength(candidate) {
  if ((candidate.maxSceneScore || 0) >= DEFAULTS.sceneStrongThreshold) return "strong";
  if ((candidate.maxDiffScore || 0) >= 70) return "strong";
  return "weak";
}

function summarizeCandidateSource(candidate) {
  if (candidate.source === "scene_score") return { source: "scene_score", score: candidate.score, strength: candidate.strength };
  return { source: "frame_diff", score: candidate.score, meanDiff: candidate.meanDiff, histL1: candidate.histL1 };
}

function buildDenseWindows(candidates, durationSeconds, config) {
  const windows = [];
  let group = [];
  for (const candidate of candidates) {
    const previous = group[group.length - 1];
    if (!previous || candidate.time - previous.time <= config.denseGapSeconds) {
      group.push(candidate);
    } else {
      pushDenseWindow(windows, group, durationSeconds, config);
      group = [candidate];
    }
  }
  pushDenseWindow(windows, group, durationSeconds, config);
  return windows.slice(0, 6).map((window, index) => ({ ...window, id: `Z${String(index + 1).padStart(3, "0")}` }));
}

function pushDenseWindow(windows, group, durationSeconds, config) {
  if (group.length < config.denseMinCount) return;
  const start = Math.max(0, group[0].time - 1.5);
  const end = Math.min(durationSeconds, group[group.length - 1].time + 1.5);
  windows.push({
    start: roundTime(start),
    end: roundTime(end),
    candidateIds: group.map((candidate) => candidate.id),
  });
}

async function buildOverviewSheets({ inputPath, sheetDir, metadata, config, store }) {
  const outputPath = path.join(sheetDir, "overview_1fps.jpg");
  await runCommand("ffmpeg", [
    "-hide_banner", "-y", "-i", inputPath,
    "-vf", `fps=${config.overviewFps},scale=240:-1,drawtext=text='%{pts\\:hms}':x=6:y=6:fontsize=16:fontcolor=white:box=1:boxcolor=black@0.55,tile=6x${Math.ceil(metadata.durationSeconds / 6) + 1}`,
    "-frames:v", "1",
    outputPath,
  ]);
  return [sheetArtifact({ id: "overview-1fps", purpose: "v2_overview", outputPath, store })];
}

async function buildCandidateCheckSheets({ inputPath, sheetDir, candidates, metadata, config, store }) {
  if (!candidates.length) return [];
  const framesDir = path.join(sheetDir, "candidate-frames");
  await fs.mkdir(framesDir, { recursive: true });
  const frameStep = 1 / Math.max(1, metadata.fps || 30);
  const frameItems = [];
  for (const candidate of candidates) {
    for (const offsetFrames of config.candidateFrameOffsets) {
      const timestamp = clampTime(candidate.time + offsetFrames * frameStep, metadata.durationSeconds);
      const label = `${candidate.id} ${offsetFramesLabel(offsetFrames)} ${timestamp.toFixed(3)}s`;
      const outputPath = path.join(framesDir, `${candidate.id}_${offsetFramesLabel(offsetFrames).replace("+", "p").replace("-", "m")}.jpg`);
      await extractLabeledFrame({ inputPath, outputPath, timestamp, label, width: 180 });
      frameItems.push({ path: outputPath });
    }
  }
  const outputPath = path.join(sheetDir, "candidate_check_5frames.jpg");
  await tileImages({ inputs: frameItems.map((item) => item.path), outputPath, cols: 5, cellWidth: 180, cellHeight: Math.round(180 * metadata.height / metadata.width) });
  return [sheetArtifact({ id: "candidate-check-5frames", purpose: "v2_candidate_check_5frames", outputPath, store })];
}

async function buildZoomSheets({ inputPath, sheetDir, denseWindows, metadata, config, store }) {
  const sheets = [];
  for (const window of denseWindows) {
    const duration = Math.max(0.2, window.end - window.start);
    const frameCount = Math.ceil(duration * config.zoomFps);
    const cols = 5;
    const rows = Math.max(1, Math.ceil(frameCount / cols));
    const outputPath = path.join(sheetDir, `${window.id}_zoom.jpg`);
    await runCommand("ffmpeg", [
      "-hide_banner", "-y", "-ss", String(window.start), "-t", String(duration), "-i", inputPath,
      "-vf", `fps=${config.zoomFps},scale=200:-1,drawtext=text='${window.id} %{pts\\:hms}':x=5:y=5:fontsize=14:fontcolor=white:box=1:boxcolor=black@0.55,tile=${cols}x${rows}`,
      "-frames:v", "1",
      outputPath,
    ]);
    sheets.push(sheetArtifact({ id: `${window.id}-zoom`, purpose: "v2_dense_zoom", outputPath, store, window }));
  }
  return sheets;
}

async function extractLabeledFrame({ inputPath, outputPath, timestamp, label, width }) {
  const safeLabel = String(label).replace(/[:\\']/g, "_");
  await runCommand("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-ss", String(timestamp),
    "-i", inputPath,
    "-frames:v", "1",
    "-vf", `scale=${width}:-1,drawtext=text='${safeLabel}':x=5:y=5:fontsize=13:fontcolor=white:box=1:boxcolor=black@0.55`,
    outputPath,
  ]);
}

async function tileImages({ inputs, outputPath, cols, cellWidth, cellHeight }) {
  const rows = Math.ceil(inputs.length / cols);
  const composites = [];
  for (let index = 0; index < inputs.length; index += 1) {
    const buffer = await sharp(inputs[index]).resize(cellWidth, cellHeight, { fit: "cover" }).jpeg().toBuffer();
    composites.push({
      input: buffer,
      left: (index % cols) * cellWidth,
      top: Math.floor(index / cols) * cellHeight,
    });
  }
  await sharp({
    create: {
      width: cols * cellWidth,
      height: rows * cellHeight,
      channels: 3,
      background: "#050505",
    },
  }).composite(composites).jpeg({ quality: 90, chromaSubsampling: "4:4:4" }).toFile(outputPath);
}

function sheetArtifact({ id, purpose, outputPath, store, window = null }) {
  return {
    artifactId: `artifact_${randomUUID()}`,
    sheetId: id,
    sheetPurpose: purpose,
    uri: store.runtimeUri(outputPath),
    imagePath: store.runtimeUri(outputPath),
    localImagePath: outputPath,
    window,
  };
}

function resolveRuntimePath(uri, runtimeRoot) {
  const value = String(uri || "");
  if (!value.startsWith("/runtime/")) return null;
  return path.join(runtimeRoot, value.slice("/runtime/".length).split("/").join(path.sep));
}

function offsetFramesLabel(offsetFrames) {
  if (offsetFrames === 0) return "t";
  return `t${offsetFrames > 0 ? "+" : ""}${offsetFrames}f`;
}

function parseRate(rate) {
  const [num, den] = String(rate || "").split("/").map(Number);
  if (Number.isFinite(num) && Number.isFinite(den) && den > 0) return num / den;
  return 0;
}

function clampTime(value, durationSeconds) {
  return roundTime(Math.max(0, Math.min(Math.max(0, durationSeconds - 0.001), Number(value) || 0)));
}

function roundTime(value) {
  return round(Number(value), 3);
}

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function evidenceHash(evidence) {
  return createHash("sha256").update(JSON.stringify({
    metadata: evidence.metadata,
    candidates: evidence.candidates,
    denseWindows: evidence.denseWindows,
  }), "utf8").digest("hex");
}

module.exports = {
  DEFAULTS,
  buildEvidencePackage,
  evidenceHash,
};
