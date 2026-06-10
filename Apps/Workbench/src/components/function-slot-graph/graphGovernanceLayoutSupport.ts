import type { FunctionSlotGraphEdge, FunctionSlotGraphNode, FunctionSlotLibraryGraph } from "../../types/library";
import { CENTER, VIEWBOX, clamp, type LayoutPosition } from "./graphCore";
import { distributedAngle, groupByParent, hashText, isAtomLayoutLevel, parentBundledAngleOffset, parentBundledNodeAngleRange, parentBundledSpacing, placeColumn, radialPoint, radialSortKey, shouldParentBundleGovernanceLevel, siblingAngleOffset } from "./graphLayoutMath";

type ParentAnchor = {
  id: string;
  angle: number;
  level: number;
  depth: number;
};

const GOVERNANCE_RING_START_RADIUS = 260;
const GOVERNANCE_RING_STEP = 220;

const GOVERNANCE_LAYOUT_LEVELS: Array<{ types: string[]; columnSpacing: number }> = [
  { types: ["slotFamily"], columnSpacing: 54 },
  { types: ["slotArchetype"], columnSpacing: 54 },
  { types: ["slotSubtype"], columnSpacing: 54 },
  { types: ["atomArchetype"], columnSpacing: 54 },
  { types: ["atomPattern"], columnSpacing: 54 },
  { types: ["sourceVariant"], columnSpacing: 34 },
  { types: ["bindingPrinciple", "recompositionPolicy", "bindingPattern", "rulePattern", "implementationBundle", "unmappedVariant"], columnSpacing: 58 },
  { types: ["sourceSample"], columnSpacing: 86 },
];

export function buildGovernanceForcePositions(graph: FunctionSlotLibraryGraph, visibleNodeIds: Set<string> | null) {
  const levels = visibleGovernanceLevels(graph, visibleNodeIds).map((level, index) => ({
    types: level.types,
    radius: GOVERNANCE_RING_START_RADIUS + (index * GOVERNANCE_RING_STEP),
  }));
  return buildConcentricTypeRingPositions(graph, {
    rootTypes: ["governanceRoot"],
    center: CENTER,
    yScale: 1,
    levels,
    visibleNodeIds,
    parentBundled: true,
  });
}

export function visibleGovernanceLevels(graph: FunctionSlotLibraryGraph, visibleNodeIds: Set<string> | null) {
  return GOVERNANCE_LAYOUT_LEVELS.filter((level) => graph.nodes.some((node) => level.types.includes(node.type) && layoutNodeVisible(node, visibleNodeIds)));
}

export function layoutNodeVisible(node: FunctionSlotGraphNode, visibleNodeIds: Set<string> | null) {
  return !visibleNodeIds || visibleNodeIds.has(node.id);
}

