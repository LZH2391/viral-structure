const path = require("path");
const { randomUUID, createHash } = require("crypto");
const { createTraceContext } = require("../../../../Core/Workspace/sample-video-contracts");
const { createTraceIds, nextStage } = require("../../../../Infrastructure/Observability/trace");

const STAGE_NAME = "sample.subtitle.revised";
const MAX_SEGMENT_TEXT_LENGTH = 240;

function createSubtitleRevisionService({ store, logger, artifactIndex }) {
  async function saveRevision({ sampleVideoId, segments, expectedSubtitleArtifactId = null, expectedRevisionIndex = null }) {
    const traceContext = createTraceContext(createTraceIds());
    const context = {
      sampleVideoId,
      traceContext,
      activeStage: null,
    };

    try {
      const artifactPath = path.join(store.sampleDir(sampleVideoId), "artifact.json");
      const artifact = await store.readJson(artifactPath).catch(() => null);
      if (!artifact) throw badRequestError("sample_artifact_not_found", "样例产物不存在");
      if (!artifact.subtitles || artifact.subtitles.type !== "subtitle-track") {
        throw badRequestError("subtitle_artifact_missing", "当前样例没有可编辑字幕");
      }

      const currentSubtitles = artifact.subtitles;
      assertExpectedSubtitleRevision(currentSubtitles, { expectedSubtitleArtifactId, expectedRevisionIndex });
      const normalizedSegments = normalizeSubtitleSegments(segments, artifact.metadata?.durationSeconds);
      if (!normalizedSegments.length) throw badRequestError("subtitle_segments_empty", "字幕列表不能为空");
      if (!hasSubtitleChanges(currentSubtitles.segments, normalizedSegments)) {
        return { sampleArtifact: artifact, traceId: traceContext.traceId, changed: false };
      }

      const revisionOfArtifactId = currentSubtitles.revisionOfArtifactId ?? currentSubtitles.artifactId ?? null;
      const revisionIndex = resolveNextRevisionIndex(currentSubtitles);
      const inputSummary = {
        sampleVideoId,
        sourceSubtitleArtifactId: currentSubtitles.artifactId ?? null,
        expectedSubtitleArtifactId,
        expectedRevisionIndex,
        revisionOfArtifactId,
        requestedSegmentCount: normalizedSegments.length,
        nextRevisionIndex: revisionIndex,
      };

      return runStage(context, {
        stageName: STAGE_NAME,
        artifactId: `artifact_${randomUUID()}`,
        parentArtifactId: currentSubtitles.artifactId ?? artifact.sampleVideo?.artifactId ?? null,
        inputSummary,
        action: async () => {
          const nextSubtitleArtifact = buildRevisedSubtitleArtifact({
            artifactId: context.activeStage.artifactId,
            currentSubtitles,
            normalizedSegments,
            revisionOfArtifactId,
            revisionIndex,
            traceId: context.traceContext.traceId,
          });
          const nextArtifact = {
            ...artifact,
            subtitles: nextSubtitleArtifact,
            subtitlesRevisionHistory: appendRevisionHistory(artifact.subtitlesRevisionHistory, currentSubtitles, artifact.trace?.traceId ?? null),
          };
          await store.writeJson(artifactPath, nextArtifact);
          const item = await artifactIndex.getItem(sampleVideoId).catch(() => null);
          await artifactIndex.registerSampleArtifact({
            artifact: nextArtifact,
            fileHash: item?.fileHash ?? null,
            traceId: context.traceContext.traceId,
          });
          return { sampleArtifact: nextArtifact, subtitleArtifact: nextSubtitleArtifact, changed: true };
        },
        outputSummary: ({ sampleArtifact, subtitleArtifact }) => ({
          subtitleArtifactId: subtitleArtifact.artifactId,
          parentArtifactId: subtitleArtifact.parentArtifactId ?? null,
          revisionOfArtifactId: subtitleArtifact.revisionOfArtifactId ?? null,
          revisionIndex: subtitleArtifact.revisionIndex ?? 0,
          source: subtitleArtifact.source ?? null,
          segmentCount: subtitleArtifact.segments?.length ?? 0,
          textHash: subtitleArtifact.textHash ?? null,
          historyCount: sampleArtifact.subtitlesRevisionHistory?.length ?? 0,
        }),
      });
    } catch (error) {
      throw await markFailed(context, error);
    }
  }

  async function runStage(context, options) {
    context.traceContext = nextStage(context.traceContext);
    const startedAt = Date.now();
    context.activeStage = {
      stageName: options.stageName,
      artifactId: options.artifactId ?? null,
      parentArtifactId: options.parentArtifactId ?? null,
      inputSummary: options.inputSummary ?? null,
      outputSummary: null,
      startedAt,
    };
    await logger.writeStageLog({
      traceContext: context.traceContext,
      stageName: options.stageName,
      event: "stage.start",
      artifactId: options.artifactId ?? null,
      parentArtifactId: options.parentArtifactId ?? null,
      inputSummary: options.inputSummary ?? null,
    });
    const result = await options.action();
    const outputSummary = options.outputSummary ? options.outputSummary(result) : null;
    context.activeStage.outputSummary = outputSummary;
    await logger.writeStageLog({
      traceContext: context.traceContext,
      stageName: options.stageName,
      event: "stage.end",
      artifactId: options.artifactId ?? null,
      parentArtifactId: options.parentArtifactId ?? null,
      outputSummary,
      durationMs: Date.now() - startedAt,
    });
    context.activeStage = null;
    return { ...result, traceId: context.traceContext.traceId };
  }

  async function markFailed(context, error) {
    context.traceContext = context.traceContext?.stageId ? context.traceContext : createTraceContext(createTraceIds());
    if (!context.activeStage) {
      context.traceContext = nextStage(context.traceContext);
      context.activeStage = {
        stageName: STAGE_NAME,
        artifactId: null,
        parentArtifactId: null,
        inputSummary: {
          sampleVideoId: context.sampleVideoId,
          requestedSegmentCount: Array.isArray(error?.debugPayload?.segmentIds) ? error.debugPayload.segmentIds.length : null,
        },
        outputSummary: null,
        startedAt: Date.now(),
      };
    }
    const safe = buildErrorSummary(error, context.activeStage.stageName);
    const snapshot = await logger.writeDebugSnapshot({
      traceContext: context.traceContext,
      stageName: context.activeStage.stageName,
      artifactId: context.activeStage.artifactId,
      parentArtifactId: context.activeStage.parentArtifactId,
      reason: safe.code,
      inputSummary: context.activeStage.inputSummary,
      outputSummary: context.activeStage.outputSummary,
      debugPayload: buildDebugPayload(error, context.activeStage.inputSummary),
    });
    const errorSummary = { ...safe, debugSnapshotUri: snapshot.uri };
    await logger.writeStageLog({
      traceContext: context.traceContext,
      stageName: context.activeStage.stageName,
      event: "stage.fail",
      artifactId: context.activeStage.artifactId,
      parentArtifactId: context.activeStage.parentArtifactId,
      outputSummary: context.activeStage.outputSummary,
      durationMs: context.activeStage.startedAt ? Date.now() - context.activeStage.startedAt : null,
      errorSummary,
    });
    context.activeStage = null;
    return apiError(errorSummary, context.traceContext.traceId);
  }

  return { saveRevision };
}

