import { useEffect, useState } from "react";
import type { AgentRunJob, SampleVideo, ShotBoundaryAnalysisArtifact, ShotBoundaryAnalysisHistoryEntry } from "../../types";
import { formatSecondsCompact } from "../../utils/format";
import { getShotBoundaryGuard, type ShotBoundaryGuard } from "../../utils/workbenchHelpers";
import {
  formatFpsValue,
  formatHistoryMeta,
  isValidShotResult,
  renderResultOrigin,
  resolveAnalysisSamplingPreview,
  resolveMaxAnalysisFps,
  resolveRenderedAnalysisSampling,
  resolveShotEndBoundaryReason,
  resolveShotSummary,
  shortTurnId,
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
  const renderedSampling = resolveRenderedAnalysisSampling(analysis);
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
      {analysisFpsExceeded ? <div className="detail-hint">分析采样率不能高于当前抽帧 fps（{maxAnalysisFps}）。</div> : null}
      {!running && guard.message ? <div className="detail-hint">{guard.message}</div> : null}
      {analysis ? (
        <div className="detail-hint">
          <div>来源：{renderResultOrigin(analysis.resultOrigin)}</div>
          <div>turn：{analysis.agent?.turnId ? shortTurnId(analysis.agent.turnId) : "无"}</div>
          <div>requestedAnalysisFps：{formatFpsValue(renderedSampling.requestedFps)}</div>
          <div>effectiveAnalysisFps：{formatFpsValue(renderedSampling.effectiveFps)}</div>
          {renderedSampling.isLegacyStride ? <div>stride：{renderedSampling.stride}</div> : null}
          <div>targetFrameCount：{renderedSampling.targetFrameCount ?? "无"}</div>
          <div>selectedFrameCount：{renderedSampling.selectedFrameCount ?? "无"}</div>
          <div>selectionPolicy：{renderedSampling.selectionPolicy}</div>
          <div>roundingPolicy：{renderedSampling.roundingPolicy}</div>
          <div>boundaryCount：{analysis.boundaries?.length ?? 0}</div>
          <div>repairAttemptCount：{analysis.validation?.repairAttemptCount ?? 0}</div>
          <div>validation：{analysis.validation?.status ?? "未知"}{analysis.validation?.validatorCode ? ` / ${analysis.validation.validatorCode}` : ""}</div>
        </div>
      ) : null}
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
