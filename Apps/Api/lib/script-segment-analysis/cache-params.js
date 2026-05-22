const { contentHash, stableJson } = require("./shared");

const INPUT_SCHEMA_VERSION = "script_segment_input.v2";

function buildScriptSegmentContentFingerprint(input, inputPackage = null) {
  return contentHash(stableJson({
    schemaVersion: INPUT_SCHEMA_VERSION,
    commerceBrief: input?.commerceBrief ?? null,
    shots: Array.isArray(input?.shots)
      ? input.shots.map((shot) => ({
        shotId: shot?.shotId ?? null,
        start: shot?.start ?? null,
        end: shot?.end ?? null,
        summary: shot?.summary ?? null,
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

function buildScriptSegmentCacheParams({
  inputFingerprint,
  shotCount,
  inputPackageManifestHash,
  visualManifestHash,
  outputContractHash,
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
    shotCount: Number(shotCount ?? 0),
    inputPackageManifestHash: inputPackageManifestHash ?? null,
    visualManifestHash: visualManifestHash ?? null,
    outputContractHash: outputContractHash ?? null,
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
  buildScriptSegmentContentFingerprint,
  buildScriptSegmentCacheParams,
};
