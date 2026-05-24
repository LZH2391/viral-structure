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
      <DetailRow label="候选置信度" value={marker?.confidence !== undefined && marker?.confidence !== null ? formatNumber(marker.confidence) : "无"} />
      <DetailRow label="可用于剪辑" value={marker?.usableForEdit === undefined || marker?.usableForEdit === null ? "无" : marker.usableForEdit ? "候选可用" : "仅作参考"} />
      <DetailRow label="候选证据" value={marker?.evidenceLabels?.length ? marker.evidenceLabels.join(", ") : "无"} />
      <DetailRow label="tempo" value={formatNumber(artifact.tempoBpm, " BPM")} />
      <DetailRow label="RMS" value={formatNumber(marker?.rms)} />
      <DetailRow label="beat数" value={String(artifact.beats.length)} />
      <DetailRow label="onset数" value={String(artifact.onsets.length)} />
      <DetailRow label="候选数" value={String(artifact.audioEventCandidates?.length ?? 0)} />
      <DetailRow label="频谱质心" value={formatNumber(artifact.spectralSummary?.centroidMean)} />
      <DetailRow label="带宽均值" value={formatNumber(artifact.spectralSummary?.bandwidthMean)} />
      <DetailRow label="rolloff" value={formatNumber(artifact.spectralSummary?.rolloffMean)} />
      <DetailRow label="ZCR均值" value={formatNumber(artifact.spectralSummary?.zeroCrossingRateMean)} />
      <DetailRow label="flatness均值" value={formatNumber(artifact.spectralSummary?.flatnessMean)} />
      <DetailRow label="entropy均值" value={formatNumber(artifact.spectralSummary?.entropyMean)} />
      <DetailRow label="PANNs状态" value={artifact.classificationSummary?.status ?? "无"} />
      <DetailRow label="PANNs标签" value={formatTopLabels(artifact)} />
      <DetailRow label="artifact" value={artifact.artifactId} />
      <DetailRow label="parent" value={artifact.parentArtifactId ?? "无"} />
    </>
  );
}

function formatTopLabels(artifact: AudioFeatureAnalysisArtifact) {
  const labels = artifact.classificationSummary?.wholeFileTopLabels ?? [];
  if (!labels.length) return artifact.classificationSummary?.reason ?? "无";
  return labels
    .slice(0, 3)
    .map((item) => `${item.label} ${formatNumber(item.score)}`)
    .join(", ");
}
