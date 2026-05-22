const { contentHash, stableJson } = require("./shared");

const INPUT_SCHEMA_VERSION = "script_segment_input.v1";

function buildScriptSegmentContentFingerprint(input) {
  return contentHash(stableJson({
    schemaVersion: INPUT_SCHEMA_VERSION,
    commerceBrief: input?.commerceBrief ?? null,
    shots: Array.isArray(input?.shots)
      ? input.shots.map((shot) => ({
        shotId: shot?.shotId ?? null,
        start: shot?.start ?? null,
        end: shot?.end ?? null,
        summary: shot?.summary ?? null,
        subtitleSummary: shot?.subtitleSummary ?? null,
        ocrSummary: shot?.ocrSummary ?? null,
        audioHintSummary: shot?.audioHintSummary ?? null,
      }))
      : [],
  }));
}

function buildScriptSegmentCacheParams({
  inputFingerprint,
  shotCount,
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
