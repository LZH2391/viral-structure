import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from "d3-force";
import type { SampleArtifact } from "../../types/artifact";
import type { FunctionSlotGraphEdge, FunctionSlotGraphNode } from "../../types/library";
import type { D3Link, SimNode } from "./types";

export const VIEWBOX = { width: 4600, height: 3900 };
export const CENTER = { x: 2300, y: 1950 };

export type LayoutPosition = {
  x: number;
  y: number;
  layoutAngleMin?: number;
  layoutAngleMax?: number;
  layoutRadiusMin?: number;
  layoutRadiusMax?: number;
  layoutYScale?: number;
  layoutLevel?: number;
};

export function centerPosition(): LayoutPosition {
  return { x: CENTER.x, y: CENTER.y };
}

export function graphId(...parts: Array<string | number | null | undefined>) {
  return parts.map((part) => sanitizeGraphId(part)).join(":");
}

export function sanitizeGraphId(value: unknown) {
  return String(value ?? "").replace(/[^A-Za-z0-9_.:-]/g, "_");
}

export function nodeDataTextArray(node: FunctionSlotGraphNode, key: string) {
  const value = node.data?.[key];
  return Array.isArray(value) ? value.map((item) => String(item ?? "").trim()).filter(Boolean) : [];
}

export function constrainNodeToLayoutSector(node: SimNode) {
  if (
    typeof node.layoutAngleMin !== "number"
    || typeof node.layoutAngleMax !== "number"
    || typeof node.layoutRadiusMin !== "number"
    || typeof node.layoutRadiusMax !== "number"
  ) return;
  const yScale = node.layoutYScale ?? 1;
  const dx = node.x - CENTER.x;
  const dy = (node.y - CENTER.y) / yScale;
  const currentRadius = Math.hypot(dx, dy);
  const angleCenter = (node.layoutAngleMin + node.layoutAngleMax) / 2;
  const currentAngle = unwrapAngleNear(currentRadius > 0 ? Math.atan2(dy, dx) : angleCenter, angleCenter);
  const angle = clamp(currentAngle, node.layoutAngleMin, node.layoutAngleMax);
  const radius = clamp(currentRadius, node.layoutRadiusMin, node.layoutRadiusMax);
  node.x = clamp(CENTER.x + Math.cos(angle) * radius, 70, VIEWBOX.width - 70);
  node.y = clamp(CENTER.y + Math.sin(angle) * radius * yScale, 60, VIEWBOX.height - 60);
}

function unwrapAngleNear(angle: number, target: number) {
  let nextAngle = angle;
  while (nextAngle - target > Math.PI) nextAngle -= Math.PI * 2;
  while (nextAngle - target < -Math.PI) nextAngle += Math.PI * 2;
  return nextAngle;
}

export function createGraphSimulation(nodes: SimNode[], links: D3Link[]) {
  return forceSimulation<SimNode>(nodes)
    .alpha(0.95)
    .alphaDecay(0.012)
    .velocityDecay(0.32)
    .force("center", forceCenter(CENTER.x, CENTER.y).strength(0.004))
    .force("x", forceX<SimNode>((node) => node.layoutX ?? CENTER.x).strength((node) => layoutAnchorStrength(node)))
    .force("y", forceY<SimNode>((node) => node.layoutY ?? CENTER.y).strength((node) => layoutAnchorStrength(node)))
    .force("charge", forceManyBody<SimNode>().strength((node) => {
      if (node.type === "confirmedPlan" || node.type === "governanceRoot") return -920;
      if (node.type === "slotFamily") return -560;
      if (node.type === "slotSubtype") return -520;
      if (node.type === "atomArchetype") return -640;
      if (node.type === "atomPattern") return -620;
      if (node.type === "slotArchetype") return -470;
      if (node.type === "sourceVariant") return -520;
      if (node.type === "libraryItem" || node.type === "slotInstance") return -220;
      if (node.type === "bindingPattern" || node.type === "rulePattern" || node.type === "unmappedVariant") return -360;
      return -260;
    }).distanceMin(64).distanceMax(1200))
    .force("collide", forceCollide<SimNode>().radius((node) => {
      if (node.type === "confirmedPlan" || node.type === "governanceRoot") return nodeRadius(node) + 92;
      if (node.type === "sourceVariant") return nodeRadius(node) + 82;
      if (node.type === "slotFamily" || node.type === "slotSubtype") return nodeRadius(node) + 78;
      if (node.type === "atomArchetype") return nodeRadius(node) + 98;
      if (node.type === "atomPattern") return nodeRadius(node) + 94;
      if (node.type === "slotArchetype") return nodeRadius(node) + 68;
      return nodeRadius(node) + 58;
    }).strength(0.96).iterations(4))
    .force("link", forceLink<SimNode, D3Link>(links)
      .id((node) => node.id)
      .distance((edge) => edgeDistance(edge.type))
      .strength((edge) => edgeStrength(edge.type)));
}

