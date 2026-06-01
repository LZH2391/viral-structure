const fs = require("fs/promises");
const path = require("path");
const { createHash, randomUUID } = require("crypto");
const { nextStage } = require("../../../../Infrastructure/Observability/trace");
const { loadRoleProfileByRole, renderTurnTemplate } = require("../gateways/threadpool/role-profile-loader");
const {
  STAGE_NAME: TRANSFORM_STAGE_NAME,
  buildAgentRepairRequest,
  transformRestructureFinalFile,
} = require("../../../../Infrastructure/FunctionSlotRestructureDisplay/markdown-transformer");

const AUTO_STAGE_NAME = "function.slot.restructure_display.auto_transform";
const REPAIR_ROLE = "function-slot-restructure-display-transformer";
const MAX_REPAIR_ATTEMPTS = 2;

async function maybeAutoTransformRestructureResult({
  payload,
  handlers,
  traceContext,
  conversationId,
  url = null,
} = {}) {
  if (!isCompleted(payload?.status)) return null;
  if (!String(payload?.finalMessage ?? "").trim()) return null;
  if (!conversationId) return null;

  const conversation = await handlers.agentConversationStore?.get?.(conversationId);
  if (conversation?.role !== "function-slot-restructure") return null;
  const finalMessage = String(payload.finalMessage ?? "");
  const explicitPath = normalizeText(url?.searchParams?.get("restructureFinalPath"));
  const currentMessagePath = explicitPath || extractRestructureFinalPath(finalMessage);
  const historicalPath = currentMessagePath ? null : findLatestRestructureFinalPath(conversation);
  const linkedRestructureFinalPath = currentMessagePath || historicalPath;
  if (!linkedRestructureFinalPath) return null;

  const rootDir = handlers.rootDir;
  const logger = handlers.logger;
  if (!rootDir || !logger) return null;

  const stageTraceContext = nextStage(traceContext);
  const artifactId = `artifact_${randomUUID()}`;
  const parentArtifactId = normalizeText(url?.searchParams?.get("parentArtifactId")) ?? null;
  const sourceMode = currentMessagePath ? "linkedFile" : "conversationHistory";
  const restructureFinalPath = resolveRestructureFinalPath({
    rootDir,
    finalMessage,
    explicitPath: linkedRestructureFinalPath,
    conversationId,
    turnId: payload.turnId,
  });
  const displayJsonPath = path.join(path.dirname(restructureFinalPath), "restructure.display.json");
  const repairRequestPath = path.join(path.dirname(restructureFinalPath), "restructure.display.repair-request.json");
  const previousFingerprint = findLatestDisplayFingerprint(conversation, safeRelative(rootDir, restructureFinalPath));
  const trigger = "file_changed";
  const inputSummary = {
    conversationId,
    turnId: payload.turnId ?? null,
    finalMessageChars: String(payload.finalMessage ?? "").length,
    restructureFinalPath: safeRelative(rootDir, restructureFinalPath),
    displayJsonPath: safeRelative(rootDir, displayJsonPath),
    sourceMode,
    previousFingerprint,
  };
  const startedAt = Date.now();

  await logger.writeStageLog({
    traceContext: stageTraceContext,
    stageName: AUTO_STAGE_NAME,
    event: "stage.start",
    artifactId,
    parentArtifactId,
    inputSummary,
  });

  try {
    const fileFingerprint = await readRestructureFinalFingerprint(restructureFinalPath, rootDir);
    if (fingerprintsEqual(fileFingerprint, previousFingerprint)) {
      const outputSummary = {
        artifactId,
        status: "skipped_unchanged",
        restructureFinalPath: safeRelative(rootDir, restructureFinalPath),
        displayJsonPath: safeRelative(rootDir, displayJsonPath),
        sourceMode,
        trigger: "file_unchanged",
        fileFingerprint,
      };
      await logger.writeStageLog({
        traceContext: stageTraceContext,
        stageName: AUTO_STAGE_NAME,
        event: "stage.end",
        artifactId,
        parentArtifactId,
        outputSummary,
        durationMs: Date.now() - startedAt,
      });
      return {
        ok: true,
        status: "skipped_unchanged",
        artifactId,
        traceId: stageTraceContext.traceId,
        runId: stageTraceContext.runId,
        stageId: stageTraceContext.stageId,
        stageName: AUTO_STAGE_NAME,
        restructureFinalPath: safeRelative(rootDir, restructureFinalPath),
        displayJsonPath: safeRelative(rootDir, displayJsonPath),
        sourceMode,
        trigger: "file_unchanged",
        fileFingerprint,
      };
    }
    const transformResult = await transformWithRepair({
      handlers,
      rootDir,
      restructureFinalPath,
      displayJsonPath,
      repairRequestPath,
      artifactId,
      parentArtifactId,
      sourceTurnId: payload.turnId,
      stageTraceContext,
    });
    const displayJson = transformResult.displayJson;
    const outputSummary = {
      artifactId,
      status: "processed",
      transformStageName: TRANSFORM_STAGE_NAME,
      restructureFinalPath: safeRelative(rootDir, restructureFinalPath),
      displayJsonPath: safeRelative(rootDir, displayJsonPath),
      sectionCount: displayJson.sourceTextDigest.sectionCount,
      missingSections: displayJson.missingSections,
      repairAttemptCount: transformResult.repairAttemptCount,
      sourceMode,
      trigger,
      fileFingerprint,
    };
    await logger.writeStageLog({
      traceContext: stageTraceContext,
      stageName: AUTO_STAGE_NAME,
      event: "stage.end",
      artifactId,
      parentArtifactId,
      outputSummary,
      durationMs: Date.now() - startedAt,
    });
    return {
      ok: true,
      status: "processed",
      artifactId,
      traceId: stageTraceContext.traceId,
      runId: stageTraceContext.runId,
      stageId: stageTraceContext.stageId,
      stageName: AUTO_STAGE_NAME,
      restructureFinalPath: safeRelative(rootDir, restructureFinalPath),
      displayJsonPath: safeRelative(rootDir, displayJsonPath),
      missingSections: displayJson.missingSections,
      repairAttemptCount: transformResult.repairAttemptCount,
      repairTurns: transformResult.repairTurns,
      sourceMode,
      trigger,
      slotAtomDisplay: buildSlotAtomDisplaySummary(displayJson, {
        displayJsonPath: safeRelative(rootDir, displayJsonPath),
        fileFingerprint,
      }),
    };
  } catch (error) {
    if (!error.repairRequestWritten) {
      const repairRequest = buildAgentRepairRequest({
        error,
        inputPath: safeRelative(rootDir, restructureFinalPath),
        outputPath: safeRelative(rootDir, displayJsonPath),
        restructureArtifactId: artifactId,
      });
      await fs.mkdir(path.dirname(repairRequestPath), { recursive: true });
      await fs.writeFile(repairRequestPath, `${JSON.stringify(repairRequest, null, 2)}\n`, "utf8");
    }
    const safeError = {
      code: error?.code ?? "restructure_display_auto_transform_failed",
      message: safePreview(error instanceof Error ? error.message : "结构展示自动转换失败", 240),
      retryable: true,
    };
    const snapshot = await logger.writeDebugSnapshot({
      traceContext: stageTraceContext,
      stageName: AUTO_STAGE_NAME,
      artifactId,
      parentArtifactId,
      reason: safeError.code,
      inputSummary,
      outputSummary: null,
      debugPayload: {
        code: safeError.code,
        message: safeError.message,
        validationErrors: error?.validationErrors ?? null,
        repairRequestPath: safeRelative(rootDir, repairRequestPath),
      },
    });
    await logger.writeStageLog({
      traceContext: stageTraceContext,
      stageName: AUTO_STAGE_NAME,
      event: "stage.fail",
      artifactId,
      parentArtifactId,
      errorSummary: { ...safeError, debugSnapshotUri: snapshot.uri },
      durationMs: Date.now() - startedAt,
    });
    return {
      ok: false,
      status: "repair_required",
      artifactId,
      traceId: stageTraceContext.traceId,
      runId: stageTraceContext.runId,
      stageId: stageTraceContext.stageId,
      stageName: AUTO_STAGE_NAME,
      restructureFinalPath: safeRelative(rootDir, restructureFinalPath),
      repairRequestPath: safeRelative(rootDir, repairRequestPath),
      repairAttemptCount: error.repairAttemptCount ?? 0,
      error: safeError.code,
      message: safeError.message,
      debugSnapshotUri: snapshot.uri,
    };
  }
}