export function buildConcentricTypeRingPositions(
  graph: FunctionSlotLibraryGraph,
  options: {
    rootTypes: string[];
    center: { x: number; y: number };
    yScale: number;
    levels: Array<{ types: string[]; radius: number }>;
    visibleNodeIds?: Set<string> | null;
    parentBundled?: boolean;
  },
) {
  const positions = new Map<string, LayoutPosition>();
  const angles = new Map<string, number>();
  const levelByType = new Map<string, number>();
  options.levels.forEach((level, index) => level.types.forEach((type) => levelByType.set(type, index + 1)));
  for (const type of options.rootTypes) levelByType.set(type, 0);

  const roots = graph.nodes
    .filter((node) => options.rootTypes.includes(node.type) && layoutNodeVisible(node, options.visibleNodeIds ?? null))
    .sort((left, right) => radialSortKey(left).localeCompare(radialSortKey(right), "zh-Hans-CN"));
  const rootIds = new Set(roots.map((node) => node.id));
  if (roots.length <= 1) {
    roots.forEach((node) => {
      angles.set(node.id, -Math.PI / 2);
      positions.set(node.id, { ...options.center, layoutLevel: 0 });
    });
  } else {
    roots.forEach((node, index) => {
      const angle = distributedAngle(index, roots.length);
      angles.set(node.id, angle);
      positions.set(node.id, ringPosition(options.center, angle, 120, options.yScale, 0.22, 0));
    });
  }

  const incoming = new Map<string, FunctionSlotGraphEdge[]>();
  const nodeTypeById = new Map(graph.nodes.map((node) => [node.id, node.type]));
  for (const edge of graph.edges) {
    incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge]);
  }

  options.levels.forEach((level, levelIndex) => {
    const nodes = graph.nodes
      .filter((node) => level.types.includes(node.type) && layoutNodeVisible(node, options.visibleNodeIds ?? null))
      .sort((left, right) => radialSortKey(left).localeCompare(radialSortKey(right), "zh-Hans-CN"));
    if (options.parentBundled && shouldParentBundleGovernanceLevel(level.types)) {
      placeParentBundledLevel(positions, nodes, incoming, angles, levelByType, nodeTypeById, level.radius, levelIndex, options.center, options.yScale);
    } else {
      const orderedNodes = orderNodesByParentAngle(nodes, incoming, angles, levelByType, nodeTypeById);
      const offset = averageParentAlignmentOffset(orderedNodes, incoming, angles, levelByType, nodeTypeById);
      orderedNodes.forEach((node, index) => {
        const spacing = (Math.PI * 2) / Math.max(orderedNodes.length, 1);
        const angle = distributedAngle(index, orderedNodes.length) + offset;
        angles.set(node.id, angle);
        positions.set(node.id, ringPosition(options.center, angle, level.radius, options.yScale, nodeAngleRange(spacing, levelIndex), levelIndex + 1));
      });
    }
  });

  const knownTypes = new Set([...options.rootTypes, ...options.levels.flatMap((level) => level.types)]);
  const fallbackNodes = graph.nodes
    .filter((node) => !knownTypes.has(node.type) && layoutNodeVisible(node, options.visibleNodeIds ?? null))
    .sort((left, right) => radialSortKey(left).localeCompare(radialSortKey(right), "zh-Hans-CN"));
  placeRing(positions, fallbackNodes, 1840, options.center, options.yScale, Math.PI / 2, options.levels.length + 1);
  return positions;
}

function placeParentBundledLevel(
  positions: Map<string, LayoutPosition>,
  nodes: FunctionSlotGraphNode[],
  incoming: Map<string, FunctionSlotGraphEdge[]>,
  angles: Map<string, number>,
  levelByType: Map<string, number>,
  nodeTypeById: Map<string, string>,
  radius: number,
  levelIndex: number,
  center: { x: number; y: number },
  yScale: number,
) {
  const groups = new Map<string, { angle: number | null; nodes: FunctionSlotGraphNode[] }>();
  nodes.forEach((node, index) => {
    const anchor = nearestVisibleParentAnchor(node, incoming, angles, levelByType, nodeTypeById);
    const key = anchor?.id ?? `__root__:${index}`;
    const group = groups.get(key) ?? { angle: anchor?.angle ?? null, nodes: [] };
    group.nodes.push(node);
    groups.set(key, group);
  });

  [...groups.values()]
    .sort((left, right) => (left.angle ?? Number.POSITIVE_INFINITY) - (right.angle ?? Number.POSITIVE_INFINITY))
    .forEach((group, groupIndex) => {
      const sortedNodes = group.nodes.sort((left, right) => radialSortKey(left).localeCompare(radialSortKey(right), "zh-Hans-CN"));
      const parentAngle = group.angle ?? distributedAngle(groupIndex, groups.size);
      const spacing = parentBundledSpacing(sortedNodes.length, sortedNodes[0]?.type);
      sortedNodes.forEach((node, nodeIndex) => {
        const angle = parentAngle + parentBundledAngleOffset(nodeIndex, sortedNodes.length, spacing);
        angles.set(node.id, angle);
        positions.set(node.id, ringPosition(center, angle, radius, yScale, parentBundledNodeAngleRange(spacing, levelIndex, node.type), levelIndex + 1));
      });
    });
}

