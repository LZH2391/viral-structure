import type { PointerEvent } from "react";
import { nodeRadius, VIEWBOX } from "./graphUtils";
import {
  isSlotSequenceNode,
  nodeClassName,
  nodeLabelFontSize,
  nodeLabelOpacity,
  slotOrderBadge,
} from "./graphVisualStyles";
import type { SimNode } from "./types";

export { nodeLabelFontSize, nodeLabelOpacity };

export function GraphSvgNode({
  node,
  focused,
  focusMuted,
  selected,
  pinnedPreview,
  labelOpacity,
  labelFontSize,
  onHover,
  onHoverOut,
  onStartDrag,
}: {
  node: SimNode;
  focused: boolean;
  focusMuted: boolean;
  selected: boolean;
  pinnedPreview: boolean;
  labelOpacity: number;
  labelFontSize: number;
  onHover: (id: string) => void;
  onHoverOut: (id: string) => void;
  onStartDrag: (event: PointerEvent<SVGGElement>, node: SimNode) => void;
}) {
  const radius = nodeRadius(node);
  const overlayColors = Array.isArray(node.data.overlayColors) ? node.data.overlayColors.filter((value): value is string => typeof value === "string") : [];
  const overlayUsageCount = Number(node.data.overlayUsageCount ?? overlayColors.length);
  const slotBadge = slotOrderBadge(node);
  return (
    <g
      className={nodeClassName(node, focused, selected, pinnedPreview, focusMuted)}
      onPointerDown={(event) => onStartDrag(event, node)}
      onPointerEnter={() => onHover(node.id)}
      onPointerLeave={() => onHoverOut(node.id)}
      tabIndex={0}
      role="button"
      aria-label={node.label}
    >
      {node.type === "confirmedPlan" || node.type === "governanceRoot" || node.type === "sourceSample" ? <circle className="slot-graph-plan-ring" cx={node.x} cy={node.y} r={radius + 7} /> : null}
      <circle cx={node.x} cy={node.y} r={radius} />
      {slotBadge ? (
        <g className="slot-graph-slot-badge">
          <circle cx={node.x - radius + 2} cy={node.y - radius + 2} r={8} />
          <text x={node.x - radius + 2} y={node.y - radius + 5}>{slotBadge}</text>
        </g>
      ) : null}
      {overlayColors.length ? (
        <g className="slot-graph-plan-badge">
          <circle cx={node.x + radius - 1} cy={node.y - radius + 1} r={7} style={{ fill: overlayColors[0] }} />
          <text x={node.x + radius - 1} y={node.y - radius + 4}>{overlayUsageCount > 1 ? overlayUsageCount : ""}</text>
        </g>
      ) : null}
      {labelOpacity > 0.01 ? <text x={node.x} y={node.y + radius + 14} style={{ opacity: labelOpacity, fontSize: labelFontSize }}>{node.shortLabel}</text> : null}
      <title>{node.label}</title>
    </g>
  );
}

export function isSamplePreviewNode(node: SimNode | null) {
  return node?.type === "sourceSample" || node?.type === "libraryItem";
}

export function edgeArrowHeadPoints(type: string, source: SimNode, target: SimNode, line: { x1: number; y1: number; x2: number; y2: number }) {
  if ((type !== "slot_next" && type !== "plan_slot_next") || !isSlotSequenceNode(source) || !isSlotSequenceNode(target)) return null;
  const dx = line.x2 - line.x1;
  const dy = line.y2 - line.y1;
  const angle = Math.atan2(dy, dx);
  const size = 8;
  const left = angle + Math.PI * 0.82;
  const right = angle - Math.PI * 0.82;
  const leftX = line.x2 + Math.cos(left) * size;
  const leftY = line.y2 + Math.sin(left) * size;
  const rightX = line.x2 + Math.cos(right) * size;
  const rightY = line.y2 + Math.sin(right) * size;
  return `M ${leftX} ${leftY} L ${line.x2} ${line.y2} L ${rightX} ${rightY}`;
}

export function GraphBackground() {
  const dots = Array.from({ length: 110 }, (_, index) => ({
    x: 50 + ((index * 157) % (VIEWBOX.width - 100)),
    y: 38 + ((index * 89) % (VIEWBOX.height - 76)),
    r: 2 + (index % 4),
  }));
  return (
    <g className="slot-graph-bg">
      {dots.map((dot, index) => <circle key={index} cx={dot.x} cy={dot.y} r={dot.r} />)}
    </g>
  );
}