async function transformWithRepair({
  handlers,
  rootDir,
  restructureFinalPath,
  displayJsonPath,
  repairRequestPath,
  artifactId,
  parentArtifactId,
  sourceTurnId,
  stageTraceContext,
}) {
  const repairTurns = [];
  let lastError = null;
  let transformInputPath = restructureFinalPath;
  for (let attempt = 0; attempt <= MAX_REPAIR_ATTEMPTS; attempt += 1) {
    try {
      const displayJson = await transformRestructureFinalFile({
        inputPath: transformInputPath,
        outputPath: displayJsonPath,
        restructureArtifactId: artifactId,
      });
      return {
        displayJson,
        repairAttemptCount: attempt,
        repairTurns,
      };
    } catch (error) {
      lastError = error;
      if (attempt >= MAX_REPAIR_ATTEMPTS) break;
      const repairAttemptCount = attempt + 1;
      const repairRequest = buildAgentRepairRequest({
        error,
        inputPath: safeRelative(rootDir, transformInputPath),
        outputPath: safeRelative(rootDir, displayJsonPath),
        restructureArtifactId: artifactId,
        repairAttemptCount,
      });
      await fs.writeFile(repairRequestPath, `${JSON.stringify(repairRequest, null, 2)}\n`, "utf8");
      const repair = await runFormatRepairTurn({
        handlers,
        rootDir,
        repairRequest,
        repairAttemptCount,
        restructureFinalPath,
        artifactId,
        parentArtifactId,
        sourceTurnId,
        stageTraceContext,
      });
      const repairedPath = path.join(path.dirname(restructureFinalPath), `restructure.final.repair-attempt-${repairAttemptCount}.md`);
      await fs.writeFile(repairedPath, normalizeFinalMarkdown(repair.repairedMarkdown), "utf8");
      transformInputPath = repairedPath;
      repairTurns.push({
        ...repair.summary,
        repairedPath: safeRelative(rootDir, repairedPath),
      });
    }
  }
  if (lastError) {
    lastError.repairAttemptCount = MAX_REPAIR_ATTEMPTS;
    lastError.repairRequestWritten = true;
  }
  throw lastError;
}

