import type { AudioFeatureAnalysisArtifact, MediaDerivative, SampleVideo, ScriptSegmentArtifact, ShotBoundaryAnalysisArtifact, SubtitleArtifact } from "../../types";
import { formatTime } from "../../utils/format";
import { DetailRow } from "./SharedRows";
import { findAudioFeatureMarker, formatFpsValue, formatNumber, markerLabel, resolutionText } from "./formatters";

export function MetaInfoPanel({
  sampleVideo,
  mediaDerivatives,
  audioFeatures,
  selectedAudioFeatureMarkerId,
  subtitles,
  shotBoundaryAnalysis,
  scriptSegmentAnalysis,
  processingTraceId,
  processingStatus,
  processingStage,
  processingProgress,
  errorMessage,
}: {
  sampleVideo: SampleVideo | null;
  mediaDerivatives: MediaDerivative[];
  audioFeatures?: AudioFeatureAnalysisArtifact | null;
  selectedAudioFeatureMarkerId?: string | null;
  subtitles?: SubtitleArtifact | null;
  shotBoundaryAnalysis?: ShotBoundaryAnalysisArtifact | null;
  scriptSegmentAnalysis?: ScriptSegmentArtifact | null;
  processingTraceId?: string | null;
  processingStatus?: string | null;
  processingStage?: string | null;
  processingProgress?: number | null;
  errorMessage?: string | null;
}) {
  if (sampleVideo) {
    const metadata = sampleVideo.metadata ?? null;
    const frameSummary = sampleVideo.frameOutputSummary ?? null;
    const audioTracks = mediaDerivatives.filter((item) => item.type === "audio-track" || item.type === "audio-vocal" || item.type === "audio-music");
    const selectedMarker = findAudioFeatureMarker(audioFeatures, selectedAudioFeatureMarkerId ?? null);
    return (
      <section className="property-section agent-run-panel">
        <div className="section-heading">元信息</div>
        <div className="detail-block">
          <DetailRow label="样例" value={sampleVideo.fileName} />
          <DetailRow label="时长" value={formatTime(sampleVideo.duration)} />
          <DetailRow label="分辨率" value={resolutionText(sampleVideo)} />
          <DetailRow label="视频格式" value={metadata?.formatName || "无"} />
          <DetailRow label="视频码率" value={formatBitrate(metadata?.bitrate)} />
          <DetailRow label="时长来源" value={renderDurationSource(metadata?.durationSource)} />
          <DetailRow label="含音频轨" value={renderBoolean(metadata?.hasAudio)} />
          <DetailRow label="音频摘要" value={sampleVideo.audioSummary || "无"} />
          <DetailRow label="抽帧采样率" value={`${frameSummary?.frameSampleRateFps ?? sampleVideo.processingOptions?.frameSampleRateFps ?? 1} fps`} />
          <DetailRow label="目标帧数" value={String(frameSummary?.targetFrameCount ?? "无")} />
          <DetailRow label="实际帧数" value={String(frameSummary?.actualFrameCount ?? sampleVideo.frameArtifacts.length ?? 0)} />
          <DetailRow label="帧数上限" value={String(frameSummary?.maxFrames ?? "无")} />
          <DetailRow label="抽帧策略" value={frameSummary?.samplingPolicy || "无"} />
          <DetailRow label="音频资源" value={String(audioTracks.length)} />
          <DetailRow label="字幕段数" value={String(subtitles?.segments.length ?? 0)} />
          <DetailRow label="节拍标记" value={String(audioFeatures?.beats.length ?? 0)} />
          <DetailRow label="onset 标记" value={String(audioFeatures?.onsets.length ?? 0)} />
          <DetailRow label="当前音频点" value={selectedMarker ? markerLabel(selectedMarker.type) : "未选择"} />
          <DetailRow label="音频点时间" value={selectedMarker ? formatTime(selectedMarker.time) : "无"} />
          <DetailRow label="音频点 RMS" value={selectedMarker ? formatNumber(selectedMarker.rms) : "无"} />
          <DetailRow label="音频时长" value={audioFeatures?.durationSeconds ? formatTime(audioFeatures.durationSeconds) : "无"} />
          <DetailRow label="音频采样率" value={audioFeatures?.analysisParams?.sampleRate ? `${audioFeatures.analysisParams.sampleRate} Hz` : "无"} />
          <DetailRow label="音频源角色" value={audioFeatures?.analysisParams?.sourceRole || "无"} />
          <DetailRow label="节奏 BPM" value={audioFeatures?.tempoBpm ? formatFpsValue(audioFeatures.tempoBpm) : "无"} />
          <DetailRow label="镜头数" value={shotBoundaryAnalysis ? String(shotBoundaryAnalysis.shots.length) : "无"} />
          <DetailRow label="切镜结果" value={shotBoundaryAnalysis ? `${shotBoundaryAnalysis.shots.length} 镜 / ${shotBoundaryAnalysis.boundaries?.length ?? 0} 边界` : "无"} />
          <DetailRow label="脚本段数" value={scriptSegmentAnalysis ? String(scriptSegmentAnalysis.segments.length) : "无"} />
          <DetailRow label="处理状态" value={sampleVideo.processingStatus} />
          <DetailRow label="trace" value={processingTraceId ?? "无"} />
        </div>
      </section>
    );
  }

  if (errorMessage) {
    return (
      <section className="property-section agent-run-panel">
        <div className="section-heading">元信息</div>
        <div className="detail-block">
          <DetailRow label="错误" value={errorMessage} />
        </div>
      </section>
    );
  }

  if (processingStatus) {
    return (
      <section className="property-section agent-run-panel">
        <div className="section-heading">元信息</div>
        <div className="detail-block">
          <DetailRow label="任务" value={processingStatus} />
          <DetailRow label="阶段" value={processingStage ?? "unknown"} />
          <DetailRow label="进度" value={`${processingProgress ?? 0}%`} />
          <DetailRow label="trace" value={processingTraceId ?? "无"} />
        </div>
      </section>
    );
  }

  return (
    <section className="property-section agent-run-panel">
      <div className="section-heading">元信息</div>
      <div className="detail-block">暂无元信息</div>
    </section>
  );
}

function renderBoolean(value?: boolean | null) {
  if (value == null) return "无";
  return value ? "是" : "否";
}

function renderDurationSource(value?: string | null) {
  if (value === "video_stream") return "video_stream";
  if (value === "format_fallback") return "format_fallback";
  return value || "无";
}

function formatBitrate(value?: number | null) {
  if (!Number.isFinite(value) || Number(value) <= 0) return "无";
  const kbps = Math.round(Number(value) / 1000);
  return `${kbps} kbps`;
}
