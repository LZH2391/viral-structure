import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { checkFullAnalysisUploadCache, getLatestFullAnalysisRun, getLatestFullAnalysisRunForSample, getProcessingJob, getSampleArtifact, getWorkflowRun, rerunWorkflowStage, resolveCacheDecision, runtimeUrl, startFullAnalysisRun } from "../api/client";
import type { LibraryItemSummary, ProcessingJob, SampleArtifact, WorkflowRun, WorkflowStageState } from "../types";
import { SplitResizeHandle } from "./SplitResizeHandle";
import { CacheDecisionDialog } from "./CacheDecisionDialog";
import { shortId } from "../utils/format";
import { useResizableGridLayout } from "../hooks/useResizableGridLayout";
import { readFullAnalysisDraft, writeFullAnalysisActiveSampleDraft, writeFullAnalysisDraft } from "../utils/fullAnalysisDraft";
import { ResultPanel, TabButton, type ResultTab } from "./full-analysis/FullAnalysisResults";
import { canRerun, StageStep, type FullAnalysisStageTarget } from "./full-analysis/FullAnalysisStageStep";
import { buildWorkbenchSyncSignature, clampNumber, isRunExecuting, NON_EXECUTING_RUN_STATUS, statusLabel } from "./full-analysis/fullAnalysisState";
export type { FullAnalysisStageTarget } from "./full-analysis/FullAnalysisStageStep";

type WorkflowCachePrompt = { stage: WorkflowStageState; job: ProcessingJob; order: number };
type UploadCachePrompt = { file: File; cachedItem: LibraryItemSummary } | null;
export type FullAnalysisWorkbenchActiveSample = {
  artifact: SampleArtifact;
  activeSampleRevision: number;
  activeSampleSource: "workbench" | "fullAnalysis" | "library";
};
export type FullAnalysisWorkbenchSync = { run: WorkflowRun; artifact: SampleArtifact | null; childJobs: Record<string, ProcessingJob | null>; activeSampleChanged: boolean };

const POLL_INTERVAL_MS = 2000;
const STAGE_ORDER = ["upload", "shotBoundary", "scriptSegment", "rhythmStructure", "packagingStructure", "functionSlotAtomization", "aggregate"];
const CACHE_PROMPT_ORDER = ["shotBoundary", "scriptSegment", "rhythmStructure", "packagingStructure", "functionSlotAtomization"];
const DEFAULT_STAGES: WorkflowStageState[] = [
  buildDefaultStage("upload", "上传"),
  buildDefaultStage("shotBoundary", "切镜"),
  buildDefaultStage("scriptSegment", "脚本段落"),
  buildDefaultStage("rhythmStructure", "节奏结构"),
  buildDefaultStage("packagingStructure", "包装结构"),
  buildDefaultStage("functionSlotAtomization", "功能槽位原子化"),
  buildDefaultStage("aggregate", "汇总"),
];

type FullAnalysisAppProps = {
  embedded?: boolean;
  activeSample?: FullAnalysisWorkbenchActiveSample | null;
  onWorkbenchSync?: (payload: FullAnalysisWorkbenchSync) => void;
  onOpenWorkbenchStage?: (stageKey: FullAnalysisStageTarget) => void;
};

