import { Container, Graphics, Text } from "pixi.js";
import type { TextStyleOptions } from "pixi.js";
import type { FunctionSlotGraphEdge } from "../../types/library";
import { clamp, nodeRadius, VIEWBOX } from "./graphUtils";
import { edgeLayerClass, edgeLinePoints, nodeLabelOpacity, slotOrderBadge } from "./GraphCanvas";
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

export type PixiGraphObjects = {
  edges: Map<string, PixiEdgeView>;
  nodes: Map<string, PixiNodeView>;
};

type PixiEdgeView = {
  container: Container;
  line: Graphics;
  arrow: Graphics;
  lineKey: string | null;
  arrowKey: string | null;
};

type PixiNodeView = {
  container: Container;
  ring: Graphics;
  body: Graphics;
  slotBadge: Graphics;
  slotBadgeText: Text;
  planBadge: Graphics;
  planBadgeText: Text;
  label: Text | null;
  ringKey: string | null;
  bodyKey: string | null;
  slotBadgeKey: string | null;
  planBadgeKey: string | null;
};

type StrokeStyle = {
  color: number;
  alpha: number;
  width: number;
  dash?: [number, number];
};

const textStyleKeys = new WeakMap<Text, string>();
const textStyleCache = new Map<string, TextStyleOptions>();
const nodePositionCache = new WeakMap<SimNode[], Map<string, SimNode>>();
const edgeByIdCache = new WeakMap<FunctionSlotGraphEdge[], Map<string, FunctionSlotGraphEdge>>();
const SVG_LABEL_BASELINE_GAP = 14;
const SVG_BASELINE_TO_TEXT_TOP_RATIO = 0.82;
const SLOT_BADGE_FONT_SIZE = 6;
const PLAN_BADGE_FONT_SIZE = 7;
const NODE_LABEL_FONT_SIZE = 11;
const PROMINENT_NODE_LABEL_FONT_SIZE = 12;

export function createPixiGraphObjects(): PixiGraphObjects {
  return { edges: new Map(), nodes: new Map() };
}

export function destroyPixiGraphObjects(objects: PixiGraphObjects) {
  for (const edge of objects.edges.values()) edge.container.destroy({ children: true });
  for (const view of objects.nodes.values()) {
    view.label?.destroy();
    view.container.destroy({ children: true });
  }
  objects.edges.clear();
  objects.nodes.clear();
}

export function drawPixiBackground(graphics: Graphics) {
  graphics.clear();
  for (let index = 0; index < 110; index += 1) {
    const x = 50 + ((index * 157) % (VIEWBOX.width - 100));
    const y = 38 + ((index * 89) % (VIEWBOX.height - 76));
    graphics.circle(x, y, 2 + (index % 4)).fill({ color: 0xffffff, alpha: 0.08 });
  }
}

export function syncPixiEdges(edgeLayer: Container, objects: PixiGraphObjects, edges: FunctionSlotGraphEdge[], nodes: SimNode[], state: PixiGraphRenderState) {
  const edgeIds = new Set(edges.map((edge) => edge.id));
  for (const [edgeId, view] of objects.edges.entries()) {
    if (edgeIds.has(edgeId)) continue;
    view.container.destroy({ children: true });
    objects.edges.delete(edgeId);
  }

  const positions = nodePositionMap(nodes);
  for (const edge of edges) {
    const source = positions.get(edge.source);
    const target = positions.get(edge.target);
    if (!source || !target) continue;
    const view = getEdgeView(edgeLayer, objects, edge.id);
    const activeId = state.hoveredNodeId ?? state.selectedNodeId;
    const focused = state.hasFocusNode
      ? (state.mode === "planTrace" ? state.focusedEdgeIds.has(edge.id) : edge.source === activeId || edge.target === activeId)
      : false;
    const muted = state.hasFocusNode && !focused;
    const line = edgeLinePoints(edge.type, source, target);
    const style = edgeStyle(edge, source, target, focused, muted, state.mode);
    syncEdgeView(view, line.x1, line.y1, line.x2, line.y2, style, isSlotSequenceEdge(edge.type, source, target));
  }
}

