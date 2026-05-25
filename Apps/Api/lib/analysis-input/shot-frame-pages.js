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
  return shots.map((shot, index) => {
    const matchedFrames = frames.filter((frame) => frameBelongsToShot(frame, shot, index === shots.length - 1));
    return {
      shot,
      shotIndex: index,
      frames: matchedFrames.map((frame) => ({
        ...frame,
        shotId: shot.shotId,
        shotNo: shot.shotNo,
      })),
    };
  });
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
  for (const pageGroup of shotFramePages) {
    if (!pageGroup.frames.length) {
      emptyShotCount += 1;
      shotSheets.push({
        shotId: pageGroup.shot.shotId,
        shotNo: pageGroup.shot.shotNo,
        empty: true,
        sheetIds: [],
      });
      continue;
    }
    const renderedSheets = await contactSheetGenerator.generateContactSheets({
      frames: pageGroup.frames,
      frameWidth: input.frameDimensions?.width ?? 0,
      frameHeight: input.frameDimensions?.height ?? 0,
      sampleDir,
      parentArtifactId: input.parentArtifactId,
      store,
      outputSubdir: "sheets",
      sheetPurpose,
      buildSheetId: ({ sheetIndex }) => `${pageGroup.shot.shotNo}-p${sheetIndex + 1}`,
      buildGridItemLabel: (frame) => `${pageGroup.shot.shotNo} ${Number(frame.timestamp ?? 0).toFixed(3)}s`,
      outputFileNameBuilder: (sheet) => `${sheet.sheetId}.jpg`,
      constraints: {
        ...contactSheetGenerator.DEFAULT_CONSTRAINTS,
        overlapFrameCount: 0,
      },
    });
    const normalizedSheets = renderedSheets.map((sheet, pageIndex) => {
      visualAttachments.push({
        sheetId: sheet.sheetId,
        shotId: pageGroup.shot.shotId,
        shotNo: pageGroup.shot.shotNo,
        localImagePath: sheet.localImagePath,
        uri: sheet.uri,
      });
      const entry = {
        sheetId: sheet.sheetId,
        shotId: pageGroup.shot.shotId,
        shotNo: pageGroup.shot.shotNo,
        pageIndex,
        cells: sheet.gridItems.map((item) => ({
          frameId: item.frameId,
          timestamp: item.timestamp,
          row: item.row,
          col: item.col,
        })),
      };
      sheets.push(entry);
      return entry;
    });
    shotSheets.push({
      shotId: pageGroup.shot.shotId,
      shotNo: pageGroup.shot.shotNo,
      empty: false,
      sheetIds: normalizedSheets.map((sheet) => sheet.sheetId),
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

module.exports = {
  frameBelongsToShot,
  planShotFramePages,
  buildShotFrameVisualManifest,
  stripVisualManifestPaths,
};
