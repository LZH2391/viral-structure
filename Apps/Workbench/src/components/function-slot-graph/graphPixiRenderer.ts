import { Container, Graphics, Text } from "pixi.js";
import type { FunctionSlotGraphEdge } from "../../types/library";
import { clamp, nodeRadius, VIEWBOX } from "./graphUtils";
import { edgeLayerClass, edgeLinePoints, shouldShowNodeLabel, slotOrderBadge } from "./GraphCanvas";
import type { SimNode } from "./types";

type GraphMode = "structure" | "governance" | "planTrace";

export type PixiGraphRenderState = {
  mode: GraphMode;
  selectedNodeId: string | null;
  hoveredNodeId: string | null;
  pinnedPreviewNodeId: string | null;
  focusedIds: Set<string>;
  focusedEdgeIds: Set<string>;
  hasFocusNode: boolean;
  fixedLayout: boolean;
};

export type PixiTextMaps = {
  labels: Map<string, Text>;
  slotBadges: Map<string, Text>;
  planBadges: Map<string, Text>;
};

type StrokeStyle = {
  color: number;
  alpha: number;
  width: number;
  dash?: [number, number];
};

export function drawPixiBackground(graphics: Graphics) {
  graphics.clear();
  for (let index = 0; index < 110; index += 1) {
    const x = 50 + ((index * 157) % (VIEWBOX.width - 100));
    const y = 38 + ((index * 89) % (VIEWBOX.height - 76));
    graphics.circle(x, y, 2 + (index % 4)).fill({ color: 0xffffff, alpha: 0.08 });
  }
}

export function drawPixiEdges(graphics: Graphics, edges: FunctionSlotGraphEdge[], nodes: SimNode[], state: PixiGraphRenderState) {
  graphics.clear();
  const positions = new Map(nodes.map((node) => [node.id, node]));
  for (const edge of edges) {
    const source = positions.get(edge.source);
    const target = positions.get(edge.target);
    if (!source || !target) continue;
    const activeId = state.hoveredNodeId ?? state.selectedNodeId;
    const focused = state.hasFocusNode
      ? (state.mode === "planTrace" ? state.focusedEdgeIds.has(edge.id) : edge.source === activeId || edge.target === activeId)
      : false;
    const muted = state.hasFocusNode && !focused;
    const line = edgeLinePoints(edge.type, source, target);
    const style = edgeStyle(edge, source, target, focused, muted, state.mode);
    drawLine(graphics, line.x1, line.y1, line.x2, line.y2, style);
    if (isSlotSequenceEdge(edge.type, source, target)) drawArrow(graphics, line.x1, line.y1, line.x2, line.y2, style);
  }
}

export function drawPixiNodes(graphics: Graphics, labelLayer: Container, textMaps: PixiTextMaps, nodes: SimNode[], state: PixiGraphRenderState, zoom: number, rootScale: number) {
  graphics.clear();
  for (const node of nodes) {
    const focused = state.hasFocusNode && (node.id === state.hoveredNodeId || node.id === state.selectedNodeId || state.focusedIds.has(node.id));
    const selected = node.id === state.selectedNodeId;
    const pinned = node.id === state.pinnedPreviewNodeId;
    const radius = nodeRadius(node);
    const style = nodeStyle(node, focused, selected, pinned, state.mode, state.hasFocusNode);
    if (node.type === "confirmedPlan" || node.type === "governanceRoot" || node.type === "sourceSample") {
      graphics.circle(node.x, node.y, radius + 7).stroke({ color: 0xbbaeff, alpha: 0.76, width: 2 });
    }
    graphics.circle(node.x, node.y, radius).fill({ color: style.fill, alpha: style.alpha }).stroke({ color: style.stroke, alpha: style.strokeAlpha, width: style.strokeWidth });
    drawSlotBadge(graphics, textMaps, labelLayer, node, radius, rootScale);
    drawPlanBadge(graphics, textMaps, labelLayer, node, radius, rootScale);
    syncNodeLabel(textMaps.labels, labelLayer, node, radius, shouldShowNodeLabel(state.mode, node, zoom), style.textColor, state.mode, rootScale);
  }
}

export function hitTestPixiNode(nodes: SimNode[], point: { x: number; y: number }, zoom: number) {
  const hitPad = clamp(10 / zoom, 4, 16);
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    const radius = nodeRadius(node) + hitPad;
    if (Math.hypot(point.x - node.x, point.y - node.y) <= radius) return node;
  }
  return null;
}

export function pixiScreenPoint(node: SimNode, viewport: { x: number; y: number; k: number }, size: { width: number; height: number }) {
  return {
    x: (node.x * viewport.k + viewport.x) * (size.width / VIEWBOX.width),
    y: (node.y * viewport.k + viewport.y) * (size.height / VIEWBOX.height),
  };
}

export function createPixiTextMaps(): PixiTextMaps {
  return { labels: new Map(), slotBadges: new Map(), planBadges: new Map() };
}

