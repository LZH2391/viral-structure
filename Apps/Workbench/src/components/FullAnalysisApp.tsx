import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getProcessingJob, getSampleArtifact, getThreadConversation, getWorkflowRun, rerunWorkflowStage, runtimeUrl, startFullAnalysisRun } from "../api/client";
import type { ProcessingJob, SampleArtifact, ThreadConversation, WorkflowRun, WorkflowStageState } from "../types";
import { SplitResizeHandle } from "./SplitResizeHandle";
import { formatSecondsCompact, shortId } from "../utils/format";
import { useResizableGridLayout } from "../hooks/useResizableGridLayout";
import { stageLabel } from "../utils/workbenchHelpers";

type ResultTab = "shot" | "script" | "rhythm" | "packaging";
type ThreadMessageItem = { kind: "history" | "active" | "final"; text: string };

const POLL_INTERVAL_MS = 2000;
const TERMINAL_RUN_STATUS = new Set(["processed", "failed", "partial_failed"]);
const STAGE_ORDER = ["upload", "shotBoundary", "scriptSegment", "rhythmStructure", "packagingStructure", "aggregate"];

type FullAnalysisAppProps = {
  embedded?: boolean;
};

export function FullAnalysisApp({ embedded = false }: FullAnalysisAppProps = {}) {
  const [run, setRun] = useState<WorkflowRun | null>(null);
  const [artifact, setArtifact] = useState<SampleArtifact | null>(null);
  const [childJobs, setChildJobs] = useState<Record<string, ProcessingJob | null>>({});
  const [threadConversations, setThreadConversations] = useState<Record<string, ThreadConversation | null>>({});
  const [activeTab, setActiveTab] = useState<ResultTab>("shot");
  const [statusText, setStatusText] = useState("等待上传");
  const [errorText, setErrorText] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [frameSampleRate, setFrameSampleRate] = useState(10);
  const [refreshMode, setRefreshMode] = useState(false);
  const pollTimerRef = useRef<number | null>(null);
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
    const stages = run?.stages ?? [];
    return [...stages].sort((a, b) => STAGE_ORDER.indexOf(a.key) - STAGE_ORDER.indexOf(b.key));
  }, [run]);

  const childJobIds = useMemo(
    () => orderedStages
      .filter((stage) => Boolean(stage.childJobId))
      .map((stage) => stage.childJobId as string),
    [orderedStages],
  );

  const threadIds = useMemo(
    () => Array.from(new Set(
      orderedStages
        .map((stage) => {
          const job = stage.childJobId ? childJobs[stage.childJobId] ?? null : null;
          return job?.activeThreadMessage?.threadId ?? job?.agentRun?.threadId ?? null;
        })
        .filter((value): value is string => Boolean(value)),
    )),
    [childJobs, orderedStages],
  );

  const startPolling = useCallback((workflowRunId: string) => {
    if (pollTimerRef.current != null) window.clearInterval(pollTimerRef.current);
    const poll = async () => {
      const nextRun = await getWorkflowRun(workflowRunId);
      setRun(nextRun);
      setStatusText(statusLabel(nextRun));
      if (nextRun.sampleVideoId) {
        const nextArtifact = await getSampleArtifact(nextRun.sampleVideoId).catch(() => null);
        if (nextArtifact && "sampleVideo" in nextArtifact) setArtifact(nextArtifact as SampleArtifact);
      }
      if (TERMINAL_RUN_STATUS.has(nextRun.status) && pollTimerRef.current != null) {
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
    if (!threadIds.length) return;
    let cancelled = false;

    const syncConversations = async () => {
      const updates = await Promise.all(threadIds.map(async (threadId) => {
        try {
          return [threadId, await getThreadConversation(threadId)] as const;
        } catch {
          return [threadId, null] as const;
        }
      }));
      if (cancelled) return;
      setThreadConversations((current) => {
        const next = { ...current };
        for (const [threadId, conversation] of updates) next[threadId] = conversation;
        return next;
      });
    };

    void syncConversations();
    const timer = window.setInterval(() => {
      void syncConversations();
    }, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [threadIds]);

  const handleUpload = useCallback(async (file: File) => {
    setIsStarting(true);
    setErrorText(null);
    setArtifact(null);
    setStatusText("创建完整分析任务");
    try {
      const nextRun = await startFullAnalysisRun(file, {
        frameSampleRateFps: frameSampleRate,
        enableAudioSeparation: true,
        enableSubtitleRecognition: true,
        enableAudioFeatureAnalysis: true,
        cacheDecision: refreshMode ? "refresh" : "reuse",
      });
      setRun(nextRun);
      setStatusText(statusLabel(nextRun));
      startPolling(nextRun.workflowRunId);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "启动完整分析失败");
      setStatusText("启动失败");
    } finally {
      setIsStarting(false);
    }
  }, [frameSampleRate, refreshMode, startPolling]);

  const handleRerun = useCallback(async (stageKey: string) => {
    if (!run) return;
    setErrorText(null);
    try {
      const nextRun = await rerunWorkflowStage(run.workflowRunId, stageKey);
      setRun(nextRun);
      setStatusText(statusLabel(nextRun));
      startPolling(nextRun.workflowRunId);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "重跑步骤失败");
    }
  }, [run, startPolling]);

  const videoUrl = runtimeUrl(artifact?.sampleVideo.normalized.uri);
  const countLabel = `workflow ${run ? shortId(run.workflowRunId) : "未创建"}`;
  const traceLabel = `trace ${run ? shortId(run.traceId) : "等待后端返回 trace"}`;

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
            <span>{traceLabel}</span>
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
                disabled={isStarting || isRunActive(run)}
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
                  disabled={isStarting || isRunActive(run)}
                  onChange={(event) => setFrameSampleRate(clampNumber(Number(event.currentTarget.value || 10), 1, 10))}
                />
              </label>
              <label className="option-toggle">
                <input
                  type="checkbox"
                  checked={refreshMode}
                  disabled={isStarting || isRunActive(run)}
                  onChange={(event) => setRefreshMode(event.currentTarget.checked)}
                />
                <span>重新生成</span>
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
                conversation={resolveJobConversation(stage.childJobId ? childJobs[stage.childJobId] ?? null : null, threadConversations)}
                onRerun={handleRerun}
                disabled={!canRerun(stage, run)}
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
            </div>
            {errorText ? <div className="detail-hint failure-hint">{errorText}</div> : null}
            <ResultPanel tab={activeTab} artifact={artifact} />
          </section>
        </div>
      </main>
    </div>
  );
}

