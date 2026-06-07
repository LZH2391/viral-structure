import type { CSSProperties } from "react";
import { runtimeUrl } from "../../api/client";
import type { SampleArtifact } from "../../types/artifact";
import type { FunctionSlotLibraryGraph } from "../../types/library";
import type { SimNode } from "./types";

export function LibraryPreviewPopover({
  node,
  sampleArtifact,
  sourceTitle,
  position,
  size,
  pinned,
  onMouseEnter,
  onMouseLeave,
  onClose,
}: {
  node: SimNode;
  sampleArtifact: SampleArtifact | null;
  sourceTitle?: string | null;
  position: { left: number; top: number };
  size: { width: number; mediaHeight: number; totalHeight: number };
  pinned: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onClose: () => void;
}) {
  const sampleVideoId = typeof node.data.sampleVideoId === "string" ? node.data.sampleVideoId : null;
  const videoUrl = runtimeUrl(sampleArtifact?.sampleVideo.normalized.uri ?? sampleArtifact?.sampleVideo.original.uri ?? null);
  const sampleTitle = sampleVideoId ?? "样例";
  const fileName = stripMediaExtension(
    sourceTitle
      ?? sampleArtifact?.sampleVideo.original.summary
      ?? sampleArtifact?.sampleVideo.normalized.summary
      ?? sampleVideoId
      ?? "源视频",
  );
  return (
    <div
      className={`slot-graph-preview-popover ${pinned ? "pinned" : ""}`}
      style={{ left: position.left, top: position.top, "--preview-width": `${size.width}px`, "--preview-media-height": `${size.mediaHeight}px` } as CSSProperties}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="slot-graph-preview-head">
        <strong title={sampleTitle}>{sampleTitle}</strong>
        <span>{pinned ? "已固定" : "源视频"}</span>
        {pinned ? <button type="button" aria-label="关闭预览" onClick={onClose}>x</button> : null}
      </div>
      {videoUrl ? (
        <video src={videoUrl} controls playsInline preload="metadata" />
      ) : (
        <div className="slot-graph-preview-empty">加载源视频</div>
      )}
      <div className="slot-graph-preview-meta">
        <span title={fileName}>{fileName}</span>
      </div>
    </div>
  );
}

function stripMediaExtension(value: string) {
  return value.trim().replace(/\.(mp4|mov|m4v|webm|mkv|avi|wmv|flv|mpeg|mpg)$/i, "");
}

export function GraphLegend({ mode }: { mode: "structure" | "governance" | "planTrace" }) {
  if (mode === "governance") {
    return (
      <div className="slot-graph-legend">
        <span><i className="legend-slot" />槽位治理</span>
        <span><i className="legend-script" />脚本原子</span>
        <span><i className="legend-rhythm" />节奏原子</span>
        <span><i className="legend-packaging" />包装原子</span>
        <span><i className="legend-binding" />绑定关系</span>
        <span><i className="legend-rule" />规则策略</span>
        <span><i className="legend-unmapped" />待治理证据</span>
      </div>
    );
  }
  if (mode === "planTrace") {
    return (
      <div className="slot-graph-legend">
        <span><i className="legend-plan" />确定方案</span>
        <span><i className="legend-subtype" />槽位子型</span>
        <span><i className="legend-source-variant" />原子变体</span>
        <span><i className="legend-source-sample" />样例</span>
      </div>
    );
  }
  return (
    <div className="slot-graph-legend">
      <span><i className="legend-library" />样例</span>
      <span><i className="legend-slot" />槽位</span>
      <span><i className="legend-script" />脚本原子</span>
      <span><i className="legend-rhythm" />节奏原子</span>
      <span><i className="legend-packaging" />包装原子</span>
    </div>
  );
}

export function governanceSummaryText(graph: FunctionSlotLibraryGraph) {
  return `${graph.summary.sampleCount ?? 0} 个样例 / ${graph.summary.slotCount} 个槽位变体`;
}

export function planTraceSummaryText(graph: FunctionSlotLibraryGraph) {
  return `${graph.summary.planCount ?? 0} 个方案 / ${graph.summary.slotCount ?? 0} 个槽位 / ${graph.summary.atomCount ?? 0} 个原子变体`;
}
