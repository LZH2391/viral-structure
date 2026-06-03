import { Container, Graphics, Text } from "pixi.js";
import type { TextStyleOptions } from "pixi.js";
import type { FunctionSlotGraphEdge } from "../../types/library";
import { clamp, nodeRadius, VIEWBOX } from "./graphUtils";
import type { SimNode } from "./types";
import {
  edgeLinePoints,
  nodeLabelOpacity,
  resolveGraphEdgeStyle,
  resolveGraphNodeStyle,
  slotOrderBadge,
  type GraphMode,
  type GraphNodeDrawStyle,
  type GraphStrokeStyle,
} from "./graphVisualStyles";

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

export type PixiAlphaSnapshot = {
  nodes: Map<string, { container: number; label: number | null }>;
  edges: Map<string, { line: number; arrow: number; glow: number }>;
};

type PixiEdgeView = {
  container: Container;
  glow: Graphics;
  line: Graphics;
  arrow: Graphics;
  style: GraphStrokeStyle | null;
  showArrow: boolean;
  glowKey: string | null;
  lineKey: string | null;
  arrowKey: string | null;
};

type PixiNodeView = {
  container: Container;
  glow: Graphics;
  ring: Graphics;
  body: Graphics;
  slotBadge: Graphics;
  slotBadgeText: Text;
  planBadge: Graphics;
  planBadgeText: Text;
  label: Text | null;
  glowKey: string | null;
  ringKey: string | null;
  bodyKey: string | null;
  slotBadgeKey: string | null;
  planBadgeKey: string | null;
};

const textStyleKeys = new WeakMap<Text, string>();
const textStyleCache = new Map<string, TextStyleOptions>();
const nodePositionCache = new WeakMap<SimNode[], Map<string, SimNode>>();
const edgeByIdCache = new WeakMap<FunctionSlotGraphEdge[], Map<string, FunctionSlotGraphEdge>>();
const SVG_LABEL_BASELINE_GAP = 14;
const SVG_BASELINE_TO_TEXT_TOP_RATIO = 0.82;
const SLOT_BADGE_FONT_SIZE = 6;
const PLAN_BADGE_FONT_SIZE = 7;

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

export function capturePixiAlphaSnapshot(objects: PixiGraphObjects): PixiAlphaSnapshot {
  return {
    nodes: new Map([...objects.nodes.entries()].map(([id, view]) => [id, { container: view.container.alpha, label: view.label?.alpha ?? null }])),
    edges: new Map([...objects.edges.entries()].map(([id, view]) => [id, { line: view.line.alpha, arrow: view.arrow.alpha, glow: view.glow.alpha }])),
  };
}

export function applyPixiAlphaTween(objects: PixiGraphObjects, start: PixiAlphaSnapshot, end: PixiAlphaSnapshot, progress: number) {
  for (const [id, target] of end.nodes.entries()) {
    const view = objects.nodes.get(id);
    if (!view) continue;
    const from = start.nodes.get(id);
    view.container.alpha = mixAlpha(from?.container ?? target.container, target.container, progress);
    if (view.label && target.label !== null) view.label.alpha = mixAlpha(from?.label ?? target.label, target.label, progress);
  }
  for (const [id, target] of end.edges.entries()) {
    const view = objects.edges.get(id);
    if (!view) continue;
    const from = start.edges.get(id);
    view.line.alpha = mixAlpha(from?.line ?? target.line, target.line, progress);
    view.arrow.alpha = mixAlpha(from?.arrow ?? target.arrow, target.arrow, progress);
    view.glow.alpha = mixAlpha(from?.glow ?? target.glow, target.glow, progress);
  }
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
    const style = resolveGraphEdgeStyle(edge, source, target, state.mode, focused, muted);
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
    const view = getNodeView(nodeLayer, objects, node.id);
    const focused = state.hasFocusNode && (node.id === state.hoveredNodeId || node.id === state.selectedNodeId || state.focusedIds.has(node.id));
    const focusMuted = state.hasFocusNode && !focused;
    const selected = node.id === state.selectedNodeId;
    const pinned = node.id === state.pinnedPreviewNodeId;
    const hovered = node.id === state.hoveredNodeId;
    const radius = nodeRadius(node);
    const style = resolveGraphNodeStyle(node, state.mode, focused, selected, pinned, hovered, focusMuted);
    view.container.position.set(node.x, node.y);
    view.container.alpha = style.groupAlpha;

    syncNodeRing(view, node, radius);
    syncNodeGlow(view, radius, style);
    syncNodeBody(view, radius, style);

    syncSlotBadge(view, node, radius);
    syncPlanBadge(view, node, radius);
    syncNodeLabel(labelLayer, view, node, radius, nodeLabelOpacity(state.mode, node, zoom), style);
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
  const scale = Math.min(size.width / VIEWBOX.width, size.height / VIEWBOX.height) || 1;
  const offsetX = (size.width - VIEWBOX.width * scale) / 2;
  const offsetY = (size.height - VIEWBOX.height * scale) / 2;
  return {
    x: (node.x * viewport.k + viewport.x) * scale + offsetX,
    y: (node.y * viewport.k + viewport.y) * scale + offsetY,
  };
}

