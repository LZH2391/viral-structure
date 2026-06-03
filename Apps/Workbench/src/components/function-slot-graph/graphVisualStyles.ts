import type { FunctionSlotGraphEdge } from "../../types/library";
import { nodeRadius } from "./graphUtils";
import type { SimNode } from "./types";

export type GraphMode = "structure" | "governance" | "planTrace";

export type GraphStrokeStyle = {
  color: number;
  alpha: number;
  width: number;
  dash?: [number, number];
  glow?: {
    color: number;
    alpha: number;
    width: number;
  };
  arrowColor: number;
  arrowAlpha: number;
};

export type GraphNodeDrawStyle = {
  fill: number;
  fillAlpha: number;
  stroke: number;
  strokeWidth: number;
  strokeAlpha: number;
  groupAlpha: number;
  dash?: [number, number];
  glow?: {
    color: number;
    alpha: number;
    radiusPad: number;
  };
  labelFill: string;
  labelFontSize: number;
};

const WHITE = 0xffffff;
const EDGE_MARKER_COLOR = 0xffee9e;
const EDGE_MARKER_ALPHA = 0.62;

export function slotOrderBadge(node: SimNode) {
  if (!isSlotSequenceNode(node)) return null;
  const order = Number(node.data.slotOrder);
  if (!Number.isFinite(order) || order <= 0) return null;
  return order < 10 ? `0${order}` : String(order);
}

export function shouldShowNodeLabel(mode: GraphMode, node: SimNode, zoom: number) {
  return nodeLabelOpacity(mode, node, zoom) > 0.01;
}

export function nodeLabelOpacity(mode: GraphMode, node: SimNode, zoom: number) {
  if (mode !== "governance") return zoomFade(zoom, 0.45, 1, 0.58, 1);
  if (node.type === "governanceRoot" || node.type === "slotFamily" || node.type === "sourceSample") {
    return zoomFade(zoom, 0.45, 1, 0.72, 1);
  }
  if (node.type === "slotSubtype") return zoomFade(zoom, 1.05, 1.45, 0.12, 1);
  if (node.type === "sourceVariant") return zoomFade(zoom, 1.1, 1.55, 0, 1);
  if (node.type === "slotArchetype" || node.type === "implementationBundle") return zoomFade(zoom, 1.45, 1.9, 0, 1);
  return zoomFade(zoom, 1.9, 2.3, 0, 1);
}

export function nodeClassName(node: SimNode, focused: boolean, selected: boolean, pinnedPreview: boolean) {
  return nodeClassTokens(node, focused, selected, pinnedPreview).join(" ");
}

export function nodeClassTokens(node: SimNode, focused: boolean, selected: boolean, pinnedPreview: boolean) {
  return [
    "slot-graph-node",
    `node-${cssToken(node.group)}`,
    `node-type-${cssToken(node.type)}`,
    nodeLayerClass(node),
    focused ? "" : "muted",
    selected ? "selected" : "",
    pinnedPreview ? "preview-pinned" : "",
  ].filter(Boolean);
}

export function edgeClassName(type: string, source: SimNode, target: SimNode, focused: boolean, muted: boolean) {
  return edgeClassTokens(type, source, target, focused, muted).join(" ");
}

export function edgeClassTokens(type: string, source: SimNode, target: SimNode, focused: boolean, muted: boolean) {
  return [
    "slot-graph-edge",
    `edge-${cssToken(type)}`,
    edgeLayerClass(source, target),
    focused ? "focused" : "",
    muted ? "muted" : "",
  ].filter(Boolean);
}

export function edgeMarkerEnd(type: string, source: SimNode, target: SimNode) {
  return isSlotSequenceEdge(type, source, target) ? "url(#slot-graph-arrow)" : undefined;
}

export function edgeLinePoints(type: string, source: SimNode, target: SimNode) {
  if (!isSlotSequenceEdge(type, source, target)) {
    return { x1: source.x, y1: source.y, x2: target.x, y2: target.y };
  }
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const distance = Math.hypot(dx, dy);
  if (!distance) return { x1: source.x, y1: source.y, x2: target.x, y2: target.y };
  const ux = dx / distance;
  const uy = dy / distance;
  const sourceGap = nodeRadius(source) + 4;
  const targetGap = nodeRadius(target) + 2;
  return {
    x1: source.x + ux * sourceGap,
    y1: source.y + uy * sourceGap,
    x2: target.x - ux * targetGap,
    y2: target.y - uy * targetGap,
  };
}

export function isSlotSequenceNode(node: SimNode) {
  return node.type === "slotInstance" || node.type === "slotSubtype";
}