function normalizeSubtitleSegments(segments, durationSeconds) {
  if (!Array.isArray(segments)) throw badRequestError("subtitle_segments_invalid", "字幕列表格式不正确");
  const safeDuration = Number.isFinite(Number(durationSeconds)) && Number(durationSeconds) > 0 ? Number(durationSeconds) : Number.POSITIVE_INFINITY;
  return segments.map((segment, index) => normalizeSubtitleSegment(segment, index, safeDuration));
}

function normalizeSubtitleSegment(segment, index, durationSeconds) {
  if (!segment || typeof segment !== "object") {
    throw badRequestError("subtitle_segment_invalid", "字幕片段格式不正确", { segmentIndex: index });
  }
  const id = String(segment.id ?? "").trim();
  if (!id) throw badRequestError("subtitle_segment_id_missing", "字幕片段缺少 id", { segmentIndex: index });
  const text = String(segment.text ?? "").trim().slice(0, MAX_SEGMENT_TEXT_LENGTH);
  if (!text) throw badRequestError("subtitle_text_empty", "字幕文本不能为空", { segmentId: id, segmentIndex: index });
  const start = roundTime(segment.start);
  const end = roundTime(segment.end);
  if (!Number.isFinite(start) || start < 0) throw badRequestError("subtitle_start_invalid", "字幕开始时间不合法", { segmentId: id, segmentIndex: index, start });
  if (!Number.isFinite(end) || end <= start) throw badRequestError("subtitle_end_invalid", "字幕结束时间必须大于开始时间", { segmentId: id, segmentIndex: index, start, end });
  if (Number.isFinite(durationSeconds) && end > durationSeconds) {
    throw badRequestError("subtitle_time_out_of_range", "字幕时间超出样例时长", { segmentId: id, segmentIndex: index, end, durationSeconds: roundTime(durationSeconds) });
  }
  return {
    id,
    start,
    end,
    text,
    confidence: Number.isFinite(Number(segment.confidence)) ? Number(segment.confidence) : null,
  };
}

function buildRevisedSubtitleArtifact({
  artifactId,
  currentSubtitles,
  normalizedSegments,
  revisionOfArtifactId,
  revisionIndex,
  traceId,
}) {
  const textHash = buildSubtitleTextHash(normalizedSegments);
  return {
    artifactId,
    parentArtifactId: currentSubtitles.artifactId ?? null,
    revisionOfArtifactId,
    source: "manual_edit",
    revisionIndex,
    textHash,
    traceId,
    createdAt: new Date().toISOString(),
    type: "subtitle-track",
    uri: null,
    summary: `${normalizedSegments.length} 条字幕`,
    segments: normalizedSegments,
    status: "processed",
    reason: null,
    debugSnapshotUri: null,
  };
}