export function syncPixiLayout(objects: PixiGraphObjects, edges: FunctionSlotGraphEdge[], nodes: SimNode[], state: PixiGraphRenderState) {
  const positions = nodePositionMap(nodes);
  for (const edge of edges) {
    const source = positions.get(edge.source);
    const target = positions.get(edge.target);
    const view = objects.edges.get(edge.id);
    if (!source || !target || !view) return false;
    const line = edgeLinePoints(edge.type, source, target);
    if (!syncEdgeGeometry(view, line.x1, line.y1, line.x2, line.y2)) return false;
  }
  for (const node of nodes) {
    const view = objects.nodes.get(node.id);
    if (!view) return false;
    view.container.position.set(node.x, node.y);
    if (view.label) {
      const radius = nodeRadius(node);
      const focused = state.hasFocusNode && (node.id === state.hoveredNodeId || node.id === state.selectedNodeId || state.focusedIds.has(node.id));
      const selected = node.id === state.selectedNodeId;
      const pinned = node.id === state.pinnedPreviewNodeId;
      const hovered = node.id === state.hoveredNodeId;
      const style = resolveGraphNodeStyle(node, state.mode, focused, selected, pinned, hovered, state.hasFocusNode && !focused);
      view.label.position.set(node.x, node.y + nodeLabelTopY(radius, style.labelFontSize));
    }
  }
  return true;
}

export function syncPixiLabels(labelLayer: Container, objects: PixiGraphObjects, nodes: SimNode[], state: PixiGraphRenderState, zoom: number) {
  for (const node of nodes) {
    const view = objects.nodes.get(node.id);
    if (!view) return false;
    const focused = state.hasFocusNode && (node.id === state.hoveredNodeId || node.id === state.selectedNodeId || state.focusedIds.has(node.id));
    const focusMuted = state.hasFocusNode && !focused;
    const selected = node.id === state.selectedNodeId;
    const pinned = node.id === state.pinnedPreviewNodeId;
    const hovered = node.id === state.hoveredNodeId;
    const radius = nodeRadius(node);
    const style = resolveGraphNodeStyle(node, state.mode, focused, selected, pinned, hovered, focusMuted);
    syncNodeLabel(labelLayer, view, node, radius, nodeLabelOpacity(state.mode, node, zoom), style);
  }
  return true;
}

export function syncPixiFocus(objects: PixiGraphObjects, edges: FunctionSlotGraphEdge[], nodes: SimNode[], previous: PixiGraphRenderState, next: PixiGraphRenderState, zoom: number) {
  const positions = nodePositionMap(nodes);
  const nodeIds = affectedFocusNodeIds(nodes, previous, next);
  for (const nodeId of nodeIds) {
    const node = positions.get(nodeId);
    const view = objects.nodes.get(nodeId);
    if (!node || !view) return false;
    const focused = next.hasFocusNode && (node.id === next.hoveredNodeId || node.id === next.selectedNodeId || next.focusedIds.has(node.id));
    const focusMuted = next.hasFocusNode && !focused;
    const selected = node.id === next.selectedNodeId;
    const pinned = node.id === next.pinnedPreviewNodeId;
    const hovered = node.id === next.hoveredNodeId;
    const radius = nodeRadius(node);
    const style = resolveGraphNodeStyle(node, next.mode, focused, selected, pinned, hovered, focusMuted);
    view.container.alpha = style.groupAlpha;
    syncNodeGlow(view, radius, style);
    syncNodeBody(view, radius, style);
    if (view.label) {
      view.label.alpha = nodeLabelOpacity(next.mode, node, zoom) * style.groupAlpha;
      syncTextStyle(view.label, textStyle(style.labelFontSize, style.labelFill), `label:${style.labelFontSize}:${style.labelFill}`);
      view.label.position.set(node.x, node.y + nodeLabelTopY(radius, style.labelFontSize));
    }
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
    const style = resolveGraphEdgeStyle(edge, source, target, next.mode, focused, muted);
    syncEdgeView(view, line.x1, line.y1, line.x2, line.y2, style, isSlotSequenceEdge(edge.type, source, target));
  }
  return true;
}