function drawSlotBadge(graphics: Graphics, textMaps: PixiTextMaps, labelLayer: Container, node: SimNode, radius: number, rootScale: number) {
  const badge = slotOrderBadge(node);
  const text = syncText(textMaps.slotBadges, labelLayer, `slot:${node.id}`, {
    fontFamily: "Inter, Arial, sans-serif",
    fontSize: 7 / rootScale,
    fontWeight: "800",
    fill: "#fff2a8",
    stroke: { color: "#080b11", width: 2 },
  });
  if (!badge) {
    text.visible = false;
    return;
  }
  const x = node.x - radius + 2;
  const y = node.y - radius + 2;
  graphics.circle(x, y, 8).fill({ color: 0x111827, alpha: 0.96 }).stroke({ color: 0xffee9e, alpha: 0.94, width: 1.5 });
  text.text = badge;
  text.anchor.set(0.5);
  text.position.set(x, y - (5 / rootScale));
  text.visible = true;
}

function drawPlanBadge(graphics: Graphics, textMaps: PixiTextMaps, labelLayer: Container, node: SimNode, radius: number, rootScale: number) {
  const overlayColors = Array.isArray(node.data.overlayColors) ? node.data.overlayColors.filter((value): value is string => typeof value === "string") : [];
  const text = syncText(textMaps.planBadges, labelLayer, `plan:${node.id}`, {
    fontFamily: "Inter, Arial, sans-serif",
    fontSize: 8 / rootScale,
    fontWeight: "800",
    fill: "#111827",
  });
  if (!overlayColors.length) {
    text.visible = false;
    return;
  }
  const x = node.x + radius - 1;
  const y = node.y - radius + 1;
  const count = Number(node.data.overlayUsageCount ?? overlayColors.length);
  graphics.circle(x, y, 7).fill({ color: cssColorToNumber(overlayColors[0]) ?? 0x6ea8fe, alpha: 1 }).stroke({ color: 0xffffff, alpha: 0.86, width: 1 });
  text.text = count > 1 ? String(count) : "";
  text.anchor.set(0.5);
  text.position.set(x, y - (4 / rootScale));
  text.visible = count > 1;
}

function syncNodeLabel(textMap: Map<string, Text>, labelLayer: Container, node: SimNode, radius: number, visible: boolean, fill: string, mode: GraphMode, rootScale: number) {
  const text = syncText(textMap, labelLayer, node.id, {
    fontFamily: "Inter, Arial, sans-serif",
    fontSize: (mode === "structure" ? 15 : 13) / rootScale,
    fontWeight: "760",
    fill,
    stroke: { color: "#080b11", width: (mode === "structure" ? 5 : 4) / rootScale },
  });
  text.text = node.shortLabel;
  text.anchor.set(0.5, 0);
  text.position.set(node.x, node.y + radius + (18 / rootScale));
  text.visible = visible;
}

function syncText(map: Map<string, Text>, parent: Container, id: string, style: Record<string, unknown>) {
  const existing = map.get(id);
  if (existing) {
    existing.style = style;
    return existing;
  }
  const text = new Text({ text: "", style });
  map.set(id, text);
  parent.addChild(text);
  return text;
}

function edgeStyle(edge: FunctionSlotGraphEdge, source: SimNode, target: SimNode, focused: boolean, muted: boolean, mode: GraphMode): StrokeStyle {
  let style: StrokeStyle = { color: 0x97a3b9, alpha: mode === "planTrace" ? 0.36 : 0.34, width: 1.1 };
  if (edge.type === "slot_next" || edge.type === "plan_slot_next") style = { color: 0xffee9e, alpha: 0.58, width: 2.1 };
  if (edge.type === "plan_uses_slot" || edge.type === "plan_uses_slot_family" || edge.type === "plan_uses_slot_subtype") style = { color: 0xf4f6ff, alpha: 0.78, width: 2.6 };
  if (edge.type.includes("source_variant") || edge.type.includes("source_sample") || edge.type.startsWith("traced_to_")) style = { color: 0xc4cbed, alpha: 0.46, width: 1.6, dash: [7, 7] };
  if (edge.type.includes("family") || edge.type.includes("archetype")) style = { color: 0x7fb7ff, alpha: 0.72, width: 2.2 };
  if (edge.type.includes("subtype")) style = { color: 0xf0d36d, alpha: 0.78, width: 2.3 };
  if (edge.type.startsWith("binding_")) style = { color: 0xd6c066, alpha: 0.46, width: 1.5, dash: [7, 7] };
  const layerClass = edgeLayerClass(source, target);
  if (layerClass.includes("script")) style = { ...style, color: 0xe48182, alpha: Math.max(style.alpha, 0.62) };
  if (layerClass.includes("rhythm")) style = { ...style, color: 0x69c5e8, alpha: Math.max(style.alpha, 0.62) };
  if (layerClass.includes("packaging")) style = { ...style, color: 0xa98cff, alpha: Math.max(style.alpha, 0.62) };
  if (focused) return { ...style, color: 0xffffff, alpha: 0.96, width: Math.max(style.width, 3.2), dash: undefined };
  if (muted) return { ...style, alpha: mode === "planTrace" ? 0.08 : 0.18 };
  return style;
}

