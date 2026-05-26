const { contentHash, stableJson } = require("./shared");

const INPUT_SCHEMA_VERSION = "function_slot_atomization_input.v1";

function buildFunctionSlotAtomizationContentFingerprint(input) {
  return contentHash(stableJson({
    schemaVersion: INPUT_SCHEMA_VERSION,
    sourceScriptSegmentArtifactId: input?.sourceScriptSegmentArtifactId ?? null,
    sourceRhythmStructureArtifactId: input?.sourceRhythmStructureArtifactId ?? null,
    sourcePackagingStructureArtifactId: input?.sourcePackagingStructureArtifactId ?? null,
    scriptSegments: input?.scriptSegmentAnalysis?.segments ?? [],
    rhythmSections: input?.rhythmStructureAnalysis?.sections ?? [],
    rhythmCards: input?.rhythmStructureAnalysis?.cards ?? [],
    packagingBlocks: input?.packagingStructureAnalysis?.packagingBlocks ?? [],
    shotPackagingNotes: input?.packagingStructureAnalysis?.shotPackagingNotes ?? [],
    claimStack: input?.packagingStructureAnalysis?.claimStack ?? [],
    proofStack: input?.packagingStructureAnalysis?.proofStack ?? [],
    conversionWrap: input?.packagingStructureAnalysis?.conversionWrap ?? null,
  }));
}

function buildFunctionSlotAtomizationCacheParams({
  inputFingerprint,
  sourceScriptSegmentArtifactId,
  sourceRhythmStructureArtifactId,
  sourcePackagingStructureArtifactId,
  profileVersion,
  promptTemplateId,
  promptTemplateVersion,
  promptTemplateHash,
  skillHash,
} = {}) {
  return {
    inputSchemaVersion: INPUT_SCHEMA_VERSION,
    inputFingerprint: inputFingerprint ?? null,
    sourceScriptSegmentArtifactId: sourceScriptSegmentArtifactId ?? null,
    sourceRhythmStructureArtifactId: sourceRhythmStructureArtifactId ?? null,
    sourcePackagingStructureArtifactId: sourcePackagingStructureArtifactId ?? null,
    profileVersion: profileVersion ?? null,
    promptTemplateId: promptTemplateId ?? null,
    promptTemplateVersion: promptTemplateVersion ?? null,
    promptTemplateHash: promptTemplateHash ?? null,
    skillHash: skillHash ?? null,
  };
}

module.exports = {
  INPUT_SCHEMA_VERSION,
  buildFunctionSlotAtomizationContentFingerprint,
  buildFunctionSlotAtomizationCacheParams,
};