function getEdgeView(edgeLayer: Container, objects: PixiGraphObjects, edgeId: string) {
  const existing = objects.edges.get(edgeId);
  if (existing) return existing;
  const container = new Container();
  const glow = new Graphics();
  const line = new Graphics();
  const arrow = new Graphics();
  arrow.visible = false;
  glow.visible = false;
  container.addChild(glow);
  container.addChild(line);
  container.addChild(arrow);
  const view = { container, glow, line, arrow, style: null, showArrow: false, glowKey: null, lineKey: null, arrowKey: null };
  objects.edges.set(edgeId, view);
  edgeLayer.addChild(container);
  return view;
}

function getNodeView(nodeLayer: Container, objects: PixiGraphObjects, nodeId: string) {
  const existing = objects.nodes.get(nodeId);
  if (existing) return existing;

  const container = new Container();
  const glow = new Graphics();
  const ring = new Graphics();
  const body = new Graphics();
  const slotBadge = new Graphics();
  const planBadge = new Graphics();
  const slotBadgeText = new Text({ text: "", style: whiteTextStyle(SLOT_BADGE_FONT_SIZE) });
  const planBadgeText = new Text({ text: "", style: whiteTextStyle(PLAN_BADGE_FONT_SIZE) });
  slotBadgeText.anchor.set(0.5);
  planBadgeText.anchor.set(0.5);
  container.addChild(glow);
  container.addChild(ring);
  container.addChild(body);
  container.addChild(slotBadge);
  container.addChild(planBadge);
  container.addChild(slotBadgeText);
  container.addChild(planBadgeText);
  nodeLayer.addChild(container);

  const view = {
    container,
    glow,
    ring,
    body,
    slotBadge,
    slotBadgeText,
    planBadge,
    planBadgeText,
    label: null,
    glowKey: null,
    ringKey: null,
    bodyKey: null,
    slotBadgeKey: null,
    planBadgeKey: null,
  };
  objects.nodes.set(nodeId, view);
  return view;
}

function syncEdgeView(view: PixiEdgeView, x1: number, y1: number, x2: number, y2: number, style: GraphStrokeStyle, showArrow: boolean) {
  view.style = style;
  view.showArrow = showArrow;
  syncEdgeGeometry(view, x1, y1, x2, y2);
}

function syncEdgeGeometry(view: PixiEdgeView, x1: number, y1: number, x2: number, y2: number) {
  const style = view.style;
  if (!style) return false;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy);
  view.container.visible = length > 0;
  if (!length) return true;
  view.container.position.set(x1, y1);
  view.container.rotation = Math.atan2(dy, dx);

  const dashLength = style.dash ? Math.ceil(length / 12) * 12 : length;
  const dashKey = style.dash ? `${style.dash[0]}:${style.dash[1]}:${dashLength}` : "solid";
  const lineKey = `${style.color}:${style.width}:${dashKey}`;
  if (view.lineKey !== lineKey) {
    view.line.clear();
    drawLocalLine(view.line, dashLength, style);
    view.lineKey = lineKey;
  }
  view.line.scale.x = style.dash ? 1 : length;
  view.line.alpha = style.alpha;

  view.glow.visible = false;
  if (view.glowKey !== "none") {
    view.glow.clear();
    view.glowKey = "none";
  }

  view.arrow.visible = view.showArrow;
  if (!view.showArrow) return true;
  view.arrow.position.set(length, 0);
  view.arrow.alpha = style.arrowAlpha;
  const arrowKey = `${style.arrowColor}:11`;
  if (view.arrowKey === arrowKey) return true;
  view.arrow.clear();
  drawLocalArrow(view.arrow, style);
  view.arrowKey = arrowKey;
  return true;
}

function syncNodeRing(view: PixiNodeView, node: SimNode, radius: number) {
  const highlighted = node.type === "confirmedPlan" || node.type === "governanceRoot" || node.type === "sourceSample";
  const key = highlighted ? `ring:${radius}` : "none";
  if (view.ringKey === key) return;
  view.ring.clear();
  if (highlighted) drawCircleStroke(view.ring, radius + 7, 0xbbaeff, 0.76, 2, [6, 7]);
  view.ringKey = key;
}