export function nodeRadius(node: Pick<FunctionSlotGraphNode, "type" | "data">) {
  if (node.type === "governanceRoot") return 30;
  if (node.type === "slotFamily") return 24;
  if (node.type === "slotArchetype") return 20;
  if (node.type === "slotSubtype") return 16;
  if (node.type === "sourceVariant" && typeof node.data?.planId === "string") return 16;
  if (node.type === "atomArchetype") return 13;
  if (node.type === "atomPattern") return 11;
  if (node.type === "sourceVariant") return 8;
  if (node.type === "bindingPrinciple" || node.type === "recompositionPolicy") return 10;
  if (node.type === "bindingPattern" || node.type === "rulePattern" || node.type === "implementationBundle") return 9;
  if (node.type === "unmappedVariant") return 8;
  if (node.type === "sourceExample") return 9;
  if (node.type === "sourceSample") return 30;
  if (node.type === "confirmedPlan") return 30;
  if (node.type.startsWith("traced")) return 13;
  if (node.type === "libraryItem") return 24;
  if (node.type === "slotInstance") return 18;
  if (node.type === "atomInstance") return 10;
  if (node.type === "slotConcept") return 11;
  if (node.type === "binding") return 6;
  return 7;
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function svgScreenPoint(svg: SVGSVGElement | null, node: SimNode, viewport: { x: number; y: number; k: number }) {
  if (!svg) return { x: node.x, y: node.y };
  const rect = svg.getBoundingClientRect();
  const point = svg.createSVGPoint();
  point.x = node.x * viewport.k + viewport.x;
  point.y = node.y * viewport.k + viewport.y;
  const transformed = point.matrixTransform(svg.getScreenCTM() ?? undefined);
  return {
    x: transformed.x - rect.left,
    y: transformed.y - rect.top,
  };
}

export function previewPopoverSize(sampleArtifact: SampleArtifact | null) {
  const metadata = sampleArtifact?.metadata;
  const width = positiveNumber(metadata?.width) ?? 16;
  const height = positiveNumber(metadata?.height) ?? 9;
  const aspectRatio = clamp(width / height, 0.45, 2.1);
  const popoverWidth = aspectRatio < 0.9 ? 184 : 248;
  const mediaHeight = clamp(Math.round(popoverWidth / aspectRatio), 118, 322);
  return {
    width: popoverWidth,
    mediaHeight,
    totalHeight: mediaHeight + 82,
  };
}

export function clampPreviewPosition(point: { x: number; y: number }, size: { width: number; height: number }, popoverSize: { width: number; totalHeight: number }) {
  const popoverWidth = popoverSize.width;
  const popoverHeight = popoverSize.totalHeight;
  const gap = 8;
  const left = point.x + gap + popoverWidth > size.width ? point.x - popoverWidth - gap : point.x + gap;
  const top = point.y - popoverHeight - gap < 0 ? point.y + gap : point.y - popoverHeight - gap;
  return {
    left: clamp(left, 12, Math.max(12, size.width - popoverWidth - 12)),
    top: clamp(top, 12, Math.max(12, size.height - popoverHeight - 12)),
  };
}

function edgeDistance(type: string) {
  if (type.includes("source_variant")) return 270;
  if (type === "plan_uses_slot_family") return 300;
  if (type.includes("bundle")) return 250;
  if (type.includes("pattern")) return 245;
  if (type.includes("archetype")) return 270;
  if (type === "slot_next") return 230;
  if (type === "library_contains_slot") return 280;
  if (type === "library_contains_binding") return 220;
  if (type.startsWith("binding_")) return 240;
  return 260;
}

function edgeStrength(type: string) {
  if (type === "plan_uses_slot_family" || type === "governance_contains_family") return 0.16;
  if (type.includes("source_variant")) return 0.035;
  if (type.includes("bundle") || type.startsWith("binding_") || type.includes("rule")) return 0.045;
  if (type.includes("pattern")) return 0.06;
  return 0.08;
}

function layoutAnchorStrength(node: SimNode) {
  if (node.type === "confirmedPlan" || node.type === "governanceRoot") return 0.32;
  if (node.type === "sourceVariant" || node.type === "unmappedVariant") return 0.24;
  if (node.type === "sourceSample") return 0.24;
  if (node.type === "atomPattern" || node.type === "atomArchetype") return 0.21;
  if (node.type === "slotFamily" || node.type === "slotArchetype" || node.type === "slotSubtype") return 0.23;
  return 0.14;
}

export function positiveNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}
