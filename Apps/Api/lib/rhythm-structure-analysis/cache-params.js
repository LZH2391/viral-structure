const { contentHash, stableJson } = require("./shared");

const INPUT_SCHEMA_VERSION = "rhythm_structure_input.v1";

function buildRhythmStructureContentFingerprint(input, inputPackage = null) {
  return contentHash(stableJson({
    schemaVersion: INPUT_SCHEMA_VERSION,
    shots: Array.isArray(input?.shots)
      ? input.shots.map((shot) => ({
        shotId: shot?.shotId ?? null,
        start: shot?.start ?? null,
        end: shot?.end ?? null,
        summary: shot?.summary ?? null,
        endBoundaryReason: shot?.endBoundaryReason ?? null,
        subtitleText: shot?.subtitleText ?? null,
        subtitleContextText: shot?.subtitleContextText ?? null,
      }))
      : [],
    scriptSegments: Array.isArray(input?.scriptSegments)
      ? input.scriptSegments.map((segment) => ({
        segmentId: segment?.segmentId ?? null,
        label: segment?.label ?? null,
        start: segment?.start ?? null,
        end: segment?.end ?? null,
        shotRefs: segment?.shotRefs ?? [],
        roleSummary: segment?.roleSummary ?? null,
      }))
      : [],
    inputPackage: inputPackage
      ? {
        manifestHash: inputPackage?.hashes?.manifestHash ?? null,
        outputContractHash: inputPackage?.hashes?.outputContractHash ?? null,
        visualManifestHash: inputPackage?.hashes?.visualManifestHash ?? null,
        sheetCount: inputPackage?.sheetCount ?? null,
        emptyShotCount: inputPackage?.emptyShotCount ?? null,
      }
      : null,
  }));
}

function buildRhythmStructureCacheParams({
  inputFingerprint,
  shotCount,
  inputPackageManifestHash,
  visualManifestHash,
  outputContractHash,
  sourceShotArtifactId,
  sourceScriptSegmentArtifactId,
  profileVersion,
  promptTemplateId,
  promptTemplateVersion,
  promptTemplateHash,
  skillHash,
} = {}) {
  return {
    inputSchemaVersion: INPUT_SCHEMA_VERSION,
    inputFingerprint: inputFingerprint ?? null,
    shotCount: Number(shotCount ?? 0),
    inputPackageManifestHash: inputPackageManifestHash ?? null,
    visualManifestHash: visualManifestHash ?? null,
    outputContractHash: outputContractHash ?? null,
    sourceShotArtifactId: sourceShotArtifactId ?? null,
    sourceScriptSegmentArtifactId: sourceScriptSegmentArtifactId ?? null,
    profileVersion: profileVersion ?? null,
    promptTemplateId: promptTemplateId ?? null,
    promptTemplateVersion: promptTemplateVersion ?? null,
    promptTemplateHash: promptTemplateHash ?? null,
    skillHash: skillHash ?? null,
  };
}

module.exports = {
  INPUT_SCHEMA_VERSION,
  buildRhythmStructureContentFingerprint,
  buildRhythmStructureCacheParams,
};

