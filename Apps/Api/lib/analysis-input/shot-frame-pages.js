const contactSheetGenerator = require("../../../../Infrastructure/MediaProcessing/contact-sheet-generator");

function frameBelongsToShot(frame, shot, isLastShot) {
  const timestamp = Number(frame?.timestamp ?? Number.NaN);
  const start = Number(shot?.start ?? Number.NaN);
  const end = Number(shot?.end ?? Number.NaN);
  if (!Number.isFinite(timestamp) || !Number.isFinite(start) || !Number.isFinite(end)) return false;
  return isLastShot ? timestamp >= start && timestamp <= end : timestamp >= start && timestamp < end;
}

function planShotFramePages(input) {
  const frames = Array.isArray(input.frames) ? input.frames : [];
  const shots = Array.isArray(input.shots) ? input.shots : [];
  const allFrames = frames.filter((frame) => frame?.frameId && frame?.filePath);
  return shots.map((shot, index) => {
    const matchedFrames = allFrames.filter((frame) => frameBelongsToShot(frame, shot, index === shots.length - 1));
    const representativeFrame = selectRepresentativeFrameForShot({ shot, frames: allFrames });
    const representative = representativeFrame ? buildRepresentativeShotFrame({ shot, frame: representativeFrame }) : null;
    return {
      shot,
      shotIndex: index,
      frames: representative ? [representative] : [],
      representativeFrame: representative,
      sourceFrameCount: matchedFrames.length,
    };
  });
}

function selectRepresentativeFrameForShot({ shot, frames }) {
  const safeFrames = Array.isArray(frames) ? frames : [];
  if (!safeFrames.length) return null;
  const middleTimestamp = resolveShotMiddleTimestamp(shot);
  let bestFrame = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const frame of safeFrames) {
    const timestamp = Number(frame?.timestamp ?? Number.NaN);
    if (!Number.isFinite(timestamp)) continue;
    const distance = Math.abs(timestamp - middleTimestamp);
    if (
      !bestFrame
      || distance < bestDistance
      || (distance === bestDistance && timestamp > Number(bestFrame.timestamp ?? Number.NEGATIVE_INFINITY))
    ) {
      bestFrame = frame;
      bestDistance = distance;
    }
  }
  return bestFrame;
}

function buildRepresentativeShotFrame({ shot, frame }) {
  const start = normalizeTime(shot?.start);
  const end = normalizeTime(shot?.end);
  const duration = normalizeTime(end - start);
  const middleTimestamp = resolveShotMiddleTimestamp(shot);
  const representativeFrameTimestamp = normalizeTime(frame?.timestamp);
  return {
    ...frame,
    shotId: shot.shotId,
    shotNo: shot.shotNo,
    shotStart: start,
    shotEnd: end,
    shotDuration: duration,
    middleTimestamp,
    representativeFrameTimestamp,
  };
}