function appendRevisionHistory(history, subtitles, fallbackTraceId) {
  const next = Array.isArray(history) ? history.slice() : [];
  if (!subtitles?.artifactId) return next;
  if (next.some((entry) => entry?.artifactId === subtitles.artifactId)) return next;
  next.push({
    artifactId: subtitles.artifactId,
    parentArtifactId: subtitles.parentArtifactId ?? null,
    revisionOfArtifactId: subtitles.revisionOfArtifactId ?? subtitles.artifactId ?? null,
    segmentCount: Array.isArray(subtitles.segments) ? subtitles.segments.length : 0,
    textHash: subtitles.textHash ?? buildSubtitleTextHash(subtitles.segments ?? []),
    traceId: subtitles.traceId ?? fallbackTraceId ?? null,
    createdAt: subtitles.createdAt ?? new Date().toISOString(),
  });
  return next;
}

function hasSubtitleChanges(currentSegments, nextSegments) {
  const current = Array.isArray(currentSegments) ? currentSegments : [];
  if (current.length !== nextSegments.length) return true;
  for (let index = 0; index < current.length; index += 1) {
    const left = current[index];
    const right = nextSegments[index];
    if (!left || !right) return true;
    if (String(left.id ?? "") !== String(right.id ?? "")) return true;
    if (roundTime(left.start) !== roundTime(right.start)) return true;
    if (roundTime(left.end) !== roundTime(right.end)) return true;
    if (String(left.text ?? "").trim() !== String(right.text ?? "").trim()) return true;
  }
  return false;
}

function resolveNextRevisionIndex(subtitles) {
  const current = Number(subtitles?.revisionIndex);
  return Number.isInteger(current) && current >= 0 ? current + 1 : 1;
}

function buildSubtitleTextHash(segments) {
  const value = (Array.isArray(segments) ? segments : [])
    .map((segment) => `${segment.id}:${roundTime(segment.start)}-${roundTime(segment.end)}:${String(segment.text ?? "").trim()}`)
    .join("\n");
  return value ? createHash("sha256").update(value).digest("hex").slice(0, 16) : null;
}

function roundTime(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 1000) / 1000 : Number.NaN;
}

function buildErrorSummary(error, stageName) {
  return {
    code: error?.code ?? "subtitle_revision_failed",
    message: error?.safeSummary ?? (error instanceof Error ? error.message : "字幕保存失败"),
    stageName,
    retryable: typeof error?.retryable === "boolean" ? error.retryable : true,
    statusCode: Number.isInteger(error?.statusCode) ? error.statusCode : null,
  };
}

function buildDebugPayload(error, inputSummary) {
  return {
    errorSummary: {
      code: error?.code ?? "subtitle_revision_failed",
      message: error instanceof Error ? error.message : "字幕保存失败",
    },
    inputSummary,
    validation: error?.debugPayload ?? null,
    causeName: error?.name ?? null,
  };
}

function assertExpectedSubtitleRevision(currentSubtitles, options) {
  const expectedArtifactId = options?.expectedSubtitleArtifactId ?? null;
  const expectedRevisionIndex = Number.isInteger(options?.expectedRevisionIndex) ? options.expectedRevisionIndex : null;
  if (expectedArtifactId === null && expectedRevisionIndex === null) return;
  const currentArtifactId = currentSubtitles?.artifactId ?? null;
  const currentRevisionIndex = Number.isInteger(currentSubtitles?.revisionIndex) ? currentSubtitles.revisionIndex : 0;
  if (expectedArtifactId === currentArtifactId && expectedRevisionIndex === currentRevisionIndex) return;
  const error = new Error("字幕版本已变化，请刷新后重试");
  error.code = "subtitle_revision_conflict";
  error.safeSummary = "字幕版本已变化，请刷新后重试";
  error.retryable = true;
  error.statusCode = 409;
  error.debugPayload = {
    expectedSubtitleArtifactId: expectedArtifactId,
    expectedRevisionIndex,
    currentSubtitleArtifactId: currentArtifactId,
    currentRevisionIndex,
  };
  throw error;
}

function badRequestError(code, message, debugPayload = null) {
  const error = new Error(message);
  error.code = code;
  error.safeSummary = message;
  error.retryable = false;
  error.statusCode = 400;
  error.debugPayload = debugPayload;
  return error;
}

function apiError(errorSummary, traceId) {
  const error = new Error(errorSummary.message || "字幕保存失败");
  error.code = errorSummary.code;
  error.statusCode = errorSummary.statusCode ?? (errorSummary.retryable === false ? 400 : 500);
  error.debugSnapshotUri = errorSummary.debugSnapshotUri ?? null;
  error.stageName = errorSummary.stageName ?? STAGE_NAME;
  error.traceId = traceId ?? null;
  error.retryable = errorSummary.retryable ?? true;
  return error;
}

module.exports = {
  STAGE_NAME,
  createSubtitleRevisionService,
  normalizeSubtitleSegments,
  buildSubtitleTextHash,
  appendRevisionHistory,
  assertExpectedSubtitleRevision,
};