async function runFormatRepairTurn({
  handlers,
  rootDir,
  repairRequest,
  repairAttemptCount,
  restructureFinalPath,
  artifactId,
  parentArtifactId,
  sourceTurnId,
  stageTraceContext,
}) {
  if (!handlers.threadPool?.ensureRoleReady || !handlers.threadPool?.acquireLease || !handlers.threadPool?.releaseLease || !handlers.appServer?.runTurnWithInputs) {
    const error = new Error("agentRepair requires ThreadPool lease and appServer runTurnWithInputs");
    error.code = "restructure_display_agent_repair_unavailable";
    throw error;
  }
  const roleProfile = await loadRoleProfileByRole(REPAIR_ROLE);
  const sourceMarkdown = await fs.readFile(restructureFinalPath, "utf8");
  const prompt = renderTurnTemplate(roleProfile, "repairTurn", {
    repairAttemptCount,
    restructureFinalPath: repairRequest.source.restructureFinalPath ?? safeRelative(rootDir, restructureFinalPath),
    restructureArtifactId: repairRequest.source.restructureArtifactId ?? artifactId,
    parentArtifactId: parentArtifactId ?? "",
    sourceTurnId: sourceTurnId ?? "",
    stageName: AUTO_STAGE_NAME,
    errorCode: repairRequest.errorCode,
    errorMessage: repairRequest.errorMessage,
    debugSnapshotUri: "",
    validationErrorsJson: JSON.stringify(repairRequest.validationErrors ?? []),
    repairTargetsJson: JSON.stringify(repairRequest.repairTargets ?? []),
    scriptInputJson: JSON.stringify({
      restructureFinalPath: safeRelative(rootDir, restructureFinalPath),
      repairAttemptCount,
      maxRepairAttempts: MAX_REPAIR_ATTEMPTS,
    }),
    sourceSnippet: buildRepairSnippet(sourceMarkdown, repairRequest.repairTargets),
  });
  const ownerId = `restructure-display-repair-${stageTraceContext.runId}`;
  const readiness = await handlers.threadPool.ensureRoleReady(REPAIR_ROLE);
  if (!readiness?.ok) {
    const error = new Error(readiness?.message || "display repair role unavailable");
    error.code = readiness?.error || "restructure_display_repair_role_unavailable";
    throw error;
  }
  const lease = await handlers.threadPool.acquireLease({ role: REPAIR_ROLE, ownerId });
  const threadId = lease.thread_id ?? lease.threadId;
  if (!threadId) {
    const error = new Error("display repair lease missing threadId");
    error.code = "restructure_display_repair_thread_missing";
    throw error;
  }
  try {
    const turn = await handlers.appServer.runTurnWithInputs({
      workspaceRoot: rootDir,
      threadId,
      skillPath: readiness.status?.skillPath ?? roleProfile.skillPath ?? null,
      inputs: [{ type: "text", text: prompt.text, text_elements: [] }],
      timeoutSeconds: 180,
    });
    const repairedMarkdown = normalizeRepairMarkdown(turn.finalMessage ?? "");
    return {
      repairedMarkdown,
      summary: {
        repairAttemptCount,
        role: REPAIR_ROLE,
        threadId,
        turnId: turn.turnId ?? turn.turn?.id ?? null,
        status: turn.status ?? null,
        promptTemplateVersion: prompt.promptTemplateVersion,
      },
    };
  } finally {
    await handlers.threadPool.releaseLease({ leaseId: lease.lease_id ?? lease.leaseId, ownerId }).catch(() => null);
  }
}

