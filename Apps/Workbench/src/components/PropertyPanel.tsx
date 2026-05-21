import { useEffect, useState } from "react";
import type { MediaDerivative, SampleVideo, StructureCard, SubtitleArtifact, SubtitleDraft } from "../types";
import { formatTime } from "../utils/format";

type PropertyPanelProps = {
  sampleVideo: SampleVideo | null;
  activeMediaKind: string;
  selectedFrameId: string | null;
  selectedDerivativeId: string | null;
  selectedSubtitleId: string | null;
  mediaDerivatives: MediaDerivative[];
  subtitles?: SubtitleArtifact | null;
  subtitleDrafts: Record<string, SubtitleDraft>;
  currentCard: StructureCard | null;
  processingTraceId?: string | null;
  processingStatus?: string | null;
  processingStage?: string | null;
  processingProgress?: number | null;
  errorMessage?: string | null;
  onSubtitleDraftChange: (draft: { segmentId: string; text: string; start: number; end: number; sourceArtifactId: string | null }) => void;
};

export function PropertyPanel(props: PropertyPanelProps) {
  return (
    <aside className="property-panel" aria-label="属性区">
      <section className="property-section">
        <div className="section-heading">当前片段</div>
        <div id="currentSegment" className="detail-block">
          <PropertyRows {...props} />
        </div>
      </section>
    </aside>
  );
}

function PropertyRows({
  sampleVideo,
  activeMediaKind,
  selectedFrameId,
  selectedDerivativeId,
  selectedSubtitleId,
  mediaDerivatives,
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
