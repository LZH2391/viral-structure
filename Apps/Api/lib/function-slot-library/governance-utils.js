const { spawn } = require("child_process");
const fs = require("fs/promises");
const path = require("path");
const { ROLE } = require("./governance-constants");

function runProcess(command, args, { cwd }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PYTHONIOENCODING: process.env.PYTHONIOENCODING || "utf-8" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", reject);
    child.on("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
}

function buildCoverageSummary(input) {
  const summary = input.slotIndex?.summary ?? {};
  return {
    indexPath: input.slotIndexPath,
    governancePath: input.governancePath,
    sampleCount: summary.sampleCount ?? null,
    slotVariantCount: summary.slotVariantCount ?? null,
    atomVariantCount: summary.atomVariantCount ?? null,
    bindingCount: summary.bindingCount ?? null,
    ruleCount: summary.ruleCount ?? null,
    templateCount: summary.templateCount ?? null,
    currentGovernanceId: input.governance?.governanceId ?? null,
    existingConceptCount: countExistingConcepts(input.governance),
  };
}

function countExistingConcepts(governance) {
  if (!governance) return 0;
  return [
    "slotFamilies",
    "slotArchetypes",
    "slotSubtypes",
    "atomArchetypes",
    "atomPatterns",
    "bindingPatterns",
    "bindingPrinciples",
    "rulePatterns",
    "recompositionPolicies",
    "implementationBundles",
  ].reduce((count, field) => count + (Array.isArray(governance[field]) ? governance[field].length : 0), 0);
}

function buildTurnInputSummary(input, turn) {
  const coverage = buildCoverageSummary(input);
  return {
    ...coverage,
    role: ROLE,
    promptTemplateId: turn.promptTemplateId,
    promptTemplateVersion: turn.promptTemplateVersion,
    promptTemplateHash: turn.promptTemplateHash,
  };
}

function promptTemplateSummary(turn) {
  return {
    promptTemplateId: turn.promptTemplateId,
    promptTemplateVersion: turn.promptTemplateVersion,
    promptTemplateHash: turn.promptTemplateHash,
  };
}

function summarizeGovernanceArtifact(artifact) {
  return {
    artifactId: artifact.artifactId,
    governanceId: artifact.governanceId,
    outputPath: artifact.outputPath,
    sourceIndex: artifact.sourceIndex,
    sampleCount: artifact.coverage?.sampleCount ?? null,
    slotVariantCount: artifact.coverage?.slotVariantCount ?? null,
    validationOk: artifact.validation?.ok ?? false,
  };
}

function parseValidationIssues(text) {
  return String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("[error]") || line.startsWith("[warning]"))
    .slice(0, 40)
    .map((line) => ({ message: line.slice(0, 500) }));
}

function sanitizeDebugPayload(error) {
  const payload = error?.debugPayload ?? {};
  return {
    code: error?.code ?? null,
    message: error instanceof Error ? safePreview(error.message, 300) : safePreview(String(error ?? ""), 300),
    turnId: payload.turnId ?? null,
    status: payload.status ?? null,
    attemptCount: payload.attemptCount ?? null,
    timeoutReason: payload.timeoutReason ?? null,
    validation: payload.validation ? {
      ok: payload.validation.ok ?? null,
      code: payload.validation.code ?? null,
      issueCount: Array.isArray(payload.validation.issues) ? payload.validation.issues.length : null,
      issues: Array.isArray(payload.validation.issues) ? payload.validation.issues.slice(0, 12) : [],
    } : null,
    outputSummary: payload.outputSummary ?? null,
    stdout: safePreview(payload.stdout, 800),
    stderr: safePreview(payload.stderr, 800),
  };
}

function safeErrorMessage(error) {
  if (error?.code === "function_slot_governance_validation_failed") return "语义治理结果未通过校验";
  if (error?.code === "function_slot_governance_parse_failed") return "语义治理 Agent 未返回合法 JSON";
  if (error?.code === "appserver_turn_collect_timeout") return "语义治理 Agent 长时间未返回结果";
  return error?.retryable === false ? (error.message ?? "语义治理失败") : "FunctionSlotLibrary 语义治理失败";
}

function codedError(code, message, debugPayload = null, retryable = true) {
  const error = new Error(message);
  error.code = code;
  error.debugPayload = debugPayload;
  error.retryable = retryable;
  return error;
}

function safePreview(value, limit = 240) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length <= limit ? text : `${text.slice(0, limit)}...`;
}

function extractTurnTokenUsage(turn) {
  const usage = turn?.turnActivity?.tokenUsage ?? turn?.lastTokenUsage ?? turn?.last_token_usage ?? null;
  const modelContextWindow = turn?.modelContextWindow ?? turn?.model_context_window ?? turn?.turnActivity?.modelContextWindow ?? null;
  if (!usage && modelContextWindow == null) return null;
  return {
    last_token_usage: usage ?? {},
    ...(modelContextWindow != null ? { model_context_window: Number(modelContextWindow) } : {}),
  };
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

module.exports = {
  runProcess,
  buildCoverageSummary,
  buildTurnInputSummary,
  promptTemplateSummary,
  summarizeGovernanceArtifact,
  parseValidationIssues,
  sanitizeDebugPayload,
  safeErrorMessage,
  codedError,
  safePreview,
  extractTurnTokenUsage,
  readJson,
  writeJson,
};
