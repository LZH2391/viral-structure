const fs = require("fs/promises");
const path = require("path");
const {
  ARTIFACT_TYPE,
  GOVERNANCE_LOOKUP_INDEX_RELATIVE_PATH,
  GOVERNANCE_MATERIALIZED_RELATIVE_PATH,
  GOVERNANCE_RELATIVE_PATH,
  SLOT_INDEX_RELATIVE_PATH,
  STAGES,
  VALIDATION_RELATIVE_PATH,
} = require("./governance-constants");
const {
  codedError,
  parseValidationIssues,
  readJson,
  runProcess,
  safePreview,
  writeJson,
} = require("./governance-utils");
const { writeGovernanceLookupIndex } = require("./governance-lookup-index");
const {
  readGovernanceFile,
  readGovernanceFileSnapshot,
  restoreGovernanceFileSnapshot,
  writeSplitGovernanceFile,
} = require("./governance-store");

function createGovernanceFileOps({ rootDir, python, skillScriptDir, referenceDir }) {
  async function refreshEvidence() {
    const validation = await runBuilderScript("validate_corpus.py", [rootDir, "--out", path.join(rootDir, VALIDATION_RELATIVE_PATH)], { allowNonZero: true });
    const slotIndex = await runBuilderScript("build_slot_index.py", [rootDir, "--out", path.join(rootDir, SLOT_INDEX_RELATIVE_PATH)]);
    const skeleton = await runBuilderScript("build_governance_skeleton.py", [rootDir, "--formal-out", "--update-existing"]);
    const slotIndexJson = await readJson(path.join(rootDir, SLOT_INDEX_RELATIVE_PATH));
    return {
      validation: { exitCode: validation.exitCode, path: VALIDATION_RELATIVE_PATH, stderr: safePreview(validation.stderr) },
      slotIndex: { path: SLOT_INDEX_RELATIVE_PATH, sampleCount: slotIndexJson.summary?.sampleCount ?? null },
      governance: { path: GOVERNANCE_RELATIVE_PATH, stdout: safePreview(skeleton.stdout) },
    };
  }

  async function prepareGovernanceInput() {
    const governancePath = path.join(rootDir, GOVERNANCE_RELATIVE_PATH);
    const slotIndexPath = path.join(rootDir, SLOT_INDEX_RELATIVE_PATH);
    const [governance, slotIndex] = await Promise.all([readGovernanceFile(governancePath), readJson(slotIndexPath)]);
    await writeJson(path.join(rootDir, GOVERNANCE_MATERIALIZED_RELATIVE_PATH), governance);
    return {
      governance,
      slotIndex,
      governancePath: GOVERNANCE_RELATIVE_PATH,
      materializedGovernancePath: GOVERNANCE_MATERIALIZED_RELATIVE_PATH,
      slotIndexPath: SLOT_INDEX_RELATIVE_PATH,
      semanticProtocolPath: relativeReference("semantic-governance-protocol.md"),
      atomBindingRuleProtocolPath: relativeReference("atom-binding-rule-governance.md"),
      outputFormatPath: relativeReference("governance-output-format.md"),
    };
  }

  async function readGovernanceSnapshot() {
    return readGovernanceFileSnapshot(path.join(rootDir, GOVERNANCE_RELATIVE_PATH));
  }

  async function readGovernanceObject() {
    return readGovernanceFile(path.join(rootDir, GOVERNANCE_RELATIVE_PATH));
  }

  async function restoreGovernanceSnapshot(snapshot) {
    await restoreGovernanceFileSnapshot(snapshot);
  }

  async function validateGovernanceObject(governance) {
    if (!governance || governance.schemaVersion !== "function_slot_semantic_governance.v1") {
      return { ok: false, code: "governance_schema_invalid", message: "schemaVersion 不支持", issues: [] };
    }
    const governancePath = path.join(rootDir, GOVERNANCE_RELATIVE_PATH);
    await writeSplitGovernanceFile(governancePath, governance);
    const result = await runBuilderScript("validate_governance.py", [rootDir], { allowNonZero: true });
    return {
      ok: result.exitCode === 0,
      code: result.exitCode === 0 ? null : "governance_validation_failed",
      message: result.exitCode === 0 ? "ok" : "validate_governance.py failed",
      issues: parseValidationIssues(result.stdout || result.stderr),
      stdout: safePreview(result.stdout, 1200),
      stderr: safePreview(result.stderr, 1200),
    };
  }

  async function writeGovernanceArtifact(context, governance, validation, agentArtifact) {
    await writeSplitGovernanceFile(path.join(rootDir, GOVERNANCE_RELATIVE_PATH), governance);
    const lookupIndex = await writeGovernanceLookupIndex(path.join(rootDir, GOVERNANCE_LOOKUP_INDEX_RELATIVE_PATH), governance);
    return {
      artifactId: context.artifactId,
      parentArtifactId: null,
      artifactType: ARTIFACT_TYPE,
      type: ARTIFACT_TYPE,
      stageName: STAGES.materialize,
      runId: context.traceContext.runId,
      traceId: context.traceContext.traceId,
      stageId: context.traceContext.stageId,
      governanceId: governance.governanceId ?? null,
      outputPath: GOVERNANCE_RELATIVE_PATH,
      sourceIndex: SLOT_INDEX_RELATIVE_PATH,
      lookupIndexPath: GOVERNANCE_LOOKUP_INDEX_RELATIVE_PATH,
      coverage: governance.coverage ?? {},
      lookupIndex: {
        itemCount: lookupIndex.summary.itemCount,
        variantCount: lookupIndex.summary.variantCount,
        reviewVariantCount: lookupIndex.summary.reviewVariantCount,
      },
      validation: {
        ok: validation.ok,
        issueCount: validation.issues.length,
      },
      agent: agentArtifact,
      createdAt: new Date().toISOString(),
    };
  }

  async function runBuilderScript(scriptName, args, { allowNonZero = false } = {}) {
    const scriptPath = path.join(skillScriptDir, scriptName);
    const result = await runProcess(python, [scriptPath, ...args], { cwd: rootDir });
    if (result.exitCode !== 0 && !allowNonZero) {
      throw codedError("function_slot_governance_script_failed", `${scriptName} failed with ${result.exitCode}`, {
        scriptName,
        exitCode: result.exitCode,
        stdout: safePreview(result.stdout, 800),
        stderr: safePreview(result.stderr, 800),
      });
    }
    return result;
  }

  function relativeReference(fileName) {
    return path.relative(rootDir, path.join(referenceDir, fileName)).replace(/\\/g, "/");
  }

  return {
    refreshEvidence,
    prepareGovernanceInput,
    readGovernanceSnapshot,
    readGovernanceObject,
    restoreGovernanceSnapshot,
    validateGovernanceObject,
    writeGovernanceArtifact,
  };
}

module.exports = {
  createGovernanceFileOps,
};
