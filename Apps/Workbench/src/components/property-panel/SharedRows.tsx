export function MediaRows({ label, time, artifactId, parentArtifactId, resolution }: { label?: string | null; time: string; artifactId?: string | null; parentArtifactId?: string | null; resolution: string }) {
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

export function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail-row">
      <b>{label}</b>
      <span>{value}</span>
    </div>
  );
}
