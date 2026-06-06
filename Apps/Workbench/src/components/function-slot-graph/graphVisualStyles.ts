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

export type GraphVisualTheme = {
  edge: {
    default: number;
    slot: number;
    sequence: number;
    binding: number;
    plan: number;
    semantic: number;
    hierarchy: number;
    sourceTrace: number;
    script: number;
    rhythm: number;
    packaging: number;
    focusGlowAlpha: number;
  };
  node: {
    neutral: number;
    neutralStroke: number;
    selectedStroke: number;
    library: number;
    slot: number;
    slotFamily: number;
    slotFamilyStroke: number;
    slotArchetype: number;
    slotArchetypeStroke: number;
    slotSubtype: number;
    slotSubtypeStroke: number;
    tracedSlot: number;
    tracedSlotStroke: number;
    script: number;
    scriptStroke: number;
    rhythm: number;
    rhythmStroke: number;
    packaging: number;
    packagingStroke: number;
    concept: number;
    binding: number;
    governance: number;
    governanceStroke: number;
    policy: number;
    bundle: number;
    review: number;
    sourceVariant: number;
    sourceVariantTrace: number;
    projected: number;
    pinnedGlow: number;
    landmarkGlow: number;
  };
  text: {
    label: string;
  };
};

export const GRAPH_VISUAL_THEME: GraphVisualTheme = {
  edge: {
    default: 0x8a8a86,
    slot: 0x8fc89a,
    sequence: 0xc8b46a,
    binding: 0xb7a45c,
    plan: 0xeeeeea,
    semantic: 0xc8b46a,
    hierarchy: 0x7fb7ff,
    sourceTrace: 0xaeb3ad,
    script: 0xd86a5d,
    rhythm: 0x6fa9d8,
    packaging: 0x9b8ad8,
    focusGlowAlpha: 0.28,
  },
  node: {
    neutral: 0x20201f,
    neutralStroke: 0x8a8a86,
    selectedStroke: 0xf4f3ef,
    library: 0x6f6a86,
    slot: 0x6fa77a,
    slotFamily: 0x587b60,
    slotFamilyStroke: 0x8fc89a,
    slotArchetype: 0x4e6f94,
    slotArchetypeStroke: 0x7fb7ff,
    slotSubtype: 0x8b7742,
    slotSubtypeStroke: 0xc8b46a,
    tracedSlot: 0x74b89f,
    tracedSlotStroke: 0xb8ded1,
    script: 0xc9655a,
    scriptStroke: 0xd88376,
    rhythm: 0x5d99bd,
    rhythmStroke: 0x81b9da,
    packaging: 0x8d7ac8,
    packagingStroke: 0xa998d8,
    concept: 0x5f9d78,
    binding: 0xb9a85f,
    governance: 0x20201f,
    governanceStroke: 0xeeeeea,
    policy: 0x7f9fcf,
    bundle: 0xb99655,
    review: 0xc77566,
    sourceVariant: 0x262625,
    sourceVariantTrace: 0x303846,
    projected: 0x5e5e5a,
    pinnedGlow: 0x8f879f,
    landmarkGlow: 0xb8adc8,
  },
  text: {
    label: "#eeeeea",
  },
};

type GovernanceLabelSpec = {
  start: number;
  end: number;
  min: number;
  fontSize: number;
};

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
  const spec = governanceLabelSpec(node);
  return zoomFade(zoom, spec.start, spec.end, spec.min, 1);
}

export function nodeLabelFontSize(mode: GraphMode, node: SimNode) {
  if (mode === "governance") return governanceLabelSpec(node).fontSize;
  if (mode === "structure" && (node.group === "script" || node.group === "rhythm" || node.group === "packaging")) return 11;
  return mode === "structure" ? 12 : 11;
}

export function nodeClassName(node: SimNode, focused: boolean, selected: boolean, pinnedPreview: boolean, focusMuted = false) {
  return nodeClassTokens(node, focused, selected, pinnedPreview, focusMuted).join(" ");
}

