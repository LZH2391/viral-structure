import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { getFullAnalysisBatchRun, getSampleArtifact, getWorkflowRun } from "../../api/client";
import type { FullAnalysisBatchRun, ProcessingJob, SampleArtifact, WorkflowRun } from "../../types";
import { writeFullAnalysisBatchDraft, writeFullAnalysisDraft } from "../../utils/fullAnalysisDraft";
import { isBatchTerminal } from "./FullAnalysisBatchPanel";
import { NON_EXECUTING_RUN_STATUS, statusLabel } from "./fullAnalysisState";
import { POLL_INTERVAL_MS, TERMINAL_SETTLE_POLL_COUNT, hasSettledArtifactForRun } from "./fullAnalysisWorkflowModel";

type PollingOptions = {
  active: boolean;
  pageTitle: string;
  draftStorageKey?: string;
  run: WorkflowRun | null;
  batchRun: FullAnalysisBatchRun | null;
  operationTokenRef: MutableRefObject<number>;
  selectedBatchItemIdRef: MutableRefObject<string | null>;
  setRun: Dispatch<SetStateAction<WorkflowRun | null>>;
  setArtifact: Dispatch<SetStateAction<SampleArtifact | null>>;
  setStatusText: Dispatch<SetStateAction<string>>;
  setErrorText: Dispatch<SetStateAction<string | null>>;
  setBatchRun: Dispatch<SetStateAction<FullAnalysisBatchRun | null>>;
  setSelectedBatchItemId: Dispatch<SetStateAction<string | null>>;
};

