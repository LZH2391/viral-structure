const path = require("path");

function normalizeFrame(frame, index, runtimeRoot) {
  const imageUri = String(frame?.imageUri ?? frame?.uri ?? "");
  const filePath = resolveLocalImagePath(imageUri, runtimeRoot);
  return {
    frameId: String(frame?.frameId ?? ""),
    artifactId: frame?.artifactId ?? null,
    parentArtifactId: frame?.parentArtifactId ?? null,
    timestamp: normalizeNumber(frame?.timestamp, 0),
    inputIndex: normalizeInteger(frame?.inputIndex, index),
    sourceFrameIndex: normalizeInteger(frame?.sourceFrameIndex, index),
    imageUri,
    filePath,
  };
}

function resolveLocalImagePath(imageUri, runtimeRoot) {
  const value = String(imageUri ?? "");
  if (runtimeRoot && value.startsWith("/runtime/")) {
    return path.join(runtimeRoot, ...value.slice("/runtime/".length).split("/"));
  }
  if (/^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\") || value.startsWith("/")) return value;
  return value;
}

function normalizeShotNo(value, index) {
  const text = String(value ?? "").trim();
  return text || `S${String(index + 1).padStart(3, "0")}`;
}

function normalizeNumber(value, fallback) {
  const next = Number(value);
  return Number.isFinite(next) ? Math.round(next * 1000) / 1000 : fallback;
}

function normalizeInteger(value, fallback) {
  const next = Number(value);
  return Number.isInteger(next) ? next : fallback;
}

module.exports = {
  normalizeFrame,
  resolveLocalImagePath,
  normalizeShotNo,
  normalizeNumber,
  normalizeInteger,
};