function nearestVisibleParentAnchor(
  node: FunctionSlotGraphNode,
  incoming: Map<string, FunctionSlotGraphEdge[]>,
  angles: Map<string, number>,
  levelByType: Map<string, number>,
  nodeTypeById: Map<string, string>,
): ParentAnchor | null {
  const nodeLevel = levelByType.get(node.type) ?? Number.POSITIVE_INFINITY;
  const visited = new Set<string>([node.id]);
  let frontier = [{ nodeId: node.id, depth: 0 }];
  let best: ParentAnchor | null = null;

  while (frontier.length) {
    const next: Array<{ nodeId: string; depth: number }> = [];
    for (const { nodeId, depth } of frontier) {
      for (const edge of incoming.get(nodeId) ?? []) {
        if (visited.has(edge.source)) continue;
        visited.add(edge.source);
        const sourceLevel = levelByType.get(nodeTypeById.get(edge.source) ?? "") ?? -1;
        const sourceAngle = angles.get(edge.source);
        if (typeof sourceAngle === "number" && sourceLevel < nodeLevel) {
          if (!best || depth < best.depth || (depth === best.depth && sourceLevel > best.level)) {
            best = { id: edge.source, angle: sourceAngle, level: sourceLevel, depth };
          }
          continue;
        }
        next.push({ nodeId: edge.source, depth: depth + 1 });
      }
    }
    if (best) return best;
    frontier = next;
  }

  return best;
}

function orderNodesByParentAngle(
  nodes: FunctionSlotGraphNode[],
  incoming: Map<string, FunctionSlotGraphEdge[]>,
  angles: Map<string, number>,
  levelByType: Map<string, number>,
  nodeTypeById: Map<string, string>,
) {
  return [...nodes].sort((left, right) => {
    const leftAngle = parentAngleForNode(left, incoming, angles, levelByType, nodeTypeById) ?? 0;
    const rightAngle = parentAngleForNode(right, incoming, angles, levelByType, nodeTypeById) ?? 0;
    return leftAngle - rightAngle || radialSortKey(left).localeCompare(radialSortKey(right), "zh-Hans-CN");
  });
}

function averageParentAlignmentOffset(
  nodes: FunctionSlotGraphNode[],
  incoming: Map<string, FunctionSlotGraphEdge[]>,
  angles: Map<string, number>,
  levelByType: Map<string, number>,
  nodeTypeById: Map<string, string>,
) {
  let sin = 0;
  let cos = 0;
  let count = 0;
  nodes.forEach((node, index) => {
    const parentAngle = parentAngleForNode(node, incoming, angles, levelByType, nodeTypeById);
    if (typeof parentAngle !== "number") return;
    const baseAngle = distributedAngle(index, nodes.length);
    const diff = parentAngle - baseAngle;
    sin += Math.sin(diff);
    cos += Math.cos(diff);
    count += 1;
  });
  return count ? Math.atan2(sin / count, cos / count) : 0;
}

function parentAngleForNode(
  node: FunctionSlotGraphNode,
  incoming: Map<string, FunctionSlotGraphEdge[]>,
  angles: Map<string, number>,
  levelByType: Map<string, number>,
  nodeTypeById: Map<string, string>,
) {
  const nodeLevel = levelByType.get(node.type) ?? Number.POSITIVE_INFINITY;
  const parent = (incoming.get(node.id) ?? [])
    .map((edge) => edge.source)
    .filter((sourceId) => angles.has(sourceId))
    .sort((left, right) => (levelByType.get(nodeTypeById.get(right) ?? "") ?? -1) - (levelByType.get(nodeTypeById.get(left) ?? "") ?? -1))
    .find((sourceId) => (levelByType.get(nodeTypeById.get(sourceId) ?? "") ?? -1) < nodeLevel);
  return parent ? angles.get(parent) ?? null : null;
}

function nodeAngleRange(spacing: number, levelIndex: number) {
  return clamp(spacing * 0.34 - levelIndex * 0.004, 0.08, 0.22);
}

function ringPosition(center: { x: number; y: number }, angle: number, radius: number, yScale: number, angleRange: number, layoutLevel?: number): LayoutPosition {
  return {
    x: clamp(center.x + Math.cos(angle) * radius, 70, VIEWBOX.width - 70),
    y: clamp(center.y + Math.sin(angle) * radius * yScale, 60, VIEWBOX.height - 60),
    layoutAngleMin: angle - angleRange,
    layoutAngleMax: angle + angleRange,
    layoutRadiusMin: Math.max(0, radius - 24),
    layoutRadiusMax: radius + 24,
    layoutYScale: yScale,
    layoutLevel,
  };
}

