import type { FunctionSlotGraphEdge } from "../../types/library";
import { nodeRadius } from "./graphUtils";
import type { SimNode } from "./types";
import { GRAPH_VISUAL_THEME, classSet, cssToken, rgba, type GraphMode, type GraphNodeDrawStyle, type GraphStrokeStyle, type GraphVisualTheme } from "./graphVisualTheme";

export { GRAPH_VISUAL_THEME, readGraphVisualTheme } from "./graphVisualTheme";
export type { GraphMode, GraphNodeDrawStyle, GraphStrokeStyle, GraphVisualTheme } from "./graphVisualTheme";

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
  const spec = graphLabelSpec(mode, node);
  return stagedZoomReveal(zoom, spec.start, spec.end);
}

export function nodeLabelFontSize(mode: GraphMode, node: SimNode) {
  return graphLabelSpec(mode, node).fontSize;
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

export function resolveGraphEdgeStyle(edge: FunctionSlotGraphEdge, source: SimNode, target: SimNode, mode: GraphMode, focused: boolean, muted: boolean, theme: GraphVisualTheme = GRAPH_VISUAL_THEME): GraphStrokeStyle {
  const classes = classSet(edgeClassTokens(edge.type, source, target, focused, muted));
  const sourceTraceEdge = isSourceTraceEdge(classes);
  let stroke = rgba(theme.edge.default, 0.22);
  let opacity = 0.34;
  let width = 1.1;
  let dash: [number, number] | undefined;
  let distanceFade: GraphStrokeStyle["distanceFade"] | undefined;
  let glow: GraphStrokeStyle["glow"] | undefined;

  if (classes.has("edge-library_contains_slot") || classes.has("edge-slot_next") || classes.has("edge-slot_instance_of_concept")) {
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
  if (classes.has("edge-slot_traced_to_semantic")) {
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
  if (classes.has("edge-source_sample_slot_variant_to_subtype")) {
    dash = [7, 7];
    stroke = rgba(theme.edge.semantic, 0.48);
    width = 1.6;
    opacity = Math.max(opacity, 0.4);
  }
  if (
    classes.has("edge-subtype_to_atom_pattern")
    || classes.has("edge-atom_archetype_to_pattern")
  ) {
    width = 1.9;
    opacity = Math.max(opacity, 0.44);
  }
  if (classes.has("edge-layer-script")) stroke = rgba(theme.edge.script, 0.62);
  if (classes.has("edge-layer-rhythm")) stroke = rgba(theme.edge.rhythm, 0.62);
  if (classes.has("edge-layer-packaging")) stroke = rgba(theme.edge.packaging, 0.62);
  if (sourceTraceEdge) {
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
    if (classes.has("muted")) opacity = theme.state.edgeMutedOpacity;
  }
  if (sourceTraceEdge && !focused) distanceFade = { minAlpha: 0.32 };
  if (mode !== "planTrace" && classes.has("muted")) opacity = theme.state.edgeMutedOpacity;
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
    distanceFade,
    glow,
    arrowColor: stroke.color,
    arrowAlpha: alpha,
  };
}

function isSourceTraceEdge(classes: Set<string>) {
  return classes.has("edge-pattern_to_source_variant")
    || classes.has("edge-source_variant_to_sample")
    || classes.has("edge-traced_to_source_sample")
    || classes.has("edge-traced_to_source_variant");
}

export function resolveGraphNodeStyle(node: SimNode, mode: GraphMode, focused: boolean, selected: boolean, pinned: boolean, hovered: boolean, focusMuted = false, theme: GraphVisualTheme = GRAPH_VISUAL_THEME): GraphNodeDrawStyle {
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
  if (classes.has("focus-muted")) groupAlpha = theme.state.nodeFocusMutedAlpha;
  else if (classes.has("muted")) groupAlpha = theme.state.nodeMutedAlpha;
  if (classes.has("node-library")) {
    circleOpacity = 1;
    if (mode === "structure" && node.type === "libraryItem") {
      fill = theme.node.governance;
      stroke = rgba(theme.node.governanceStroke, 0.96);
      strokeWidth = 3;
      glow = { color: theme.node.landmarkGlow, alpha: 0.1, radiusPad: 18 };
    } else {
      fill = theme.node.library;
      glow = { color: theme.node.library, alpha: 0.12, radiusPad: 10 };
    }
  }
  if (classes.has("node-slot")) {
    fill = theme.node.slot;
    circleOpacity = 1;
    stroke = rgba(theme.node.slotFamilyStroke, 1);
    strokeWidth = Math.max(strokeWidth, 1.8);
    glow = { color: theme.node.slot, alpha: 0.12, radiusPad: 8 };
  }
  if (classes.has("node-type-slotFamily")) {
    fill = theme.node.slotFamily;
    circleOpacity = 1;
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
    circleOpacity = 1;
    stroke = rgba(theme.node.slotSubtypeStroke, 1);
    strokeWidth = 2.3;
    glow = { color: theme.node.slotSubtypeStroke, alpha: mode === "planTrace" ? 0.13 : 0.1, radiusPad: mode === "planTrace" ? 13 : 11 };
  }
  if (classes.has("node-type-tracedSlot")) {
    fill = theme.node.tracedSlot;
    circleOpacity = 1;
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
    circleOpacity = 1;
    glow = { color: theme.node.review, alpha: 0.12, radiusPad: 8 };
  }
  if (classes.has("node-script") || classes.has("node-layer-script")) {
    fill = theme.node.script;
    circleOpacity = 1;
    stroke = rgba(theme.node.scriptStroke, 1);
    strokeWidth = 2;
    glow = { color: theme.node.scriptStroke, alpha: 0.1, radiusPad: mode === "planTrace" ? 9 : 8 };
  }
  if (classes.has("node-rhythm") || classes.has("node-layer-rhythm")) {
    fill = theme.node.rhythm;
    circleOpacity = 1;
    stroke = rgba(theme.node.rhythmStroke, 1);
    strokeWidth = 2;
    glow = { color: theme.node.rhythmStroke, alpha: 0.1, radiusPad: mode === "planTrace" ? 9 : 8 };
  }
  if (classes.has("node-packaging") || classes.has("node-layer-packaging")) {
    fill = theme.node.packaging;
    circleOpacity = 1;
    stroke = rgba(theme.node.packagingStroke, 1);
    strokeWidth = 2;
    glow = { color: theme.node.packagingStroke, alpha: 0.1, radiusPad: mode === "planTrace" ? 9 : 8 };
  }
  if (classes.has("node-concept")) {
    fill = theme.node.concept;
    circleOpacity = 1;
    dash = [4, 3];
    glow = { color: theme.node.concept, alpha: 0.11, radiusPad: 8 };
  }
  if (className.includes("node-binding")) {
    fill = theme.node.binding;
    circleOpacity = 1;
  }
  if (classes.has("node-governance") || classes.has("node-type-governanceRoot")) {
    fill = theme.node.governance;
    stroke = rgba(theme.node.governanceStroke, 0.96);
    dash = undefined;
    strokeWidth = 3;
    glow = { color: theme.node.landmarkGlow, alpha: 0.1, radiusPad: 18 };
  }
  if (classes.has("node-type-governanceRoot")) labelFontSize = 12;
  if (classes.has("node-policy") || classes.has("node-rule")) {
    fill = theme.node.policy;
    circleOpacity = 1;
  }
  if (classes.has("node-bundle")) {
    fill = theme.node.bundle;
    circleOpacity = 1;
    dash = [5, 3];
  }
  if (classes.has("node-unmapped") || classes.has("node-needReview")) {
    fill = theme.node.review;
    circleOpacity = 1;
    glow = { color: theme.node.review, alpha: 0.11, radiusPad: 8 };
  }
  if (classes.has("node-sourceVariant")) {
    const layeredSourceVariant = classes.has("node-layer-script") || classes.has("node-layer-rhythm") || classes.has("node-layer-packaging");
    if (!layeredSourceVariant) {
      fill = theme.node.sourceVariant;
      stroke = rgba(theme.edge.sourceTrace, 0.82);
    }
    dash = [5, 4];
    strokeWidth = Math.max(strokeWidth, 1.8);
    circleOpacity = 1;
    labelFontSize = 12;
  }
  if (mode === "planTrace" && classes.has("node-sourceVariant")) {
    dash = undefined;
    strokeWidth = Math.max(strokeWidth, 2.2);
    circleOpacity = 1;
    labelFontSize = 11;
  }
  if (classes.has("node-sourceSample")) {
    fill = mode === "structure" ? theme.node.sourceVariant : theme.node.governance;
    stroke = mode === "structure" ? rgba(theme.edge.sourceTrace, 0.72) : rgba(theme.node.governanceStroke, 0.96);
    dash = undefined;
    strokeWidth = mode === "structure" ? 1.4 : 3;
    glow = mode === "structure" ? undefined : { color: theme.node.landmarkGlow, alpha: 0.1, radiusPad: 18 };
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

  labelFontSize = nodeLabelFontSize(mode, node);

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

function stagedZoomReveal(zoom: number, start: number, end: number) {
  if (zoom < start) return 0;
  if (zoom >= end) return 1;
  const progress = (zoom - start) / (end - start);
  if (progress < 1 / 3) return lerp(0, 0.1, progress * 3);
  if (progress < 2 / 3) return lerp(0.1, 0.6, (progress - 1 / 3) * 3);
  return lerp(0.6, 1, (progress - 2 / 3) * 3);
}

function lerp(start: number, end: number, progress: number) {
  return start + (end - start) * progress;
}

export function governanceLabelSpec(node: Pick<SimNode, "type" | "layoutLevel">): GovernanceLabelSpec {
  const level = governanceLabelLevel(node);
  const start = level === 0 ? 0.72 : 0.88 + (level * 0.28);
  const end = start + 0.6;
  const min = 0;
  const fontSize = Math.max(10, 15 - level);
  return { start, end, min, fontSize };
}

function graphLabelSpec(mode: GraphMode, node: Pick<SimNode, "type" | "layoutLevel">): GovernanceLabelSpec {
  if (mode === "governance") return governanceLabelSpec(node);
  return governanceLabelSpec({ type: node.type, layoutLevel: graphLabelLevel(mode, node) });
}

function graphLabelLevel(mode: Exclude<GraphMode, "governance">, node: Pick<SimNode, "type" | "layoutLevel">) {
  const level = Number(node.layoutLevel);
  if (Number.isFinite(level) && level >= 0) return Math.floor(level);
  if (mode === "planTrace") {
    if (node.type === "confirmedPlan") return 0;
    if (node.type === "slotSubtype") return 1;
    if (node.type === "sourceVariant") return 2;
    if (node.type === "sourceSample") return 3;
    return 2;
  }
  if (node.type === "libraryItem") return 0;
  if (node.type === "slotInstance" || node.type === "slotConcept") return 1;
  if (node.type === "atomInstance" || node.type === "binding") return 2;
  return 2;
}

function governanceLabelLevel(node: Pick<SimNode, "type" | "layoutLevel">) {
  if (node.type === "governanceRoot") return 0;
  const level = Number(node.layoutLevel);
  if (Number.isFinite(level) && level >= 0) return Math.floor(level);
  return 8;
}