export function useFullAnalysisPolling({
  active,
  pageTitle,
  draftStorageKey,
  run,
  batchRun,
  operationTokenRef,
  selectedBatchItemIdRef,
  setRun,
  setArtifact,
  setStatusText,
  setErrorText,
  setBatchRun,
  setSelectedBatchItemId,
}: PollingOptions) {
  const pollTimerRef = useRef<number | null>(null);
  const batchPollTimerRef = useRef<number | null>(null);
  const runPollSequenceRef = useRef(0);
  const batchPollSequenceRef = useRef(0);

  const clearRunPolling = useCallback(() => {
    if (pollTimerRef.current == null) return;
    window.clearInterval(pollTimerRef.current);
    pollTimerRef.current = null;
  }, []);

  const startPolling = useCallback((workflowRunId: string, token = operationTokenRef.current) => {
    if (!active) return;
    clearRunPolling();
    let terminalPollsRemaining = TERMINAL_SETTLE_POLL_COUNT;
    const poll = async () => {
      const pollSequence = runPollSequenceRef.current + 1;
      runPollSequenceRef.current = pollSequence;
      const isCurrentPoll = () => token === operationTokenRef.current && pollSequence === runPollSequenceRef.current;
      if (!isCurrentPoll()) return;
      try {
        const nextRun = await getWorkflowRun(workflowRunId);
        if (!isCurrentPoll()) return;
        setRun(nextRun);
        setStatusText(statusLabel(nextRun));
        let nextArtifact: SampleArtifact | null = null;
        if (nextRun.sampleVideoId) {
          nextArtifact = await getSampleArtifact(nextRun.sampleVideoId).catch(() => null);
          if (!isCurrentPoll()) return;
          if (nextArtifact && "sampleVideo" in nextArtifact) setArtifact(nextArtifact as SampleArtifact);
        }
        writeFullAnalysisDraft(nextRun, nextArtifact, draftStorageKey);
        if (!NON_EXECUTING_RUN_STATUS.has(nextRun.status)) {
          terminalPollsRemaining = TERMINAL_SETTLE_POLL_COUNT;
          return;
        }
        const terminalArtifactSettled = hasSettledArtifactForRun(nextRun, nextArtifact);
        if ((terminalArtifactSettled || terminalPollsRemaining <= 0) && pollTimerRef.current != null) {
          window.clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
          return;
        }
        terminalPollsRemaining -= 1;
      } catch (error) {
        if (isCurrentPoll()) setErrorText(error instanceof Error ? error.message : `查询${pageTitle}状态失败`);
      }
    };
    void poll();
    pollTimerRef.current = window.setInterval(() => {
      void poll();
    }, POLL_INTERVAL_MS);
  }, [active, clearRunPolling, draftStorageKey, operationTokenRef, pageTitle, setArtifact, setErrorText, setRun, setStatusText]);

  const startBatchPolling = useCallback((batchRunId: string, token = operationTokenRef.current) => {
    if (!active) return;
    if (batchPollTimerRef.current != null) window.clearInterval(batchPollTimerRef.current);
    const poll = async () => {
      const pollSequence = batchPollSequenceRef.current + 1;
      batchPollSequenceRef.current = pollSequence;
      const isCurrentPoll = () => token === operationTokenRef.current && pollSequence === batchPollSequenceRef.current;
      if (!isCurrentPoll()) return;
      try {
        const nextBatch = await getFullAnalysisBatchRun(batchRunId);
        if (!isCurrentPoll()) return;
        setBatchRun(nextBatch);
        writeFullAnalysisBatchDraft(nextBatch.batchRunId, draftStorageKey);
        const selected = nextBatch.items.find((item) => item.queueItemId === selectedBatchItemIdRef.current) ?? nextBatch.items.find((item) => item.workflowRunId) ?? null;
        if (selected && selected.queueItemId !== selectedBatchItemIdRef.current) {
          selectedBatchItemIdRef.current = selected.queueItemId;
          setSelectedBatchItemId(selected.queueItemId);
        }
        if (selected?.workflowRunId) {
          const nextRun = await getWorkflowRun(selected.workflowRunId).catch(() => null);
          if (!isCurrentPoll()) return;
          if (nextRun) {
            setRun(nextRun);
            setStatusText(statusLabel(nextRun));
            if (nextRun.sampleVideoId) {
              const nextArtifact = await getSampleArtifact(nextRun.sampleVideoId).catch(() => null);
              if (!isCurrentPoll()) return;
              if (nextArtifact && "sampleVideo" in nextArtifact) setArtifact(nextArtifact as SampleArtifact);
            }
          }
        }
        if (isBatchTerminal(nextBatch) && batchPollTimerRef.current != null) {
          window.clearInterval(batchPollTimerRef.current);
          batchPollTimerRef.current = null;
        }
      } catch (error) {
        if (isCurrentPoll()) setErrorText(error instanceof Error ? error.message : "查询批量完整分析状态失败");
      }
    };
    void poll();
    batchPollTimerRef.current = window.setInterval(() => {
      void poll();
    }, POLL_INTERVAL_MS);
  }, [active, draftStorageKey, operationTokenRef, selectedBatchItemIdRef, setArtifact, setBatchRun, setErrorText, setRun, setSelectedBatchItemId, setStatusText]);

  useEffect(() => () => {
    clearRunPolling();
    if (batchPollTimerRef.current != null) window.clearInterval(batchPollTimerRef.current);
  }, [clearRunPolling]);

  useEffect(() => {
    if (!active) {
      runPollSequenceRef.current += 1;
      batchPollSequenceRef.current += 1;
      clearRunPolling();
      if (batchPollTimerRef.current != null) {
        window.clearInterval(batchPollTimerRef.current);
        batchPollTimerRef.current = null;
      }
      return;
    }
    if (run && !NON_EXECUTING_RUN_STATUS.has(run.status) && pollTimerRef.current == null) startPolling(run.workflowRunId, operationTokenRef.current);
    if (batchRun && !isBatchTerminal(batchRun) && batchPollTimerRef.current == null) startBatchPolling(batchRun.batchRunId, operationTokenRef.current);
  }, [active, batchRun, clearRunPolling, operationTokenRef, run, startBatchPolling, startPolling]);

  return { startPolling, startBatchPolling, clearRunPolling };
}
