import { useEffect, useState } from "react";
import type { AgentRunJob, AudioFeatureAnalysisArtifact, AudioFeatureMarker, MediaDerivative, SampleVideo, ShotBoundaryAnalysisArtifact, ShotBoundaryAnalysisHistoryEntry, StructureCard, SubtitleArtifact, SubtitleDraft } from "../types";
import { formatTime } from "../utils/format";
import { getShotBoundaryGuard, type ShotBoundaryGuard } from "../utils/workbenchHelpers";

const SHOT_BOUNDARY_GUARD_POLL_MS = 2000;

type PropertyPanelProps = {
  sampleVideo: SampleVideo | null;
  activeMediaKind: string;
  selectedFrameId: string | null;
  selectedDerivativeId: string | null;
  selectedSubtitleId: string | null;
  selectedAudioFeatureMarkerId: string | null;
  mediaDerivatives: MediaDerivative[];
  audioFeatures?: AudioFeatureAnalysisArtifact | null;
  subtitles?: SubtitleArtifact | null;
  subtitleDrafts: Record<string, SubtitleDraft>;
  currentCard: StructureCard | null;
  processingTraceId?: string | null;
  processingStatus?: string | null;
  processingStage?: string | null;
  processingProgress?: number | null;
  errorMessage?: string | null;
  shotBoundaryAnalysis?: ShotBoundaryAnalysisArtifact | null;
  shotBoundaryAnalysisHistory?: ShotBoundaryAnalysisHistoryEntry[] | null;
  currentShot?: ShotBoundaryAnalysisArtifact["shots"][number] | null;
  currentShotId?: string | null;
  agentJob?: AgentRunJob | null;
  agentAnalysisFps: number;
  onAgentAnalysisFpsChange: (value: number) => void;
  onRunShotBoundary: () => void;
  onSelectShot: (time: number) => void;
  onSubtitleDraftChange: (draft: { segmentId: string; text: string; start: number; end: number; sourceArtifactId: string | null }) => void;
};

export function PropertyPanel(props: PropertyPanelProps) {
  return (
    <aside className="property-panel" aria-label="属性区">
      <AgentRunPanel
        sampleVideo={props.sampleVideo}
        analysis={props.shotBoundaryAnalysis}
        analysisHistory={props.shotBoundaryAnalysisHistory}
        currentShot={props.currentShot}
        currentShotId={props.currentShotId}
        job={props.agentJob}
        analysisFps={props.agentAnalysisFps}
        onAnalysisFpsChange={props.onAgentAnalysisFpsChange}
        onRun={props.onRunShotBoundary}
        onSelectShot={props.onSelectShot}
      />
      <section className="property-section">
        <div className="section-heading">当前片段</div>
        <div id="currentSegment" className="detail-block">
          <PropertyRows {...props} />
        </div>
      </section>
    </aside>
  );
}