async function buildShotFrameVisualManifest({
  input,
  shotFramePages,
  sampleDir,
  store,
  schemaVersion,
  sheetPurpose,
}) {
  const visualAttachments = [];
  const sheets = [];
  const shotSheets = [];
  let emptyShotCount = 0;
  const representativeFrames = [];
  for (const pageGroup of shotFramePages) {
    if (!pageGroup.representativeFrame) {
      emptyShotCount += 1;
      continue;
    }
    representativeFrames.push(pageGroup.representativeFrame);
  }

  if (representativeFrames.length) {
    const renderedSheets = await contactSheetGenerator.generateContactSheets({
      frames: representativeFrames,
      frameWidth: input.frameDimensions?.width ?? 0,
      frameHeight: input.frameDimensions?.height ?? 0,
      sampleDir,
      parentArtifactId: input.parentArtifactId,
      store,
      outputSubdir: "sheets",
      sheetPurpose,
      buildSheetId: ({ sheetIndex }) => `shot-representatives-p${sheetIndex + 1}`,
      buildGridItemLabel: (frame) => ({ text: buildShotCellLabel(frame), complete: true }),
      outputFileNameBuilder: (sheet) => `${sheet.sheetId}.jpg`,
      constraints: {
        ...contactSheetGenerator.DEFAULT_CONSTRAINTS,
        overlapFrameCount: 0,
      },
    });

    for (const [pageIndex, sheet] of renderedSheets.entries()) {
      const attachmentIndex = visualAttachments.length;
      visualAttachments.push({
        sheetId: sheet.sheetId,
        localImagePath: sheet.localImagePath,
        uri: sheet.uri,
      });
      const entry = {
        sheetId: sheet.sheetId,
        attachmentIndex,
        pageIndex,
        timeRange: {
          start: minFinite(sheet.gridItems.map((item) => item.shotStart)),
          end: maxFinite(sheet.gridItems.map((item) => item.shotEnd)),
        },
        cells: sheet.gridItems.map((item) => ({
          shotId: item.shotId,
          shotNo: item.shotNo,
          start: item.shotStart,
          end: item.shotEnd,
          duration: item.shotDuration,
          middleTimestamp: item.middleTimestamp,
          representativeFrameTimestamp: item.representativeFrameTimestamp ?? item.timestamp,
          row: item.row,
          col: item.col,
        })),
      };
      sheets.push(entry);
    }
  }

  const sheetIdsByShot = buildSheetIdsByShot(sheets);
  for (const pageGroup of shotFramePages) {
    const sheetIds = sheetIdsByShot.get(pageGroup.shot.shotId) ?? [];
    shotSheets.push({
      shotId: pageGroup.shot.shotId,
      shotNo: pageGroup.shot.shotNo,
      empty: !pageGroup.representativeFrame || !sheetIds.length,
      sheetIds,
      middleTimestamp: pageGroup.representativeFrame?.middleTimestamp ?? null,
      representativeFrameTimestamp: pageGroup.representativeFrame?.representativeFrameTimestamp ?? null,
      duration: pageGroup.representativeFrame?.shotDuration ?? null,
    });
  }
  const visualManifest = {
    schemaVersion,
    sheetPurpose,
    sheetCount: sheets.length,
    emptyShotCount,
    shotSheets,
    sheets,
  };
  return { visualManifest, visualAttachments };
}

function stripVisualManifestPaths(visualManifest) {
  return visualManifest;
}

function buildSheetIdsByShot(sheets) {
  const result = new Map();
  for (const sheet of sheets) {
    for (const cell of sheet.cells ?? []) {
      if (!cell.shotId) continue;
      const current = result.get(cell.shotId) ?? [];
      if (!current.includes(sheet.sheetId)) current.push(sheet.sheetId);
      result.set(cell.shotId, current);
    }
  }
  return result;
}

function resolveShotMiddleTimestamp(shot) {
  const start = normalizeTime(shot?.start);
  const end = normalizeTime(shot?.end);
  return normalizeTime(start + Math.max(0, end - start) / 2);
}

function buildShotCellLabel(frame) {
  return `${frame.shotNo} ${formatSeconds(frame.shotStart)}-${formatSeconds(frame.shotEnd)}s / ${formatSeconds(frame.shotDuration)}s`;
}

function formatSeconds(value) {
  const numeric = normalizeTime(value);
  return numeric.toFixed(1);
}

function normalizeTime(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.round(numeric * 1000) / 1000 : 0;
}

function minFinite(values) {
  const finite = values.map(Number).filter(Number.isFinite);
  return finite.length ? Math.min(...finite) : null;
}

function maxFinite(values) {
  const finite = values.map(Number).filter(Number.isFinite);
  return finite.length ? Math.max(...finite) : null;
}

module.exports = {
  frameBelongsToShot,
  planShotFramePages,
  selectRepresentativeFrameForShot,
  buildShotFrameVisualManifest,
  stripVisualManifestPaths,
};
