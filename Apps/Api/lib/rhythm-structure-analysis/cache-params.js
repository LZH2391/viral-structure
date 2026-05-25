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
  sourceShotArtifactId,
  profileVersion,
  promptTemplateId,
  promptTemplateVersion,
  promptTemplateHash,
  skillHash,
} = {}) {
  return {
    inputSchemaVersion: INPUT_SCHEMA_VERSION,
    inputFingerprint: inputFingerprint ?? null,
    sourceShotArtifactId: sourceShotArtifactId ?? null,
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