function AgentRunPanel({
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

  const runDisabled = !sampleVideo || running || analysisFpsExceeded || (guard.disabled && guard.state !== "warming");
  const runLabel = running ? "运行中" : guard.buttonLabel;
  const hasValidShotResult = isValidShotResult(analysis);
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
        <input type="number" min="0.1" max={maxAnalysisFps} step="0.1" value={analysisFps} aria-invalid={analysisFpsExceeded} disabled={running} onChange={(event) => onAnalysisFpsChange(Number(event.currentTarget.value || 1))} />
      </label>
      <div className="detail-hint">
        <div>1 fps 推荐：普通口播、生活记录、稳定剪辑。</div>
        <div>2-3 fps 推荐：动作快、转场多、镜头变化密的视频。</div>
        <div>0.5 fps 推荐：长镜头、慢节奏、只需粗略切分。</div>
        <div>采样率越高，图片越多，分析更细但耗时更久。</div>
      </div>
      {analysisFpsExceeded ? <div className="detail-hint">分析采样率不能高于当前抽帧 fps（{maxAnalysisFps}）。</div> : null}
      {!running && guard.message ? <div className="detail-hint">{guard.message}</div> : null}
      {analysis ? (
        <div className="detail-hint">
          <div>来源：{renderResultOrigin(analysis.resultOrigin)}</div>
          <div>turn：{analysis.agent?.turnId ? shortTurnId(analysis.agent.turnId) : "无"}</div>
          <div>analysisFps：{analysis.analysisSampling?.fps ?? "无"}</div>
          <div>boundaryCount：{analysis.boundaries?.length ?? 0}</div>
          <div>repairAttemptCount：{analysis.validation?.repairAttemptCount ?? 0}</div>
          <div>validation：{analysis.validation?.status ?? "未知"}{analysis.validation?.validatorCode ? ` / ${analysis.validation.validatorCode}` : ""}</div>
        </div>
      ) : null}
      {analysis && !hasValidShotResult ? <div className="detail-hint">无有效切镜结果 / 需重新分析</div> : null}
      {analysis?.shots?.length && hasValidShotResult && currentShot ? (
        <div className="agent-shot-current" aria-live="polite">
          当前 {currentShot.shotNo ?? `S${String(currentShot.index + 1).padStart(3, "0")}`} / {formatTime(currentShot.start)} - {formatTime(currentShot.end)}
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
              <span>{formatTime(shot.start)} - {formatTime(shot.end)}</span>
              <small>{shot.reason}</small>
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

function PropertyRows({
  sampleVideo,
  activeMediaKind,
  selectedFrameId,
  selectedDerivativeId,
  selectedSubtitleId,
  selectedAudioFeatureMarkerId,
  mediaDerivatives,
  audioFeatures,
  subtitles,
  subtitleDrafts,
  currentCard,
  processingTraceId,
  processingStatus,
  processingStage,
  processingProgress,
  errorMessage,
  onSubtitleDraftChange,
}: PropertyPanelProps) {
  if (currentCard) {
    return (
      <>
        <DetailRow label="片段" value={currentCard.name} />
        <DetailRow label="时间" value={`${formatTime(currentCard.start)} - ${formatTime(currentCard.end)}`} />
        <DetailRow label="解释" value={currentCard.explanation} />
        <DetailRow label="规则" value={currentCard.transferableRule} />
      </>
    );
  }
  if (sampleVideo) {
    const frame = sampleVideo.frameArtifacts.find((item) => item.id === selectedFrameId);
    const derivative = mediaDerivatives.find((item) => item.artifactId === selectedDerivativeId);
    const subtitle = subtitles?.segments.find((item) => item.id === selectedSubtitleId);
    const audioFeatureMarker = findAudioFeatureMarker(audioFeatures, selectedAudioFeatureMarkerId);
    if (activeMediaKind === "audioFeature" && audioFeatures) {
      return <AudioFeatureRows artifact={audioFeatures} marker={audioFeatureMarker} />;
    }
    if (activeMediaKind === "subtitle" && subtitle && subtitles) {
      return <SubtitleRows subtitle={subtitle} artifact={subtitles} draft={subtitleDrafts[subtitle.id]} onChange={onSubtitleDraftChange} />;
    }
    if (activeMediaKind === "frame" && frame) {
      return <MediaRows label="抽帧图片" time={formatTime(frame.time)} artifactId={frame.artifactId} parentArtifactId={frame.parentArtifactId} resolution={resolutionText(sampleVideo)} />;
    }
    if (activeMediaKind === "audio") {
      return (
        <MediaRows
          label={derivative?.summary || sampleVideo.audioSummary || "音频轨"}
          time="不适用"
          artifactId={derivative?.artifactId}
          parentArtifactId={derivative?.parentArtifactId ?? sampleVideo.artifactId}
          resolution="不适用"
        />
      );
    }
    if (derivative) {
      return (
        <MediaRows
          label={derivative.name}
          time={activeMediaKind === "video" ? "可播放" : "独立图片"}
          artifactId={derivative.artifactId}
          parentArtifactId={derivative.parentArtifactId}
          resolution={resolutionText(sampleVideo)}
        />
      );
    }
    return (
      <>
        <DetailRow label="样例" value={sampleVideo.fileName} />
        <DetailRow label="时长" value={formatTime(sampleVideo.duration)} />
        <DetailRow label="分辨率" value={resolutionText(sampleVideo)} />
        <DetailRow label="状态" value={sampleVideo.processingStatus} />
        <DetailRow label="采样率" value={`${sampleVideo.processingOptions?.frameSampleRateFps ?? 1} fps`} />
        <DetailRow label="trace" value={processingTraceId ?? "无"} />
      </>
    );
  }
  if (errorMessage) return <DetailRow label="错误" value={errorMessage} />;
  if (processingStatus) {
    return (
      <>
        <DetailRow label="任务" value={processingStatus} />
        <DetailRow label="阶段" value={processingStage ?? "unknown"} />
        <DetailRow label="进度" value={`${processingProgress ?? 0}%`} />
        <DetailRow label="trace" value={processingTraceId ?? "无"} />
      </>
    );
  }
  return <>暂无片段</>;
}

function AudioFeatureRows({ artifact, marker }: { artifact: AudioFeatureAnalysisArtifact; marker: AudioFeatureMarker | null }) {
  if (artifact.status === "degraded") {
    return (
      <>
        <DetailRow label="媒体类型" value="音频基础分析" />
        <DetailRow label="状态" value={artifact.status} />
        <DetailRow label="原因" value={artifact.reason ?? "未产出"} />
        <DetailRow label="artifact" value={artifact.artifactId} />
        <DetailRow label="parent" value={artifact.parentArtifactId ?? "无"} />
      </>
    );
  }
  return (
    <>
      <DetailRow label="媒体类型" value={marker ? markerLabel(marker.type) : "音频基础分析"} />
      <DetailRow label="时间点" value={marker ? formatTime(marker.time) : "未选择"} />
      <DetailRow label="tempo" value={formatNumber(artifact.tempoBpm, " BPM")} />
      <DetailRow label="RMS" value={formatNumber(marker?.rms)} />
      <DetailRow label="beat数" value={String(artifact.beats.length)} />
      <DetailRow label="onset数" value={String(artifact.onsets.length)} />
      <DetailRow label="频谱质心" value={formatNumber(artifact.spectralSummary?.centroidMean)} />
      <DetailRow label="带宽均值" value={formatNumber(artifact.spectralSummary?.bandwidthMean)} />
      <DetailRow label="rolloff" value={formatNumber(artifact.spectralSummary?.rolloffMean)} />
      <DetailRow label="ZCR均值" value={formatNumber(artifact.spectralSummary?.zeroCrossingRateMean)} />
      <DetailRow label="artifact" value={artifact.artifactId} />
      <DetailRow label="parent" value={artifact.parentArtifactId ?? "无"} />
    </>
  );
}

function markerLabel(type: AudioFeatureMarker["type"]) {
  return type === "beat" ? "beat 标记" : "onset 标记";
}

function findAudioFeatureMarker(audioFeatures: AudioFeatureAnalysisArtifact | null | undefined, markerId: string | null): AudioFeatureMarker | null {
  if (!audioFeatures || !markerId) return null;
  const markers = [
    ...(audioFeatures.beats ?? []).map((time, index) => ({ id: `beat_${index}_${time}`, type: "beat" as const, time, rms: nearestRms(audioFeatures, time) })),
    ...(audioFeatures.onsets ?? []).map((time, index) => ({ id: `onset_${index}_${time}`, type: "onset" as const, time, rms: nearestRms(audioFeatures, time) })),
  ];
  return markers.find((item) => item.id === markerId) ?? null;
}

function nearestRms(audioFeatures: AudioFeatureAnalysisArtifact, time: number) {
  const frames = audioFeatures.energyFrames ?? [];
  if (!frames.length) return null;
  let best = frames[0];
  for (const frame of frames) {
    if (Math.abs(frame.time - time) < Math.abs(best.time - time)) best = frame;
  }
  return best.rms;
}

function resolveMaxAnalysisFps(sampleVideo: SampleVideo | null): number {
  const summary = sampleVideo?.frameOutputSummary as { actualFrameCount?: number; frameSampleRateFps?: number } | null | undefined;
  const durationSeconds = Number(sampleVideo?.duration ?? 0);
  const extractFps = durationSeconds > 0 ? Number(summary?.actualFrameCount ?? 0) / durationSeconds : Number.NaN;
  const fallback = Number(summary?.frameSampleRateFps ?? sampleVideo?.processingOptions?.frameSampleRateFps ?? 24);
  const resolved = Number.isFinite(extractFps) && extractFps > 0 ? extractFps : fallback;
  return Math.max(0.1, Math.round(resolved * 1000) / 1000);
}

function formatNumber(value?: number | null, suffix = "") {
  if (!Number.isFinite(value)) return "无";
  const number = Number(value);
  return `${Math.abs(number) >= 10 ? number.toFixed(2) : number.toFixed(4)}${suffix}`;
}

function SubtitleRows({
  subtitle,
  artifact,
  draft,
  onChange,
}: {
  subtitle: NonNullable<SubtitleArtifact["segments"]>[number];
  artifact: SubtitleArtifact;
  draft?: SubtitleDraft;
  onChange: PropertyPanelProps["onSubtitleDraftChange"];
}) {
  const [text, setText] = useState(draft?.text ?? subtitle.text);
  const [start, setStart] = useState(String(draft?.start ?? subtitle.start));
  const [end, setEnd] = useState(String(draft?.end ?? subtitle.end));

  useEffect(() => {
    setText(draft?.text ?? subtitle.text);
    setStart(String(draft?.start ?? subtitle.start));
    setEnd(String(draft?.end ?? subtitle.end));
  }, [draft?.end, draft?.start, draft?.text, subtitle.end, subtitle.start, subtitle.text]);

  const commit = () => {
    onChange({
      segmentId: subtitle.id,
      text,
      start: Number(start || subtitle.start),
      end: Number(end || subtitle.end),
      sourceArtifactId: artifact.artifactId,
    });
  };

  return (
    <div className="subtitle-editor">
      <DetailRow label="字幕来源" value={artifact.artifactId} />
      <DetailRow label="parent" value={artifact.parentArtifactId ?? "无"} />
      <label>
        <span>文本</span>
        <textarea value={text} rows={4} onChange={(event) => setText(event.currentTarget.value)} onBlur={commit} />
      </label>
      <div className="subtitle-time-fields">
        <label>
          <span>开始</span>
          <input type="number" min="0" step="0.1" value={start} onChange={(event) => setStart(event.currentTarget.value)} onBlur={commit} />
        </label>
        <label>
          <span>结束</span>
          <input type="number" min="0" step="0.1" value={end} onChange={(event) => setEnd(event.currentTarget.value)} onBlur={commit} />
        </label>
      </div>
      <DetailRow label="草稿版本" value={draft?.draftVersionId ?? "未编辑"} />
    </div>
  );
}

function MediaRows({ label, time, artifactId, parentArtifactId, resolution }: { label?: string | null; time: string; artifactId?: string | null; parentArtifactId?: string | null; resolution: string }) {
  return (
    <>
      <DetailRow label="媒体类型" value={label ?? "无"} />
      <DetailRow label="时间点" value={time} />
      <DetailRow label="artifact" value={artifactId ?? "无"} />
      <DetailRow label="parent" value={parentArtifactId ?? "无"} />
      <DetailRow label="分辨率" value={resolution} />
    </>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail-row">
      <b>{label}</b>
      <span>{value}</span>
    </div>
  );
}

function resolutionText(sampleVideo: SampleVideo) {
  if (!sampleVideo.width || !sampleVideo.height) return "未知";
  const ratio = Number.isFinite(sampleVideo.aspectRatio) && sampleVideo.aspectRatio ? ` / ${sampleVideo.aspectRatio.toFixed(2)}:1` : "";
  return `${sampleVideo.width} x ${sampleVideo.height}${ratio}`;
}

function renderResultOrigin(origin?: ShotBoundaryAnalysisArtifact["resultOrigin"]) {
  if (origin === "repaired_turn") return "repaired turn";
  if (origin === "cache_reuse") return "cache reuse";
  if (origin === "failed_validation") return "failed validation";
  return "new turn";
}

function shortTurnId(turnId: string) {
  return turnId.length > 10 ? turnId.slice(-10) : turnId;
}

function isValidShotResult(analysis?: ShotBoundaryAnalysisArtifact | null) {
  if (!analysis) return false;
  if (analysis.status === "failed" || analysis.validation?.status === "failed") return false;
  const boundaries = analysis.boundaries ?? [];
  const shots = analysis.shots ?? [];
  const looksLikeLegacyFallback = boundaries.length === 0
    && shots.length === 1
    && /未检测到明确切镜边界/.test(String(shots[0]?.reason ?? ""));
  if (looksLikeLegacyFallback) return false;
  return boundaries.length > 0 && shots.length > 0;
}

function formatHistoryMeta(entry: ShotBoundaryAnalysisHistoryEntry) {
  const time = entry.createdAt ? new Date(entry.createdAt).toLocaleString("zh-CN", { hour12: false }) : "未知时间";
  const turn = entry.turnId ? shortTurnId(entry.turnId) : "无";
  const validator = entry.validatorCode ? ` / ${entry.validatorCode}` : "";
  return `${time} / turn ${turn}${validator}`;
}
