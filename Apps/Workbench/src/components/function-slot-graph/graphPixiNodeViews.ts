import { Container, Graphics, Text } from "pixi.js";
import type { TextStyleOptions } from "pixi.js";
import { nodeRadius } from "./graphUtils";
import {
  GRAPH_VISUAL_THEME,
  resolveGraphNodeStyle,
  slotOrderBadge,
  type GraphNodeDrawStyle,
  type GraphVisualTheme,
} from "./graphVisualStyles";
import type { PixiGraphRenderState } from "./graphPixiRenderer";
import type { SimNode } from "./types";

export type PixiNodeView = {
  container: Container;
  glow: Graphics;
  ring: Graphics;
  occlusion: Graphics;
  body: Graphics;
  slotBadge: Graphics;
  slotBadgeText: Text;
  planBadge: Graphics;
  planBadgeText: Text;
  label: Text | null;
  glowKey: string | null;
  ringKey: string | null;
  occlusionKey: string | null;
  bodyKey: string | null;
  slotBadgeKey: string | null;
  planBadgeKey: string | null;
};

const textStyleKeys = new WeakMap<Text, string>();
const textStyleCache = new Map<string, TextStyleOptions>();
const SVG_LABEL_BASELINE_GAP = 14;
const SVG_BASELINE_TO_TEXT_TOP_RATIO = 0.82;
const SLOT_BADGE_FONT_SIZE = 14;
const PLAN_BADGE_FONT_SIZE = 7;

export function getNodeView(nodeOcclusionLayer: Container, nodeLayer: Container, objects: { nodes: Map<string, PixiNodeView> }, nodeId: string) {
  const existing = objects.nodes.get(nodeId);
  if (existing) return existing;

  const container = new Container();
  const glow = new Graphics();
  const ring = new Graphics();
  const occlusion = new Graphics();
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
  nodeOcclusionLayer.addChild(occlusion);
  nodeLayer.addChild(container);

  const view = {
    container,
    glow,
    ring,
    occlusion,
    body,
    slotBadge,
    slotBadgeText,
    planBadge,
    planBadgeText,
    label: null,
    glowKey: null,
    ringKey: null,
    occlusionKey: null,
    bodyKey: null,
    slotBadgeKey: null,
    planBadgeKey: null,
  };
  objects.nodes.set(nodeId, view);
  return view;
}

export function syncNodeRing(view: PixiNodeView, node: SimNode, radius: number, state: PixiGraphRenderState) {
  const theme = state.theme;
  const highlighted = node.type === "confirmedPlan"
    || node.type === "governanceRoot"
    || (state.mode !== "structure" && node.type === "sourceSample")
    || (state.mode === "structure" && node.type === "libraryItem");
  const key = highlighted ? `ring:${radius}:${theme.node.landmarkGlow}` : "none";
  if (view.ringKey === key) return;
  view.ring.clear();
  if (highlighted) drawCircleStroke(view.ring, radius + 7, theme.node.landmarkGlow, 0.58, 2, [6, 7]);
  view.ringKey = key;
}

export function syncNodeGlow(view: PixiNodeView, radius: number, style: GraphNodeDrawStyle) {
  void radius;
  void style;
  if (view.glowKey === "none") return;
  view.glow.clear();
  view.glowKey = "none";
}

export function syncNodeOcclusion(view: PixiNodeView, radius: number, theme: GraphVisualTheme, alpha = 1) {
  const key = `${radius}:${theme.canvas.nodeOcclusionFill}:${alpha}`;
  if (view.occlusionKey === key) return;
  view.occlusion
    .clear()
    .circle(0, 0, radius + 1.5)
    .fill({ color: theme.canvas.nodeOcclusionFill, alpha });
  view.occlusionKey = key;
}

export function syncNodeBody(view: PixiNodeView, radius: number, style: GraphNodeDrawStyle) {
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

export function syncSlotBadge(view: PixiNodeView, node: SimNode, radius: number, theme: GraphVisualTheme) {
  const badge = slotOrderBadge(node);
  if (!badge) {
    if (view.slotBadgeKey !== "none") {
      view.slotBadge.clear();
      view.slotBadgeKey = "none";
    }
    view.slotBadgeText.visible = false;
    return;
  }
  const key = `center:${radius}:${theme.text.label}`;
  if (view.slotBadgeKey !== key) {
    view.slotBadge.clear();
    view.slotBadgeKey = key;
  }
  syncTextStyle(view.slotBadgeText, whiteTextStyle(SLOT_BADGE_FONT_SIZE, theme), `slot-center:${SLOT_BADGE_FONT_SIZE}:${theme.text.label}`);
  syncText(view.slotBadgeText, badge);
  view.slotBadgeText.position.set(0, 1.25);
  view.slotBadgeText.visible = true;
}

export function syncPlanBadge(view: PixiNodeView, node: SimNode, radius: number, theme: GraphVisualTheme) {
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
  const key = `${radius}:${badgeColor}:${theme.node.selectedStroke}`;
  if (view.planBadgeKey !== key) {
    view.planBadge
      .clear()
      .circle(x, y, 7)
      .fill({ color: badgeColor, alpha: 1 })
      .stroke({ color: theme.node.selectedStroke, alpha: 0.86, width: 1 });
    view.planBadgeKey = key;
  }
  syncTextStyle(view.planBadgeText, whiteTextStyle(PLAN_BADGE_FONT_SIZE, theme), `plan:${theme.text.label}`);
  syncText(view.planBadgeText, count > 1 ? String(count) : "");
  view.planBadgeText.position.set(x, y + 0.75);
  view.planBadgeText.visible = count > 1;
}

export function syncNodeLabel(labelLayer: Container, view: PixiNodeView, node: SimNode, radius: number, opacity: number, style: GraphNodeDrawStyle) {
  if (opacity <= 0.01) {
    if (view.label) {
      safeDestroyText(view.label);
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

export function nodeLabelTopY(radius: number, fontSize: number) {
  return radius + SVG_LABEL_BASELINE_GAP - (fontSize * SVG_BASELINE_TO_TEXT_TOP_RATIO);
}

export function safeDestroyText(text: Text | null) {
  if (!text) return;
  text.removeFromParent();
  try {
    text.destroy();
  } catch {
    // Pixi can throw while returning canvas text textures during mode teardown.
  }
}

export function nodeStyleForState(node: SimNode, state: PixiGraphRenderState, focused: boolean, selected: boolean, pinned: boolean, hovered: boolean, focusMuted: boolean) {
  return resolveGraphNodeStyle(node, state.mode, focused, selected, pinned, hovered, focusMuted, state.theme);
}

function syncText(text: Text, value: string) {
  if (text.text !== value) text.text = value;
}

function syncTextStyle(text: Text, style: TextStyleOptions, key: string) {
  if (textStyleKeys.get(text) === key) return;
  text.style = style;
  textStyleKeys.set(text, key);
}

function whiteTextStyle(fontSize: number, theme: GraphVisualTheme = GRAPH_VISUAL_THEME): TextStyleOptions {
  return textStyle(fontSize, theme.text.label);
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

function cssColorToNumber(value: string) {
  if (!value.startsWith("#")) return null;
  const normalized = value.length === 4
    ? `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`
    : value;
  const parsed = Number.parseInt(normalized.slice(1), 16);
  return Number.isFinite(parsed) ? parsed : null;
}
