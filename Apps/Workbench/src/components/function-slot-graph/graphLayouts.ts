import type { FunctionSlotGraphEdge, FunctionSlotGraphNode, FunctionSlotLibraryGraph } from "../../types/library";
import type { GovernanceLayoutMode, GraphFiltersState } from "./types";
import { CENTER, VIEWBOX, clamp, type LayoutPosition } from "./graphCore";
import { buildConcentricTypeRingPositions, buildGovernanceForcePositions, layoutNodeVisible, visibleGovernanceLevels } from "./graphGovernanceLayoutSupport";
import { placeColumn, radialSortKey } from "./graphLayoutMath";

type ParentAnchor = {
  id: string;
  angle: number;
  level: number;
  depth: number;
};

const GOVERNANCE_RING_START_RADIUS = 260;
const GOVERNANCE_RING_STEP = 220;
const GOVERNANCE_COLUMN_START_X = 310;
const GOVERNANCE_COLUMN_STEP_X = 220;

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

export function buildPositions(graph: FunctionSlotLibraryGraph): Map<string, LayoutPosition> {
  const positions = new Map<string, LayoutPosition>();
  const root = graph.nodes.find((node) => node.type === "libraryItem");
  if (root) positions.set(root.id, CENTER);

  const slots = graph.nodes.filter((node) => node.type === "slotInstance").sort((left, right) => Number(left.data.slotOrder ?? 0) - Number(right.data.slotOrder ?? 0));
  const slotRadius = 260;
  slots.forEach((slot, index) => {
    const angle = -Math.PI / 2 + (index / Math.max(slots.length, 1)) * Math.PI * 2;
    const x = CENTER.x + Math.cos(angle) * slotRadius;
    const y = CENTER.y + Math.sin(angle) * slotRadius;
    positions.set(slot.id, { x, y });
    const atoms = graph.nodes.filter((node) => node.type === "atomInstance" && node.data.slotId === slot.data.slotId);
    atoms.forEach((atom, atomIndex) => {
      const atomAngle = angle + (atomIndex - 1) * 0.34;
      positions.set(atom.id, {
        x: CENTER.x + Math.cos(atomAngle) * 390,
        y: CENTER.y + Math.sin(atomAngle) * 390,
      });
    });
  });

  const bindings = graph.nodes.filter((node) => node.type === "binding");
  bindings.forEach((binding, index) => {
    const angle = -Math.PI / 2 + (index / Math.max(bindings.length, 1)) * Math.PI * 2 + 0.18;
    positions.set(binding.id, {
      x: CENTER.x + Math.cos(angle) * 105,
      y: CENTER.y + Math.sin(angle) * 105,
    });
  });

  const concepts = graph.nodes.filter((node) => node.type === "slotConcept");
  concepts.forEach((concept, index) => {
    const angle = Math.PI + (index / Math.max(concepts.length, 1)) * Math.PI * 0.8;
    positions.set(concept.id, {
      x: CENTER.x + Math.cos(angle) * 430,
      y: CENTER.y + Math.sin(angle) * 270,
    });
  });
  return positions;
}

export function buildLibraryColumnPositions(graph: FunctionSlotLibraryGraph): Map<string, LayoutPosition> {
  const positions = new Map<string, LayoutPosition>();
  const root = graph.nodes.find((node) => node.type === "libraryItem");
  if (root) positions.set(root.id, { x: 135, y: CENTER.y });

  const slots = graph.nodes
    .filter((node) => node.type === "slotInstance")
    .sort((left, right) => Number(left.data.slotOrder ?? 0) - Number(right.data.slotOrder ?? 0));
  placeColumn(positions, slots, 330, CENTER.y, 72);

  placeSlotAtomColumn(positions, graph, slots, "script", 560);
  placeSlotAtomColumn(positions, graph, slots, "rhythm", 760);
  placeSlotAtomColumn(positions, graph, slots, "packaging", 960);

  const bindings = graph.nodes
    .filter((node) => node.type === "binding")
    .sort((left, right) => String(left.data.bindingId ?? left.label).localeCompare(String(right.data.bindingId ?? right.label)));
  placeColumn(positions, bindings, 1130, CENTER.y, 42);

  return positions;
}

