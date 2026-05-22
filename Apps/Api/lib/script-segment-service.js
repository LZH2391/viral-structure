const path = require("path");
const { randomUUID } = require("crypto");
const { createTraceContext, SAMPLE_STATUS } = require("../../../Core/Workspace/sample-video-contracts");
const { createTraceIds, nextStage } = require("../../../Infrastructure/Observability/trace");
const { loadRoleProfileByRole, renderTurnTemplate, sha256 } = require("./role-profile-loader");

const ROLE = "script-segment-analyzer";
const SKILL_PATH = "C:/ByteDanceFullStack/.agents/skills/script-segment-analyzer/SKILL.md";

const STAGES = {
  inputPrepared: "script_segment.input_prepare",
  analyzed: "script_segment.analyze",
  validated: "script_segment.validate",
  repaired: "script_segment.repair",
  materialized: "script_segment.materialize",
};

const MAX_SEGMENTS = 8;
const MAX_EVIDENCE_PER_SEGMENT = 3;
const MAX_TEXT_FIELD_LENGTH = 120;
const MAX_UNCERTAINTIES = 5;

function createScriptSegmentService({ store, logger, jobStore, artifactIndex }) {
  async function enqueue({ sampleVideoId }) {
    await store.ensureRuntimeDirs();
    const artifact = await loadArtifact(sampleVideoId, store);
    const traceContext = createTraceContext(createTraceIds());
    const job = jobStore.createJob({ sampleVideoId, traceId: traceContext.traceId });
    const roleProfile = await loadRoleProfileByRole(ROLE);
    const context = {
      sampleVideoId,
      artifact,
      traceContext,
      job,
      roleProfile,
      activeStage: null,
      scriptArtifactId: `artifact_${randomUUID()}`,
    };
    run(context).catch(() => undefined);
    return { processingJobId: job.jobId, sampleVideoId, traceId: traceContext.traceId };
  }

  async function run(context) {
    try {
      const input = await runStage(context, STAGES.inputPrepared, 20, {
        artifactId: context.scriptArtifactId,
        parentArtifactId: context.artifact.shotBoundaryAnalysis?.artifactId ?? context.artifact.sampleVideo?.artifactId ?? null,
        inputSummary: {
          sampleVideoId: context.sampleVideoId,
          shotCount: context.artifact.shotBoundaryAnalysis?.shots?.length ?? 0,
          hasCommerceBrief: Boolean(context.artifact.shotBoundaryAnalysis?.commerceBrief),
        },
        action: () => prepareInput(context.artifact),
        outputSummary: (result) => ({
          shotCount: result.shots.length,
          hasCommerceBrief: Boolean(result.commerceBrief),
          parentArtifactId: result.parentArtifactId,
        }),
      });

      const analyzed = await runStage(context, STAGES.analyzed, 55, {
        artifactId: context.scriptArtifactId,
        parentArtifactId: input.parentArtifactId,
        inputSummary: {
          shotCount: input.shots.length,
          hasCommerceBrief: Boolean(input.commerceBrief),
          promptTemplateVersion: context.roleProfile?.turnTemplates?.analyze?.templateVersion ?? null,
        },
        action: () => analyzeSegments(input, context.roleProfile, context.traceContext.traceId),
        outputSummary: (result) => ({
          segmentCount: result.segments.length,
          promptTemplateVersion: result.agent?.promptTemplateVersion ?? null,
        }),
      });

      let validated = await runStage(context, STAGES.validated, 75, {
        artifactId: analyzed.artifactId,
        parentArtifactId: analyzed.parentArtifactId,
        inputSummary: {
          segmentCount: analyzed.segments.length,
          sourceShotBoundaryArtifactId: analyzed.sourceShotBoundaryArtifactId ?? null,
        },
        action: () => validateSegments(analyzed),
        outputSummary: (result) => ({
          status: result.validation.status,
          segmentCount: result.segments.length,
          validatorCode: result.validation.validatorCode,
        }),
      });

      if (validated.validation.status !== "passed") {
        validated = await runStage(context, STAGES.repaired, 88, {
          artifactId: validated.artifactId,
          parentArtifactId: validated.parentArtifactId,
          inputSummary: {
            validatorCode: validated.validation.validatorCode,
            segmentCount: validated.segments.length,
            promptTemplateVersion: context.roleProfile?.turnTemplates?.repair?.templateVersion ?? null,
          },
          action: () => repairSegments(validated, context.roleProfile, context.traceContext.traceId),
          outputSummary: (result) => ({
            status: result.validation.status,
            segmentCount: result.segments.length,
            repairAttemptCount: result.validation.repairAttemptCount,
          }),
        });
      }

      const materializedArtifact = await runStage(context, STAGES.materialized, 96, {
        artifactId: validated.artifactId,
        parentArtifactId: validated.parentArtifactId,
        inputSummary: {
          segmentCount: validated.segments.length,
          validatorCode: validated.validation.validatorCode,
        },
        action: async () => {
          const nextArtifact = await attachScriptSegments(context.sampleVideoId, validated, {
            traceId: context.traceContext.traceId,
            sourceTraceId: context.artifact.trace?.traceId ?? null,
          }, store);
          await artifactIndex.registerSampleArtifact({
            artifact: nextArtifact,
            fileHash: await resolveExistingFileHash(context.sampleVideoId, artifactIndex),
            traceId: context.traceContext.traceId,
          });
          return nextArtifact;
        },
        outputSummary: (artifact) => ({
          segmentCount: artifact.scriptSegmentAnalysis?.segments?.length ?? 0,
          scriptArtifactId: artifact.scriptSegmentAnalysis?.artifactId ?? null,
        }),
      });

      jobStore.updateJob(context.job.jobId, {
        stage: SAMPLE_STATUS.processed,
        status: SAMPLE_STATUS.processed,
        progress: 100,
        errorSummary: null,
      });
      return materializedArtifact;
    } catch (error) {
      await markFailed(context, error);
      return null;
    }
  }

  async function runStage(context, stageName, progress, options) {
    context.traceContext = nextStage(context.traceContext);
    const startedAt = Date.now();
    context.activeStage = {
      stageName,
      artifactId: options.artifactId ?? null,
      parentArtifactId: options.parentArtifactId ?? null,
      inputSummary: options.inputSummary ?? null,
      outputSummary: null,
      startedAt,
    };
    jobStore.updateJob(context.job.jobId, { stage: stageName, status: SAMPLE_STATUS.processing, progress, errorSummary: null });
    await logger.writeStageLog({
      traceContext: context.traceContext,
      stageName,
      event: "stage.start",
      artifactId: context.activeStage.artifactId,
      parentArtifactId: context.activeStage.parentArtifactId,
      inputSummary: context.activeStage.inputSummary,
    });
    const result = await options.action();
    const outputSummary = options.outputSummary ? options.outputSummary(result) : null;
    context.activeStage.outputSummary = outputSummary;
    await logger.writeStageLog({
      traceContext: context.traceContext,
      stageName,
      event: "stage.end",
      artifactId: context.activeStage.artifactId,
      parentArtifactId: context.activeStage.parentArtifactId,
      outputSummary,
      durationMs: Date.now() - startedAt,
    });
    context.activeStage = null;
    return result;
  }

  async function markFailed(context, error) {
    const activeStage = context.activeStage ?? {
      stageName: STAGES.analyzed,
      artifactId: context.scriptArtifactId,
      parentArtifactId: context.artifact?.shotBoundaryAnalysis?.artifactId ?? context.artifact?.sampleVideo?.artifactId ?? null,
      inputSummary: {
        sampleVideoId: context.sampleVideoId,
      },
      outputSummary: null,
      startedAt: Date.now(),
    };
    const safe = {
      code: error?.code ?? "script_segment_failed",
      message: error instanceof Error ? error.message : "脚本段落分析失败",
      stageName: activeStage.stageName,
      retryable: typeof error?.retryable === "boolean" ? error.retryable : true,
    };
    const snapshot = await logger.writeDebugSnapshot({
      traceContext: context.traceContext,
      stageName: activeStage.stageName,
      artifactId: activeStage.artifactId,
      parentArtifactId: activeStage.parentArtifactId,
      reason: safe.code,
      inputSummary: activeStage.inputSummary,
      outputSummary: activeStage.outputSummary,
      debugPayload: {
        code: safe.code,
        message: safe.message,
        validation: error?.debugPayload ?? null,
      },
    });
    const errorSummary = { ...safe, debugSnapshotUri: snapshot.uri };
    await logger.writeStageLog({
      traceContext: context.traceContext,
      stageName: activeStage.stageName,
      event: "stage.fail",
      artifactId: activeStage.artifactId,
      parentArtifactId: activeStage.parentArtifactId,
      outputSummary: activeStage.outputSummary,
      durationMs: activeStage.startedAt ? Date.now() - activeStage.startedAt : null,
      errorSummary,
    });
    jobStore.updateJob(context.job.jobId, {
      stage: activeStage.stageName,
      status: SAMPLE_STATUS.failed,
      progress: 100,
      errorSummary,
    });
    context.activeStage = null;
  }

  return { enqueue };
}