async function assertReadableRestructureFinal(restructureFinalPath) {
  try {
    await fs.access(restructureFinalPath);
  } catch (error) {
    const wrapped = new Error("restructure.final.md does not exist for linked agent response");
    wrapped.code = "restructure_final_link_target_missing";
    wrapped.statusCode = 404;
    wrapped.retryable = false;
    wrapped.cause = error;
    throw wrapped;
  }
}

function findLatestRestructureFinalPath(conversation) {
  const messages = Array.isArray(conversation?.messages) ? conversation.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const pathFromMessage = extractRestructureFinalPath(messages[index]?.text);
    if (pathFromMessage) return pathFromMessage;
  }
  return normalizeText(conversation?.confirmedPlan?.sourceRestructurePath);
}

function findLatestDisplayFingerprint(conversation, restructureFinalPath) {
  const messages = Array.isArray(conversation?.messages) ? conversation.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const fingerprint = messages[index]?.slotAtomDisplay?.fileFingerprint;
    if (fingerprint?.path === restructureFinalPath) return fingerprint;
  }
  return null;
}

async function readRestructureFinalFingerprint(filePath, rootDir) {
  const content = await fs.readFile(filePath);
  const stat = await fs.stat(filePath);
  return {
    path: safeRelative(rootDir, filePath),
    size: stat.size,
    mtimeMs: Math.trunc(stat.mtimeMs),
    sha256: createHash("sha256").update(content).digest("hex"),
  };
}

function fingerprintsEqual(left, right) {
  if (!left || !right) return false;
  return left.path === right.path
    && left.size === right.size
    && left.sha256 === right.sha256;
}

function resolveRestructureFinalPath({ rootDir, finalMessage, explicitPath, conversationId, turnId }) {
  const inferred = explicitPath || extractRestructureFinalPath(finalMessage);
  const relativePath = inferred
    ? normalizeRelativeArtifactPath(inferred, rootDir)
    : path.join("Artifacts", "FunctionSlotRestructure", safeSlug(conversationId || turnId || "agent-chat"), "restructure.final.md");
  const resolved = path.resolve(rootDir, relativePath);
  const root = path.resolve(rootDir);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    const error = new Error("restructure.final.md path is outside workspace");
    error.code = "restructure_final_path_outside_workspace";
    throw error;
  }
  return resolved;
}

function extractRestructureFinalPath(finalMessage) {
  const text = String(finalMessage ?? "");
  const saved = text.match(/保存路径[：:]\s*`([^`]+restructure\.final\.md)`/i);
  if (saved?.[1]) return saved[1];
  const artifactPath = text.match(/(Artifacts[\\/]+FunctionSlotRestructure[^\n`]*?restructure\.final\.md)/i);
  return artifactPath?.[1] ?? null;
}

function normalizeRelativeArtifactPath(value, rootDir) {
  const text = String(value ?? "").trim().replaceAll("\\", "/");
  if (!text) return null;
  const absolute = path.isAbsolute(text) || /^[A-Za-z]:\//.test(text);
  if (!absolute) return text;
  return path.relative(rootDir, path.resolve(text)).replaceAll(path.sep, "/");
}

