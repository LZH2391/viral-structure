import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from "d3-force";
import type { SampleArtifact } from "../../types/artifact";
import type { FunctionSlotGraphEdge, FunctionSlotGraphNode, FunctionSlotLibraryGraph } from "../../types/library";
import type { D3Link, GovernanceLayoutMode, GraphFiltersState, PositionedNode, SimNode, VisibleGraph } from "./types";

export const VIEWBOX = { width: 4600, height: 3900 };
export const CENTER = { x: 2300, y: 1950 };

type LayoutPosition = {
  x: number;
  y: number;
  layoutAngleMin?: number;
  layoutAngleMax?: number;
  layoutRadiusMin?: number;
  layoutRadiusMax?: number;
  layoutYScale?: number;
  layoutLevel?: number;
};

type ProjectedEdgesCacheEntry = {
  edgeSignature: string;
  visibleSignature: string;
  edges: FunctionSlotGraphEdge[];
};

type FocusIndex = {
  connected: Map<string, Set<string>>;
  incoming: Map<string, FunctionSlotGraphEdge[]>;
};

type ParentAnchor = {
  id: string;
  angle: number;
  level: number;
  depth: number;
};

const projectedEdgesCache = new WeakMap<FunctionSlotLibraryGraph, ProjectedEdgesCacheEntry>();
const focusIndexCache = new WeakMap<FunctionSlotGraphEdge[], FocusIndex>();
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

export function buildVisibleGraph(graph: FunctionSlotLibraryGraph | null, filters: GraphFiltersState, focusNodeId: string | null = null, governanceLayoutMode: GovernanceLayoutMode = "columns"): VisibleGraph {
  if (!graph) return { nodes: [], edges: [] };
  const normalizedGraph = graph.schemaVersion === "function_slot_governance_graph.v1" ? withoutAtomLayerNodes(graph) : graph;
  const projectedGraph = normalizedGraph.schemaVersion === "confirmed_plan_trace_graph.v1" && hasLegacyPlanTraceAtomNodes(normalizedGraph)
    ? withoutAtomLayerNodes(withAtomLayerProjection(normalizedGraph))
    : normalizedGraph;
  const visibleIds = projectedGraph.schemaVersion === "function_slot_governance_graph.v1" ? visibleGovernanceNodeIds(projectedGraph, filters, focusNodeId) : null;
  const effectiveGovernanceEdges = projectedGraph.schemaVersion === "function_slot_governance_graph.v1" && visibleIds
    ? projectVisibleEdges(projectedGraph, visibleIds)
    : null;
  const layoutGraph = effectiveGovernanceEdges
    ? { ...projectedGraph, edges: effectiveGovernanceEdges }
    : projectedGraph;
  let positions: Map<string, LayoutPosition>;
  if (projectedGraph.schemaVersion === "function_slot_governance_graph.v1") {
    positions = buildGovernancePositions(layoutGraph, governanceLayoutMode, visibleIds);
  } else if (projectedGraph.schemaVersion === "confirmed_plan_trace_graph.v1") {
    positions = governanceLayoutMode === "columns" ? buildPlanTraceColumnPositions(projectedGraph) : buildPlanTracePositions(projectedGraph);
  } else {
    positions = governanceLayoutMode === "columns" ? buildLibraryColumnPositions(projectedGraph) : buildPositions(projectedGraph);
  }
  const nodes = projectedGraph.nodes
    .filter((node) => {
      if (visibleIds && !visibleIds.has(node.id)) return false;
      if (node.type === "slotInstance") return filters.slot;
      if (node.type === "atomInstance") return filters.atom;
      if (node.type === "binding") return filters.binding;
      if (node.type === "slotConcept") return false;
      if (projectedGraph.schemaVersion === "function_slot_governance_graph.v1") return governanceFilterMatch(node, filters);
      if (projectedGraph.schemaVersion === "confirmed_plan_trace_graph.v1") return planTraceFilterMatch(node, filters);
      return true;
    })
    .filter((node) => positions.has(node.id))
    .map((node) => {
      const position = positions.get(node.id) ?? centerPosition();
      return {
        ...node,
        x: position.x,
        y: position.y,
        layoutX: position.x,
        layoutY: position.y,
        layoutAngleMin: position.layoutAngleMin,
        layoutAngleMax: position.layoutAngleMax,
        layoutRadiusMin: position.layoutRadiusMin,
        layoutRadiusMax: position.layoutRadiusMax,
        layoutYScale: position.layoutYScale,
        layoutLevel: position.layoutLevel,
        shortLabel: shortLabel(node),
      };
    });
  const nodeIds = new Set(nodes.map((node) => node.id));
  return {
    nodes,
    edges: effectiveGovernanceEdges
      ? effectiveGovernanceEdges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
      : projectedGraph.schemaVersion === "confirmed_plan_trace_graph.v1"
      ? projectVisibleEdges(projectedGraph, nodeIds)
      : projectedGraph.edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target)),
  };
}