function placeRing(
  positions: Map<string, LayoutPosition>,
  nodes: FunctionSlotGraphNode[],
  radius: number,
  center: { x: number; y: number },
  yScale: number,
  angleOffset: number,
  layoutLevel?: number,
) {
  if (!nodes.length) return;
  nodes.forEach((node, index) => {
    const angle = angleOffset + (index / Math.max(nodes.length, 1)) * Math.PI * 2;
    positions.set(node.id, ringPosition(center, angle, radius, yScale, Math.PI, layoutLevel));
  });
}

const GRAPH_SECTORS: Record<string, { start: number; end: number }> = {
  slot: { start: deg(-170), end: deg(-78) },
  script: { start: deg(-66), end: deg(8) },
  rhythm: { start: deg(20), end: deg(96) },
  packaging: { start: deg(108), end: deg(166) },
  binding: { start: deg(-74), end: deg(-34) },
  rule: { start: deg(-32), end: deg(4) },
  bundle: { start: deg(168), end: deg(178) },
  unmapped: { start: deg(-178), end: deg(-172) },
  misc: { start: deg(178), end: deg(180) },
};

function buildSectorBandPositions(
  graph: FunctionSlotLibraryGraph,
  options: {
    rootTypes: string[];
    center: { x: number; y: number };
    yScale: number;
    sectors: Record<string, { start: number; end: number }>;
    levels: Array<{ types: string[]; radius: number; band: number }>;
  },
) {
  const positions = new Map<string, LayoutPosition>();
  const roots = graph.nodes.filter((node) => options.rootTypes.includes(node.type));
  roots.forEach((node) => positions.set(node.id, options.center));

  for (const level of options.levels) {
    const nodes = graph.nodes
      .filter((node) => level.types.includes(node.type))
      .sort((left, right) => radialSortKey(left).localeCompare(radialSortKey(right), "zh-Hans-CN"));
    const bySector = new Map<string, FunctionSlotGraphNode[]>();
    for (const node of nodes) {
      const sectorKey = graphSectorKey(node);
      bySector.set(sectorKey, [...(bySector.get(sectorKey) ?? []), node]);
    }
    for (const [sectorKey, sectorNodes] of bySector) {
      const sector = options.sectors[sectorKey] ?? options.sectors.misc;
      placeSectorBand(positions, sectorNodes, sector, level.radius, level.band, options.center, options.yScale);
    }
  }

  graph.nodes.forEach((node) => {
    if (positions.has(node.id)) return;
    const sector = options.sectors[graphSectorKey(node)] ?? options.sectors.misc;
    const angle = (sector.start + sector.end) / 2;
    positions.set(node.id, sectorPoint(options.center, angle, 980, options.yScale, sector, 920, 1040));
  });

  return positions;
}

function placeSectorBand(
  positions: Map<string, LayoutPosition>,
  nodes: FunctionSlotGraphNode[],
  sector: { start: number; end: number },
  radius: number,
  band: number,
  center: { x: number; y: number },
  yScale: number,
) {
  if (!nodes.length) return;
  const width = sector.end - sector.start;
  const padding = Math.min(width * 0.16, deg(10));
  const inner = radius - band / 2;
  const outer = radius + band / 2;
  const usableWidth = Math.max(deg(6), width - padding * 2);
  const maxPerArc = Math.max(2, Math.floor((usableWidth * radius) / 94));
  const rowCount = Math.max(1, Math.ceil(nodes.length / maxPerArc));
  const rowStep = rowCount <= 1 ? 0 : band / Math.max(rowCount - 1, 1);
  nodes.forEach((node, index) => {
    const row = Math.floor(index / maxPerArc);
    const rowStart = row * maxPerArc;
    const rowLength = Math.min(maxPerArc, nodes.length - rowStart);
    const column = index - rowStart;
    const angle = sector.start + padding + ((column + 0.5) / Math.max(rowLength, 1)) * usableWidth;
    const rowRadius = rowCount <= 1 ? radius : inner + row * rowStep;
    positions.set(node.id, sectorPoint(center, angle, rowRadius, yScale, sector, inner, outer));
  });
}

