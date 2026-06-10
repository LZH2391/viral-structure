import type { FunctionSlotGraphEdge, FunctionSlotGraphNode } from "../../types/library";
import { CENTER, VIEWBOX, clamp, type LayoutPosition } from "./graphCore";

export function groupByParent(
  nodes: FunctionSlotGraphNode[],
  incoming: Map<string, FunctionSlotGraphEdge[]>,
  angles: Map<string, number>,
  levelByType: Map<string, number>,
  nodeTypeById: Map<string, string>,
) {
  const grouped = new Map<string, FunctionSlotGraphNode[]>();
  for (const node of nodes) {
    const nodeLevel = levelByType.get(node.type) ?? Number.POSITIVE_INFINITY;
    const parent = (incoming.get(node.id) ?? [])
      .map((edge) => edge.source)
      .filter((sourceId) => angles.has(sourceId))
      .sort((left, right) => (levelByType.get(nodeTypeById.get(right) ?? "") ?? -1) - (levelByType.get(nodeTypeById.get(left) ?? "") ?? -1))
      .find((sourceId) => (levelByType.get(nodeTypeById.get(sourceId) ?? "") ?? -1) < nodeLevel);
    const key = parent ?? "__root__";
    grouped.set(key, [...(grouped.get(key) ?? []), node]);
  }
  return grouped;
}

export function siblingAngleOffset(index: number, count: number, radius: number) {
  if (count <= 1) return 0;
  const maxStep = radius > 650 ? 0.46 : radius > 500 ? 0.4 : radius > 360 ? 0.34 : 0.28;
  const step = Math.min(maxStep, Math.PI * 1.85 / Math.max(count, 1));
  return (index - (count - 1) / 2) * step;
}

export function parentBundledAngleOffset(index: number, count: number, spacing = parentBundledSpacing(count)) {
  if (count <= 1) return 0;
  const span = spacing * (count - 1);
  return -span / 2 + index * spacing;
}

export function parentBundledSpacing(count: number, nodeType?: string) {
  if (count <= 1) return 0.12;
  if (isAtomLayoutNodeType(nodeType)) return clamp(0.16 - Math.min(count, 18) * 0.004, 0.095, 0.15);
  return clamp(0.055 + (count > 8 ? 0.018 : 0), 0.055, 0.09);
}

export function nodeAngleRange(spacing: number, levelIndex: number) {
  return clamp(spacing * 0.34 - levelIndex * 0.004, 0.08, 0.22);
}

export function parentBundledNodeAngleRange(spacing: number, levelIndex: number, nodeType: string) {
  if (!isAtomLayoutNodeType(nodeType)) return nodeAngleRange(spacing, levelIndex);
  return clamp(spacing * 0.62, 0.13, 0.24);
}

export function isAtomLayoutNodeType(type: string | undefined) {
  return type === "atomArchetype" || type === "atomPattern";
}

export function isAtomLayoutLevel(types: string[]) {
  return types.length > 0 && types.every((type) => isAtomLayoutNodeType(type));
}

export function shouldParentBundleGovernanceLevel(types: string[]) {
  return false;
}

export function distributedAngle(index: number, count: number) {
  if (count <= 1) return 0.62;
  return -Math.PI / 2 + (index / Math.max(count, 1)) * Math.PI * 2;
}

export function radialPoint(center: { x: number; y: number }, angle: number, radius: number, yScale: number) {
  return {
    x: clamp(center.x + Math.cos(angle) * radius, 70, VIEWBOX.width - 70),
    y: clamp(center.y + Math.sin(angle) * radius * yScale, 60, VIEWBOX.height - 60),
  };
}

export function radialSortKey(node: FunctionSlotGraphNode) {
  const order = Number(node.data?.slotOrder ?? node.data?.order ?? Number.NaN);
  const orderKey = Number.isFinite(order) ? String(order).padStart(4, "0") : "9999";
  return `${orderKey}:${node.type}:${String(node.label ?? node.id)}`;
}

export function hashText(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

export function placeColumn(positions: Map<string, LayoutPosition>, nodes: FunctionSlotGraphNode[], x: number, centerY = CENTER.y, spacing = 54, layoutLevel?: number) {
  const startY = centerY - ((nodes.length - 1) * spacing) / 2;
  nodes.forEach((node, index) => positions.set(node.id, { x, y: clamp(startY + index * spacing, 55, VIEWBOX.height - 55), layoutLevel }));
}