function normalizeFinalMarkdown(value) {
  const text = String(value ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trimEnd();
  return `${text}\n`;
}

function normalizeRepairMarkdown(value) {
  const text = String(value ?? "").trim();
  const fenced = text.match(/^```(?:markdown|md)?\s*([\s\S]*?)\s*```$/i);
  return fenced?.[1] ?? text;
}

function buildRepairSnippet(markdown, repairTargets = []) {
  const lines = String(markdown ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const lineNumbers = (repairTargets ?? []).map((target) => Number(target.line)).filter((line) => Number.isFinite(line) && line > 0);
  if (!lineNumbers.length) return lines.slice(0, 240).join("\n");
  const ranges = [];
  for (const line of lineNumbers) {
    const start = Math.max(1, line - 8);
    const end = Math.min(lines.length, line + 12);
    ranges.push([start, end]);
  }
  const merged = [];
  for (const [start, end] of ranges.sort((left, right) => left[0] - right[0])) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged.map(([start, end]) => lines.slice(start - 1, end).join("\n")).join("\n\n...\n\n");
}

function isCompleted(status) {
  return String(status ?? "").toLowerCase() === "completed";
}

function buildSlotAtomDisplaySummary(displayJson, { displayJsonPath = null, fileFingerprint = null } = {}) {
  const slotRows = firstTableRows(displayJson?.sections?.finalSlotChain);
  const atomRows = firstTableRows(displayJson?.sections?.atomLandingTable);
  const slots = slotRows.map((row, index) => {
    const slotSubtype = rowValue(row, ["slotSubtype", "槽位", "slot subtype"]);
    const archetype = rowValue(row, ["parent archetype", "archetype"]);
    return {
      index: numberOrFallback(rowValue(row, ["顺序", "序号"]), index + 1),
      demand: rowValue(row, ["需求"]),
      slotSubtype,
      slotSubtypeId: extractBacktickId(slotSubtype),
      archetype,
      archetypeId: extractBacktickId(archetype),
      functionText: rowValue(row, ["链路功能", "功能"]),
      usage: rowValue(row, ["本方案用法", "用法"]),
      reason: rowValue(row, ["选择理由", "理由"]),
    };
  });
  const atoms = atomRows.map((row) => {
    const slotSubtype = rowValue(row, ["槽位", "slotSubtype"]);
    return {
      slotSubtype,
      slotSubtypeId: extractBacktickId(slotSubtype),
      source: rowValue(row, ["来源"]),
      scriptAtom: rowValueContains(row, "script atom"),
      rhythmAtom: rowValueContains(row, "rhythm atom"),
      packagingAtom: rowValueContains(row, "packaging atom"),
      handling: rowValue(row, ["atom 处理", "处理"]),
    };
  });
  return {
    schemaVersion: "function_slot_restructure_slot_atom_display.v1",
    status: slots.length || atoms.length ? "available" : "empty",
    displayJsonPath,
    slotCount: slots.length,
    atomBindingCount: atoms.length,
    selectedSlotSubtypeId: slots[0]?.slotSubtypeId ?? atoms[0]?.slotSubtypeId ?? null,
    fileFingerprint,
    slots,
    atoms,
  };
}

function firstTableRows(section) {
  const table = (section?.items ?? []).find((item) => item?.type === "table" && Array.isArray(item.rows));
  return table?.rows ?? [];
}

function rowValue(row, keys) {
  for (const key of keys) {
    if (row?.[key] != null) return String(row[key]);
  }
  const entries = Object.entries(row ?? {});
  const normalizedKeys = keys.map(normalizeKey);
  const found = entries.find(([key]) => normalizedKeys.includes(normalizeKey(key)));
  return found ? String(found[1]) : "";
}

function rowValueContains(row, needle) {
  const normalizedNeedle = normalizeKey(needle);
  const found = Object.entries(row ?? {}).find(([key]) => normalizeKey(key).includes(normalizedNeedle));
  return found ? String(found[1]) : "";
}

function normalizeKey(value) {
  return String(value ?? "").toLowerCase().replace(/[\s_（）()：:·\-]/g, "");
}

function extractBacktickId(value) {
  const match = String(value ?? "").match(/`([^`]+)`/);
  return match?.[1] ?? null;
}

function numberOrFallback(value, fallback) {
  const number = Number(String(value ?? "").match(/\d+/)?.[0]);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function normalizeText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function safeSlug(value) {
  return String(value ?? "").trim().replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "") || "agent-chat";
}

function safeRelative(rootDir, filePath) {
  return path.relative(rootDir, path.resolve(filePath)).replaceAll(path.sep, "/");
}

function safePreview(value, limit = 240) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length <= limit ? text : `${text.slice(0, limit)}...`;
}

module.exports = {
  AUTO_STAGE_NAME,
  MAX_REPAIR_ATTEMPTS,
  extractRestructureFinalPath,
  maybeAutoTransformRestructureResult,
};
