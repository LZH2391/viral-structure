const path = require("path");
const { normalizeText, pipelineError } = require("./shot-storyboard-pipeline-utils");

const PDF_ROLE = "shot-storyboard-prep";
const PDF_STAGE_NAME = "function.slot.shot_storyboard_prep.pdf_agent";
const PDF_INPUT_SCHEMA = "shot-storyboard-pdf-input.v1";
const PDF_LAYOUT_SCHEMA = "shot-storyboard-layout.v1";
const PDF_SUMMARY_SCHEMA = "shot-storyboard-pdf.v1";

function pdfAgentError(code, message, retryable = true, debugPayload = null, validationErrors = null) {
  return pipelineError(code, message, { retryable, debugPayload, validationErrors });
}

function collectShotRefs(shot) {
  const refs = new Set();
  for (const value of [
    shot?.shotRef,
    shot?.sourceShotRef,
    shot?.materialShotRef,
    shot?.groupId,
    shot?.sourceGroupId,
    shot?.shotId,
  ]) {
    const text = normalizeText(value);
    if (text) refs.add(text);
  }
  for (const key of ["sourceRefs", "shotRefs", "materialRefs"]) {
    const values = Array.isArray(shot?.[key]) ? shot[key] : [];
    values.map((item) => normalizeText(item)).filter(Boolean).forEach((item) => refs.add(item));
  }
  return Array.from(refs);
}

function summarizeManifest(manifest) {
  const shots = Array.isArray(manifest?.shots) ? manifest.shots : [];
  return {
    shotCount: shots.length,
    generatedShotCount: shots.filter((shot) => shot?.shouldGenerate).length,
    materialShotCount: shots.filter((shot) => !shot?.shouldGenerate).length,
    slotCount: countManifestSlots(shots),
    groupCount: Array.isArray(manifest?.storyboardGroups) ? manifest.storyboardGroups.length : 0,
    warningCount: Array.isArray(manifest?.warnings) ? manifest.warnings.length : 0,
  };
}

function countManifestSlots(shots) {
  let count = 0;
  let previous = null;
  for (const shot of Array.isArray(shots) ? shots : []) {
    const slotKey = normalizeText(shot?.slotKey) ?? normalizeText(shot?.slotSubtype) ?? "unknown_slot";
    if (slotKey !== previous) count += 1;
    previous = slotKey;
  }
  return count;
}

function resolvePathOrUri(value, rootDir, baseDir) {
  const text = normalizeText(value);
  if (!text) return null;
  if (text.startsWith("/runtime/")) return path.join(rootDir, "Runtime", text.slice("/runtime/".length));
  if (text.startsWith("runtime/")) return path.join(rootDir, "Runtime", text.slice("runtime/".length));
  return path.isAbsolute(text) || /^[A-Za-z]:[\\/]/.test(text)
    ? path.resolve(text)
    : path.resolve(baseDir, text);
}

function firstText(values) {
  for (const value of values) {
    const text = normalizeText(value);
    if (text) return text;
  }
  return null;
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

function safeFilename(value) {
  return String(value ?? "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .trim()
    .replace(/[ .]+$/g, "") || "shot";
}

module.exports = {
  PDF_INPUT_SCHEMA,
  PDF_LAYOUT_SCHEMA,
  PDF_ROLE,
  PDF_STAGE_NAME,
  PDF_SUMMARY_SCHEMA,
  collectShotRefs,
  countManifestSlots,
  firstText,
  pdfAgentError,
  resolvePathOrUri,
  safeFilename,
  summarizeManifest,
  toInteger,
  toNumber,
};
