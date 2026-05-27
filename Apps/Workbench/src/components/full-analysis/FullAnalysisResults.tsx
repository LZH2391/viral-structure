import type { SampleArtifact } from "../../types";
import { formatSecondsCompact } from "../../utils/format";

export type ResultTab = "shot" | "script" | "rhythm" | "packaging" | "atomization";

export function TabButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button className={`tab-button ${active ? "active" : ""}`} type="button" onClick={onClick}>
      {label}
    </button>
  );
}

export function ResultPanel({ tab, artifact }: { tab: ResultTab; artifact: SampleArtifact | null }) {
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
  if (tab === "atomization") {
    const slots = artifact.functionSlotAtomizationAnalysis?.slotMap?.slots ?? [];
    return <ResultList empty="原子化完成后会展示功能槽位。" items={slots.map((slot) => ({
      id: slot.slotId,
      title: slot.slotName ?? slot.slotId,
      time: slot.slotType ?? "slot",
      body: slot.persuasionTask ?? slot.viewerStateAfter ?? "无摘要",
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