function centerPosition(): LayoutPosition {
  return { x: CENTER.x, y: CENTER.y };
}

function graphId(...parts: Array<string | number | null | undefined>) {
  return parts.map((part) => sanitizeGraphId(part)).join(":");
}

function sanitizeGraphId(value: unknown) {
  return String(value ?? "").replace(/[^A-Za-z0-9_.:-]/g, "_");
}

function withoutAtomLayerNodes(graph: FunctionSlotLibraryGraph): FunctionSlotLibraryGraph {
  if (!graph.nodes.some((node) => node.type === "atomLayer")) return graph;
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const incoming = new Map<string, FunctionSlotGraphEdge[]>();
  const outgoing = new Map<string, FunctionSlotGraphEdge[]>();
  for (const edge of graph.edges) {
    incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge]);
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge]);
  }
  const edges: FunctionSlotGraphEdge[] = [];
  for (const edge of graph.edges) {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (source?.type === "atomLayer" || target?.type === "atomLayer") continue;
    edges.push(edge);
  }
  for (const layer of graph.nodes.filter((node) => node.type === "atomLayer")) {
    for (const sourceEdge of incoming.get(layer.id) ?? []) {
      const source = nodeById.get(sourceEdge.source);
      if (!source || source.type === "atomLayer") continue;
      for (const targetEdge of outgoing.get(layer.id) ?? []) {
        const target = nodeById.get(targetEdge.target);
        if (!target || target.type === "atomLayer") continue;
        edges.push({
          id: graphId("edge", "projected_atom_layer", source.id, target.id),
          source: source.id,
          target: target.id,
          type: projectedAtomLayerEdgeType(source, target),
          label: targetEdge.label ?? sourceEdge.label,
        });
      }
    }
  }
  return {
    ...graph,
    nodes: graph.nodes.filter((node) => node.type !== "atomLayer"),
    edges: dedupeEdges(edges),
  };
}

function projectedAtomLayerEdgeType(source: FunctionSlotGraphNode, target: FunctionSlotGraphNode) {
  if (source.type === "slotSubtype" && target.type === "atomArchetype") return "subtype_to_atom_archetype";
  if (source.type === "slotSubtype" && target.type === "atomPattern") return "subtype_to_atom_pattern";
  return "projected_atom_layer";
}

function layerDisplayName(layer: unknown) {
  if (layer === "script") return "脚本层";
  if (layer === "rhythm") return "节奏层";
  if (layer === "packaging") return "包装层";
  return "Atom Layer";
}

