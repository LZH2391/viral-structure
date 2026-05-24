function buildRequiredArtifactRefs(refs = {}) {
  return Object.fromEntries(
    Object.entries(refs)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, value ?? null]),
  );
}

function readRequiredArtifactRef(source, key, legacyKey = key) {
  return source?.dependencies?.[key] ?? source?.analysisOptions?.[key] ?? source?.[legacyKey] ?? null;
}

function assertExpectedArtifact({
  expectedArtifactId,
  actualArtifactId,
  conflictError,
  code,
  message,
  expectedKey,
  actualKey,
}) {
  const expected = String(expectedArtifactId ?? "").trim();
  if (!expected) return;
  const actual = String(actualArtifactId ?? "").trim();
  if (actual === expected) return;
  throw conflictError(code, message, {
    [expectedKey]: expected,
    [actualKey]: actual || null,
  });
}

module.exports = {
  assertExpectedArtifact,
  buildRequiredArtifactRefs,
  readRequiredArtifactRef,
};