function placeSlotAtomColumn(
  positions: Map<string, LayoutPosition>,
  graph: FunctionSlotLibraryGraph,
  slots: FunctionSlotGraphNode[],
  atomType: string,
  x: number,
) {
  const slotY = new Map(slots.map((slot) => [String(slot.data.slotId ?? ""), positions.get(slot.id)?.y ?? CENTER.y]));
  const atoms = graph.nodes
    .filter((node) => node.type === "atomInstance" && node.data.atomType === atomType)
    .sort((left, right) => {
      const leftSlotY = slotY.get(String(left.data.slotId ?? "")) ?? CENTER.y;
      const rightSlotY = slotY.get(String(right.data.slotId ?? "")) ?? CENTER.y;
      return leftSlotY - rightSlotY || String(left.data.atomId ?? left.label).localeCompare(String(right.data.atomId ?? right.label));
    });
  const bySlot = new Map<string, FunctionSlotGraphNode[]>();
  for (const atom of atoms) {
    const slotId = String(atom.data.slotId ?? "");
    bySlot.set(slotId, [...(bySlot.get(slotId) ?? []), atom]);
  }
  for (const [slotId, slotAtoms] of bySlot) {
    const centerY = slotY.get(slotId) ?? CENTER.y;
    const spacing = 24;
    const startY = centerY - ((slotAtoms.length - 1) * spacing) / 2;
    slotAtoms.forEach((atom, index) => positions.set(atom.id, { x, y: clamp(startY + index * spacing, 55, VIEWBOX.height - 55) }));
  }
}

export function visibleGovernanceNodeIds(graph: FunctionSlotLibraryGraph, filters: GraphFiltersState, focusNodeId: string | null) {
  const ids = new Set<string>();
  const root = graph.nodes.find((node) => node.type === "governanceRoot");
  if (root) ids.add(root.id);

  for (const node of graph.nodes) {
    if (governanceFilterMatch(node, filters)) ids.add(node.id);
    if (filters.binding && (node.type === "bindingPrinciple" || node.type === "bindingPattern")) ids.add(node.id);
    if (filters.rule && (node.type === "rulePattern" || node.type === "recompositionPolicy")) ids.add(node.id);
    if (filters.bundle && node.type === "implementationBundle") ids.add(node.id);
    if (filters.unmapped && node.type === "unmappedVariant") ids.add(node.id);
  }

  const focus = focusNodeId ? graph.nodes.find((node) => node.id === focusNodeId) : null;
  if (focus) {
    ids.add(focus.id);
    const depth = focus.type === "slotSubtype" || focus.type === "implementationBundle" ? 2 : 1;
    for (const id of connectedGovernanceIds(graph, focus.id, depth)) ids.add(id);
  }

  return ids;
}

function connectedGovernanceIds(graph: FunctionSlotLibraryGraph, nodeId: string, maxDepth: number) {
  const ids = new Set<string>([nodeId]);
  let frontier = new Set<string>([nodeId]);
  for (let depth = 0; depth < maxDepth; depth += 1) {
    const next = new Set<string>();
    for (const edge of graph.edges) {
      if (frontier.has(edge.source) && !ids.has(edge.target)) next.add(edge.target);
      if (frontier.has(edge.target) && !ids.has(edge.source)) next.add(edge.source);
    }
    for (const id of next) ids.add(id);
    frontier = next;
  }
  return ids;
}

export function governanceFilterMatch(node: FunctionSlotGraphNode, filters: GraphFiltersState) {
  if (node.type === "atomLayer") return false;
  if (node.type === "unmappedVariant") return filters.unmapped;
  if (node.type === "sourceVariant") return filters.sourceVariant;
  if (node.type === "sourceSample") return true;
  if (node.type === "governanceRoot") return true;
  if (node.type === "slotFamily") return filters.slotFamily;
  if (node.type === "slotArchetype") return filters.slotArchetype;
  if (node.type === "slotSubtype") return filters.slotSubtype;
  if (node.type === "atomArchetype") return filters.atomArchetype;
  if (node.type === "atomPattern") return filters.atomPattern;
  if (node.type.startsWith("binding")) return filters.binding;
  if (node.type === "rulePattern" || node.type === "recompositionPolicy") return filters.rule;
  if (node.type === "implementationBundle") return filters.bundle;
  return true;
}

export function planTraceFilterMatch(node: FunctionSlotGraphNode, filters: GraphFiltersState) {
  if (node.type === "confirmedPlan") return true;
  if (node.type === "atomLayer") return false;
  if (node.type === "tracedSlot") return filters.slot;
  if (node.type === "slotSubtype") return filters.slotSubtype;
  if (node.type === "sourceVariant") return filters.sourceVariant && isSourceVariantAtom(node);
  if (node.type === "sourceSample") return true;
  if (node.type === "slotFamily" || node.type === "slotArchetype" || node.type === "atomArchetype" || node.type === "atomPattern") return false;
  if (node.type === "sourceExample") return false;
  return true;
}