function prepareInput(artifact) {
  const shotBoundary = artifact?.shotBoundaryAnalysis;
  const shots = Array.isArray(shotBoundary?.shots) ? shotBoundary.shots : [];
  if (!shots.length) {
    const error = new Error("当前样例没有可分析的切镜结果");
    error.code = "script_segment_missing_shots";
    error.retryable = false;
    throw error;
  }
  return {
    sampleVideoId: artifact.sampleVideoId,
    parentArtifactId: shotBoundary?.artifactId ?? artifact.sampleVideo?.artifactId ?? null,
    commerceBrief: normalizeCommerceBrief(shotBoundary?.commerceBrief ?? null),
    shots: shots.map((shot) => ({
      shotId: String(shot.id),
      start: normalizeNumber(shot.start, 0),
      end: normalizeNumber(shot.end, normalizeNumber(shot.start, 0)),
      summary: normalizeText(shot.summary ?? shot.reason ?? "镜头内容"),
      reason: normalizeText(shot.reason),
    })),
  };
}

function analyzeSegments(input, roleProfile, traceId) {
  const prompt = buildAnalyzePrompt(input, roleProfile);
  const segments = buildSegments(input.shots, input.commerceBrief);
  const promptHash = sha256(prompt.text ?? "");
  return createScriptSegmentArtifact({
    input,
    segments,
    traceId,
    provider: "local-heuristic",
    promptTemplateId: prompt.promptTemplateId,
    promptTemplateVersion: prompt.promptTemplateVersion,
    promptTemplateHash: prompt.promptTemplateHash ?? promptHash,
    promptHash,
    repairAttemptCount: 0,
    validatorCode: null,
    status: "pending",
  });
}

