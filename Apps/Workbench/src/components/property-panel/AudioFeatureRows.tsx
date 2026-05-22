import type { AudioFeatureAnalysisArtifact, AudioFeatureMarker } from "../../types";
import { formatNumber, markerLabel } from "./formatters";
import { DetailRow } from "./SharedRows";

export function AudioFeatureRows({ artifact, marker }: { artifact: AudioFeatureAnalysisArtifact; marker: AudioFeatureMarker | null }) {
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
      <DetailRow label="时间点" value={marker ? String(marker.time) : "未选择"} />
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
