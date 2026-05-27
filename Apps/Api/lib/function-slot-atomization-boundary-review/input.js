const { renderTurnTemplate } = require("../gateways/threadpool/role-profile-loader");
const { buildOutputContract, sanitizeForAppServerText, stableJson } = require("../function-slot-atomization-analysis/shared");
const { contentHash } = require("./shared");

function buildReviewManifest({ context, analysis, finalOutput }) {
  return sanitizeForAppServerText({
    schemaVersion: "function_slot_atomization_boundary_review_input.v1",
    sampleVideoId: context.sampleVideoId,
    finalOutputPath: finalOutput?.filePath ?? null,
    finalOutputManifestPath: finalOutput?.manifestPath ?? null,
    functionSlotAtomizationArtifactId: analysis?.artifactId ?? null,
    analyzer: {
      role: analysis?.agent?.role ?? null,
      threadId: analysis?.agent?.threadId ?? null,
      turnId: analysis?.agent?.turnId ?? null,
      promptTemplateVersion: analysis?.agent?.promptTemplateVersion ?? null,
    },
    sources: {
      sourceScriptSegmentArtifactId: analysis?.sourceScriptSegmentArtifactId ?? null,
      sourceRhythmStructureArtifactId: analysis?.sourceRhythmStructureArtifactId ?? null,
      sourcePackagingStructureArtifactId: analysis?.sourcePackagingStructureArtifactId ?? null,
    },
  });
}

function buildReviewContract() {
  return {
    decision: "pass | rework | blocked",
    reason: "string",
    issues: [{
      issue: "string",
      minimal_fix: "string",
      field_paths: ["string"],
    }],
  };
}

function renderReviewTurnInputs({ context, analysis, finalOutput, roleProfile }) {
  const manifest = buildReviewManifest({ context, analysis, finalOutput });
  const outputContract = buildOutputContract();
  const fieldRoles = outputContract.field_roles;
  const prompt = renderTurnTemplate(roleProfile, "review", {
    manifestJson: stableJson({
      ...manifest,
      outputContract: buildReviewContract(),
    }),
    fieldRolesJson: stableJson(fieldRoles),
  });
  return {
    ...prompt,
    inputs: sanitizeForAppServerText([{ type: "text", text: prompt.text, text_elements: [] }]),
    manifest,
    fieldRoles,
    fieldRolesHash: contentHash(stableJson(fieldRoles)),
  };
}

module.exports = {
  buildReviewManifest,
  buildReviewContract,
  renderReviewTurnInputs,
};