function sectorPoint(
  center: { x: number; y: number },
  angle: number,
  radius: number,
  yScale: number,
  sector: { start: number; end: number },
  radiusMin: number,
  radiusMax: number,
): LayoutPosition {
  return {
    x: clamp(center.x + Math.cos(angle) * radius, 70, VIEWBOX.width - 70),
    y: clamp(center.y + Math.sin(angle) * radius * yScale, 60, VIEWBOX.height - 60),
    layoutAngleMin: sector.start,
    layoutAngleMax: sector.end,
    layoutRadiusMin: radiusMin,
    layoutRadiusMax: radiusMax,
    layoutYScale: yScale,
  };
}

function deg(value: number) {
  return (value * Math.PI) / 180;
}

function graphSectorKey(node: FunctionSlotGraphNode) {
  const layer = typeof node.data?.layer === "string" ? node.data.layer : null;
  const kind = typeof node.data?.kind === "string" ? node.data.kind : null;
  if (layer === "script" || kind === "script" || node.group === "script") return "script";
  if (layer === "rhythm" || kind === "rhythm" || node.group === "rhythm") return "rhythm";
  if (layer === "packaging" || kind === "packaging" || node.group === "packaging") return "packaging";
  if (node.type.startsWith("slot") || node.type === "tracedSlot" || kind === "slot" || node.group === "slot") return "slot";
  if (node.type.startsWith("binding") || node.group === "binding") return "binding";
  if (node.type === "rulePattern" || node.type === "recompositionPolicy" || node.group === "rule" || node.group === "policy") return "rule";
  if (node.type === "implementationBundle" || node.group === "bundle") return "bundle";
  if (node.type === "unmappedVariant" || node.group === "unmapped") return "unmapped";
  return "misc";
}

function buildLayeredRadialPositions(
  graph: FunctionSlotLibraryGraph,
  options: {
    rootTypes: string[];
    center: { x: number; y: number };
    yScale: number;
    levels: Array<{ types: string[]; radius: number }>;
  },
) {
  const positions = new Map<string, { x: number; y: number }>();
  const angles = new Map<string, number>();
  const levelByType = new Map<string, number>();
  options.levels.forEach((level, index) => level.types.forEach((type) => levelByType.set(type, index + 1)));
  for (const type of options.rootTypes) levelByType.set(type, 0);

  const roots = graph.nodes.filter((node) => options.rootTypes.includes(node.type));
  const rootIds = new Set(roots.map((node) => node.id));
  roots.forEach((node, index) => {
    const angle = distributedAngle(index, roots.length);
    angles.set(node.id, angle);
    positions.set(node.id, options.center);
  });

  const incoming = new Map<string, FunctionSlotGraphEdge[]>();
  const nodeTypeById = new Map(graph.nodes.map((node) => [node.id, node.type]));
  for (const edge of graph.edges) {
    incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge]);
  }

  for (const level of options.levels) {
    const nodes = graph.nodes
      .filter((node) => level.types.includes(node.type))
      .sort((left, right) => radialSortKey(left).localeCompare(radialSortKey(right), "zh-Hans-CN"));
    const grouped = groupByParent(nodes, incoming, angles, levelByType, nodeTypeById);
    const parentEntries = [...grouped.entries()].sort(([leftParent], [rightParent]) => {
      const leftAngle = leftParent === "__root__" ? -Math.PI / 2 : angles.get(leftParent) ?? 0;
      const rightAngle = rightParent === "__root__" ? -Math.PI / 2 : angles.get(rightParent) ?? 0;
      return leftAngle - rightAngle;
    });

    let fallbackIndex = 0;
    for (const [parentId, children] of parentEntries) {
      const parentAngle = parentId === "__root__" || rootIds.has(parentId)
        ? null
        : angles.get(parentId) ?? null;
      children.forEach((node, childIndex) => {
        const angle = parentAngle === null
          ? distributedAngle(fallbackIndex + childIndex, nodes.length)
          : parentAngle + siblingAngleOffset(childIndex, children.length, level.radius);
        angles.set(node.id, angle);
        positions.set(node.id, radialPoint(options.center, angle, level.radius, options.yScale));
      });
      if (parentAngle === null) fallbackIndex += children.length;
    }
  }

  graph.nodes.forEach((node) => {
    if (positions.has(node.id)) return;
    const seed = hashText(node.id);
    const angle = (seed % 6283) / 1000;
    positions.set(node.id, radialPoint(options.center, angle, 640, options.yScale));
  });

  return positions;
}