function withAtomLayerProjection(graph: FunctionSlotLibraryGraph): FunctionSlotLibraryGraph {
  if (graph.nodes.some((node) => node.type === "atomLayer")) return graph;
  const nodes = [...graph.nodes];
  const edges: FunctionSlotGraphEdge[] = [];
  const nodeIds = new Set(nodes.map((node) => node.id));
  const layerIds = new Map<string, string>();

  const ensureLayer = (planId: string | null, layer: string | null) => {
    const normalizedLayer = layer === "rhythm" || layer === "packaging" ? layer : "script";
    const key = `${planId ?? "governance"}:${normalizedLayer}`;
    const existing = layerIds.get(key);
    if (existing) return existing;
    const id = graphId("atomLayer", planId ?? graph.artifactId, normalizedLayer);
    layerIds.set(key, id);
    if (!nodeIds.has(id)) {
      nodeIds.add(id);
      nodes.push({
        id,
        type: "atomLayer",
        label: layerDisplayName(normalizedLayer),
        group: normalizedLayer,
        data: {
          planId,
          layer: normalizedLayer,
          virtual: true,
        },
      });
    }
    return id;
  };

  const atomParentEdgeTypes = new Set(["subtype_to_atom_archetype", "subtype_to_atom_pattern"]);
  for (const edge of graph.edges) {
    const source = graph.nodes.find((node) => node.id === edge.source);
    const target = graph.nodes.find((node) => node.id === edge.target);
    if (target?.type === "atomArchetype" || target?.type === "atomPattern") {
      const planId = typeof target.data?.planId === "string" ? target.data.planId : null;
      const layer = typeof target.data?.layer === "string" ? target.data.layer : target.group;
      const layerId = ensureLayer(planId, layer);
      if (atomParentEdgeTypes.has(edge.type)) {
        edges.push({ ...edge, target: layerId, id: `${edge.id}:toLayer`, type: "subtype_to_atom_layer", label: layerDisplayName(layer) });
        edges.push({ ...edge, source: layerId, id: `${edge.id}:fromLayer`, type: target.type === "atomArchetype" ? "atom_layer_to_archetype" : "atom_layer_to_pattern", label: target.type === "atomArchetype" ? "archetype" : "pattern" });
        continue;
      }
      if (source?.type !== "atomLayer" && edge.type !== "atom_layer_to_pattern" && edge.type !== "atom_layer_to_archetype") {
        edges.push({ ...edge, source: layerId, id: `${edge.id}:layerParent`, type: target.type === "atomArchetype" ? "atom_layer_to_archetype" : "atom_layer_to_pattern", label: edge.label ?? "pattern" });
      }
    }
    edges.push(edge);
  }

  return { ...graph, nodes, edges: dedupeEdges(edges) };
}

function projectVisibleEdges(graph: FunctionSlotLibraryGraph, visibleNodeIds: Set<string>) {
  const edgeSignature = graph.edges.map((edge) => `${edge.id}:${edge.source}>${edge.target}:${edge.type}`).join("|");
  const visibleSignature = [...visibleNodeIds].sort().join("|");
  const cached = projectedEdgesCache.get(graph);
  if (cached?.edgeSignature === edgeSignature && cached.visibleSignature === visibleSignature) return cached.edges;

  const incoming = new Map<string, FunctionSlotGraphEdge[]>();
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  for (const edge of graph.edges) {
    incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge]);
  }
  const edges: FunctionSlotGraphEdge[] = [];
  for (const targetId of visibleNodeIds) {
    const ancestors = nearestVisibleAncestors(targetId, incoming, visibleNodeIds);
    for (const ancestorId of ancestors) {
      if (ancestorId === targetId) continue;
      if (!shouldProjectHierarchyEdge(nodeById, ancestorId, targetId)) continue;
      edges.push({
        id: graphId("edge", "projected", ancestorId, targetId),
        source: ancestorId,
        target: targetId,
        type: "projected_hierarchy",
        label: "projected",
      });
    }
  }
  for (const edge of graph.edges) {
    if (edge.type === "governance_contains_source_sample") continue;
    if (!visibleNodeIds.has(edge.source) || !visibleNodeIds.has(edge.target)) continue;
    edges.push(edge);
  }
  const result = dedupeEdges(edges);
  projectedEdgesCache.set(graph, { edgeSignature, visibleSignature, edges: result });
  return result;
}

function hasLegacyPlanTraceAtomNodes(graph: FunctionSlotLibraryGraph) {
  return graph.nodes.some((node) => node.type === "atomArchetype" || node.type === "atomPattern");
}