export function syncPixiNodes(nodeLayer: Container, labelLayer: Container, objects: PixiGraphObjects, nodes: SimNode[], state: PixiGraphRenderState, zoom: number) {
  const nodeIds = new Set(nodes.map((node) => node.id));
  for (const [nodeId, view] of objects.nodes.entries()) {
    if (nodeIds.has(nodeId)) continue;
    view.label?.destroy();
    view.label = null;
    view.container.destroy({ children: true });
    objects.nodes.delete(nodeId);
  }

  for (const node of nodes) {
    const view = getNodeView(nodeLayer, labelLayer, objects, node.id);
    const focused = state.hasFocusNode && (node.id === state.hoveredNodeId || node.id === state.selectedNodeId || state.focusedIds.has(node.id));
    const selected = node.id === state.selectedNodeId;
    const pinned = node.id === state.pinnedPreviewNodeId;
    const radius = nodeRadius(node);
    const style = nodeStyle(node, focused, selected, pinned, state.mode, state.hasFocusNode);
    view.container.position.set(node.x, node.y);

    syncNodeRing(view, node, radius);
    syncNodeBody(view, radius, style);

    syncSlotBadge(view, node, radius);
    syncPlanBadge(view, node, radius);
    syncNodeLabel(labelLayer, view, node, radius, nodeLabelOpacity(state.mode, node, zoom), state.mode);
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

export function syncPixiLayout(objects: PixiGraphObjects, edges: FunctionSlotGraphEdge[], nodes: SimNode[], state: PixiGraphRenderState) {
  const positions = nodePositionMap(nodes);
  for (const edge of edges) {
    const source = positions.get(edge.source);
    const target = positions.get(edge.target);
    const view = objects.edges.get(edge.id);
    if (!source || !target || !view) return false;
    const activeId = state.hoveredNodeId ?? state.selectedNodeId;
    const focused = state.hasFocusNode
      ? (state.mode === "planTrace" ? state.focusedEdgeIds.has(edge.id) : edge.source === activeId || edge.target === activeId)
      : false;
    const muted = state.hasFocusNode && !focused;
    const line = edgeLinePoints(edge.type, source, target);
    const style = edgeStyle(edge, source, target, focused, muted, state.mode);
    syncEdgeView(view, line.x1, line.y1, line.x2, line.y2, style, isSlotSequenceEdge(edge.type, source, target));
  }
  for (const node of nodes) {
    const view = objects.nodes.get(node.id);
    if (!view) return false;
    const radius = nodeRadius(node);
    view.container.position.set(node.x, node.y);
    if (view.label) view.label.position.set(node.x, nodeLabelTopY(node, radius, labelFontSize(state.mode, node)));
  }
  return true;
}

export function syncPixiFocus(objects: PixiGraphObjects, edges: FunctionSlotGraphEdge[], nodes: SimNode[], previous: PixiGraphRenderState, next: PixiGraphRenderState) {
  const positions = nodePositionMap(nodes);
  const nodeIds = affectedFocusNodeIds(nodes, previous, next);
  for (const nodeId of nodeIds) {
    const node = positions.get(nodeId);
    const view = objects.nodes.get(nodeId);
    if (!node || !view) return false;
    const focused = next.hasFocusNode && (node.id === next.hoveredNodeId || node.id === next.selectedNodeId || next.focusedIds.has(node.id));
    const selected = node.id === next.selectedNodeId;
    const pinned = node.id === next.pinnedPreviewNodeId;
    syncNodeBody(view, nodeRadius(node), nodeStyle(node, focused, selected, pinned, next.mode, next.hasFocusNode));
  }

  const edgeIds = affectedFocusEdgeIds(edges, previous, next);
  const edgeById = edgeByIdMap(edges);
  for (const edgeId of edgeIds) {
    const edge = edgeById.get(edgeId);
    if (!edge) continue;
    const source = positions.get(edge.source);
    const target = positions.get(edge.target);
    const view = objects.edges.get(edge.id);
    if (!source || !target || !view) return false;
    const focused = isEdgeFocused(edge, next);
    const muted = next.hasFocusNode && !focused;
    const line = edgeLinePoints(edge.type, source, target);
    const style = edgeStyle(edge, source, target, focused, muted, next.mode);
    syncEdgeView(view, line.x1, line.y1, line.x2, line.y2, style, isSlotSequenceEdge(edge.type, source, target));
  }
  return true;
}

function getEdgeView(edgeLayer: Container, objects: PixiGraphObjects, edgeId: string) {
  const existing = objects.edges.get(edgeId);
  if (existing) return existing;
  const container = new Container();
  const line = new Graphics();
  const arrow = new Graphics();
  arrow.visible = false;
  container.addChild(line);
  container.addChild(arrow);
  const view = { container, line, arrow, lineKey: null, arrowKey: null };
  objects.edges.set(edgeId, view);
  edgeLayer.addChild(container);
  return view;
}

function getNodeView(nodeLayer: Container, labelLayer: Container, objects: PixiGraphObjects, nodeId: string) {
  const existing = objects.nodes.get(nodeId);
  if (existing) return existing;

  const container = new Container();
  const ring = new Graphics();
  const body = new Graphics();
  const slotBadge = new Graphics();
  const planBadge = new Graphics();
  const slotBadgeText = new Text({ text: "", style: whiteTextStyle(SLOT_BADGE_FONT_SIZE) });
  const planBadgeText = new Text({ text: "", style: whiteTextStyle(PLAN_BADGE_FONT_SIZE) });
  slotBadgeText.anchor.set(0.5);
  planBadgeText.anchor.set(0.5);
  container.addChild(ring);
  container.addChild(body);
  container.addChild(slotBadge);
  container.addChild(planBadge);
  container.addChild(slotBadgeText);
  container.addChild(planBadgeText);
  nodeLayer.addChild(container);

  const view = {
    container,
    ring,
    body,
    slotBadge,
    slotBadgeText,
    planBadge,
    planBadgeText,
    label: null,
    ringKey: null,
    bodyKey: null,
    slotBadgeKey: null,
    planBadgeKey: null,
  };
  objects.nodes.set(nodeId, view);
  return view;
}

function syncEdgeView(view: PixiEdgeView, x1: number, y1: number, x2: number, y2: number, style: StrokeStyle, showArrow: boolean) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy);
  view.container.visible = length > 0;
  if (!length) return;
  view.container.position.set(x1, y1);
  view.container.rotation = Math.atan2(dy, dx);

  const dashKey = style.dash ? `${style.dash[0]}:${style.dash[1]}` : "solid";
  const lineKey = `${style.color}:${style.width}:${dashKey}`;
  if (view.lineKey !== lineKey) {
    view.line.clear();
    drawLocalLine(view.line, style.dash ? 1 : length, style);
    view.lineKey = lineKey;
  }
  view.line.scale.x = style.dash ? length : length;
  view.line.alpha = style.alpha;

  view.arrow.visible = showArrow;
  if (!showArrow) return;
  view.arrow.position.set(length, 0);
  view.arrow.alpha = Math.max(style.alpha, 0.62);
  const arrowKey = `${style.color}:11`;
  if (view.arrowKey === arrowKey) return;
  view.arrow.clear();
  drawLocalArrow(view.arrow, style);
  view.arrowKey = arrowKey;
}

