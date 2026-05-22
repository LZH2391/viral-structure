import { useEffect, useState } from "react";
import type { AgentRunJob, SampleVideo, ShotBoundaryAnalysisArtifact, ShotBoundaryAnalysisHistoryEntry } from "../../types";
import { formatSecondsCompact } from "../../utils/format";
import { getShotBoundaryGuard, type ShotBoundaryGuard } from "../../utils/workbenchHelpers";
import {
  formatFpsValue,
  formatHistoryMeta,
  isValidShotResult,
  renderResultOrigin,
  resolveAnalysisFpsExceededHint,
  resolveAnalysisSamplingPreview,
  resolveMaxAnalysisFps,
  resolveShotEndBoundaryReason,
  resolveShotSummary,
} from "./formatters";

const SHOT_BOUNDARY_GUARD_POLL_MS = 2000;
const MIN_ANALYSIS_FPS = 1;
const MAX_ANALYSIS_FPS = 10;

export function AgentRunPanel({
  sampleVideo,
  analysis,
  analysisHistory,
  currentShot,
  currentShotId,
  job,
  analysisFps,
  onAnalysisFpsChange,
  onRun,
  onSelectShot,
}: {
  sampleVideo: SampleVideo | null;
  analysis?: ShotBoundaryAnalysisArtifact | null;
  analysisHistory?: ShotBoundaryAnalysisHistoryEntry[] | null;
  currentShot?: ShotBoundaryAnalysisArtifact["shots"][number] | null;
  currentShotId?: string | null;
  job?: AgentRunJob | null;
  analysisFps: number;
  onAnalysisFpsChange: (value: number) => void;
  onRun: () => void;
  onSelectShot: (time: number) => void;
}) {
  const running = job?.status === "pending" || job?.status === "processing";
  const maxAnalysisFps = resolveMaxAnalysisFps(sampleVideo);
  const analysisFpsExceeded = Number.isFinite(maxAnalysisFps) && analysisFps > maxAnalysisFps;
  const analysisFpsInvalid = !Number.isInteger(analysisFps) || analysisFps < MIN_ANALYSIS_FPS || analysisFps > MAX_ANALYSIS_FPS;
  const [guard, setGuard] = useState<ShotBoundaryGuard>({ state: "loading", buttonLabel: "检查中", message: null, disabled: true });
  const historyEntries = analysisHistory ?? [];

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const syncGuard = async (showLoading: boolean) => {
      if (showLoading) setGuard({ state: "loading", buttonLabel: "检查中", message: null, disabled: true });
      try {
        const next = await getShotBoundaryGuard();
        if (!cancelled) setGuard(next);
      } catch (error) {
        if (!cancelled) {
          setGuard({
            state: "blocked",
            buttonLabel: "不可用",
            message: error instanceof Error ? error.message : "ThreadPool 状态读取失败",
            disabled: true,
          });
        }
      } finally {
        if (!cancelled) timer = setTimeout(() => syncGuard(false), SHOT_BOUNDARY_GUARD_POLL_MS);
      }
    };
    if (!sampleVideo) {
      setGuard({ state: "loading", buttonLabel: "检查中", message: null, disabled: true });
      return undefined;
    }
    if (running) {
      setGuard((current) => (current.state === "ready" ? current : { state: "ready", buttonLabel: "运行", message: null, disabled: false }));
      return undefined;
    }
    syncGuard(true);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [running, sampleVideo?.id]);

  const runDisabled = !sampleVideo || running || analysisFpsInvalid || analysisFpsExceeded || (guard.disabled && guard.state !== "warming");
  const runLabel = running ? "运行中" : guard.buttonLabel;
  const hasValidShotResult = isValidShotResult(analysis);
  const samplingPreview = resolveAnalysisSamplingPreview(sampleVideo, analysisFps);
  const analysisFpsExceededHint = resolveAnalysisFpsExceededHint(sampleVideo, analysisFps);
  const jobErrorSummary = job?.errorSummary ?? null;
  const jobTurnId = analysis?.agent?.turnId ?? null;
  const preAgentLeaseFailure = job?.status === "failed"
    && (job.stage === "shot.thread_acquire" || jobErrorSummary?.stageName === "shot.thread_acquire")
    && !jobTurnId
    && jobErrorSummary?.turnSubmitted !== true;
  const jobStatusHint = preAgentLeaseFailure
    ? "ThreadPool 获取 lease 超时，Agent turn 未提交，可重试"
    : (job?.status === "failed" && jobErrorSummary?.message ? jobErrorSummary.message : null);
  const handleRun = () => {
    if (guard.state === "warming") {
      window.alert(guard.message ?? "ThreadPool 正在 warming，请稍后再试");
      return;
    }
    if (runDisabled) return;
    onRun();
  };

  return (
    <section className="property-section agent-run-panel">
      <div className="section-heading">Agent</div>
      <div className="agent-capability-row">
        <div>
          <strong>shot-boundary</strong>
          <span>{job ? `${job.stage} / ${job.progress}%` : analysis ? (hasValidShotResult ? `${analysis.shots.length} / ${analysis.shots.length} 镜` : "无有效切镜结果") : "等待分析"}</span>
        </div>
        <button className="primary-button" type="button" disabled={runDisabled} title={guard.message ?? undefined} onClick={handleRun}>
          {runLabel}
        </button>
      </div>
      <label className="agent-field">
        <span>分析采样率</span>
        <input type="number" min={MIN_ANALYSIS_FPS} max={maxAnalysisFps} step="1" value={analysisFps} aria-invalid={analysisFpsInvalid || analysisFpsExceeded} disabled={running} onChange={(event) => onAnalysisFpsChange(Number(event.currentTarget.value || MIN_ANALYSIS_FPS))} />
      </label>
      <div className="detail-hint">
        <div>1 fps 推荐：普通口播、生活记录、稳定剪辑。</div>
        <div>2-3 fps 推荐：动作快、转场多、镜头变化密的视频。</div>
        <div>4-10 fps 推荐：高频动作、快速闪切、需要更细切分的视频。</div>
        <div>采样率越高，图片越多，分析更细但耗时更久。</div>
      </div>
      {analysisFpsInvalid ? <div className="detail-hint">分析采样率必须是 1 到 10 之间的整数。</div> : null}
      {samplingPreview ? <div className="agent-sampling-preview">预计分析：目标 {formatFpsValue(samplingPreview.requestedFps)} fps / 约 {samplingPreview.selectedFrameCount} 帧 / 最近不重复取帧</div> : null}
      {analysisFpsExceeded ? <div className="detail-hint">{analysisFpsExceededHint ?? `分析采样率不能高于当前抽帧 fps（${maxAnalysisFps}）。`}</div> : null}
      {!running && guard.message ? <div className="detail-hint">{guard.message}</div> : null}
      {jobStatusHint ? <div className="detail-hint">{jobStatusHint}</div> : null}
      {analysis?.commerceBrief ? <CommerceBriefPanel brief={analysis.commerceBrief} /> : null}
      {analysis && !hasValidShotResult ? <div className="detail-hint">无有效切镜结果 / 需重新分析</div> : null}
      {analysis?.shots?.length && hasValidShotResult && currentShot ? (
        <div className="agent-shot-current" aria-live="polite">
          <strong>{resolveShotSummary(currentShot)}</strong>
          <span>当前 {currentShot.shotNo ?? `S${String(currentShot.index + 1).padStart(3, "0")}`} / {formatSecondsCompact(currentShot.start)} - {formatSecondsCompact(currentShot.end)}</span>
          {resolveShotEndBoundaryReason(currentShot) ? <small>切换：{resolveShotEndBoundaryReason(currentShot)}</small> : null}
        </div>
      ) : null}
      {analysis?.shots?.length && hasValidShotResult ? (
        <div className="agent-shot-list">
          {analysis.shots.map((shot) => (
            <button
              key={shot.id}
              className={`agent-shot-item ${currentShotId === shot.id ? "active" : ""}`}
              type="button"
              aria-current={currentShotId === shot.id ? "true" : undefined}
              onClick={() => onSelectShot(shot.start)}
            >
              <strong>{shot.shotNo ?? `S${String(shot.index + 1).padStart(3, "0")}`}</strong>
              <span className="agent-shot-time">{formatSecondsCompact(shot.start)} - {formatSecondsCompact(shot.end)}</span>
              <b className="agent-shot-summary">{resolveShotSummary(shot)}</b>
              <small title={resolveShotEndBoundaryReason(shot) ?? undefined}>{resolveShotEndBoundaryReason(shot) ? `切换：${resolveShotEndBoundaryReason(shot)}` : "切换原因缺失"}</small>
            </button>
          ))}
        </div>
      ) : null}
      {historyEntries.length ? (
        <div className="agent-history-list">
          {historyEntries.slice(-5).reverse().map((entry) => (
            <div key={`${entry.artifactId}_${entry.createdAt}`} className={`agent-history-item ${analysis?.artifactId === entry.artifactId ? "is-current" : ""}`}>
              <strong>{renderResultOrigin(entry.resultOrigin)}</strong>
              <span>{entry.analysisFps ?? "?"} fps / {entry.boundaryCount} 边界 / {entry.shotCount} 镜</span>
              <small>{formatHistoryMeta(entry)}</small>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function CommerceBriefPanel({ brief }: { brief: NonNullable<ShotBoundaryAnalysisArtifact["commerceBrief"]> }) {
  const uncertainties = brief.uncertainties?.filter(Boolean) ?? [];
  return (
    <div className="commerce-brief-panel shot-commerce-brief" aria-label="带货总结">
      <div className="commerce-brief-heading">带货总结</div>
      <div className="commerce-brief-grid">
        <CommerceBriefRow label="卖什么" value={brief.sellingObject} />
        <CommerceBriefRow label="怎么证明" value={brief.proofApproach} />
        <CommerceBriefRow label="承诺结果" value={brief.promisedOutcome} />
        <CommerceBriefRow label="打动对象" value={brief.persuasionTarget} />
        <CommerceBriefRow label="转化动作" value={brief.conversionAction} />
        <CommerceBriefRow label="不确定点" value={uncertainties.length ? uncertainties.join("；") : "无"} />
      </div>
    </div>
  );
}

function CommerceBriefRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="commerce-brief-row">
      <span>{label}</span>
      <strong>{String(value ?? "").trim() || "未观察到"}</strong>
    </div>
  );
}
