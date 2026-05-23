import { useCallback, useEffect, useRef } from "react";
import { getSampleArtifact, saveSubtitleRevision } from "../api/client";
import type { WorkbenchAction } from "../state";
import type { ProcessingJob, SampleArtifact, SubtitleArtifact, SubtitleDraft, WorkbenchState } from "../types";
import { buildSubtitleSaveError } from "../utils/workbenchHelpers";
import type { UiStage } from "../observability/uiStage";
import { createId } from "../utils/format";

const SUBTITLE_SAVE_STAGE = "sample.subtitle.revised";

type SubtitleDraftFlowOptions = {
  state: WorkbenchState;
  dispatch: (action: WorkbenchAction) => void;
  persistWorkbenchArtifact: (artifact: SampleArtifact, traceId: string | null) => void;
  setSaveStatus: (value: string) => void;
  beginStage: (stageName: string, parentArtifactId?: string | null, inputSummary?: unknown) => UiStage;
  finishStage: (stage: UiStage, artifactId?: string, outputSummary?: unknown) => void;
  failStage: (stage: UiStage, error: unknown, details?: Record<string, unknown>) => void;
};

export function useSubtitleDraftFlow(options: SubtitleDraftFlowOptions) {
  const { state, dispatch, persistWorkbenchArtifact, setSaveStatus, beginStage, finishStage, failStage } = options;
  const subtitleSaveTokenRef = useRef(0);
  const subtitleSaveQueueRef = useRef(Promise.resolve(true));
  const subtitleSaveStateRef = useRef({
    sampleVideo: state.sampleVideo,
    subtitles: state.subtitles,
    subtitleDrafts: state.subtitleDrafts,
    processingTraceId: state.processingJob?.traceId ?? null,
  });

  useEffect(() => {
    subtitleSaveStateRef.current = {
      sampleVideo: state.sampleVideo,
      subtitles: state.subtitles,
      subtitleDrafts: state.subtitleDrafts,
      processingTraceId: state.processingJob?.traceId ?? null,
    };
  }, [state.processingJob?.traceId, state.sampleVideo, state.subtitleDrafts, state.subtitles]);

  const buildSubtitleSegmentsForSave = useCallback((subtitles: SubtitleArtifact, drafts: Record<string, SubtitleDraft>) => {
    return subtitles.segments.map((segment) => {
      const draft = drafts[segment.id];
      return draft
        ? {
            id: segment.id,
            start: draft.start,
            end: draft.end,
            text: draft.text,
            confidence: segment.confidence ?? null,
          }
        : {
            id: segment.id,
            start: segment.start,
            end: segment.end,
            text: segment.text,
            confidence: segment.confidence ?? null,
          };
    });
  }, []);

  const isSubtitleDraftChanged = useCallback((artifact: SubtitleArtifact | null | undefined, draft: SubtitleDraft) => {
    const sourceArtifactId = artifact?.artifactId ?? null;
    if (!artifact || draft.sourceArtifactId !== sourceArtifactId) return true;
    const sourceSegment = artifact.segments.find((item) => item.id === draft.segmentId);
    if (!sourceSegment) return true;
    return sourceSegment.text !== draft.text || sourceSegment.start !== draft.start || sourceSegment.end !== draft.end;
  }, []);

  const saveSubtitleDraft = useCallback(async (draft: SubtitleDraft, options: { silent?: boolean; allowConflictRetry?: boolean } = {}) => {
    const currentState = subtitleSaveStateRef.current;
    const subtitles = currentState.subtitles;
    const sampleVideo = currentState.sampleVideo;
    if (!subtitles || !sampleVideo) return { ok: false as const, reason: "missing_subtitles" };
    if (!isSubtitleDraftChanged(subtitles, draft)) {
      dispatch({ type: "clear-subtitle-draft", segmentId: draft.segmentId, saveToken: draft.saveToken ?? null });
      if (!options.silent) setSaveStatus("字幕未变化，无需保存");
      return { ok: true as const, changed: false };
    }
    const stage = beginStage(SUBTITLE_SAVE_STAGE, subtitles.artifactId ?? sampleVideo.artifactId, {
      sampleVideoId: sampleVideo.id,
      sourceSubtitleArtifactId: subtitles.artifactId ?? null,
      segmentId: draft.segmentId,
      queuedDraftCount: Object.keys(currentState.subtitleDrafts).length,
    });
    dispatch({ type: "set-subtitle-draft-status", segmentId: draft.segmentId, saveState: "saving", saveToken: draft.saveToken ?? null });
    try {
      const segments = buildSubtitleSegmentsForSave(subtitles, subtitleSaveStateRef.current.subtitleDrafts);
      const result = await saveSubtitleRevision(sampleVideo.id, segments, {
        expectedSubtitleArtifactId: subtitles.artifactId ?? null,
        expectedRevisionIndex: subtitles.revisionIndex ?? null,
      });
      dispatch({ type: "sync-subtitle-artifact", artifact: result.sampleArtifact });
      dispatch({
        type: "set-subtitle-draft-status",
        segmentId: draft.segmentId,
        saveState: "saved",
        saveToken: draft.saveToken ?? null,
        lastSavedArtifactId: result.sampleArtifact.subtitles?.artifactId ?? null,
      });
      dispatch({ type: "clear-subtitle-draft", segmentId: draft.segmentId, saveToken: draft.saveToken ?? null });
      persistWorkbenchArtifact(result.sampleArtifact, result.traceId ?? subtitleSaveStateRef.current.processingTraceId ?? null);
      setSaveStatus("字幕已自动保存");
      finishStage(stage, result.sampleArtifact.subtitles?.artifactId ?? stage.artifactId, {
        sampleVideoId: result.sampleArtifact.sampleVideoId,
        subtitleArtifactId: result.sampleArtifact.subtitles?.artifactId ?? null,
        revisionIndex: result.sampleArtifact.subtitles?.revisionIndex ?? null,
        changed: result.changed,
      });
      return { ok: true as const, changed: result.changed, artifact: result.sampleArtifact };
    } catch (error) {
      const rawError = error as { code?: string; traceId?: string | null; debugSnapshotUri?: string | null };
      if (rawError?.code === "subtitle_revision_conflict" && options.allowConflictRetry !== false) {
        const latestArtifact = await getSampleArtifact(sampleVideo.id);
        dispatch({ type: "sync-subtitle-artifact", artifact: latestArtifact });
        persistWorkbenchArtifact(latestArtifact, rawError.traceId ?? subtitleSaveStateRef.current.processingTraceId ?? null);
        const refreshedDraft = subtitleSaveStateRef.current.subtitleDrafts[draft.segmentId];
        if (refreshedDraft) {
          return saveSubtitleDraft(refreshedDraft, { ...options, allowConflictRetry: false });
        }
      }
      const normalizedError = buildSubtitleSaveError(error);
      const message = normalizedError.message;
      dispatch({ type: "set-subtitle-draft-status", segmentId: draft.segmentId, saveState: "failed", saveToken: draft.saveToken ?? null, errorMessage: message });
      failStage(stage, normalizedError, {
        errorCode: (normalizedError as { code?: string })?.code,
        errorMessage: message,
        errorStage: SUBTITLE_SAVE_STAGE,
        backendTraceId: (error as { traceId?: string })?.traceId ?? subtitleSaveStateRef.current.processingTraceId ?? null,
        debugSnapshotUri: (error as { debugSnapshotUri?: string })?.debugSnapshotUri ?? null,
        debugPayload: { kind: "subtitle-save-failure", segmentId: draft.segmentId, sourceArtifactId: draft.sourceArtifactId ?? null },
      });
      setSaveStatus(`字幕保存失败：${message}`);
      return { ok: false as const, error: normalizedError };
    }
  }, [beginStage, buildSubtitleSegmentsForSave, dispatch, failStage, finishStage, isSubtitleDraftChanged, persistWorkbenchArtifact, setSaveStatus]);

  const enqueueSubtitleDraftSave = useCallback((draft: SubtitleDraft, options: { silent?: boolean } = {}) => {
    subtitleSaveQueueRef.current = subtitleSaveQueueRef.current
      .catch(() => true)
      .then(async () => {
        const currentDraft = subtitleSaveStateRef.current.subtitleDrafts[draft.segmentId];
        if (!currentDraft || currentDraft.saveToken !== draft.saveToken) return true;
        const result = await saveSubtitleDraft(currentDraft, options);
        return result.ok;
      });
    return subtitleSaveQueueRef.current;
  }, [saveSubtitleDraft]);

  const flushSubtitleDraftsBeforeShotBoundary = useCallback(async () => {
    await subtitleSaveQueueRef.current.catch(() => true);
    const currentState = subtitleSaveStateRef.current;
    const drafts = Object.values(currentState.subtitleDrafts);
    if (!drafts.length) return true;
    for (const draft of drafts) {
      if (!currentState.subtitles || !isSubtitleDraftChanged(currentState.subtitles, draft)) {
        dispatch({ type: "clear-subtitle-draft", segmentId: draft.segmentId, saveToken: draft.saveToken ?? null });
        continue;
      }
      const ok = await enqueueSubtitleDraftSave(draft, { silent: true });
      if (!ok) return false;
    }
    await subtitleSaveQueueRef.current.catch(() => false);
    return !Object.values(subtitleSaveStateRef.current.subtitleDrafts).some((entry) => entry.saveState === "failed");
  }, [dispatch, enqueueSubtitleDraftSave, isSubtitleDraftChanged]);

  const handleSubtitleDraftChange = useCallback((draft: { segmentId: string; text: string; start: number; end: number; sourceArtifactId: string | null }) => {
    const currentSubtitleArtifact = state.subtitles;
    const sourceSegment = currentSubtitleArtifact?.segments.find((item) => item.id === draft.segmentId);
    const changed = !sourceSegment
      || sourceSegment.text !== draft.text
      || sourceSegment.start !== draft.start
      || sourceSegment.end !== draft.end
      || currentSubtitleArtifact?.artifactId !== draft.sourceArtifactId;
    if (!changed) {
      dispatch({ type: "clear-subtitle-draft", segmentId: draft.segmentId });
      setSaveStatus("字幕未变化，无需保存");
      return;
    }
    const saveToken = subtitleSaveTokenRef.current + 1;
    subtitleSaveTokenRef.current = saveToken;
    const nextDraft = {
      ...draft,
      draftVersionId: state.subtitleDrafts[draft.segmentId]?.draftVersionId ?? createId("version"),
      saveToken,
      queuedAt: Date.now(),
      saveState: "idle" as const,
      errorMessage: null,
      lastSavedArtifactId: state.subtitleDrafts[draft.segmentId]?.lastSavedArtifactId ?? null,
    };
    dispatch({ type: "update-subtitle-draft", ...nextDraft });
    void enqueueSubtitleDraftSave(nextDraft);
  }, [dispatch, enqueueSubtitleDraftSave, setSaveStatus, state.subtitleDrafts, state.subtitles]);

  return {
    flushSubtitleDraftsBeforeShotBoundary,
    handleSubtitleDraftChange,
  };
}