function validateSegments(artifact) {
  const normalizedSegments = normalizeSegments(artifact.segments);
  if (!normalizedSegments.length) {
    return {
      ...artifact,
      segments: [],
      validation: {
        status: "failed",
        segmentCount: 0,
        validatorCode: "script_segment_empty",
        repairAttemptCount: artifact.validation?.repairAttemptCount ?? 0,
      },
    };
  }
  const invalidOrder = normalizedSegments.some((segment, index) => {
    if (segment.start >= segment.end) return true;
    if (index === 0) return false;
    return segment.start < normalizedSegments[index - 1].end;
  });
  const missingShotRefs = normalizedSegments.some((segment) => !segment.shotRefs.length);
  const validatorCode = invalidOrder
    ? "script_segment_invalid_time_range"
    : missingShotRefs
      ? "script_segment_missing_shot_refs"
      : null;
  return {
    ...artifact,
    segments: normalizedSegments,
    validation: {
      status: validatorCode ? "failed" : "passed",
      segmentCount: normalizedSegments.length,
      validatorCode,
      repairAttemptCount: artifact.validation?.repairAttemptCount ?? 0,
    },
  };
}

function repairSegments(artifact, roleProfile, traceId) {
  const prompt = buildRepairPrompt(artifact, roleProfile);
  const repairedSegments = normalizeSegments(artifact.segments).map((segment, index, all) => {
    const previousEnd = index === 0 ? null : all[index - 1].end;
    const start = previousEnd != null && segment.start < previousEnd ? previousEnd : segment.start;
    const end = segment.end <= start ? start + 0.001 : segment.end;
    return {
      ...segment,
      start: round(start),
      end: round(end),
      needReview: true,
    };
  });
  const promptHash = sha256(prompt.text ?? "");
  return {
    ...artifact,
    segments: repairedSegments,
    validation: {
      status: "passed",
      segmentCount: repairedSegments.length,
      validatorCode: null,
      repairAttemptCount: (artifact.validation?.repairAttemptCount ?? 0) + 1,
    },
    agent: {
      ...(artifact.agent ?? {}),
      provider: "local-heuristic",
      role: ROLE,
      skillPath: SKILL_PATH,
      promptTemplateId: prompt.promptTemplateId,
      promptTemplateVersion: prompt.promptTemplateVersion,
      promptTemplateHash: prompt.promptTemplateHash ?? promptHash,
      turnId: traceId,
    },
  };
}

function buildAnalyzePrompt(input, roleProfile) {
  const manifestJson = stableJson({
    sampleVideoId: input.sampleVideoId,
    commerceBrief: input.commerceBrief,
    shots: input.shots,
  });
  const values = {
    manifestJson,
    outputContractJson: stableJson(buildOutputContract()),
  };
  return roleProfile?.turnTemplates?.analyze
    ? renderTurnTemplate(roleProfile, "analyze", values)
    : {
      promptTemplateId: "analyze",
      promptTemplateVersion: "analyze.v1",
      promptTemplateHash: sha256(`${manifestJson}\n${values.outputContractJson}`),
      text: manifestJson,
    };
}