export function nodeLayerClass(node: SimNode) {
  const layer = typeof node.data.layer === "string" ? node.data.layer : node.group;
  if (layer === "script" || layer === "rhythm" || layer === "packaging") return `node-layer-${layer}`;
  return "";
}

export function edgeLayerClass(source: SimNode, target: SimNode) {
  const layer = [source, target]
    .map((node) => typeof node.data.layer === "string" ? node.data.layer : node.group)
    .find((value) => value === "script" || value === "rhythm" || value === "packaging");
  return layer ? `edge-layer-${layer}` : "";
}

export function resolveGraphEdgeStyle(edge: FunctionSlotGraphEdge, source: SimNode, target: SimNode, mode: GraphMode, focused: boolean, muted: boolean): GraphStrokeStyle {
  const classes = classSet(edgeClassTokens(edge.type, source, target, focused, muted));
  let stroke = rgba(0x97a3b9, 0.22);
  let opacity = 0.34;
  let width = 1.1;
  let dash: [number, number] | undefined;
  let glow: GraphStrokeStyle["glow"] | undefined;

  if (classes.has("focused")) {
    stroke = rgba(0xc4bbff, 0.94);
    width = 3;
    glow = { color: 0xbbaeff, alpha: 0.42, width: 10 };
    opacity = 1;
  }
  if (classes.has("muted")) opacity = 0.18;
  if (classes.has("edge-slot_next") || classes.has("edge-slot_instance_of_concept")) {
    stroke = rgba(0x60d6a4, 0.58);
    width = 1.8;
  }
  if (classes.has("edge-slot_next") || classes.has("edge-plan_slot_next")) {
    stroke = rgba(0xffee9e, 0.56);
    width = 1.9;
    opacity = 0.48;
  }
  if (classes.has("edge-binding_targets_slot") || classes.has("edge-binding_targets_atom")) {
    dash = [7, 7];
    stroke = rgba(0xd6c066, 0.46);
    width = 1.5;
  }
  if (classes.has("edge-plan_uses_slot") || classes.has("edge-plan_uses_slot_family") || classes.has("edge-plan_uses_slot_subtype")) {
    stroke = rgba(0xf4f6ff, 0.78);
    width = 2.6;
  }
  if (classes.has("edge-slot_traced_to_semantic") || classes.has("edge-subtype_to_atom_archetype")) {
    stroke = rgba(0xf0d36d, 0.7);
    width = 2.3;
  }
  if (classes.has("edge-governance_contains_family") || classes.has("edge-slot_family_to_archetype") || classes.has("edge-family_to_archetype")) {
    stroke = rgba(0x7fb7ff, 0.72);
    width = 2.2;
  }
  if (classes.has("edge-slot_archetype_to_subtype") || classes.has("edge-archetype_to_subtype")) {
    stroke = rgba(0xf0d36d, 0.78);
    width = 2.3;
  }
  if (
    classes.has("edge-subtype_to_atom_pattern")
    || classes.has("edge-slot_uses_atom_layer")
    || classes.has("edge-atom_layer_to_pattern")
    || classes.has("edge-atom_archetype_to_pattern")
  ) {
    width = 1.9;
  }
  if (classes.has("edge-layer-script")) stroke = rgba(0xe48182, 0.62);
  if (classes.has("edge-layer-rhythm")) stroke = rgba(0x69c5e8, 0.62);
  if (classes.has("edge-layer-packaging")) stroke = rgba(0xa98cff, 0.62);
  if (classes.has("edge-pattern_to_source_variant") || classes.has("edge-traced_to_source_sample") || classes.has("edge-traced_to_source_variant")) {
    stroke = rgba(0xc4cbed, 0.42);
    width = 1.55;
    dash = [7, 7];
  }

  if (mode === "planTrace") {
    opacity = 0.36;
    if (classes.has("edge-plan_uses_slot_subtype")) {
      stroke = rgba(0xffee9e, 0.82);
      width = 2.8;
    }
    if (classes.has("edge-plan_slot_next")) {
      stroke = rgba(0xffee9e, 0.88);
      width = 2.6;
      opacity = 0.68;
    }
    if (classes.has("edge-traced_to_source_variant")) {
      stroke = rgba(0xb2cdff, 0.68);
      width = 1.9;
      dash = undefined;
    }
    if (classes.has("edge-traced_to_source_variant") && classes.has("edge-layer-script")) stroke = rgba(0xe48182, 0.72);
    if (classes.has("edge-traced_to_source_variant") && classes.has("edge-layer-rhythm")) stroke = rgba(0x69c5e8, 0.72);
    if (classes.has("edge-traced_to_source_variant") && classes.has("edge-layer-packaging")) stroke = rgba(0xa98cff, 0.72);
    if (classes.has("edge-source_variant_to_sample")) {
      stroke = rgba(0xebf0ff, 0.56);
      width = 1.7;
      dash = [5, 6];
    }
    if (classes.has("focused")) {
      stroke = rgba(WHITE, 0.96);
      width = 3.4;
      glow = { color: 0xbbaeff, alpha: 0.42, width: 10 };
    }
    if (classes.has("muted")) opacity = 0.08;
  }

  return {
    color: stroke.color,
    alpha: stroke.alpha * opacity,
    width,
    dash,
    glow,
    arrowColor: EDGE_MARKER_COLOR,
    arrowAlpha: EDGE_MARKER_ALPHA,
  };
}