export function FullAnalysisApp({ embedded = false, activeSample = null, onWorkbenchSync, onOpenWorkbenchStage }: FullAnalysisAppProps = {}) {
  const [run, setRun] = useState<WorkflowRun | null>(null);
  const [artifact, setArtifact] = useState<SampleArtifact | null>(null);
  const [childJobs, setChildJobs] = useState<Record<string, ProcessingJob | null>>({});
  const [activeTab, setActiveTab] = useState<ResultTab>("shot");
  const [statusText, setStatusText] = useState("等待上传");
  const [errorText, setErrorText] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [frameSampleRate, setFrameSampleRate] = useState(10);
  const [enableFunctionSlotAtomization, setEnableFunctionSlotAtomization] = useState(true);
  const [refreshMode, setRefreshMode] = useState(false);
  const [dismissedCachePromptJobIds, setDismissedCachePromptJobIds] = useState<string[]>([]);
  const [uploadCachePrompt, setUploadCachePrompt] = useState<UploadCachePrompt>(null);
  const pollTimerRef = useRef<number | null>(null);
  const operationTokenRef = useRef(0);
  const restoredRunRef = useRef(false);
  const lastActiveSampleRevisionRef = useRef<number | null>(null);
  const lastWorkbenchSyncSignatureRef = useRef<string | null>(null);
  const lastSyncedSampleVideoIdRef = useRef<string | null>(null);
  const layoutRef = useRef<HTMLElement>(null);
  const layout = useResizableGridLayout({
    containerRef: layoutRef,
    storageKey: "full-analysis:layout",
    leftCssVar: "--full-analysis-left-width",
    topCssVar: "--full-analysis-top-height",
    bottomLeftCssVar: "--full-analysis-bottom-left-width",
    defaultLeft: 340,
    minLeft: 280,
    maxLeft: 520,
    minRight: 420,
    defaultTop: 320,
    minTop: 260,
    maxTop: 560,
    minBottomTop: 260,
    defaultBottomLeft: 340,
    minBottomLeft: 260,
    maxBottomLeft: 520,
    minBottomRight: 420,
  });

  const orderedStages = useMemo(() => {
    const stages = run?.stages?.length ? run.stages : DEFAULT_STAGES;
    return [...stages]
      .filter((stage) => enableFunctionSlotAtomization || stage.key !== "functionSlotAtomization")
      .sort((a, b) => STAGE_ORDER.indexOf(a.key) - STAGE_ORDER.indexOf(b.key));
  }, [enableFunctionSlotAtomization, run]);

  useEffect(() => {
    if (!enableFunctionSlotAtomization && activeTab === "atomization") setActiveTab("shot");
  }, [activeTab, enableFunctionSlotAtomization]);

  const childJobIds = useMemo(
    () => orderedStages
      .filter((stage) => Boolean(stage.childJobId))
      .map((stage) => stage.childJobId as string),
    [orderedStages],
  );

  const activeCachePrompt = useMemo(() => {
    return orderedStages
      .map((stage) => ({
        stage,
        order: CACHE_PROMPT_ORDER.indexOf(stage.key),
        job: stage.childJobId ? childJobs[stage.childJobId] ?? null : null,
      }))
      .filter((item): item is WorkflowCachePrompt => item.order >= 0 && Boolean(item.job?.jobId && item.job.cachePrompt?.cachedItem && item.job.status === "cache_waiting"))
      .filter((item) => !dismissedCachePromptJobIds.includes(item.job.jobId as string))
      .sort((a, b) => a.order - b.order)[0] ?? null;
  }, [childJobs, dismissedCachePromptJobIds, orderedStages]);

  const startPolling = useCallback((workflowRunId: string, token = operationTokenRef.current) => {
    if (pollTimerRef.current != null) window.clearInterval(pollTimerRef.current);
    const poll = async () => {
      if (token !== operationTokenRef.current) return;
      const nextRun = await getWorkflowRun(workflowRunId);
      if (token !== operationTokenRef.current) return;
      setRun(nextRun);
      setStatusText(statusLabel(nextRun));
      let nextArtifact: SampleArtifact | null = null;
      if (nextRun.sampleVideoId) {
        nextArtifact = await getSampleArtifact(nextRun.sampleVideoId).catch(() => null);
        if (token !== operationTokenRef.current) return;
        if (nextArtifact && "sampleVideo" in nextArtifact) setArtifact(nextArtifact as SampleArtifact);
      }
      writeFullAnalysisDraft(nextRun, nextArtifact);
      if (NON_EXECUTING_RUN_STATUS.has(nextRun.status) && pollTimerRef.current != null) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
    void poll().catch((error) => setErrorText(error instanceof Error ? error.message : "查询完整分析状态失败"));
    pollTimerRef.current = window.setInterval(() => {
      void poll().catch((error) => setErrorText(error instanceof Error ? error.message : "查询完整分析状态失败"));
    }, POLL_INTERVAL_MS);
  }, []);

  useEffect(() => () => {
    if (pollTimerRef.current != null) window.clearInterval(pollTimerRef.current);
  }, []);

  useEffect(() => {
    if (restoredRunRef.current) return;
    restoredRunRef.current = true;
    const token = operationTokenRef.current + 1;
    operationTokenRef.current = token;
    const restoreRun = async () => {
      if (embedded && activeSample?.artifact) {
        lastActiveSampleRevisionRef.current = activeSample.activeSampleRevision;
        lastSyncedSampleVideoIdRef.current = activeSample.artifact.sampleVideoId;
        setArtifact(activeSample.artifact);
        const restoredRun = await getLatestFullAnalysisRunForSample(activeSample.artifact.sampleVideoId).catch(() => null);
        if (token !== operationTokenRef.current) return;
        if (restoredRun) {
          setRun(restoredRun);
          setStatusText(statusLabel(restoredRun));
          setEnableFunctionSlotAtomization(restoredRun.options?.enableFunctionSlotAtomization !== false);
          writeFullAnalysisDraft(restoredRun, activeSample.artifact);
          if (!NON_EXECUTING_RUN_STATUS.has(restoredRun.status)) startPolling(restoredRun.workflowRunId, token);
        } else {
          setRun(null);
          setStatusText("已同步工作台当前视频");
        }
        writeFullAnalysisActiveSampleDraft(activeSample.artifact, {
          activeSampleRevision: activeSample.activeSampleRevision,
          activeSampleSource: activeSample.activeSampleSource,
        });
        return;
      }
      const draft = readFullAnalysisDraft();
      if (draft?.sampleArtifact) {
        setArtifact(draft.sampleArtifact);
        setStatusText("已恢复最近完整分析结果");
        lastActiveSampleRevisionRef.current = draft.activeSampleRevision ?? null;
        lastSyncedSampleVideoIdRef.current = draft.sampleArtifact.sampleVideoId;
      }
      let restoredRun: WorkflowRun | null = null;
      if (draft?.workflowRunId) {
        restoredRun = await getWorkflowRun(draft.workflowRunId).catch(() => null);
      }
      if (token !== operationTokenRef.current) return;
      if (!restoredRun) {
        restoredRun = await getLatestFullAnalysisRun().catch(() => null);
      }
      if (token !== operationTokenRef.current) return;
      if (!restoredRun) return;
      setRun(restoredRun);
      setStatusText(statusLabel(restoredRun));
      setEnableFunctionSlotAtomization(restoredRun.options?.enableFunctionSlotAtomization !== false);
      let restoredArtifact: SampleArtifact | null = null;
      if (restoredRun.sampleVideoId) {
        restoredArtifact = await getSampleArtifact(restoredRun.sampleVideoId).catch(() => null);
        if (token !== operationTokenRef.current) return;
        if (restoredArtifact && "sampleVideo" in restoredArtifact) setArtifact(restoredArtifact);
      }
      writeFullAnalysisDraft(restoredRun, restoredArtifact ?? draft?.sampleArtifact ?? null);
      if (!NON_EXECUTING_RUN_STATUS.has(restoredRun.status)) startPolling(restoredRun.workflowRunId, token);
    };
    void restoreRun().catch((error) => setErrorText(error instanceof Error ? error.message : "恢复完整分析失败"));
  }, [activeSample, embedded, startPolling]);

  useEffect(() => {
    if (!embedded || !activeSample?.artifact) return;
    if (lastActiveSampleRevisionRef.current != null && activeSample.activeSampleRevision <= lastActiveSampleRevisionRef.current) return;
    lastActiveSampleRevisionRef.current = activeSample.activeSampleRevision;
    lastSyncedSampleVideoIdRef.current = activeSample.artifact.sampleVideoId;
    const shouldPreserveWorkflow = shouldPreserveActiveWorkflow(run, activeSample);
    if (!shouldPreserveWorkflow) {
      operationTokenRef.current += 1;
      if (pollTimerRef.current != null) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    }
    setArtifact(activeSample.artifact);
    setRun((current) => shouldPreserveActiveWorkflow(current, activeSample) ? current : null);
    if (!shouldPreserveWorkflow) setChildJobs({});
    setStatusText(shouldPreserveWorkflow && run ? statusLabel(run) : "已同步工作台当前视频");
    setErrorText(null);
    writeFullAnalysisActiveSampleDraft(activeSample.artifact, {
      activeSampleRevision: activeSample.activeSampleRevision,
      activeSampleSource: activeSample.activeSampleSource,
    });
    if (shouldPreserveWorkflow && run && !NON_EXECUTING_RUN_STATUS.has(run.status) && pollTimerRef.current == null) {
      startPolling(run.workflowRunId, operationTokenRef.current);
      return;
    }
    if (shouldPreserveWorkflow) return;
    const token = operationTokenRef.current;
    const sampleVideoId = activeSample.artifact.sampleVideoId;
    const syncRunForSample = async () => {
      const restoredRun = await getLatestFullAnalysisRunForSample(sampleVideoId).catch(() => null);
      if (token !== operationTokenRef.current) return;
      if (!restoredRun) {
        setStatusText("已同步工作台当前视频");
        return;
      }
      setRun(restoredRun);
      setStatusText(statusLabel(restoredRun));
      setEnableFunctionSlotAtomization(restoredRun.options?.enableFunctionSlotAtomization !== false);
      writeFullAnalysisDraft(restoredRun, activeSample.artifact);
      if (!NON_EXECUTING_RUN_STATUS.has(restoredRun.status)) startPolling(restoredRun.workflowRunId, token);
    };
    void syncRunForSample().catch((error) => setErrorText(error instanceof Error ? error.message : "恢复当前视频完整分析失败"));
  }, [activeSample, embedded, run, startPolling]);

  useEffect(() => {
    if (!childJobIds.length) return;
    let cancelled = false;

    const syncChildJobs = async () => {
      const updates = await Promise.all(childJobIds.map(async (jobId) => {
        try {
          return [jobId, await getProcessingJob(jobId)] as const;
        } catch {
          return [jobId, null] as const;
        }
      }));
      if (cancelled) return;
      setChildJobs((current) => {
        const next = { ...current };
        for (const [jobId, job] of updates) next[jobId] = job;
        return next;
      });
    };

    void syncChildJobs();
    const timer = window.setInterval(() => {
      void syncChildJobs();
    }, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [childJobIds]);

  useEffect(() => {
    if (!run || !onWorkbenchSync) return;
    const signature = buildWorkbenchSyncSignature(run, artifact, childJobs);
    if (signature === lastWorkbenchSyncSignatureRef.current) return;
    lastWorkbenchSyncSignatureRef.current = signature;
    const activeSampleChanged = Boolean(artifact?.sampleVideoId && artifact.sampleVideoId !== lastSyncedSampleVideoIdRef.current);
    if (activeSampleChanged) lastSyncedSampleVideoIdRef.current = artifact?.sampleVideoId ?? null;
    onWorkbenchSync({ run, artifact, childJobs, activeSampleChanged });
  }, [artifact, childJobs, onWorkbenchSync, run]);

  const startFullAnalysis = useCallback(async (file: File, cacheDecision: "ask" | "reuse" | "refresh") => {
    const token = operationTokenRef.current + 1;
    operationTokenRef.current = token;
    setIsStarting(true);
    setErrorText(null);
    setArtifact(null);
    setDismissedCachePromptJobIds([]);
    setStatusText("创建完整分析任务");
    try {
      const nextRun = await startFullAnalysisRun(file, {
        frameSampleRateFps: frameSampleRate,
        enableAudioSeparation: true,
        enableSubtitleRecognition: true,
        enableAudioFeatureAnalysis: true,
        enableFunctionSlotAtomization,
        cacheDecision,
      });
      if (token !== operationTokenRef.current) return;
      setRun(nextRun);
      setStatusText(statusLabel(nextRun));
      setEnableFunctionSlotAtomization(nextRun.options?.enableFunctionSlotAtomization !== false);
      writeFullAnalysisDraft(nextRun, null);
      startPolling(nextRun.workflowRunId, token);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "启动完整分析失败");
      setStatusText("启动失败");
    } finally {
      setIsStarting(false);
    }
  }, [enableFunctionSlotAtomization, frameSampleRate, startPolling]);

  const handleUpload = useCallback(async (file: File) => {
    const token = operationTokenRef.current + 1;
    operationTokenRef.current = token;
    setIsStarting(true);
    setErrorText(null);
    setArtifact(null);
    setRun(null);
    setUploadCachePrompt(null);
    setDismissedCachePromptJobIds([]);
    setStatusText(refreshMode ? "创建完整分析任务" : "检查上传缓存");
    try {
      if (!refreshMode) {
        const cache = await checkFullAnalysisUploadCache(file, { frameSampleRateFps: frameSampleRate });
        if (token !== operationTokenRef.current) return;
        if (cache.cacheHit) {
          setUploadCachePrompt({ file, cachedItem: cache.cachedItem });
          setStatusText("命中同视频缓存，等待选择");
          return;
        }
      }
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "检查上传缓存失败");
      setStatusText("缓存检查失败");
      return;
    } finally {
      setIsStarting(false);
    }
    if (token !== operationTokenRef.current) return;
    await startFullAnalysis(file, refreshMode ? "refresh" : "ask");
  }, [frameSampleRate, refreshMode, startFullAnalysis]);

  const handleRerun = useCallback(async (stageKey: string) => {
    if (!run) return;
    const token = operationTokenRef.current + 1;
    operationTokenRef.current = token;
    setErrorText(null);
    try {
      const nextRun = await rerunWorkflowStage(run.workflowRunId, stageKey);
      if (token !== operationTokenRef.current) return;
      setRun(nextRun);
      setStatusText(statusLabel(nextRun));
      setEnableFunctionSlotAtomization(nextRun.options?.enableFunctionSlotAtomization !== false);
      writeFullAnalysisDraft(nextRun, artifact);
      startPolling(nextRun.workflowRunId, token);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "重跑步骤失败");
    }
  }, [artifact, run, startPolling]);

  const resolveWorkflowCache = useCallback(async (prompt: WorkflowCachePrompt, decision: "reuse" | "refresh") => {
    if (!prompt.job.jobId) return;
    const token = operationTokenRef.current + 1;
    operationTokenRef.current = token;
    setErrorText(null);
    setDismissedCachePromptJobIds((current) => current.filter((jobId) => jobId !== prompt.job.jobId));
    setStatusText(`${prompt.stage.label}${decision === "reuse" ? "复用缓存" : "重新生成"}`);
    try {
      const nextJob = await resolveCacheDecision(prompt.job.jobId, decision);
      if (token !== operationTokenRef.current) return;
      setChildJobs((current) => ({ ...current, [prompt.job.jobId as string]: nextJob }));
      if (run) {
        const nextRun = await getWorkflowRun(run.workflowRunId);
        if (token !== operationTokenRef.current) return;
        setRun(nextRun);
        setStatusText(statusLabel(nextRun));
        setEnableFunctionSlotAtomization(nextRun.options?.enableFunctionSlotAtomization !== false);
        writeFullAnalysisDraft(nextRun, artifact);
        startPolling(nextRun.workflowRunId, token);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : `${prompt.stage.label}缓存选择失败`;
      setErrorText(message);
      setStatusText(message);
    }
  }, [artifact, run, startPolling]);

  const videoUrl = runtimeUrl(artifact?.sampleVideo.normalized.uri);
  const countLabel = `workflow ${run ? shortId(run.workflowRunId) : "未创建"}`;
  const workflowTraceLabel = `workflow trace ${run ? shortId(run.traceId) : "等待后端返回"}`;

  return (
    <div className={embedded ? "full-analysis-shell embedded-view" : "app-shell full-analysis-shell"}>
      {embedded ? null : (
        <header className="topbar">
          <div className="project-block">
            <div className="project-name">完整分析</div>
            <div className="save-status">{statusText}</div>
          </div>
          <div className="run-status-bar">
            <span>{countLabel}</span>
            <span>{workflowTraceLabel}</span>
          </div>
        </header>
      )}
      <main ref={layoutRef} className="full-analysis-main">
        <div className="full-analysis-top-row">
          <section className="full-analysis-upload" aria-label="完整分析上传">
            <label className="upload-target" htmlFor="fullAnalysisVideoInput">
              <input
                id="fullAnalysisVideoInput"
                type="file"
                accept="video/*"
                disabled={isStarting || isRunExecuting(run)}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  if (file) void handleUpload(file);
                  event.currentTarget.value = "";
                }}
              />
              <span className="upload-title">{isStarting ? "启动中" : "选择视频并完整分析"}</span>
              <span className="upload-meta">{artifact?.sampleVideo.original.summary ?? "上传后自动完成切镜、脚本、节奏、包装"}</span>
            </label>
            <div className="upload-options compact-options">
              <label className="sampling-control">
                <span>抽帧采样率</span>
                <input
                  type="number"
                  min="1"
                  max="10"
                  step="1"
                  value={frameSampleRate}
                  disabled={isStarting || isRunExecuting(run)}
                  onChange={(event) => setFrameSampleRate(clampNumber(Number(event.currentTarget.value || 10), 1, 10))}
                />
              </label>
              <label className="option-toggle">
                <input
                  type="checkbox"
                  checked={refreshMode}
                  disabled={isStarting || isRunExecuting(run)}
                  onChange={(event) => setRefreshMode(event.currentTarget.checked)}
                />
                <span>重新生成</span>
              </label>
              <label className="option-toggle">
                <input
                  type="checkbox"
                  checked={enableFunctionSlotAtomization}
                  disabled={isStarting || isRunExecuting(run)}
                  onChange={(event) => setEnableFunctionSlotAtomization(event.currentTarget.checked)}
                />
                <span>原子化</span>
              </label>
            </div>
          </section>
          <SplitResizeHandle
            className="workspace-resize-handle full-analysis-col-resizer"
            label="调整上方面板左右分界"
            orientation="vertical"
            onResizeStart={(event) => layout.startResize("column", event)}
            onReset={() => layout.resetSize("column")}
            onNudge={(direction) => layout.nudgeSize("column", direction)}
          />
          <section className="full-analysis-preview" aria-label="视频预览">
            {videoUrl ? (
              <video controls src={videoUrl} />
            ) : (
              <div className="empty-preview">等待视频产物</div>
            )}
          </section>
        </div>
        <SplitResizeHandle
          className="workspace-resize-handle full-analysis-row-resizer"
          label="调整上下区域高度"
          orientation="horizontal"
          onResizeStart={(event) => layout.startResize("top-row", event)}
          onReset={() => layout.resetSize("top-row")}
          onNudge={(direction) => layout.nudgeSize("top-row", direction)}
        />
        <div className="full-analysis-bottom-row">
          <section className="full-analysis-flow" aria-label="流程状态">
            {orderedStages.map((stage) => (
              <StageStep
                key={stage.key}
                stage={stage}
                job={stage.childJobId ? childJobs[stage.childJobId] ?? null : null}
                onRerun={handleRerun}
                onOpenStage={onOpenWorkbenchStage}
                onResolveCache={(cacheStage, job, decision) => resolveWorkflowCache({ stage: cacheStage, job, order: CACHE_PROMPT_ORDER.indexOf(cacheStage.key) }, decision)}
                disabled={!canRerun(stage, run, isRunExecuting)}
              />
            ))}
          </section>
          <SplitResizeHandle
            className="workspace-resize-handle full-analysis-bottom-resizer"
            label="调整下方面板左右分界"
            orientation="vertical"
            onResizeStart={(event) => layout.startResize("bottom-row", event)}
            onReset={() => layout.resetSize("bottom-row")}
            onNudge={(direction) => layout.nudgeSize("bottom-row", direction)}
          />
          <section className="full-analysis-results" aria-label="分析结果">
            <div className="result-tabs">
              <TabButton active={activeTab === "shot"} label="切镜" onClick={() => setActiveTab("shot")} />
              <TabButton active={activeTab === "script"} label="脚本" onClick={() => setActiveTab("script")} />
              <TabButton active={activeTab === "rhythm"} label="节奏" onClick={() => setActiveTab("rhythm")} />
              <TabButton active={activeTab === "packaging"} label="包装" onClick={() => setActiveTab("packaging")} />
              {enableFunctionSlotAtomization ? (
                <TabButton active={activeTab === "atomization"} label="原子化" onClick={() => setActiveTab("atomization")} />
              ) : null}
            </div>
            {errorText ? <div className="detail-hint failure-hint">{errorText}</div> : null}
            <ResultPanel tab={activeTab} artifact={artifact} />
          </section>
        </div>
      </main>
      {activeCachePrompt ? (
        <CacheDecisionDialog
          item={activeCachePrompt.job.cachePrompt!.cachedItem}
          onReuse={() => resolveWorkflowCache(activeCachePrompt, "reuse")}
          onRefresh={() => resolveWorkflowCache(activeCachePrompt, "refresh")}
          onCancel={() => {
            setDismissedCachePromptJobIds((current) => activeCachePrompt.job.jobId && !current.includes(activeCachePrompt.job.jobId) ? [...current, activeCachePrompt.job.jobId] : current);
            setStatusText(`${activeCachePrompt.stage.label}等待缓存选择`);
          }}
        />
      ) : null}
      {uploadCachePrompt ? (
        <CacheDecisionDialog
          item={uploadCachePrompt.cachedItem}
          onReuse={() => {
            const prompt = uploadCachePrompt;
            setUploadCachePrompt(null);
            void startFullAnalysis(prompt.file, "reuse");
          }}
          onRefresh={() => {
            const prompt = uploadCachePrompt;
            setUploadCachePrompt(null);
            void startFullAnalysis(prompt.file, "refresh");
          }}
          onCancel={() => {
            setUploadCachePrompt(null);
            setStatusText("等待上传");
          }}
        />
      ) : null}
    </div>
  );
}

function shouldPreserveActiveWorkflow(run: WorkflowRun | null, activeSample: FullAnalysisWorkbenchActiveSample) {
  if (!run) return false;
  if (activeSample.activeSampleSource === "fullAnalysis") return true;
  if (run.sampleVideoId && run.sampleVideoId === activeSample.artifact.sampleVideoId) return true;
  return isRunExecuting(run);
}

function buildDefaultStage(key: WorkflowStageState["key"], label: string): WorkflowStageState {
  return {
    key,
    stageName: key,
    label,
    status: "pending",
    attemptNo: 1,
    stageId: null,
    childJobId: null,
    childTraceId: null,
    artifactId: null,
    parentArtifactId: null,
    sampleVideoId: null,
    outputSummary: null,
    errorSummary: null,
    startedAt: null,
    completedAt: null,
  };
}