function buildRepairPrompt(artifact, roleProfile) {
  const manifestJson = stableJson({
    sampleVideoId: artifact.sampleVideoId ?? null,
    commerceBrief: artifact.commerceBrief ?? null,
    sourceShotBoundaryArtifactId: artifact.sourceShotBoundaryArtifactId ?? null,
    segments: artifact.segments,
  });
  const values = {
    repairAttemptCount: String((artifact.validation?.repairAttemptCount ?? 0) + 1),
    manifestJson,
    validationJson: stableJson(artifact.validation ?? null),
    priorOutputSummaryJson: stableJson({
      segmentCount: artifact.segments?.length ?? 0,
      labels: Array.isArray(artifact.segments) ? artifact.segments.map((segment) => segment.label ?? null) : [],
    }),
    outputContractJson: stableJson(buildOutputContract()),
  };
  return roleProfile?.turnTemplates?.repair
    ? renderTurnTemplate(roleProfile, "repair", values)
    : {
      promptTemplateId: "repair",
      promptTemplateVersion: "repair.v1",
      promptTemplateHash: sha256(`${manifestJson}\n${values.validationJson}`),
      text: manifestJson,
    };
}

function buildSegments(shots, commerceBrief) {
  const totalShots = shots.length;
  const labels = ["开场引题", "卖点展开", "收束转化"];
  const roles = [
    "先建立停留理由，说明为什么继续看。",
    "展开核心证明，让观众理解价值与逻辑。",
    "收束表达并形成转化动作或记忆点。",
  ];
  const ranges = resolveRanges(totalShots);
  return ranges.map(([startIndex, endIndex], index) => {
    const part = shots.slice(startIndex, endIndex + 1);
    const first = part[0];
    const last = part[part.length - 1];
    return {
      segmentId: `segment_${index + 1}`,
      label: labels[index] ?? `段落 ${index + 1}`,
      roleInScript: roles[index] ?? "承接样例表达中的一段结构功能",
      shotRefs: part.map((shot) => shot.shotId),
      evidence: part
        .map((shot) => shot.summary)
        .filter(Boolean)
        .slice(0, MAX_EVIDENCE_PER_SEGMENT),
      transferableRule: buildTransferableRule(index, commerceBrief),
      confidence: resolveConfidence(index, totalShots),
      needReview: part.some((shot) => !shot.summary),
      start: first.start,
      end: last.end,
    };
  });
}

function resolveRanges(totalShots) {
  if (totalShots <= 0) return [];
  if (totalShots === 1) return [[0, 0]];
  if (totalShots === 2) return [[0, 0], [1, 1]];
  const firstEnd = Math.max(0, Math.ceil(totalShots * 0.25) - 1);
  const secondEnd = Math.max(firstEnd + 1, Math.ceil(totalShots * 0.7) - 1);
  return [
    [0, firstEnd],
    [firstEnd + 1, Math.min(secondEnd, totalShots - 2)],
    [Math.min(secondEnd + 1, totalShots - 1), totalShots - 1],
  ].filter(([start, end]) => start <= end);
}

function createScriptSegmentArtifact({
  input,
  segments,
  traceId,
  provider,
  promptTemplateId,
  promptTemplateVersion,
  promptTemplateHash,
  promptHash,
  repairAttemptCount,
  validatorCode,
  status,
}) {
  return {
    artifactId: `artifact_${randomUUID()}`,
    parentArtifactId: input.parentArtifactId,
    type: "script-segment-analysis",
    status: status === "pending" ? "processed" : status,
    stageName: STAGES.materialized,
    sampleVideoId: input.sampleVideoId,
    sourceShotBoundaryArtifactId: input.parentArtifactId,
    commerceBrief: input.commerceBrief ?? null,
    segments: normalizeSegments(segments),
    validation: {
      status: validatorCode ? "failed" : "passed",
      segmentCount: segments.length,
      validatorCode,
      repairAttemptCount,
    },
    agent: {
      provider,
      role: ROLE,
      skillPath: SKILL_PATH,
      skillHash: sha256(SKILL_PATH),
      threadId: null,
      leaseId: null,
      turnId: traceId,
      promptTemplateId,
      promptTemplateVersion,
      promptTemplateHash,
      promptHash,
    },
    reason: null,
    debugSnapshotUri: null,
    createdAt: new Date().toISOString(),
  };
}

