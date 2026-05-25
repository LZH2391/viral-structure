const { contentHash, stableJson } = require("./shared");

const INPUT_SCHEMA_VERSION = "packaging_structure_input.v1";

function buildPackagingStructureContentFingerprint(input, inputPackage = null) {
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
    commerceBrief: input?.commerceBrief ?? null,
    audioEventCandidates: Array.isArray(input?.audioEventCandidates)
      ? input.audioEventCandidates.map((candidate) => ({
        time: candidate?.time ?? null,
        start: candidate?.start ?? null,
        end: candidate?.end ?? null,
        kind: candidate?.kind ?? null,
        confidence: candidate?.confidence ?? null,
        usableForEdit: candidate?.usableForEdit ?? null,
        evidence: candidate?.evidence ?? null,
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

function buildPackagingStructureCacheParams({
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
  buildPackagingStructureContentFingerprint,
  buildPackagingStructureCacheParams,
};


