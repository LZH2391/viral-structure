const fs = require("fs/promises");
const path = require("path");
const sharp = require("sharp");
const { randomUUID } = require("crypto");

const DEFAULT_CONSTRAINTS = {
  maxDimension: 4096,
  minFrameShortSide: 144,
  minFrameLongSide: 256,
  labelHeight: 28,
  overlapFrameCount: 1,
  format: "jpeg",
  quality: 88,
};

async function generateContactSheets({
  frames,
  frameWidth,
  frameHeight,
  sampleDir,
  parentArtifactId,
  store,
  constraints = {},
  outputSubdir = "contact-sheets",
  sheetPurpose = "shot_boundary_analysis",
  buildSheetId = null,
  buildGridItemLabel = null,
  outputFileNameBuilder = null,
} = {}) {
  const resolved = { ...DEFAULT_CONSTRAINTS, ...constraints };
  const plannedSheets = planContactSheets({
    frames,
    frameWidth,
    frameHeight,
    parentArtifactId,
    constraints: resolved,
    sheetPurpose,
    buildSheetId,
    buildGridItemLabel,
  });
  const outputDir = path.join(sampleDir, outputSubdir);
  await fs.mkdir(outputDir, { recursive: true });
  const rendered = [];
  for (const sheet of plannedSheets) {
    const fileName = typeof outputFileNameBuilder === "function"
      ? outputFileNameBuilder(sheet)
      : `${sheet.sheetId}.jpg`;
    const outputPath = path.join(outputDir, fileName);
    await renderContactSheet({ sheet, outputPath, quality: resolved.quality });
    rendered.push({
      ...sheet,
      uri: store.runtimeUri(outputPath),
      imagePath: store.runtimeUri(outputPath),
      localImagePath: outputPath,
    });
  }
  return rendered;
}

function planContactSheets({
  frames,
  frameWidth,
  frameHeight,
  parentArtifactId,
  constraints = DEFAULT_CONSTRAINTS,
  sheetPurpose = "shot_boundary_analysis",
  buildSheetId = null,
  buildGridItemLabel = null,
} = {}) {
  const normalizedFrames = Array.isArray(frames) ? frames.filter((frame) => frame?.frameId) : [];
  if (!normalizedFrames.length) throw new Error("缺少可生成联表的帧");
  const sourceWidth = Number(frameWidth ?? 0);
  const sourceHeight = Number(frameHeight ?? 0);
  if (!sourceWidth || !sourceHeight) throw new Error("缺少联表布局所需的视频分辨率");

  const capacity = findMaxCapacity({
    maxCount: normalizedFrames.length,
    sourceWidth,
    sourceHeight,
    constraints,
  });
  if (!capacity.layout) throw new Error("当前帧尺寸无法满足联表最小可读分辨率约束");

  const sheets = [];
  const step = Math.max(1, capacity.count - constraints.overlapFrameCount);
  for (let sheetIndex = 0, startIndex = 0; startIndex < normalizedFrames.length; sheetIndex += 1, startIndex += step) {
    const endIndex = Math.min(normalizedFrames.length, startIndex + capacity.count);
    const sheetFrames = normalizedFrames.slice(startIndex, endIndex);
    if (!sheetFrames.length) break;
    const layout = findBestLayout({
      count: sheetFrames.length,
      sourceWidth,
      sourceHeight,
      constraints,
    });
    if (!layout) throw new Error("联表布局计算失败");
    sheets.push(buildSheetArtifact({
      sheetIndex,
      parentArtifactId,
      frames: sheetFrames,
      layout,
      constraints,
      sheetPurpose,
      buildSheetId,
      buildGridItemLabel,
    }));
    if (endIndex >= normalizedFrames.length) break;
  }
  return sheets;
}

function findMaxCapacity({ maxCount, sourceWidth, sourceHeight, constraints }) {
  let best = { count: 0, layout: null };
  for (let count = 1; count <= maxCount; count += 1) {
    const layout = findBestLayout({ count, sourceWidth, sourceHeight, constraints });
    if (!layout) break;
    best = { count, layout };
  }
  return best;
}