function normalizeSegments(segments) {
  if (!Array.isArray(segments)) return [];
  return segments
    .slice(0, MAX_SEGMENTS)
    .map((segment, index) => normalizeSegment(segment, index))
    .filter(Boolean);
}

function normalizeSegment(segment, index) {
  const start = normalizeNumber(segment?.start, null);
  const end = normalizeNumber(segment?.end, null);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return {
    segmentId: normalizeText(segment?.segmentId) || `segment_${index + 1}`,
    label: normalizeText(segment?.label) || `段落 ${index + 1}`,
    roleInScript: normalizeText(segment?.roleInScript) || "承接样例表达中的一段结构功能",
    shotRefs: normalizeStringArray(segment?.shotRefs, MAX_SEGMENTS),
    evidence: normalizeStringArray(segment?.evidence, MAX_EVIDENCE_PER_SEGMENT),
    transferableRule: normalizeText(segment?.transferableRule) || "保留这段结构功能，替换成新内容表达。",
    confidence: normalizeConfidence(segment?.confidence),
    needReview: Boolean(segment?.needReview),
    start: round(start),
    end: round(end),
  };
}

function normalizeCommerceBrief(brief) {
  if (!brief || typeof brief !== "object") return null;
  const normalized = {
    sellingObject: normalizeText(brief.sellingObject),
    proofApproach: normalizeText(brief.proofApproach),
    promisedOutcome: normalizeText(brief.promisedOutcome),
    persuasionTarget: normalizeText(brief.persuasionTarget),
    conversionAction: normalizeText(brief.conversionAction),
    uncertainties: normalizeStringArray(brief.uncertainties, MAX_UNCERTAINTIES),
  };
  if (
    !normalized.sellingObject
    && !normalized.proofApproach
    && !normalized.promisedOutcome
    && !normalized.persuasionTarget
    && !normalized.conversionAction
    && !normalized.uncertainties.length
  ) {
    return null;
  }
  return normalized;
}

function normalizeStringArray(value, maxLength) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeText(item))
    .filter(Boolean)
    .slice(0, maxLength);
}

function normalizeText(value) {
  return String(value ?? "").trim().slice(0, MAX_TEXT_FIELD_LENGTH);
}

function normalizeNumber(value, fallback) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function normalizeConfidence(value) {
  const next = Number(value);
  if (!Number.isFinite(next)) return 0.72;
  return Math.max(0, Math.min(1, round(next)));
}

function resolveConfidence(index, totalShots) {
  if (totalShots <= 1) return 0.78;
  if (index === 0 || index === 2) return 0.74;
  return 0.79;
}

function buildTransferableRule(index, commerceBrief) {
  if (index === 0) return `先用${commerceBrief?.promisedOutcome || "结果或问题"}建立停留理由，再进入解释。`;
  if (index === 1) return `中段持续用证据证明${commerceBrief?.sellingObject || "核心卖点"}，不要只重复口号。`;
  return `结尾回收到${commerceBrief?.conversionAction || "明确行动"}，形成转化闭环。`;
}

async function attachScriptSegments(sampleVideoId, scriptSegmentAnalysis, traceMeta, store) {
  const artifactPath = path.join(store.sampleDir(sampleVideoId), "artifact.json");
  const artifact = await store.readJson(artifactPath);
  artifact.scriptSegmentAnalysis = scriptSegmentAnalysis;
  await store.writeJson(artifactPath, artifact);
  return artifact;
}

async function loadArtifact(sampleVideoId, store) {
  return store.readJson(path.join(store.sampleDir(sampleVideoId), "artifact.json"));
}

async function resolveExistingFileHash(sampleVideoId, artifactIndex) {
  const item = await artifactIndex.getItem(sampleVideoId).catch(() => null);
  return item?.fileHash ?? null;
}

function round(value) {
  return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : value;
}

function stableJson(value) {
  return JSON.stringify(sortObject(value));
}

function buildOutputContract() {
  return {
    segments: [
      {
        label: "段落名称",
        roleInScript: "该段在样例脚本中的职责",
        shotRefs: ["shot_1"],
        evidence: ["只保留安全摘要"],
        transferableRule: "抽象出的可迁移结构规则",
        confidence: 0.78,
        needReview: false,
      },
    ],
  };
}

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value)
    .sort()
    .reduce((result, key) => {
      result[key] = sortObject(value[key]);
      return result;
    }, {});
}

module.exports = {
  ROLE,
  SKILL_PATH,
  STAGES,
  createScriptSegmentService,
  prepareInput,
  analyzeSegments,
  validateSegments,
  repairSegments,
  buildTransferableRule,
};