function StageStep({
  stage,
  job,
  conversation,
  onRerun,
  disabled,
}: {
  stage: WorkflowStageState;
  job: ProcessingJob | null;
  conversation: ThreadConversation | null;
  onRerun: (stageKey: string) => void;
  disabled: boolean;
}) {
  const failed = stage.status === "failed";
  const runtimeStatus = getStageRuntimeStatus(stage);
  const runtimeLabel = resolveRuntimeLabel(stage, job);
  const runtimeStageText = resolveRuntimeStageText(stage, job);
  const runtimeProgress = resolveRuntimeProgress(stage, job);
  const threadMessages = resolveThreadMessages(job, conversation);
  const traceText = job?.traceId ?? stage.childTraceId ?? null;
  return (
    <div className={`workflow-step workflow-step-${stage.status}`}>
      <div className="workflow-step-heading">
        <strong>{stage.label}</strong>
        <span>{runtimeLabel}</span>
      </div>
      <small>{stage.artifactId ? `artifact ${shortId(stage.artifactId)}` : stage.childJobId ? `job ${shortId(stage.childJobId)}` : `attempt ${stage.attemptNo}`}</small>
      {runtimeStageText ? <span className="workflow-step-stage">{runtimeStageText}</span> : null}
      {runtimeProgress != null ? <span className="workflow-step-progress">{runtimeProgress}%</span> : null}
      {traceText ? <span className="workflow-step-trace">trace {shortId(traceText)}</span> : null}
      {threadMessages.length ? (
        <div className="workflow-step-thread-wrap">
          {threadMessages.map((message, index) => (
            <em key={`${message.kind}-${index}-${message.text.slice(0, 24)}`} className={`workflow-step-thread ${message.kind === "final" ? "is-final" : ""}`}>
              {message.text}
            </em>
          ))}
        </div>
      ) : null}
      {stage.errorSummary?.message ? <em>{stage.errorSummary.message}</em> : null}
      {stage.key !== "upload" && stage.key !== "aggregate" ? (
        <button className={failed ? "primary-button" : "ghost-button"} type="button" disabled={disabled || runtimeStatus === "running"} onClick={() => onRerun(stage.key)}>
          重跑
        </button>
      ) : null}
    </div>
  );
}

function TabButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button className={`tab-button ${active ? "active" : ""}`} type="button" onClick={onClick}>
      {label}
    </button>
  );
}