function isSourceVariantAtom(node: FunctionSlotGraphNode) {
  const kind = typeof node.data?.kind === "string" ? node.data.kind : null;
  const layer = typeof node.data?.layer === "string" ? node.data.layer : null;
  if (!kind && !layer) return true;
  return kind === "script" || kind === "rhythm" || kind === "packaging" || layer === "script" || layer === "rhythm" || layer === "packaging";
}

export function buildGovernancePositions(graph: FunctionSlotLibraryGraph, layoutMode: GovernanceLayoutMode, visibleNodeIds: Set<string> | null) {
  if (layoutMode === "force") return buildGovernanceForcePositions(graph, visibleNodeIds);
  const positions = new Map<string, LayoutPosition>();
  const root = graph.nodes.find((node) => node.type === "governanceRoot");
  if (root) positions.set(root.id, { x: 150, y: CENTER.y, layoutLevel: 0 });
  visibleGovernanceLevels(graph, visibleNodeIds).forEach((level, index) => {
    const nodes = graph.nodes
      .filter((node) => level.types.includes(node.type) && layoutNodeVisible(node, visibleNodeIds))
      .sort((left, right) => radialSortKey(left).localeCompare(radialSortKey(right), "zh-Hans-CN"));
    placeColumn(positions, nodes, GOVERNANCE_COLUMN_START_X + (index * GOVERNANCE_COLUMN_STEP_X), CENTER.y, level.columnSpacing, index + 1);
  });
  return positions;
}

export function buildPlanTracePositions(graph: FunctionSlotLibraryGraph) {
  return buildConcentricTypeRingPositions(graph, {
    rootTypes: ["confirmedPlan"],
    center: CENTER,
    yScale: 1,
    levels: [
      { types: ["slotSubtype"], radius: 360 },
      { types: ["sourceVariant"], radius: 760 },
      { types: ["sourceSample"], radius: 1040 },
    ],
  });
}

export function buildPlanTraceColumnPositions(graph: FunctionSlotLibraryGraph): Map<string, LayoutPosition> {
  const positions = new Map<string, LayoutPosition>();
  const incoming = new Map<string, FunctionSlotGraphEdge[]>();
  const nodeTypeById = new Map(graph.nodes.map((node) => [node.id, node.type]));
  const levelByType = new Map<string, number>();
  PLAN_TRACE_COLUMN_LEVELS.forEach((level, index) => level.types.forEach((type) => levelByType.set(type, index)));
  for (const edge of graph.edges) incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge]);

  PLAN_TRACE_COLUMN_LEVELS.forEach((level, levelIndex) => {
    const nodes = graph.nodes
      .filter((node) => level.types.includes(node.type))
      .sort((left, right) => planTraceColumnSort(left, right, positions, incoming, levelByType, nodeTypeById));
    const x = 480 + levelIndex * 620;
    placeColumn(positions, nodes, x, CENTER.y, level.spacing);
  });
  return positions;
}

const PLAN_TRACE_COLUMN_LEVELS = [
  { types: ["confirmedPlan"], spacing: 260 },
  { types: ["slotSubtype"], spacing: 112 },
  { types: ["sourceVariant"], spacing: 46 },
  { types: ["sourceSample"], spacing: 54 },
];

function planTraceColumnSort(
  left: FunctionSlotGraphNode,
  right: FunctionSlotGraphNode,
  positions: Map<string, LayoutPosition>,
  incoming: Map<string, FunctionSlotGraphEdge[]>,
  levelByType: Map<string, number>,
  nodeTypeById: Map<string, string>,
) {
  const leftParentY = parentColumnY(left, positions, incoming, levelByType, nodeTypeById);
  const rightParentY = parentColumnY(right, positions, incoming, levelByType, nodeTypeById);
  return leftParentY - rightParentY || radialSortKey(left).localeCompare(radialSortKey(right), "zh-Hans-CN");
}

function parentColumnY(
  node: FunctionSlotGraphNode,
  positions: Map<string, LayoutPosition>,
  incoming: Map<string, FunctionSlotGraphEdge[]>,
  levelByType: Map<string, number>,
  nodeTypeById: Map<string, string>,
) {
  const nodeLevel = levelByType.get(node.type) ?? Number.POSITIVE_INFINITY;
  const parent = (incoming.get(node.id) ?? [])
    .map((edge) => edge.source)
    .filter((sourceId) => positions.has(sourceId))
    .sort((left, right) => (levelByType.get(nodeTypeById.get(right) ?? "") ?? -1) - (levelByType.get(nodeTypeById.get(left) ?? "") ?? -1))
    .find((sourceId) => (levelByType.get(nodeTypeById.get(sourceId) ?? "") ?? -1) < nodeLevel);
  return parent ? positions.get(parent)?.y ?? CENTER.y : CENTER.y;
}