function syncNodeRing(view: PixiNodeView, node: SimNode, radius: number) {
  const highlighted = node.type === "confirmedPlan" || node.type === "governanceRoot" || node.type === "sourceSample";
  const key = highlighted ? `ring:${radius}` : "none";
  if (view.ringKey === key) return;
  view.ring.clear();
  if (highlighted) view.ring.circle(0, 0, radius + 7).stroke({ color: 0xbbaeff, alpha: 0.76, width: 2 });
  view.ringKey = key;
}

function syncNodeBody(view: PixiNodeView, radius: number, style: ReturnType<typeof nodeStyle>) {
  const key = `${radius}:${style.fill}:${style.alpha}:${style.stroke}:${style.strokeAlpha}:${style.strokeWidth}`;
  if (view.bodyKey === key) return;
  view.body
    .clear()
    .circle(0, 0, radius)
    .fill({ color: style.fill, alpha: style.alpha })
    .stroke({ color: style.stroke, alpha: style.strokeAlpha, width: style.strokeWidth });
  view.bodyKey = key;
}

function syncSlotBadge(view: PixiNodeView, node: SimNode, radius: number) {
  const badge = slotOrderBadge(node);
  if (!badge) {
    if (view.slotBadgeKey !== "none") {
      view.slotBadge.clear();
      view.slotBadgeKey = "none";
    }
    view.slotBadgeText.visible = false;
    return;
  }
  const x = -radius + 2;
  const y = -radius + 2;
  const key = `${radius}`;
  if (view.slotBadgeKey !== key) {
    view.slotBadge
      .clear()
      .circle(x, y, 8)
      .fill({ color: 0x111827, alpha: 0.96 })
      .stroke({ color: 0xffffff, alpha: 0.8, width: 1.5 });
    view.slotBadgeKey = key;
  }
  syncTextStyle(view.slotBadgeText, whiteTextStyle(SLOT_BADGE_FONT_SIZE), "slot");
  syncText(view.slotBadgeText, badge);
  view.slotBadgeText.position.set(x, y + 0.75);
  view.slotBadgeText.visible = true;
}