function shouldProjectHierarchyEdge(nodeById: Map<string, FunctionSlotGraphNode>, sourceId: string, targetId: string) {
  const source = nodeById.get(sourceId);
  const target = nodeById.get(targetId);
  const sourceType = source?.type;
  const targetType = target?.type;
  if (sourceType === "slotSubtype" && targetType === "atomPattern") return atomPatternTargetsSubtype(target, source);
  if (targetType === "atomPattern") return false;
  if (targetType === "sourceVariant") return sourceType === "atomPattern";
  if (targetType === "sourceSample") return sourceType === "sourceVariant" || sourceType === "atomPattern";
  return sourceType === "governanceRoot" || sourceType === "slotFamily" || sourceType === "slotArchetype";
}

function atomPatternTargetsSubtype(pattern: FunctionSlotGraphNode | undefined, subtype: FunctionSlotGraphNode | undefined) {
  const subtypeId = typeof subtype?.data?.id === "string" ? subtype.data.id : null;
  if (!subtypeId) return false;
  const targetSubtypeIds = Array.isArray(pattern?.data?.forSlotSubtypeIds)
    ? pattern.data.forSlotSubtypeIds.map((value) => String(value)).filter(Boolean)
    : [];
  return targetSubtypeIds.includes(subtypeId);
}

function nearestVisibleAncestors(targetId: string, incoming: Map<string, FunctionSlotGraphEdge[]>, visibleNodeIds: Set<string>) {
  const ancestors = new Set<string>();
  const visitedHidden = new Set<string>([targetId]);
  let frontier = [{ nodeId: targetId, crossedHidden: false }];
  while (frontier.length) {
    const next: Array<{ nodeId: string; crossedHidden: boolean }> = [];
    for (const { nodeId, crossedHidden } of frontier) {
      for (const edge of incoming.get(nodeId) ?? []) {
        if (visibleNodeIds.has(edge.source)) {
          if (crossedHidden) ancestors.add(edge.source);
          continue;
        }
        if (visitedHidden.has(edge.source)) continue;
        visitedHidden.add(edge.source);
        next.push({ nodeId: edge.source, crossedHidden: true });
      }
    }
    frontier = next;
  }
  return ancestors;
}

