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
  glow: Graphics;
  line: Graphics;
  arrow: Graphics;
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

type StrokeStyle = {
  color: number;
  alpha: number;
  width: number;
  dash?: [number, number];
  glow?: {
    color: number;
    alpha: number;
    width: number;
  };
};

type NodeDrawStyle = {
  fill: number;
  stroke: number;
  strokeWidth: number;
  alpha: number;
  strokeAlpha: number;
  groupAlpha: number;
  dash?: [number, number];
  glow?: {
    color: number;
    alpha: number;
    radiusPad: number;
  };
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
    view.container.alpha = style.groupAlpha;

    syncNodeRing(view, node, radius);
    syncNodeGlow(view, radius, style);
    syncNodeBody(view, radius, style);

    syncSlotBadge(view, node, radius);
    syncPlanBadge(view, node, radius);
    syncNodeLabel(labelLayer, view, node, radius, nodeLabelOpacity(state.mode, node, zoom), state.mode, style.groupAlpha);
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

export function syncPixiFocus(objects: PixiGraphObjects, edges: FunctionSlotGraphEdge[], nodes: SimNode[], previous: PixiGraphRenderState, next: PixiGraphRenderState, zoom: number) {
  const positions = nodePositionMap(nodes);
  const nodeIds = affectedFocusNodeIds(nodes, previous, next);
  for (const nodeId of nodeIds) {
    const node = positions.get(nodeId);
    const view = objects.nodes.get(nodeId);
    if (!node || !view) return false;
    const focused = next.hasFocusNode && (node.id === next.hoveredNodeId || node.id === next.selectedNodeId || next.focusedIds.has(node.id));
    const selected = node.id === next.selectedNodeId;
    const pinned = node.id === next.pinnedPreviewNodeId;
    const radius = nodeRadius(node);
    const style = nodeStyle(node, focused, selected, pinned, next.mode, next.hasFocusNode);
    view.container.alpha = style.groupAlpha;
    syncNodeGlow(view, radius, style);
    syncNodeBody(view, radius, style);
    if (view.label) view.label.alpha = nodeLabelOpacity(next.mode, node, zoom) * style.groupAlpha;
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
  const glow = new Graphics();
  const line = new Graphics();
  const arrow = new Graphics();
  arrow.visible = false;
  glow.visible = false;
  container.addChild(glow);
  container.addChild(line);
  container.addChild(arrow);
  const view = { container, glow, line, arrow, glowKey: null, lineKey: null, arrowKey: null };
  objects.edges.set(edgeId, view);
  edgeLayer.addChild(container);
  return view;
}

function getNodeView(nodeLayer: Container, labelLayer: Container, objects: PixiGraphObjects, nodeId: string) {
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

function syncEdgeView(view: PixiEdgeView, x1: number, y1: number, x2: number, y2: number, style: StrokeStyle, showArrow: boolean) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy);
  view.container.visible = length > 0;
  if (!length) return;
  view.container.position.set(x1, y1);
  view.container.rotation = Math.atan2(dy, dx);

  const dashKey = style.dash ? `${style.dash[0]}:${style.dash[1]}:${Math.round(length)}` : "solid";
  const lineKey = `${style.color}:${style.width}:${dashKey}`;
  if (view.lineKey !== lineKey) {
    view.line.clear();
    drawLocalLine(view.line, length, style);
    view.lineKey = lineKey;
  }
  view.line.scale.x = style.dash ? 1 : length;
  view.line.alpha = style.alpha;

  const glow = style.glow;
  view.glow.visible = Boolean(glow);
  if (glow) {
    const glowKey = `${glow.color}:${glow.alpha}:${glow.width}:${Math.round(length)}`;
    if (view.glowKey !== glowKey) {
      view.glow
        .clear()
        .moveTo(0, 0)
        .lineTo(length, 0)
        .stroke({ color: glow.color, alpha: glow.alpha, width: glow.width });
      view.glowKey = glowKey;
    }
  } else if (view.glowKey !== "none") {
    view.glow.clear();
    view.glowKey = "none";
  }

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
  if (highlighted) drawCircleStroke(view.ring, radius + 7, 0xbbaeff, 0.76, 2, [6, 7]);
  view.ringKey = key;
}

function syncNodeGlow(view: PixiNodeView, radius: number, style: NodeDrawStyle) {
  const glow = style.glow;
  const key = glow ? `${radius}:${glow.color}:${glow.alpha}:${glow.radiusPad}` : "none";
  if (view.glowKey === key) return;
  view.glow.clear();
  if (glow) view.glow.circle(0, 0, radius + glow.radiusPad).fill({ color: glow.color, alpha: glow.alpha });
  view.glowKey = key;
}

function syncNodeBody(view: PixiNodeView, radius: number, style: NodeDrawStyle) {
  const dashKey = style.dash ? `${style.dash[0]}:${style.dash[1]}` : "solid";
  const key = `${radius}:${style.fill}:${style.alpha}:${style.stroke}:${style.strokeAlpha}:${style.strokeWidth}:${dashKey}`;
  if (view.bodyKey === key) return;
  view.body
    .clear()
    .circle(0, 0, radius)
    .fill({ color: style.fill, alpha: style.alpha });
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

function syncNodeLabel(labelLayer: Container, view: PixiNodeView, node: SimNode, radius: number, opacity: number, mode: GraphMode, groupAlpha: number) {
  const fontSize = labelFontSize(mode, node);
  const fill = labelFill(mode, node);
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
  syncTextStyle(text, textStyle(fontSize, fill), `label:${fontSize}:${fill}`);
  syncText(text, node.shortLabel);
  text.position.set(node.x, nodeLabelTopY(node, radius, fontSize));
  text.alpha = opacity * groupAlpha;
  text.visible = true;
}

function labelFontSize(mode: GraphMode, node: SimNode) {
  if (mode === "structure" && (node.group === "script" || node.group === "rhythm" || node.group === "packaging")) return NODE_LABEL_FONT_SIZE;
  if (mode === "structure") return PROMINENT_NODE_LABEL_FONT_SIZE;
  if (mode === "planTrace" && node.type === "sourceVariant") return NODE_LABEL_FONT_SIZE;
  if (node.type === "governanceRoot" || node.type === "confirmedPlan" || node.type === "sourceVariant") return PROMINENT_NODE_LABEL_FONT_SIZE;
  return NODE_LABEL_FONT_SIZE;
}

function labelFill(mode: GraphMode, node: SimNode) {
  const layer = typeof node.data.layer === "string" ? node.data.layer : node.group;
  if (node.type === "governanceRoot" || node.type === "confirmedPlan" || node.type === "sourceSample") return "#f7f8ff";
  if (node.type === "slotFamily") return "#a7f2d1";
  if (node.type === "slotArchetype") return "#c4ddff";
  if (node.type === "slotSubtype") return "#ffe58f";
  if (mode === "planTrace" && node.type === "sourceVariant" && layer === "script") return "#ffc3c2";
  if (mode === "planTrace" && node.type === "sourceVariant" && layer === "rhythm") return "#bdeaff";
  if (mode === "planTrace" && node.type === "sourceVariant" && layer === "packaging") return "#d8ccff";
  if (node.type === "sourceVariant") return mode === "planTrace" ? "#eaf1ff" : "rgba(234, 239, 255, 0.86)";
  if (layer === "script") return "#ffc3c2";
  if (layer === "rhythm") return "#bdeaff";
  if (layer === "packaging") return "#d8ccff";
  return "#ffffff";
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

function edgeStyle(edge: FunctionSlotGraphEdge, source: SimNode, target: SimNode, focused: boolean, muted: boolean, mode: GraphMode): StrokeStyle {
  let color = 0x97a3b9;
  let strokeAlpha = 0.22;
  let opacity = mode === "planTrace" ? 0.36 : 0.34;
  let width = 1.1;
  let dash: [number, number] | undefined;
  let glow: StrokeStyle["glow"] | undefined;

  if (focused) {
    color = mode === "planTrace" ? 0xffffff : 0xc4bbff;
    strokeAlpha = mode === "planTrace" ? 0.96 : 0.94;
    width = mode === "planTrace" ? 3.4 : 3;
    opacity = 1;
    glow = { color: 0xbbaeff, alpha: 0.42, width: 10 };
  }

  if (edge.type === "slot_next" || edge.type === "slot_instance_of_concept") {
    color = 0x60d6a4;
    strokeAlpha = 0.58;
    width = 1.8;
  }
  if (edge.type === "slot_next" || edge.type === "plan_slot_next") {
    color = 0xffee9e;
    strokeAlpha = 0.56;
    width = 1.9;
    opacity = 0.48;
  }
  if (edge.type === "binding_targets_slot" || edge.type === "binding_targets_atom") {
    color = 0xd6c066;
    strokeAlpha = 0.46;
    width = 1.5;
    dash = [7, 7];
  }
  if (edge.type === "plan_uses_slot" || edge.type === "plan_uses_slot_family" || edge.type === "plan_uses_slot_subtype") {
    color = 0xf4f6ff;
    strokeAlpha = 0.78;
    width = 2.6;
  }
  if (edge.type === "slot_traced_to_semantic" || edge.type === "subtype_to_atom_archetype") {
    color = 0xf0d36d;
    strokeAlpha = 0.7;
    width = 2.3;
  }
  if (edge.type === "governance_contains_family" || edge.type === "slot_family_to_archetype" || edge.type === "family_to_archetype") {
    color = 0x7fb7ff;
    strokeAlpha = 0.72;
    width = 2.2;
  }
  if (edge.type === "slot_archetype_to_subtype" || edge.type === "archetype_to_subtype") {
    color = 0xf0d36d;
    strokeAlpha = 0.78;
    width = 2.3;
  }
  if (
    edge.type === "subtype_to_atom_pattern"
    || edge.type === "slot_uses_atom_layer"
    || edge.type === "atom_layer_to_pattern"
    || edge.type === "atom_archetype_to_pattern"
  ) {
    width = 1.9;
  }

  const layerClass = edgeLayerClass(source, target);
  if (layerClass.includes("script")) { color = 0xe48182; strokeAlpha = Math.max(strokeAlpha, 0.62); }
  if (layerClass.includes("rhythm")) { color = 0x69c5e8; strokeAlpha = Math.max(strokeAlpha, 0.62); }
  if (layerClass.includes("packaging")) { color = 0xa98cff; strokeAlpha = Math.max(strokeAlpha, 0.62); }

  if (edge.type === "pattern_to_source_variant" || edge.type === "traced_to_source_sample" || edge.type === "traced_to_source_variant") {
    color = 0xc4cbed;
    strokeAlpha = 0.42;
    width = 1.55;
    dash = [7, 7];
  }

  if (mode === "planTrace") {
    if (edge.type === "plan_uses_slot_subtype") {
      color = 0xffee9e;
      strokeAlpha = 0.82;
      width = 2.8;
    }
    if (edge.type === "plan_slot_next") {
      color = 0xffee9e;
      strokeAlpha = 0.88;
      width = 2.6;
      opacity = 0.68;
    }
    if (edge.type === "traced_to_source_variant") {
      color = 0xb2cdff;
      strokeAlpha = 0.68;
      width = 1.9;
      dash = undefined;
      if (layerClass.includes("script")) { color = 0xe48182; strokeAlpha = 0.72; }
      if (layerClass.includes("rhythm")) { color = 0x69c5e8; strokeAlpha = 0.72; }
      if (layerClass.includes("packaging")) { color = 0xa98cff; strokeAlpha = 0.72; }
    }
    if (edge.type === "source_variant_to_sample") {
      color = 0xebf0ff;
      strokeAlpha = 0.56;
      width = 1.7;
      dash = [5, 6];
    }
    if (focused) {
      color = 0xffffff;
      strokeAlpha = 0.96;
      width = 3.4;
      opacity = 1;
      dash = undefined;
      glow = { color: 0xbbaeff, alpha: 0.42, width: 10 };
    }
  }

  if (muted) opacity = mode === "planTrace" ? 0.08 : 0.18;
  return { color, alpha: strokeAlpha * opacity, width, dash, glow };
}

function nodeStyle(node: SimNode, focused: boolean, selected: boolean, pinned: boolean, mode: GraphMode, hasFocusNode: boolean): NodeDrawStyle {
  const layerClass = mode === "planTrace" && node.type === "sourceVariant" ? edgeLayerClass(node, node) : "";
  let fill = 0x8b5cf6;
  let stroke = 0xffffff;
  let strokeWidth = 1;
  let alpha = 0.78;
  let strokeAlpha = 0.5;
  let dash: [number, number] | undefined;
  let glow: NodeDrawStyle["glow"] | undefined;

  if (node.type === "slotInstance" || node.group === "slot") {
    fill = 0x56d7b1;
    glow = { color: 0x56d7b1, alpha: 0.18, radiusPad: 10 };
  }
  if (node.type === "slotFamily") {
    fill = 0x3f8f75;
    stroke = 0x60d6a4;
    strokeWidth = 2.4;
    glow = { color: 0x60d6a4, alpha: 0.15, radiusPad: 11 };
  }
  if (node.type === "slotArchetype") {
    fill = 0x426c9f;
    stroke = 0x7fb7ff;
    strokeWidth = 2.2;
    glow = { color: 0x7fb7ff, alpha: 0.14, radiusPad: 10 };
  }
  if (node.type === "slotSubtype") {
    fill = 0x9b8132;
    stroke = 0xf0d36d;
    strokeWidth = 2.3;
    glow = { color: 0xf0d36d, alpha: mode === "planTrace" ? 0.17 : 0.14, radiusPad: mode === "planTrace" ? 13 : 11 };
  }
  if (node.group === "script" || layerClass.includes("script")) {
    fill = 0xf07070;
    stroke = 0xe48182;
    strokeWidth = 2;
    glow = { color: 0xe48182, alpha: 0.14, radiusPad: mode === "planTrace" ? 9 : 8 };
  }
  if (node.group === "rhythm" || layerClass.includes("rhythm")) {
    fill = 0x58bfe7;
    stroke = 0x69c5e8;
    strokeWidth = 2;
    glow = { color: 0x69c5e8, alpha: 0.14, radiusPad: mode === "planTrace" ? 9 : 8 };
  }
  if (node.group === "packaging" || layerClass.includes("packaging")) {
    fill = 0xb58cff;
    stroke = 0xa98cff;
    strokeWidth = 2;
    glow = { color: 0xa98cff, alpha: 0.14, radiusPad: mode === "planTrace" ? 9 : 8 };
  }
  if (node.type === "binding" || node.group === "binding") fill = 0xf0d46f;
  if (node.group === "rule" || node.group === "policy") fill = 0x7fb0ff;
  if (node.group === "unmapped" || node.group === "needReview") fill = 0xf28b82;
  if (node.type === "slotConcept") {
    fill = 0x35c98a;
    dash = [4, 3];
    glow = { color: 0x35c98a, alpha: 0.16, radiusPad: 8 };
  }
  if (node.type === "implementationBundle" || node.group === "bundle") {
    fill = 0xf6c86b;
    dash = [5, 3];
  }
  if (node.group === "unmapped" || node.group === "needReview" || node.type === "unmappedVariant") {
    fill = 0xf28b82;
    glow = { color: 0xf28b82, alpha: 0.16, radiusPad: 8 };
  }
  if (node.type === "sourceVariant" && !layerClass) {
    fill = mode === "planTrace" ? 0x182235 : 0x111827;
    stroke = mode === "planTrace" ? 0xb2cdff : 0xc4cbed;
    strokeWidth = mode === "planTrace" ? 2.2 : 1.8;
    strokeAlpha = mode === "planTrace" ? 0.95 : 0.82;
    alpha = mode === "planTrace" ? 1 : 0.9;
    dash = mode === "planTrace" ? undefined : [5, 4];
    if (mode === "planTrace") glow = { color: 0x7fb7ff, alpha: 0.1, radiusPad: 9 };
  }
  if (node.type === "sourceSample" || node.type === "confirmedPlan" || node.type === "governanceRoot") {
    fill = 0x05070c;
    stroke = 0xf4f6ff;
    strokeWidth = node.type === "sourceSample" ? 2.6 : 3;
    strokeAlpha = node.type === "sourceSample" ? 0.94 : 0.96;
    alpha = 1;
    glow = { color: 0xbbaeff, alpha: 0.14, radiusPad: node.type === "sourceSample" ? 14 : 18 };
  }
  if (node.group === "projected") {
    fill = 0x4b5563;
    stroke = 0xffffff;
    strokeAlpha = 0.62;
  }
  if (node.type === "atomArchetype") strokeWidth = Math.max(strokeWidth, 2.2);
  if (selected || pinned || focused) {
    stroke = 0xffffff;
    strokeWidth = Math.max(strokeWidth, 2);
    strokeAlpha = 1;
  }
  if (pinned) glow = { color: 0x8b5cf6, alpha: 0.26, radiusPad: 14 };
  return {
    fill,
    stroke,
    strokeWidth,
    alpha,
    strokeAlpha,
    groupAlpha: hasFocusNode && !focused ? (mode === "planTrace" ? 0.26 : 0.52) : 1,
    dash,
    glow,
  };
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