function ResultPanel({ tab, artifact }: { tab: ResultTab; artifact: SampleArtifact | null }) {
  if (!artifact) return <div className="detail-hint">还没有可展示的结果。</div>;
  if (tab === "shot") {
    const shots = artifact.shotBoundaryAnalysis?.shots ?? [];
    return <ResultList empty="切镜完成后会展示镜头列表。" items={shots.map((shot) => ({
      id: shot.id,
      title: shot.shotNo ?? shot.id,
      time: `${formatSecondsCompact(shot.start)} - ${formatSecondsCompact(shot.end)}`,
      body: shot.summary ?? shot.reason ?? "无摘要",
    }))} />;
  }
  if (tab === "script") {
    const segments = artifact.scriptSegmentAnalysis?.segments ?? [];
    return <ResultList empty="脚本分析完成后会展示段落结构。" items={segments.map((segment) => ({
      id: segment.segmentId,
      title: segment.label,
      time: `${formatSecondsCompact(segment.start)} - ${formatSecondsCompact(segment.end)}`,
      body: segment.roleInScript,
    }))} />;
  }
  if (tab === "rhythm") {
    const sections = artifact.rhythmStructureAnalysis?.sections ?? [];
    return <ResultList empty="节奏分析完成后会展示节奏段落。" items={sections.map((section) => ({
      id: section.sectionId,
      title: section.label,
      time: `${formatSecondsCompact(section.start)} - ${formatSecondsCompact(section.end)}`,
      body: section.fields.map((field) => `${field.label}: ${field.value}`).join(" / ") || "无字段",
    }))} />;
  }
  const blocks = artifact.packagingStructureAnalysis?.packagingBlocks ?? [];
  return <ResultList empty="包装分析完成后会展示包装块。" items={blocks.map((block) => ({
    id: block.blockId,
    title: block.label,
    time: `${formatSecondsCompact(block.start)} - ${formatSecondsCompact(block.end)}`,
    body: block.packagingFunction,
  }))} />;
}

function ResultList({ items, empty }: { items: Array<{ id: string; title: string; time: string; body: string }>; empty: string }) {
  if (!items.length) return <div className="detail-hint">{empty}</div>;
  return (
    <div className="full-analysis-result-list">
      {items.map((item) => (
        <article key={item.id} className="full-analysis-result-item">
          <strong>{item.title}</strong>
          <span>{item.time}</span>
          <p>{item.body}</p>
        </article>
      ))}
    </div>
  );
}

function statusLabel(run: WorkflowRun) {
  if (run.status === "processed") return "完整分析完成";
  if (run.status === "partial_failed") return "部分步骤失败，已保留可用结果";
  if (run.status === "failed") return run.errorSummary?.message ?? "完整分析失败";
  const active = run.currentStageKeys.map((key) => run.stages.find((stage) => stage.key === key)?.label ?? key).join(" / ");
  return active ? `运行中：${active}` : "运行中";
}

function stageStatusLabel(stage: WorkflowStageState) {
  if (stage.status === "processed") return "完成";
  if (stage.status === "failed") return "失败";
  if (stage.status === "running") return "运行中";
  return "等待";
}

function getStageRuntimeStatus(stage: WorkflowStageState) {
  if (stage.status === "running") return "running";
  if (stage.status === "processed") return "processed";
  if (stage.status === "failed") return "failed";
  return "pending";
}

function resolveRuntimeLabel(stage: WorkflowStageState, job: ProcessingJob | null) {
  if (job) {
    if (job.status === "failed") return "失败";
    if (job.status === "processed") return "完成";
    if (job.status === "cache_waiting") return "等待缓存决策";
    if (job.status === "processing") return "运行中";
    if (job.status === "pending") return "排队中";
  }
  return stageStatusLabel(stage);
}

function resolveRuntimeStageText(stage: WorkflowStageState, job: ProcessingJob | null) {
  if (job?.stage) return stageLabel(job);
  if (stage.status === "processed" && stage.outputSummary) return "阶段完成";
  return stage.stageName ?? null;
}

function resolveRuntimeProgress(stage: WorkflowStageState, job: ProcessingJob | null) {
  if (job && Number.isFinite(job.progress)) return job.progress;
  if (stage.status === "processed") return 100;
  return null;
}

function resolveActiveThreadMessage(job: ProcessingJob | null) {
  const text = job?.activeThreadMessage?.text?.trim();
  return text ? text : null;
}

function resolveJobConversation(job: ProcessingJob | null, conversations: Record<string, ThreadConversation | null>) {
  const threadId = job?.activeThreadMessage?.threadId ?? job?.agentRun?.threadId ?? null;
  if (!threadId) return null;
  return conversations[threadId] ?? null;
}

function resolveThreadMessages(job: ProcessingJob | null, conversation: ThreadConversation | null) {
  const finalText = normalizeMessageText(job?.finalMessage ?? null);
  const activeText = resolveActiveThreadMessage(job);
  const turns = conversation?.turns ?? [];
  const items: ThreadMessageItem[] = turns
    .map((turn) => normalizeMessageText(turn.finalMessage ?? null))
    .filter((value): value is string => Boolean(value))
    .map((text) => ({ kind: "history", text }));
  if (activeText && !items.some((item) => item.text === activeText)) items.push({ kind: "active" as const, text: activeText });
  if (finalText && !items.some((item) => item.text === finalText)) items.push({ kind: "final" as const, text: finalText });
  return items.slice(-6);
}

function normalizeMessageText(value: string | null | undefined) {
  const text = value?.trim() ?? "";
  return text || null;
}

function isRunActive(run: WorkflowRun | null) {
  return Boolean(run && !TERMINAL_RUN_STATUS.has(run.status));
}

function canRerun(stage: WorkflowStageState, run: WorkflowRun | null) {
  return Boolean(run?.sampleVideoId && !isRunActive(run) && ["processed", "failed"].includes(stage.status));
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
