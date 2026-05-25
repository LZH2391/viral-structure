import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSampleArtifact, getWorkflowRun, rerunWorkflowStage, runtimeUrl, startFullAnalysisRun } from "../api/client";
import type { SampleArtifact, WorkflowRun, WorkflowStageState } from "../types";
import { formatSecondsCompact, shortId } from "../utils/format";

type ResultTab = "shot" | "script" | "rhythm" | "packaging";

const POLL_INTERVAL_MS = 2000;
const TERMINAL_RUN_STATUS = new Set(["processed", "failed", "partial_failed"]);
const STAGE_ORDER = ["upload", "shotBoundary", "scriptSegment", "rhythmStructure", "packagingStructure", "aggregate"];

type FullAnalysisAppProps = {
  embedded?: boolean;
};

export function FullAnalysisApp({ embedded = false }: FullAnalysisAppProps = {}) {
  const [run, setRun] = useState<WorkflowRun | null>(null);
  const [artifact, setArtifact] = useState<SampleArtifact | null>(null);
  const [activeTab, setActiveTab] = useState<ResultTab>("shot");
  const [statusText, setStatusText] = useState("等待上传");
  const [errorText, setErrorText] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [frameSampleRate, setFrameSampleRate] = useState(10);
  const [refreshMode, setRefreshMode] = useState(false);
  const pollTimerRef = useRef<number | null>(null);

  const orderedStages = useMemo(() => {
    const stages = run?.stages ?? [];
    return [...stages].sort((a, b) => STAGE_ORDER.indexOf(a.key) - STAGE_ORDER.indexOf(b.key));
  }, [run]);

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
      <main className="full-analysis-main">
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
        <section className="full-analysis-preview" aria-label="视频预览">
          {videoUrl ? (
            <video controls src={videoUrl} />
          ) : (
            <div className="empty-preview">等待视频产物</div>
          )}
        </section>
        <section className="full-analysis-flow" aria-label="流程状态">
          {orderedStages.map((stage) => (
            <StageStep key={stage.key} stage={stage} onRerun={handleRerun} disabled={!canRerun(stage, run)} />
          ))}
        </section>
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
      </main>
    </div>
  );
}

function StageStep({ stage, onRerun, disabled }: { stage: WorkflowStageState; onRerun: (stageKey: string) => void; disabled: boolean }) {
  const failed = stage.status === "failed";
  return (
    <div className={`workflow-step workflow-step-${stage.status}`}>
      <div>
        <strong>{stage.label}</strong>
        <span>{stageStatusLabel(stage)}</span>
      </div>
      <small>{stage.artifactId ? `artifact ${shortId(stage.artifactId)}` : stage.childJobId ? `job ${shortId(stage.childJobId)}` : `attempt ${stage.attemptNo}`}</small>
      {stage.errorSummary?.message ? <em>{stage.errorSummary.message}</em> : null}
      {stage.key !== "upload" && stage.key !== "aggregate" ? (
        <button className={failed ? "primary-button" : "ghost-button"} type="button" disabled={disabled} onClick={() => onRerun(stage.key)}>
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
