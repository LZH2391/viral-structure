import type { PropertyPanelProps } from "../PropertyPanel";
import { formatTime } from "../../utils/format";
import { AudioFeatureRows } from "./AudioFeatureRows";
import { MediaRows, DetailRow } from "./SharedRows";
import { SubtitleRows } from "./SubtitleRows";
import { findAudioFeatureMarker, resolutionText } from "./formatters";

type Props = Pick<PropertyPanelProps,
  "sampleVideo"
  | "activeMediaKind"
  | "selectedFrameId"
  | "selectedDerivativeId"
  | "selectedSubtitleId"
  | "selectedAudioFeatureMarkerId"
  | "mediaDerivatives"
  | "audioFeatures"
  | "subtitles"
  | "subtitleDrafts"
  | "currentCard"
  | "processingTraceId"
  | "processingStatus"
  | "processingStage"
  | "processingProgress"
  | "errorMessage"
  | "onSubtitleDraftChange"
>;

export function PropertyRows({
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
}: Props) {
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