export function resolveGraphNodeStyle(node: SimNode, mode: GraphMode, focused: boolean, selected: boolean, pinned: boolean, hovered: boolean): GraphNodeDrawStyle {
  const classes = classSet(nodeClassTokens(node, focused, selected, pinned));
  const className = [...classes].join(" ");
  let fill = 0x000000;
  let circleOpacity = 0.78;
  let stroke = rgba(WHITE, 0.5);
  let strokeWidth = 1;
  let dash: [number, number] | undefined;
  let glow: GraphNodeDrawStyle["glow"] | undefined;
  let groupAlpha = 1;
  let labelFontSize = 11;

  if (mode === "structure") labelFontSize = 12;
  if (mode === "structure" && (classes.has("node-script") || classes.has("node-rhythm") || classes.has("node-packaging"))) labelFontSize = 11;

  if (selected || pinned || hovered) {
    stroke = rgba(WHITE, 1);
    strokeWidth = 2;
    circleOpacity = 1;
  }
  if (pinned) glow = { color: 0x8b5cf6, alpha: 0.26, radiusPad: 14 };
  if (classes.has("muted")) groupAlpha = mode === "planTrace" ? 0.26 : 0.52;
  if (classes.has("node-library")) {
    fill = 0x8b5cf6;
    glow = { color: 0x8b5cf6, alpha: 0.18, radiusPad: 10 };
  }
  if (classes.has("node-slot")) {
    fill = 0x56d7b1;
    glow = { color: 0x56d7b1, alpha: 0.18, radiusPad: 8 };
  }
  if (classes.has("node-type-slotFamily")) {
    fill = 0x3f8f75;
    stroke = rgba(0x60d6a4, 1);
    strokeWidth = 2.4;
    glow = { color: 0x60d6a4, alpha: 0.15, radiusPad: 11 };
  }
  if (classes.has("node-type-slotArchetype")) {
    fill = 0x426c9f;
    stroke = rgba(0x7fb7ff, 1);
    strokeWidth = 2.2;
    glow = { color: 0x7fb7ff, alpha: 0.14, radiusPad: 10 };
  }
  if (classes.has("node-type-slotSubtype")) {
    fill = 0x9b8132;
    stroke = rgba(0xf0d36d, 1);
    strokeWidth = 2.3;
    glow = { color: 0xf0d36d, alpha: mode === "planTrace" ? 0.17 : 0.14, radiusPad: mode === "planTrace" ? 13 : 11 };
  }
  if (classes.has("node-type-tracedSlot")) {
    fill = 0x69dfc4;
    stroke = rgba(0xdff9f2, 0.92);
    strokeWidth = 1.8;
    glow = { color: 0x69dfc4, alpha: 0.13, radiusPad: 10 };
  }
  if (classes.has("node-type-atomArchetype")) {
    strokeWidth = Math.max(strokeWidth, 2.2);
    labelFontSize = 11;
  }
  if (classes.has("node-slotReview")) {
    fill = 0xf2b84b;
    glow = { color: 0xf2b84b, alpha: 0.18, radiusPad: 8 };
  }
  if (classes.has("node-script") || classes.has("node-layer-script")) {
    fill = 0xf07070;
    stroke = rgba(0xe48182, 1);
    strokeWidth = 2;
    glow = { color: 0xe48182, alpha: 0.14, radiusPad: mode === "planTrace" ? 9 : 8 };
  }
  if (classes.has("node-rhythm") || classes.has("node-layer-rhythm")) {
    fill = 0x58bfe7;
    stroke = rgba(0x69c5e8, 1);
    strokeWidth = 2;
    glow = { color: 0x69c5e8, alpha: 0.14, radiusPad: mode === "planTrace" ? 9 : 8 };
  }
  if (classes.has("node-packaging") || classes.has("node-layer-packaging")) {
    fill = 0xb58cff;
    stroke = rgba(0xa98cff, 1);
    strokeWidth = 2;
    glow = { color: 0xa98cff, alpha: 0.14, radiusPad: mode === "planTrace" ? 9 : 8 };
  }
  if (classes.has("node-concept")) {
    fill = 0x35c98a;
    dash = [4, 3];
    glow = { color: 0x35c98a, alpha: 0.16, radiusPad: 8 };
  }
  if (className.includes("node-binding")) fill = 0xf0d46f;
  if (classes.has("node-governance") || classes.has("node-type-governanceRoot")) {
    fill = 0x05070c;
    stroke = rgba(0xf4f6ff, 0.96);
    dash = undefined;
    strokeWidth = 3;
    glow = { color: 0xbbaeff, alpha: 0.14, radiusPad: 18 };
  }
  if (classes.has("node-type-governanceRoot")) labelFontSize = 12;
  if (classes.has("node-policy") || classes.has("node-rule")) fill = 0x7fb0ff;
  if (classes.has("node-bundle")) {
    fill = 0xf6c86b;
    dash = [5, 3];
  }
  if (classes.has("node-unmapped") || classes.has("node-needReview")) {
    fill = 0xf28b82;
    glow = { color: 0xf28b82, alpha: 0.16, radiusPad: 8 };
  }
  if (classes.has("node-sourceVariant")) {
    fill = 0x111827;
    stroke = rgba(0xc4cbed, 0.82);
    dash = [5, 4];
    strokeWidth = 1.8;
    circleOpacity = 0.9;
    labelFontSize = 12;
  }
  if (mode === "planTrace" && classes.has("node-sourceVariant")) {
    fill = 0x182235;
    stroke = rgba(0xb2cdff, 0.95);
    dash = undefined;
    strokeWidth = 2.2;
    glow = { color: 0x7fb7ff, alpha: 0.1, radiusPad: 9 };
    circleOpacity = 1;
    labelFontSize = 11;
  }
  if (mode === "planTrace" && classes.has("node-sourceVariant") && classes.has("node-layer-script")) {
    fill = 0xf07070;
    stroke = rgba(0xe48182, 1);
    glow = { color: 0xe48182, alpha: 0.14, radiusPad: 9 };
  }
  if (mode === "planTrace" && classes.has("node-sourceVariant") && classes.has("node-layer-rhythm")) {
    fill = 0x58bfe7;
    stroke = rgba(0x69c5e8, 1);
    glow = { color: 0x69c5e8, alpha: 0.14, radiusPad: 9 };
  }
  if (mode === "planTrace" && classes.has("node-sourceVariant") && classes.has("node-layer-packaging")) {
    fill = 0xb58cff;
    stroke = rgba(0xa98cff, 1);
    glow = { color: 0xa98cff, alpha: 0.14, radiusPad: 9 };
  }
  if (classes.has("node-sourceSample")) {
    fill = 0x05070c;
    stroke = rgba(0xf4f6ff, 0.94);
    dash = undefined;
    strokeWidth = 2.6;
    glow = { color: 0xbbaeff, alpha: 0.14, radiusPad: 14 };
    circleOpacity = 1;
    labelFontSize = 11;
  }
  if (classes.has("node-plan")) {
    fill = 0x05070c;
    stroke = rgba(0xf4f6ff, 0.96);
    dash = undefined;
    strokeWidth = 3;
    glow = { color: 0xbbaeff, alpha: 0.14, radiusPad: 18 };
    labelFontSize = 12;
  }
  if (classes.has("node-projected")) {
    fill = 0x4b5563;
    stroke = rgba(WHITE, 0.62);
  }

  return {
    fill,
    fillAlpha: circleOpacity,
    stroke: stroke.color,
    strokeWidth,
    strokeAlpha: stroke.alpha,
    groupAlpha,
    dash,
    glow,
    labelFill: "#ffffff",
    labelFontSize,
  };
}

function isSlotSequenceEdge(type: string, source: SimNode, target: SimNode) {
  return (type === "slot_next" || type === "plan_slot_next")
    && isSlotSequenceNode(source)
    && isSlotSequenceNode(target);
}

function zoomFade(zoom: number, start: number, end: number, min: number, max: number) {
  if (zoom <= start) return min;
  if (zoom >= end) return max;
  return min + ((zoom - start) / (end - start)) * (max - min);
}

function cssToken(value: unknown) {
  return String(value ?? "").replace(/[^A-Za-z0-9_-]/g, "_");
}

function classSet(tokens: string[]) {
  return new Set(tokens);
}

function rgba(color: number, alpha: number) {
  return { color, alpha };
}