export function nodeClassTokens(node: SimNode, focused: boolean, selected: boolean, pinnedPreview: boolean, focusMuted = false) {
  return [
    "slot-graph-node",
    `node-${cssToken(node.group)}`,
    `node-type-${cssToken(node.type)}`,
    nodeLayerClass(node),
    focused ? "" : "muted",
    focusMuted ? "focus-muted" : "",
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

export function edgeMarkerEnd(type: string, source: SimNode, target: SimNode, mode: GraphMode = "structure", muted = false) {
  if (!isSlotSequenceEdge(type, source, target)) return undefined;
  if (mode === "planTrace" && muted) return "url(#slot-graph-arrow-plan-trace-muted)";
  if (mode === "planTrace") return "url(#slot-graph-arrow-plan-trace)";
  if (muted) return "url(#slot-graph-arrow-muted)";
  return "url(#slot-graph-arrow)";
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
  const theme = GRAPH_VISUAL_THEME;
  const classes = classSet(edgeClassTokens(edge.type, source, target, focused, muted));
  let stroke = rgba(theme.edge.default, 0.22);
  let opacity = 0.34;
  let width = 1.1;
  let dash: [number, number] | undefined;
  let glow: GraphStrokeStyle["glow"] | undefined;

  if (classes.has("edge-slot_next") || classes.has("edge-slot_instance_of_concept")) {
    stroke = rgba(theme.edge.slot, 0.58);
    width = 1.8;
  }
  if (classes.has("edge-slot_next") || classes.has("edge-plan_slot_next")) {
    stroke = rgba(theme.edge.sequence, 0.56);
    width = 1.9;
    opacity = 0.48;
  }
  if (classes.has("edge-binding_targets_slot") || classes.has("edge-binding_targets_atom")) {
    dash = [7, 7];
    stroke = rgba(theme.edge.binding, 0.46);
    width = 1.5;
  }
  if (classes.has("edge-plan_uses_slot") || classes.has("edge-plan_uses_slot_family") || classes.has("edge-plan_uses_slot_subtype")) {
    stroke = rgba(theme.edge.plan, 0.78);
    width = 2.6;
  }
  if (classes.has("edge-slot_traced_to_semantic") || classes.has("edge-subtype_to_atom_archetype")) {
    stroke = rgba(theme.edge.semantic, 0.7);
    width = 2.3;
  }
  if (classes.has("edge-governance_contains_family") || classes.has("edge-slot_family_to_archetype") || classes.has("edge-family_to_archetype")) {
    stroke = rgba(theme.edge.hierarchy, 0.72);
    width = 2.2;
  }
  if (classes.has("edge-slot_archetype_to_subtype") || classes.has("edge-archetype_to_subtype")) {
    stroke = rgba(theme.edge.semantic, 0.78);
    width = 2.3;
  }
  if (
    classes.has("edge-subtype_to_atom_pattern")
    || classes.has("edge-slot_uses_atom_layer")
    || classes.has("edge-atom_layer_to_pattern")
    || classes.has("edge-atom_archetype_to_pattern")
  ) {
    width = 1.9;
    opacity = Math.max(opacity, 0.44);
  }
  if (classes.has("edge-layer-script")) stroke = rgba(theme.edge.script, 0.62);
  if (classes.has("edge-layer-rhythm")) stroke = rgba(theme.edge.rhythm, 0.62);
  if (classes.has("edge-layer-packaging")) stroke = rgba(theme.edge.packaging, 0.62);
  if (
    classes.has("edge-pattern_to_source_variant")
    || classes.has("edge-source_variant_to_sample")
    || classes.has("edge-traced_to_source_sample")
    || classes.has("edge-traced_to_source_variant")
  ) {
    stroke = rgba(theme.edge.sourceTrace, 0.5);
    width = 1.55;
    dash = [7, 7];
    opacity = Math.max(opacity, 0.42);
  }

  if (mode === "planTrace") {
    opacity = 0.36;
    if (classes.has("edge-plan_uses_slot_subtype")) {
      stroke = rgba(theme.edge.sequence, 0.82);
      width = 2.8;
    }
    if (classes.has("edge-plan_slot_next")) {
      stroke = rgba(theme.edge.sequence, 0.88);
      width = 2.2;
      opacity = 0.36;
    }
    if (classes.has("edge-traced_to_source_variant")) {
      stroke = rgba(theme.edge.hierarchy, 0.68);
      width = 1.9;
      dash = undefined;
    }
    if (classes.has("edge-traced_to_source_variant") && classes.has("edge-layer-script")) stroke = rgba(theme.edge.script, 0.72);
    if (classes.has("edge-traced_to_source_variant") && classes.has("edge-layer-rhythm")) stroke = rgba(theme.edge.rhythm, 0.72);
    if (classes.has("edge-traced_to_source_variant") && classes.has("edge-layer-packaging")) stroke = rgba(theme.edge.packaging, 0.72);
    if (classes.has("edge-source_variant_to_sample")) {
      stroke = rgba(theme.edge.plan, 0.56);
      width = 1.7;
      dash = [5, 6];
    }
    if (classes.has("muted")) opacity = 0.08;
  }
  if (mode !== "planTrace" && classes.has("muted")) opacity = 0.18;
  if (classes.has("focused")) {
    stroke = rgba(stroke.color, Math.max(stroke.alpha, 0.94));
    width = Math.max(width, 3);
    glow = { color: stroke.color, alpha: theme.edge.focusGlowAlpha, width: 10 };
    opacity = 1;
  }

  const alpha = stroke.alpha * opacity;

  return {
    color: stroke.color,
    alpha,
    width,
    dash,
    glow,
    arrowColor: stroke.color,
    arrowAlpha: alpha,
  };
}

export function resolveGraphNodeStyle(node: SimNode, mode: GraphMode, focused: boolean, selected: boolean, pinned: boolean, hovered: boolean, focusMuted = false): GraphNodeDrawStyle {
  const theme = GRAPH_VISUAL_THEME;
  const classes = classSet(nodeClassTokens(node, focused, selected, pinned, focusMuted));
  const className = [...classes].join(" ");
  let fill = theme.node.neutral;
  let circleOpacity = 0.78;
  let stroke = rgba(theme.node.neutralStroke, 0.58);
  let strokeWidth = 1;
  let dash: [number, number] | undefined;
  let glow: GraphNodeDrawStyle["glow"] | undefined;
  let groupAlpha = 1;
  let labelFontSize = 11;

  if (mode === "structure") labelFontSize = 12;
  if (mode === "structure" && (classes.has("node-script") || classes.has("node-rhythm") || classes.has("node-packaging"))) labelFontSize = 11;

  if (selected || pinned || hovered) {
    stroke = rgba(theme.node.selectedStroke, 1);
    strokeWidth = 2;
    circleOpacity = 1;
  }
  if (pinned) glow = { color: theme.node.pinnedGlow, alpha: 0.16, radiusPad: 14 };
  if (classes.has("focus-muted")) groupAlpha = mode === "governance" ? 0.22 : mode === "planTrace" ? 0.16 : 0.32;
  else if (classes.has("muted")) groupAlpha = mode === "planTrace" ? 0.26 : 0.52;
  if (classes.has("node-library")) {
    fill = theme.node.library;
    glow = { color: theme.node.library, alpha: 0.12, radiusPad: 10 };
  }
  if (classes.has("node-slot")) {
    fill = theme.node.slot;
    glow = { color: theme.node.slot, alpha: 0.12, radiusPad: 8 };
  }
  if (classes.has("node-type-slotFamily")) {
    fill = theme.node.slotFamily;
    stroke = rgba(theme.node.slotFamilyStroke, 1);
    strokeWidth = 2.4;
    glow = { color: theme.node.slotFamilyStroke, alpha: 0.11, radiusPad: 11 };
  }
  if (classes.has("node-type-slotArchetype")) {
    fill = theme.node.slotArchetype;
    stroke = rgba(theme.node.slotArchetypeStroke, 1);
    strokeWidth = 2.2;
    glow = { color: theme.node.slotArchetypeStroke, alpha: 0.1, radiusPad: 10 };
  }
  if (classes.has("node-type-slotSubtype")) {
    fill = theme.node.slotSubtype;
    stroke = rgba(theme.node.slotSubtypeStroke, 1);
    strokeWidth = 2.3;
    glow = { color: theme.node.slotSubtypeStroke, alpha: mode === "planTrace" ? 0.13 : 0.1, radiusPad: mode === "planTrace" ? 13 : 11 };
  }
  if (classes.has("node-type-tracedSlot")) {
    fill = theme.node.tracedSlot;
    stroke = rgba(theme.node.tracedSlotStroke, 0.92);
    strokeWidth = 1.8;
    glow = { color: theme.node.tracedSlot, alpha: 0.1, radiusPad: 10 };
  }
  if (classes.has("node-type-atomArchetype")) {
    strokeWidth = Math.max(strokeWidth, 2.2);
    labelFontSize = 11;
  }
  if (classes.has("node-slotReview")) {
    fill = theme.node.review;
    glow = { color: theme.node.review, alpha: 0.12, radiusPad: 8 };
  }
  if (classes.has("node-script") || classes.has("node-layer-script")) {
    fill = theme.node.script;
    stroke = rgba(theme.node.scriptStroke, 1);
    strokeWidth = 2;
    glow = { color: theme.node.scriptStroke, alpha: 0.1, radiusPad: mode === "planTrace" ? 9 : 8 };
  }
  if (classes.has("node-rhythm") || classes.has("node-layer-rhythm")) {
    fill = theme.node.rhythm;
    stroke = rgba(theme.node.rhythmStroke, 1);
    strokeWidth = 2;
    glow = { color: theme.node.rhythmStroke, alpha: 0.1, radiusPad: mode === "planTrace" ? 9 : 8 };
  }
  if (classes.has("node-packaging") || classes.has("node-layer-packaging")) {
    fill = theme.node.packaging;
    stroke = rgba(theme.node.packagingStroke, 1);
    strokeWidth = 2;
    glow = { color: theme.node.packagingStroke, alpha: 0.1, radiusPad: mode === "planTrace" ? 9 : 8 };
  }
  if (classes.has("node-concept")) {
    fill = theme.node.concept;
    dash = [4, 3];
    glow = { color: theme.node.concept, alpha: 0.11, radiusPad: 8 };
  }
  if (className.includes("node-binding")) fill = theme.node.binding;
  if (classes.has("node-governance") || classes.has("node-type-governanceRoot")) {
    fill = theme.node.governance;
    stroke = rgba(theme.node.governanceStroke, 0.96);
    dash = undefined;
    strokeWidth = 3;
    glow = { color: theme.node.landmarkGlow, alpha: 0.1, radiusPad: 18 };
  }
  if (classes.has("node-type-governanceRoot")) labelFontSize = 12;
  if (classes.has("node-policy") || classes.has("node-rule")) fill = theme.node.policy;
  if (classes.has("node-bundle")) {
    fill = theme.node.bundle;
    dash = [5, 3];
  }
  if (classes.has("node-unmapped") || classes.has("node-needReview")) {
    fill = theme.node.review;
    glow = { color: theme.node.review, alpha: 0.11, radiusPad: 8 };
  }
  if (classes.has("node-sourceVariant")) {
    fill = theme.node.sourceVariant;
    stroke = rgba(theme.edge.sourceTrace, 0.82);
    dash = [5, 4];
    strokeWidth = 1.8;
    circleOpacity = 0.9;
    labelFontSize = 12;
  }
  if (mode === "planTrace" && classes.has("node-sourceVariant")) {
    fill = theme.node.sourceVariantTrace;
    stroke = rgba(theme.edge.hierarchy, 0.95);
    dash = undefined;
    strokeWidth = 2.2;
    glow = { color: theme.edge.hierarchy, alpha: 0.08, radiusPad: 9 };
    circleOpacity = 1;
    labelFontSize = 11;
  }
  if (mode === "planTrace" && classes.has("node-sourceVariant") && classes.has("node-layer-script")) {
    fill = theme.node.script;
    stroke = rgba(theme.node.scriptStroke, 1);
    glow = { color: theme.node.scriptStroke, alpha: 0.1, radiusPad: 9 };
  }
  if (mode === "planTrace" && classes.has("node-sourceVariant") && classes.has("node-layer-rhythm")) {
    fill = theme.node.rhythm;
    stroke = rgba(theme.node.rhythmStroke, 1);
    glow = { color: theme.node.rhythmStroke, alpha: 0.1, radiusPad: 9 };
  }
  if (mode === "planTrace" && classes.has("node-sourceVariant") && classes.has("node-layer-packaging")) {
    fill = theme.node.packaging;
    stroke = rgba(theme.node.packagingStroke, 1);
    glow = { color: theme.node.packagingStroke, alpha: 0.1, radiusPad: 9 };
  }
  if (classes.has("node-sourceSample")) {
    fill = theme.node.governance;
    stroke = rgba(theme.node.governanceStroke, 0.96);
    dash = undefined;
    strokeWidth = 3;
    glow = { color: theme.node.landmarkGlow, alpha: 0.1, radiusPad: 18 };
    circleOpacity = 1;
    labelFontSize = 12;
  }
  if (classes.has("node-plan")) {
    fill = theme.node.governance;
    stroke = rgba(theme.node.governanceStroke, 0.96);
    dash = undefined;
    strokeWidth = 3;
    glow = { color: theme.node.landmarkGlow, alpha: 0.1, radiusPad: 18 };
    labelFontSize = 12;
  }
  if (classes.has("node-projected")) {
    fill = theme.node.projected;
    stroke = rgba(theme.node.neutralStroke, 0.72);
  }

  if (mode === "governance") labelFontSize = nodeLabelFontSize(mode, node);

  return {
    fill,
    fillAlpha: circleOpacity,
    stroke: stroke.color,
    strokeWidth,
    strokeAlpha: stroke.alpha,
    groupAlpha,
    dash,
    glow,
    labelFill: theme.text.label,
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

export function governanceLabelSpec(node: Pick<SimNode, "type" | "layoutLevel">): GovernanceLabelSpec {
  const level = governanceLabelLevel(node);
  const start = level === 0 ? 0.36 : 0.52 + (level * 0.24);
  const end = start + 0.42;
  const min = level === 0 ? 0.9 : level === 1 ? 0.5 : level === 2 ? 0.16 : 0;
  const fontSize = Math.max(8, 13 - level);
  return { start, end, min, fontSize };
}

function governanceLabelLevel(node: Pick<SimNode, "type" | "layoutLevel">) {
  if (node.type === "governanceRoot") return 0;
  const level = Number(node.layoutLevel);
  if (Number.isFinite(level) && level >= 0) return Math.floor(level);
  return 8;
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