function findBestLayout({ count, sourceWidth, sourceHeight, constraints }) {
  let best = null;
  for (let cols = 1; cols <= count; cols += 1) {
    const rows = Math.ceil(count / cols);
    const cellWidth = Math.floor(constraints.maxDimension / cols);
    const cellHeight = Math.floor(constraints.maxDimension / rows);
    const frameBoxHeight = cellHeight - constraints.labelHeight;
    if (cellWidth <= 0 || frameBoxHeight <= 0) continue;
    const scale = Math.min(cellWidth / sourceWidth, frameBoxHeight / sourceHeight);
    if (!Number.isFinite(scale) || scale <= 0) continue;
    const visibleFrameWidth = Math.max(1, Math.floor(sourceWidth * scale));
    const visibleFrameHeight = Math.max(1, Math.floor(sourceHeight * scale));
    const shortSide = Math.min(visibleFrameWidth, visibleFrameHeight);
    const longSide = Math.max(visibleFrameWidth, visibleFrameHeight);
    if (shortSide < constraints.minFrameShortSide || longSide < constraints.minFrameLongSide) continue;
    const score = visibleFrameWidth * visibleFrameHeight;
    const candidate = {
      rows,
      cols,
      width: cellWidth * cols,
      height: cellHeight * rows,
      cellWidth,
      cellHeight,
      frameBoxHeight,
      visibleFrameWidth,
      visibleFrameHeight,
      score,
    };
    if (!best || candidate.score > best.score || (candidate.score === best.score && candidate.rows * candidate.cols < best.rows * best.cols)) {
      best = candidate;
    }
  }
  return best;
}

function buildSheetArtifact({
  sheetIndex,
  parentArtifactId,
  frames,
  layout,
  constraints,
  sheetPurpose = "shot_boundary_analysis",
  buildSheetId = null,
  buildGridItemLabel = null,
}) {
  const sheetId = typeof buildSheetId === "function"
    ? String(buildSheetId({ sheetIndex, parentArtifactId, frames, layout }) ?? "")
    : `sheet-${String(sheetIndex + 1).padStart(3, "0")}`;
  const gridItems = frames.map((frame, index) => {
    const inputIndex = normalizeNonNegativeInteger(frame.inputIndex, index);
    const sourceFrameIndex = normalizeNonNegativeInteger(frame.sourceFrameIndex, index);
    const displayFrameLabel = typeof buildGridItemLabel === "function"
      ? String(buildGridItemLabel(frame, index, { sheetIndex, inputIndex, sourceFrameIndex }) ?? "").trim()
      : buildDisplayFrameLabel({ inputIndex, sourceFrameIndex }, index);
    return {
      frameId: frame.frameId,
      artifactId: frame.artifactId ?? null,
      parentArtifactId: frame.parentArtifactId ?? null,
      timestamp: Number(frame.timestamp ?? 0),
      inputIndex,
      sourceFrameIndex,
      displayFrameLabel: displayFrameLabel || buildDisplayFrameLabel({ inputIndex, sourceFrameIndex }, index),
      filePath: frame.filePath ?? null,
      shotId: frame.shotId ?? null,
      shotNo: frame.shotNo ?? null,
      gridIndex: index,
      row: Math.floor(index / layout.cols),
      col: index % layout.cols,
    };
  });
  return {
    artifactId: `artifact_${randomUUID()}`,
    parentArtifactId,
    type: "contact_sheet",
    artifactType: "contact_sheet",
    status: "processed",
    sheetPurpose,
    sheetId,
    sheetIndex,
    frameCount: frames.length,
    overlapFrameIds: sheetIndex > 0 && frames[0]?.frameId ? [frames[0].frameId] : [],
    gridItems,
    layout: {
      rows: layout.rows,
      cols: layout.cols,
      width: layout.width,
      height: layout.height,
      cellWidth: layout.cellWidth,
      cellHeight: layout.cellHeight,
      visibleFrameWidth: layout.visibleFrameWidth,
      visibleFrameHeight: layout.visibleFrameHeight,
      labelHeight: constraints.labelHeight,
    },
    constraints: {
      maxDimension: constraints.maxDimension,
      minFrameShortSide: constraints.minFrameShortSide,
      minFrameLongSide: constraints.minFrameLongSide,
      labelHeight: constraints.labelHeight,
      overlapFrameCount: constraints.overlapFrameCount,
    },
    compression: {
      format: constraints.format,
      quality: constraints.quality,
    },
    createdAt: new Date().toISOString(),
  };
}