function dedupeEdges(edges: FunctionSlotGraphEdge[]) {
  const seen = new Set<string>();
  const result: FunctionSlotGraphEdge[] = [];
  for (const edge of edges) {
    if (!edge.source || !edge.target || edge.source === edge.target) continue;
    const key = `${edge.source}->${edge.target}:${edge.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(edge);
  }
  return result;
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

export function connectedNodeIds(nodeId: string | null, edges: FunctionSlotGraphEdge[]) {
  const ids = new Set<string>();
  if (!nodeId) return ids;
  ids.add(nodeId);
  for (const connectedId of focusIndex(edges).connected.get(nodeId) ?? []) ids.add(connectedId);
  return ids;
}

export function reverseTracePath(nodeId: string | null, edges: FunctionSlotGraphEdge[]) {
  const nodes = new Set<string>();
  const edgeIds = new Set<string>();
  if (!nodeId) return { nodes, edges: edgeIds };
  nodes.add(nodeId);
  let frontier = new Set<string>([nodeId]);
  const incoming = focusIndex(edges).incoming;
  while (frontier.size) {
    const next = new Set<string>();
    for (const targetId of frontier) {
      for (const edge of incoming.get(targetId) ?? []) {
      edgeIds.add(edge.id);
      if (!nodes.has(edge.source)) {
        nodes.add(edge.source);
        next.add(edge.source);
      }
      }
    }
    frontier = next;
  }
  return { nodes, edges: edgeIds };
}

function focusIndex(edges: FunctionSlotGraphEdge[]) {
  const cached = focusIndexCache.get(edges);
  if (cached) return cached;
  const connected = new Map<string, Set<string>>();
  const incoming = new Map<string, FunctionSlotGraphEdge[]>();
  for (const edge of edges) {
    if (!connected.has(edge.source)) connected.set(edge.source, new Set());
    if (!connected.has(edge.target)) connected.set(edge.target, new Set());
    connected.get(edge.source)?.add(edge.target);
    connected.get(edge.target)?.add(edge.source);
    incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge]);
  }
  const index = { connected, incoming };
  focusIndexCache.set(edges, index);
  return index;
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

export function nodeDetailRows(node: FunctionSlotGraphNode): Array<[string, unknown]> {
  const data = node.data ?? {};
  if (node.type === "unmappedVariant") return [["variantId", data.variantId], ["variantKind", data.variantKind], ["reason", data.reason], ["suggestedAction", data.suggestedAction], ["why not pattern", data.reason]];
  if (node.type === "sourceExample") return [["planId", data.planId], ["sampleId", data.sampleId], ["sourceAlias", data.sourceAlias]];
  if (node.type === "sourceVariant") return [["variantId", data.variantId], ["label", data.label], ["sampleId", data.sampleId], ["kind", data.kind], ["sourceId", data.sourceId], ["labelMissing", data.labelMissing]];
  if (node.type === "sourceSample") return [["sampleVideoId", data.sampleVideoId], ["sampleId", data.sampleId], ["sourceAlias", data.sourceAlias]];
  if (isGovernanceNode(node)) return [["id", data.id ?? data.governanceId], ["name", graphNodeDisplayLabel(node)], ["variantCount", supportValue(data.support, "variantCount")], ["sampleCount", supportValue(data.support, "sampleCount")], ["sourceVariantIds", data.sourceVariantIds], ["judgementReason", data.judgementReason], ["differenceNotes", data.differenceNotes], ["riskIfMisclassified", data.riskIfMisclassified]];
  if (node.type === "confirmedPlan") return [["planId", data.planId], ["confirmationId", data.confirmationId], ["sourceTurnId", data.sourceTurnId], ["sourceRestructurePath", data.sourceRestructurePath], ["displayJsonPath", data.displayJsonPath], ["evidence", data.evidence]];
  if (node.type.startsWith("traced")) return [["planId", data.planId], ["evidence", data.evidence]];
  if (node.type === "slotInstance") return [["stableId", data.stableId], ["slotType", data.slotType], ["before", data.viewerStateBefore], ["after", data.viewerStateAfter], ["task", data.persuasionTask], ["shots", sourceShots(data.sourceRefs)]];
  if (node.type === "atomInstance") return [["atomId", data.atomId], ["atomType", data.atomType], ["slotId", data.slotId], ["function", data.function], ["claim/pace/proof", data.claimType ?? data.pace ?? data.proofType], ["shots", sourceShots(data.sourceRefs)]];
  if (node.type === "binding") return [["bindingId", data.bindingId], ["type", data.bindingType], ["rule", data.rule], ["risk", data.riskIfBroken], ["confidence", data.confidence]];
  return Object.entries(data).slice(0, 8);
}

export function formatDetailValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "无";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function buildPositions(graph: FunctionSlotLibraryGraph): Map<string, LayoutPosition> {
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

function buildLibraryColumnPositions(graph: FunctionSlotLibraryGraph): Map<string, LayoutPosition> {
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

function visibleGovernanceNodeIds(graph: FunctionSlotLibraryGraph, filters: GraphFiltersState, focusNodeId: string | null) {
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

function governanceFilterMatch(node: FunctionSlotGraphNode, filters: GraphFiltersState) {
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

function planTraceFilterMatch(node: FunctionSlotGraphNode, filters: GraphFiltersState) {
  if (node.type === "confirmedPlan") return true;
  if (node.type === "tracedSlot") return filters.slot;
  if (node.type === "slotSubtype") return filters.slotSubtype;
  if (node.type === "sourceVariant") return filters.sourceVariant && isSourceVariantAtom(node);
  if (node.type === "sourceSample") return true;
  if (node.type === "slotFamily" || node.type === "slotArchetype" || node.type === "atomLayer" || node.type === "atomArchetype" || node.type === "atomPattern") return false;
  if (node.type === "sourceExample") return false;
  return true;
}

function isSourceVariantAtom(node: FunctionSlotGraphNode) {
  const kind = typeof node.data?.kind === "string" ? node.data.kind : null;
  const layer = typeof node.data?.layer === "string" ? node.data.layer : null;
  if (!kind && !layer) return true;
  return kind === "script" || kind === "rhythm" || kind === "packaging" || layer === "script" || layer === "rhythm" || layer === "packaging";
}

function buildGovernancePositions(graph: FunctionSlotLibraryGraph, layoutMode: GovernanceLayoutMode, visibleNodeIds: Set<string> | null) {
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

function buildPlanTracePositions(graph: FunctionSlotLibraryGraph) {
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

function buildPlanTraceColumnPositions(graph: FunctionSlotLibraryGraph): Map<string, LayoutPosition> {
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

function buildGovernanceForcePositions(graph: FunctionSlotLibraryGraph, visibleNodeIds: Set<string> | null) {
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

function visibleGovernanceLevels(graph: FunctionSlotLibraryGraph, visibleNodeIds: Set<string> | null) {
  return GOVERNANCE_LAYOUT_LEVELS.filter((level) => graph.nodes.some((node) => level.types.includes(node.type) && layoutNodeVisible(node, visibleNodeIds)));
}

function layoutNodeVisible(node: FunctionSlotGraphNode, visibleNodeIds: Set<string> | null) {
  return !visibleNodeIds || visibleNodeIds.has(node.id);
}

function buildConcentricTypeRingPositions(
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

function groupByParent(
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

function siblingAngleOffset(index: number, count: number, radius: number) {
  if (count <= 1) return 0;
  const maxStep = radius > 650 ? 0.46 : radius > 500 ? 0.4 : radius > 360 ? 0.34 : 0.28;
  const step = Math.min(maxStep, Math.PI * 1.85 / Math.max(count, 1));
  return (index - (count - 1) / 2) * step;
}

function parentBundledAngleOffset(index: number, count: number, spacing = parentBundledSpacing(count)) {
  if (count <= 1) return 0;
  const span = spacing * (count - 1);
  return -span / 2 + index * spacing;
}

function parentBundledSpacing(count: number, nodeType?: string) {
  if (count <= 1) return 0.12;
  if (isAtomLayoutNodeType(nodeType)) return clamp(0.16 - Math.min(count, 18) * 0.004, 0.095, 0.15);
  return clamp(0.055 + (count > 8 ? 0.018 : 0), 0.055, 0.09);
}

function parentBundledNodeAngleRange(spacing: number, levelIndex: number, nodeType: string) {
  if (!isAtomLayoutNodeType(nodeType)) return nodeAngleRange(spacing, levelIndex);
  return clamp(spacing * 0.62, 0.13, 0.24);
}

function isAtomLayoutNodeType(type: string | undefined) {
  return type === "atomArchetype" || type === "atomPattern";
}

function isAtomLayoutLevel(types: string[]) {
  return types.length > 0 && types.every((type) => isAtomLayoutNodeType(type));
}

function shouldParentBundleGovernanceLevel(types: string[]) {
  return isAtomLayoutLevel(types) || (types.length === 1 && types[0] === "sourceSample");
}

function distributedAngle(index: number, count: number) {
  if (count <= 1) return 0.62;
  return -Math.PI / 2 + (index / Math.max(count, 1)) * Math.PI * 2;
}

function radialPoint(center: { x: number; y: number }, angle: number, radius: number, yScale: number) {
  return {
    x: clamp(center.x + Math.cos(angle) * radius, 70, VIEWBOX.width - 70),
    y: clamp(center.y + Math.sin(angle) * radius * yScale, 60, VIEWBOX.height - 60),
  };
}

function radialSortKey(node: FunctionSlotGraphNode) {
  const order = Number(node.data?.slotOrder ?? node.data?.order ?? Number.NaN);
  const orderKey = Number.isFinite(order) ? String(order).padStart(4, "0") : "9999";
  return `${orderKey}:${node.type}:${String(node.label ?? node.id)}`;
}

function hashText(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function placeColumn(positions: Map<string, LayoutPosition>, nodes: FunctionSlotGraphNode[], x: number, centerY = CENTER.y, spacing = 54, layoutLevel?: number) {
  const startY = centerY - ((nodes.length - 1) * spacing) / 2;
  nodes.forEach((node, index) => positions.set(node.id, { x, y: clamp(startY + index * spacing, 55, VIEWBOX.height - 55), layoutLevel }));
}

function edgeDistance(type: string) {
  if (type.includes("source_variant")) return 270;
  if (type === "plan_uses_slot_family") return 300;
  if (type === "subtype_to_atom_archetype") return 285;
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

function positiveNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function sourceShots(sourceRefs: unknown) {
  if (!sourceRefs || typeof sourceRefs !== "object") return null;
  const refs = (sourceRefs as { shotRefs?: unknown }).shotRefs;
  return Array.isArray(refs) ? refs.join(", ") : null;
}

function isGovernanceNode(node: FunctionSlotGraphNode) {
  return [
    "governanceRoot",
    "slotFamily",
    "slotArchetype",
    "slotSubtype",
    "atomArchetype",
    "atomPattern",
    "bindingPattern",
    "bindingPrinciple",
    "rulePattern",
    "recompositionPolicy",
    "implementationBundle",
    "sourceVariant",
    "sourceSample",
  ].includes(node.type);
}

function supportValue(support: unknown, key: "variantCount" | "sampleCount") {
  return support && typeof support === "object" ? (support as Record<string, unknown>)[key] : null;
}

function shortLabel(node: FunctionSlotGraphNode) {
  if (node.type === "governanceRoot") return "Governance";
  if (node.type === "sourceExample") return String(node.label ?? node.id).slice(0, 18);
  if (node.type === "sourceVariant") return sourceVariantLabel(node);
  if (node.type === "sourceSample") return String(node.label ?? node.data.sampleVideoId ?? "SourceSample").slice(0, 18);
  if (node.type === "unmappedVariant") return `unmapped ${node.data.variantKind ?? ""}`.trim();
  if (node.type === "confirmedPlan") return String(node.label ?? "Plan").slice(0, 18);
  if (node.type.startsWith("traced")) return String(node.label ?? node.id).slice(0, 18);
  if (isGovernanceNode(node)) return graphNodeDisplayLabel(node).slice(0, 20);
  if (node.type === "libraryItem") return "SourceSample";
  if (node.type === "slotInstance") return String(node.label ?? node.data.slotId ?? "").slice(0, 20);
  if (node.type === "atomInstance") return String(node.label ?? node.data.atomId ?? "").slice(0, 24);
  if (node.type === "binding") return String(node.data.bindingId ?? node.label);
  if (node.type === "slotConcept") return "SlotConcept";
  return node.label;
}

export function graphNodeDisplayLabel(node: FunctionSlotGraphNode) {
  const fallback = node.type === "sourceSample" ? node.data?.sampleVideoId ?? "SourceSample" : node.id;
  const label = String(node.label ?? fallback);
  if (!isGovernanceNode(node)) return label;
  return cleanGovernanceDisplayLabel(label);
}

function cleanGovernanceDisplayLabel(label: string) {
  const cleaned = label
    .replace(/\s+archetyp(?:e)?\s*$/i, "")
    .replace(/\s+archety\s*$/i, "")
    .replace(/\s+archet\s*$/i, "")
    .replace(/\s+(?:candidate\s+)?pattern\s*$/i, "")
    .replace(/\s+candidate\s*$/i, "")
    .trim();
  return cleaned || label;
}

function sourceVariantLabel(node: FunctionSlotGraphNode) {
  const label = typeof node.data.label === "string" && node.data.label.trim() ? node.data.label.trim() : String(node.label ?? node.id);
  return label.length > 18 ? `${label.slice(0, 18)}...` : label;
}

function shortSourceVariant(value: string) {
  const parts = value.split("::");
  return parts.length >= 2 ? parts.slice(-2).join("::") : value.slice(-18);
}