function nodeStyle(node: SimNode, focused: boolean, selected: boolean, pinned: boolean, mode: GraphMode, hasFocusNode: boolean) {
  const layerClass = mode === "planTrace" && node.type === "sourceVariant" ? edgeLayerClass(node, node) : "";
  let fill = 0x8b5cf6;
  let stroke = 0xffffff;
  let textColor = "#e2e8f0";
  let strokeWidth = 1;
  if (node.type === "slotInstance" || node.group === "slot") fill = 0x56d7b1;
  if (node.type === "slotFamily") { fill = 0x3f8f75; stroke = 0x60d6a4; strokeWidth = 2.4; textColor = "#a7f2d1"; }
  if (node.type === "slotArchetype") { fill = 0x426c9f; stroke = 0x7fb7ff; strokeWidth = 2.2; textColor = "#c4ddff"; }
  if (node.type === "slotSubtype") { fill = 0x9b8132; stroke = 0xf0d36d; strokeWidth = 2.3; textColor = "#ffe58f"; }
  if (node.group === "script" || layerClass.includes("script")) { fill = 0xf07070; stroke = 0xe48182; strokeWidth = 2; textColor = "#ffc3c2"; }
  if (node.group === "rhythm" || layerClass.includes("rhythm")) { fill = 0x58bfe7; stroke = 0x69c5e8; strokeWidth = 2; textColor = "#bdeaff"; }
  if (node.group === "packaging" || layerClass.includes("packaging")) { fill = 0xb58cff; stroke = 0xa98cff; strokeWidth = 2; textColor = "#d8ccff"; }
  if (node.type === "binding" || node.group === "binding") fill = 0xf0d46f;
  if (node.group === "rule" || node.group === "policy") fill = 0x7fb0ff;
  if (node.group === "unmapped" || node.group === "needReview") fill = 0xf28b82;
  if (node.type === "sourceVariant" && !layerClass) { fill = 0x111827; stroke = 0xc4cbed; strokeWidth = 1.8; textColor = "#eaf1ff"; }
  if (node.type === "sourceSample" || node.type === "confirmedPlan" || node.type === "governanceRoot") {
    fill = 0x05070c;
    stroke = 0xf4f6ff;
    strokeWidth = 2.8;
    textColor = "#f7f8ff";
  }
  if (selected || pinned || focused) strokeWidth = Math.max(strokeWidth, 2.4);
  return { fill, stroke, strokeWidth, textColor, alpha: focused || !hasFocusNode ? 0.9 : 0.52, strokeAlpha: selected || pinned || focused ? 1 : 0.5 };
}

function drawLine(graphics: Graphics, x1: number, y1: number, x2: number, y2: number, style: StrokeStyle) {
  if (!style.dash) {
    graphics.moveTo(x1, y1).lineTo(x2, y2).stroke({ color: style.color, alpha: style.alpha, width: style.width });
    return;
  }
  const [dash, gap] = style.dash;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy);
  if (!length) return;
  const ux = dx / length;
  const uy = dy / length;
  for (let cursor = 0; cursor < length; cursor += dash + gap) {
    const segmentEnd = Math.min(cursor + dash, length);
    graphics.moveTo(x1 + ux * cursor, y1 + uy * cursor).lineTo(x1 + ux * segmentEnd, y1 + uy * segmentEnd).stroke({ color: style.color, alpha: style.alpha, width: style.width });
  }
}

function drawArrow(graphics: Graphics, x1: number, y1: number, x2: number, y2: number, style: StrokeStyle) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const size = 11;
  const left = angle + Math.PI * 0.82;
  const right = angle - Math.PI * 0.82;
  graphics
    .moveTo(x2, y2)
    .lineTo(x2 + Math.cos(left) * size, y2 + Math.sin(left) * size)
    .lineTo(x2 + Math.cos(right) * size, y2 + Math.sin(right) * size)
    .closePath()
    .fill({ color: style.color, alpha: Math.max(style.alpha, 0.62) });
}

function isSlotSequenceEdge(type: string, source: SimNode, target: SimNode) {
  return (type === "slot_next" || type === "plan_slot_next")
    && (source.type === "slotInstance" || source.type === "slotSubtype")
    && (target.type === "slotInstance" || target.type === "slotSubtype");
}

function cssColorToNumber(value: string) {
  if (!value.startsWith("#")) return null;
  const normalized = value.length === 4
    ? `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`
    : value;
  const parsed = Number.parseInt(normalized.slice(1), 16);
  return Number.isFinite(parsed) ? parsed : null;
}