async function renderContactSheet({ sheet, outputPath, quality }) {
  const composites = [];
  for (const item of sheet.gridItems) {
    const left = item.col * sheet.layout.cellWidth;
    const top = item.row * sheet.layout.cellHeight;
    const frameBuffer = await buildFrameCell({
      framePath: item.filePath ?? null,
      label: buildFrameLabel(item),
      cellWidth: sheet.layout.cellWidth,
      cellHeight: sheet.layout.cellHeight,
      frameBoxHeight: sheet.layout.cellHeight - sheet.layout.labelHeight,
      labelHeight: sheet.layout.labelHeight,
    });
    composites.push({ input: frameBuffer, left, top });
  }
  await sharp({
    create: {
      width: sheet.layout.width,
      height: sheet.layout.height,
      channels: 3,
      background: "#050505",
    },
  })
    .composite(composites)
    .jpeg({ quality, chromaSubsampling: "4:4:4" })
    .toFile(outputPath);
}

async function buildFrameCell({ framePath, label, cellWidth, cellHeight, frameBoxHeight, labelHeight }) {
  if (!framePath) throw new Error("联表缺少本地帧路径");
  const resized = await sharp(framePath)
    .resize({
      width: cellWidth,
      height: frameBoxHeight,
      fit: "inside",
      withoutEnlargement: false,
    })
    .toBuffer();
  const frameImage = await sharp(resized).metadata();
  const left = Math.max(0, Math.floor((cellWidth - (frameImage.width ?? 0)) / 2));
  const top = Math.max(0, Math.floor((frameBoxHeight - (frameImage.height ?? 0)) / 2));
  return sharp({
    create: {
      width: cellWidth,
      height: cellHeight,
      channels: 3,
      background: "#101114",
    },
  })
    .composite([
      { input: resized, left, top },
      { input: Buffer.from(buildLabelSvg({ width: cellWidth, height: labelHeight, text: label })), left: 0, top: frameBoxHeight },
    ])
    .png()
    .toBuffer();
}

function buildFrameLabel(item) {
  const timestamp = Number(item.timestamp ?? 0);
  const displayLabel = item.displayFrameLabel || item.frameId;
  return `${displayLabel}  ${timestamp.toFixed(3)}s`;
}

function buildDisplayFrameLabel(frame, fallbackIndex = 0) {
  const ordinal = Number.isInteger(frame?.inputIndex) && frame.inputIndex >= 0
    ? frame.inputIndex + 1
    : Number.isInteger(frame?.sourceFrameIndex) && frame.sourceFrameIndex >= 0
      ? frame.sourceFrameIndex + 1
      : fallbackIndex + 1;
  return `frame-${String(ordinal).padStart(3, "0")}`;
}

function normalizeNonNegativeInteger(value, fallback = 0) {
  const normalized = Number(value);
  return Number.isInteger(normalized) && normalized >= 0 ? normalized : fallback;
}

function buildLabelSvg({ width, height, text }) {
  const safeText = escapeXml(text);
  return `
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="#16181d"/>
  <text x="10" y="${Math.max(16, height - 8)}" font-family="Segoe UI, PingFang SC, Microsoft YaHei, sans-serif" font-size="16" fill="#f5f7fa">${safeText}</text>
</svg>`;
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

module.exports = {
  DEFAULT_CONSTRAINTS,
  buildDisplayFrameLabel,
  buildFrameLabel,
  generateContactSheets,
  planContactSheets,
};