function syncPlanBadge(view: PixiNodeView, node: SimNode, radius: number) {
  const overlayColors = Array.isArray(node.data.overlayColors) ? node.data.overlayColors.filter((value): value is string => typeof value === "string") : [];
  if (!overlayColors.length) {
    if (view.planBadgeKey !== "none") {
      view.planBadge.clear();
      view.planBadgeKey = "none";
    }
    view.planBadgeText.visible = false;
    return;
  }
  const x = radius - 1;
  const y = -radius + 1;
  const count = Number(node.data.overlayUsageCount ?? overlayColors.length);
  const badgeColor = cssColorToNumber(overlayColors[0]) ?? 0x6ea8fe;
  const key = `${radius}:${badgeColor}`;
  if (view.planBadgeKey !== key) {
    view.planBadge
      .clear()
      .circle(x, y, 7)
      .fill({ color: badgeColor, alpha: 1 })
      .stroke({ color: 0xffffff, alpha: 0.86, width: 1 });
    view.planBadgeKey = key;
  }
  syncTextStyle(view.planBadgeText, whiteTextStyle(PLAN_BADGE_FONT_SIZE), "plan");
  syncText(view.planBadgeText, count > 1 ? String(count) : "");
  view.planBadgeText.position.set(x, y + 0.75);
  view.planBadgeText.visible = count > 1;
}

function syncNodeLabel(labelLayer: Container, view: PixiNodeView, node: SimNode, radius: number, opacity: number, mode: GraphMode) {
  const fontSize = labelFontSize(mode, node);
  if (opacity <= 0.01) {
    if (view.label) {
      view.label.destroy();
      view.label = null;
    }
    return;
  }
  const existing = view.label;
  const text = existing ?? new Text({ text: "", style: whiteTextStyle(fontSize) });
  if (!existing) {
    text.anchor.set(0.5, 0);
    labelLayer.addChild(text);
    view.label = text;
  }
  syncTextStyle(text, whiteTextStyle(fontSize), `label:${fontSize}`);
  syncText(text, node.shortLabel);
  text.position.set(node.x, nodeLabelTopY(node, radius, fontSize));
  text.alpha = opacity;
  text.visible = true;
}

function labelFontSize(mode: GraphMode, node: SimNode) {
  if (mode === "structure" && (node.group === "script" || node.group === "rhythm" || node.group === "packaging")) return NODE_LABEL_FONT_SIZE;
  if (mode === "structure") return PROMINENT_NODE_LABEL_FONT_SIZE;
  if (mode === "planTrace" && node.type === "sourceVariant") return NODE_LABEL_FONT_SIZE;
  if (node.type === "governanceRoot" || node.type === "confirmedPlan" || node.type === "sourceVariant") return PROMINENT_NODE_LABEL_FONT_SIZE;
  return NODE_LABEL_FONT_SIZE;
}

function nodeLabelTopY(node: SimNode, radius: number, fontSize: number) {
  return node.y + radius + SVG_LABEL_BASELINE_GAP - (fontSize * SVG_BASELINE_TO_TEXT_TOP_RATIO);
}

function syncText(text: Text, value: string) {
  if (text.text !== value) text.text = value;
}

function syncTextStyle(text: Text, style: TextStyleOptions, key: string) {
  if (textStyleKeys.get(text) === key) return;
  text.style = style;
  textStyleKeys.set(text, key);
}

function whiteTextStyle(fontSize: number): TextStyleOptions {
  const key = `${fontSize}`;
  const cached = textStyleCache.get(key);
  if (cached) return cached;
  const style: TextStyleOptions = {
    fontFamily: "Inter, Arial, sans-serif",
    fontSize,
    fontWeight: "700",
    fill: "#ffffff",
  };
  textStyleCache.set(key, style);
  return style;
}

function nodePositionMap(nodes: SimNode[]) {
  const cached = nodePositionCache.get(nodes);
  if (cached) return cached;
  const positions = new Map(nodes.map((node) => [node.id, node]));
  nodePositionCache.set(nodes, positions);
  return positions;
}

function edgeByIdMap(edges: FunctionSlotGraphEdge[]) {
  const cached = edgeByIdCache.get(edges);
  if (cached) return cached;
  const edgeById = new Map(edges.map((edge) => [edge.id, edge]));
  edgeByIdCache.set(edges, edgeById);
  return edgeById;
}

function affectedFocusNodeIds(nodes: SimNode[], previous: PixiGraphRenderState, next: PixiGraphRenderState) {
  if (previous.hasFocusNode !== next.hasFocusNode || previous.mode !== next.mode) {
    return new Set(nodes.map((node) => node.id));
  }
  const ids = new Set<string>();
  addStateNodeIds(ids, previous);
  addStateNodeIds(ids, next);
  return ids;
}

