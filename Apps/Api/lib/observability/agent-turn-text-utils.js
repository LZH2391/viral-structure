function safePreview(value, maxLength) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}...`;
}

function stringOrNull(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function nullableNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nullablePositiveNumber(value) {
  const number = nullableNumber(value);
  return number != null && number > 0 ? number : null;
}

function byteLength(value) {
  if (!value) return null;
  return Buffer.byteLength(String(value), "utf8");
}

function summarizeJson(value) {
  if (value == null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function summarizeDynamicToolContent(contentItems) {
  if (!Array.isArray(contentItems)) return null;
  return contentItems.map((item) => extractText(item)).filter(Boolean).join("\n") || null;
}

function summarizeFileChanges(changes) {
  if (!Array.isArray(changes)) return null;
  return changes.map((change) => {
    const path = change?.path ?? change?.filePath ?? change?.relativePath ?? change?.uri ?? null;
    const kind = change?.type ?? change?.kind ?? change?.status ?? null;
    return [kind, path].filter(Boolean).join(" ");
  }).filter(Boolean).join("\n") || null;
}

module.exports = {
  byteLength,
  nullableNumber,
  nullablePositiveNumber,
  safePreview,
  stringOrNull,
  summarizeDynamicToolContent,
  summarizeFileChanges,
  summarizeJson,
};