function syncNodeGlow(view: PixiNodeView, radius: number, style: GraphNodeDrawStyle) {
  void radius;
  void style;
  if (view.glowKey === "none") return;
  view.glow.clear();
  view.glowKey = "none";
}

function syncNodeBody(view: PixiNodeView, radius: number, style: GraphNodeDrawStyle) {
  const dashKey = style.dash ? `${style.dash[0]}:${style.dash[1]}` : "solid";
  const key = `${radius}:${style.fill}:${style.fillAlpha}:${style.stroke}:${style.strokeAlpha}:${style.strokeWidth}:${dashKey}`;
  if (view.bodyKey === key) return;
  view.body
    .clear()
    .circle(0, 0, radius)
    .fill({ color: style.fill, alpha: style.fillAlpha });
  drawCircleStroke(view.body, radius, style.stroke, style.strokeAlpha, style.strokeWidth, style.dash);
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
      .stroke({ color: 0xffee9e, alpha: 0.94, width: 1.5 });
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

function syncNodeLabel(labelLayer: Container, view: PixiNodeView, node: SimNode, radius: number, opacity: number, style: GraphNodeDrawStyle) {
  if (opacity <= 0.01) {
    if (view.label) {
      view.label.destroy();
      view.label = null;
    }
    return;
  }
  const existing = view.label;
  const text = existing ?? new Text({ text: "", style: textStyle(style.labelFontSize, style.labelFill) });
  if (!existing) {
    text.anchor.set(0.5, 0);
    text.resolution = 2;
    labelLayer.addChild(text);
    view.label = text;
  }
  syncTextStyle(text, textStyle(style.labelFontSize, style.labelFill), `label:${style.labelFontSize}:${style.labelFill}`);
  syncText(text, node.shortLabel);
  text.position.set(node.x, node.y + nodeLabelTopY(radius, style.labelFontSize));
  text.alpha = opacity * style.groupAlpha;
  text.visible = true;
}

function nodeLabelTopY(radius: number, fontSize: number) {
  return radius + SVG_LABEL_BASELINE_GAP - (fontSize * SVG_BASELINE_TO_TEXT_TOP_RATIO);
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
  return textStyle(fontSize, "#ffffff");
}

function textStyle(fontSize: number, fill: string): TextStyleOptions {
  const key = `${fontSize}:${fill}`;
  const cached = textStyleCache.get(key);
  if (cached) return cached;
  const style: TextStyleOptions = {
    fontFamily: "Inter, Arial, sans-serif",
    fontSize,
    fontWeight: "700",
    fill,
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

function drawLocalLine(graphics: Graphics, length: number, style: GraphStrokeStyle) {
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

function drawCircleStroke(graphics: Graphics, radius: number, color: number, alpha: number, width: number, dash?: [number, number]) {
  if (!dash) {
    graphics.circle(0, 0, radius).stroke({ color, alpha, width });
    return;
  }
  const circumference = Math.PI * 2 * radius;
  const [dashLength, gapLength] = dash;
  const step = dashLength + gapLength;
  if (!step) return;
  for (let cursor = 0; cursor < circumference; cursor += step) {
    const start = cursor / radius;
    const end = Math.min(cursor + dashLength, circumference) / radius;
    drawArcSegment(graphics, radius, start, end, color, alpha, width);
  }
}

function drawArcSegment(graphics: Graphics, radius: number, start: number, end: number, color: number, alpha: number, width: number) {
  const segments = Math.max(3, Math.ceil((end - start) / 0.18));
  graphics.moveTo(Math.cos(start) * radius, Math.sin(start) * radius);
  for (let index = 1; index <= segments; index += 1) {
    const angle = start + ((end - start) * index) / segments;
    graphics.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
  }
  graphics.stroke({ color, alpha, width });
}

function drawLocalArrow(graphics: Graphics, style: GraphStrokeStyle) {
  const size = 11;
  const left = Math.PI * 0.82;
  const right = -Math.PI * 0.82;
  graphics
    .moveTo(0, 0)
    .lineTo(Math.cos(left) * size, Math.sin(left) * size)
    .lineTo(Math.cos(right) * size, Math.sin(right) * size)
    .closePath()
    .fill({ color: style.arrowColor, alpha: 1 });
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

function mixAlpha(start: number, end: number, progress: number) {
  return start + ((end - start) * progress);
}