function addStateNodeIds(ids: Set<string>, state: PixiGraphRenderState) {
  if (state.selectedNodeId) ids.add(state.selectedNodeId);
  if (state.hoveredNodeId) ids.add(state.hoveredNodeId);
  if (state.pinnedPreviewNodeId) ids.add(state.pinnedPreviewNodeId);
  for (const nodeId of state.focusedIds) ids.add(nodeId);
}

function affectedFocusEdgeIds(edges: FunctionSlotGraphEdge[], previous: PixiGraphRenderState, next: PixiGraphRenderState) {
  if (previous.hasFocusNode !== next.hasFocusNode || previous.mode !== next.mode) {
    return new Set(edges.map((edge) => edge.id));
  }
  const ids = new Set<string>();
  addStateEdgeIds(ids, edges, previous);
  addStateEdgeIds(ids, edges, next);
  return ids;
}

function addStateEdgeIds(ids: Set<string>, edges: FunctionSlotGraphEdge[], state: PixiGraphRenderState) {
  if (!state.hasFocusNode) return;
  if (state.mode === "planTrace") {
    for (const edgeId of state.focusedEdgeIds) ids.add(edgeId);
    return;
  }
  const activeId = state.hoveredNodeId ?? state.selectedNodeId;
  if (!activeId) return;
  for (const edge of edges) {
    if (edge.source === activeId || edge.target === activeId) ids.add(edge.id);
  }
}

function isEdgeFocused(edge: FunctionSlotGraphEdge, state: PixiGraphRenderState) {
  if (!state.hasFocusNode) return false;
  if (state.mode === "planTrace") return state.focusedEdgeIds.has(edge.id);
  const activeId = state.hoveredNodeId ?? state.selectedNodeId;
  return edge.source === activeId || edge.target === activeId;
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
  let strokeWidth = 1;
  if (node.type === "slotInstance" || node.group === "slot") fill = 0x56d7b1;
  if (node.type === "slotFamily") { fill = 0x3f8f75; stroke = 0x60d6a4; strokeWidth = 2.4; }
  if (node.type === "slotArchetype") { fill = 0x426c9f; stroke = 0x7fb7ff; strokeWidth = 2.2; }
  if (node.type === "slotSubtype") { fill = 0x9b8132; stroke = 0xf0d36d; strokeWidth = 2.3; }
  if (node.group === "script" || layerClass.includes("script")) { fill = 0xf07070; stroke = 0xe48182; strokeWidth = 2; }
  if (node.group === "rhythm" || layerClass.includes("rhythm")) { fill = 0x58bfe7; stroke = 0x69c5e8; strokeWidth = 2; }
  if (node.group === "packaging" || layerClass.includes("packaging")) { fill = 0xb58cff; stroke = 0xa98cff; strokeWidth = 2; }
  if (node.type === "binding" || node.group === "binding") fill = 0xf0d46f;
  if (node.group === "rule" || node.group === "policy") fill = 0x7fb0ff;
  if (node.group === "unmapped" || node.group === "needReview") fill = 0xf28b82;
  if (node.type === "sourceVariant" && !layerClass) { fill = 0x111827; stroke = 0xc4cbed; strokeWidth = 1.8; }
  if (node.type === "sourceSample" || node.type === "confirmedPlan" || node.type === "governanceRoot") {
    fill = 0x05070c;
    stroke = 0xf4f6ff;
    strokeWidth = 2.8;
  }
  if (selected || pinned || focused) strokeWidth = Math.max(strokeWidth, 2.4);
  return { fill, stroke, strokeWidth, alpha: focused || !hasFocusNode ? 0.9 : 0.52, strokeAlpha: selected || pinned || focused ? 1 : 0.5 };
}

function drawLocalLine(graphics: Graphics, length: number, style: StrokeStyle) {
  if (!style.dash) {
    graphics.moveTo(0, 0).lineTo(1, 0).stroke({ color: style.color, alpha: 1, width: style.width });
    return;
  }
  const [dash, gap] = style.dash;
  if (!length) return;
  for (let cursor = 0; cursor < length; cursor += dash + gap) {
    const segmentEnd = Math.min(cursor + dash, length);
    graphics.moveTo(cursor, 0).lineTo(segmentEnd, 0).stroke({ color: style.color, alpha: 1, width: style.width });
  }
}

function drawLocalArrow(graphics: Graphics, style: StrokeStyle) {
  const size = 11;
  const left = Math.PI * 0.82;
  const right = -Math.PI * 0.82;
  graphics
    .moveTo(0, 0)
    .lineTo(Math.cos(left) * size, Math.sin(left) * size)
    .lineTo(Math.cos(right) * size, Math.sin(right) * size)
    .closePath()
    .fill({ color: style.color, alpha: 1 });
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
