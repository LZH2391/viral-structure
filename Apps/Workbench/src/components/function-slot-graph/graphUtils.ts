import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from "d3-force";
import type { SampleArtifact } from "../../types/artifact";
import type { FunctionSlotGraphEdge, FunctionSlotGraphNode, FunctionSlotLibraryGraph } from "../../types/library";
import type { D3Link, GraphFiltersState, PositionedNode, SimNode, VisibleGraph } from "./types";

export const VIEWBOX = { width: 1280, height: 820 };
export const CENTER = { x: 600, y: 410 };

export function buildVisibleGraph(graph: FunctionSlotLibraryGraph | null, filters: GraphFiltersState, focusNodeId: string | null = null): VisibleGraph {
  if (!graph) return { nodes: [], edges: [] };
  const positions = graph.schemaVersion === "function_slot_governance_graph.v1" ? buildGovernancePositions(graph) : buildPositions(graph);
  const visibleIds = graph.schemaVersion === "function_slot_governance_graph.v1" ? visibleGovernanceNodeIds(graph, filters, focusNodeId) : null;
  const nodes = graph.nodes
    .filter((node) => {
      if (visibleIds && !visibleIds.has(node.id)) return false;
      if (node.type === "slotInstance") return filters.slot;
      if (node.type === "atomInstance") return filters.atom;
      if (node.type === "binding") return filters.binding;
      if (node.type === "slotConcept") return false;
      if (graph.schemaVersion === "function_slot_governance_graph.v1") return governanceFilterMatch(node, filters);
      return true;
    })
    .map((node) => ({ ...node, ...positions.get(node.id), shortLabel: shortLabel(node) }))
    .filter((node): node is PositionedNode => Number.isFinite(node.x) && Number.isFinite(node.y));
  const nodeIds = new Set(nodes.map((node) => node.id));
  return {
    nodes,
    edges: graph.edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target)),
  };
}

export function createGraphSimulation(nodes: SimNode[], links: D3Link[]) {
  return forceSimulation<SimNode>(nodes)
    .alpha(0.85)
    .alphaDecay(0.018)
    .velocityDecay(0.36)
    .force("center", forceCenter(CENTER.x, CENTER.y).strength(0.055))
    .force("x", forceX(CENTER.x).strength(0.006))
    .force("y", forceY(CENTER.y).strength(0.006))
    .force("charge", forceManyBody<SimNode>().strength((node) => (node.type === "libraryItem" ? -120 : node.type === "slotInstance" ? -170 : -90)).distanceMin(30).distanceMax(620))
    .force("collide", forceCollide<SimNode>().radius((node) => nodeRadius(node) + 30).strength(0.72).iterations(2))
    .force("link", forceLink<SimNode, D3Link>(links)
      .id((node) => node.id)
      .distance((edge) => edgeDistance(edge.type)));
}

export function connectedNodeIds(nodeId: string | null, edges: FunctionSlotGraphEdge[]) {
  const ids = new Set<string>();
  if (!nodeId) return ids;
  ids.add(nodeId);
  for (const edge of edges) {
    if (edge.source === nodeId) ids.add(edge.target);
    if (edge.target === nodeId) ids.add(edge.source);
  }
  return ids;
}

export function nodeRadius(node: Pick<FunctionSlotGraphNode, "type">) {
  if (node.type === "governanceRoot") return 22;
  if (node.type === "slotFamily") return 18;
  if (node.type === "slotArchetype") return 15;
  if (node.type === "slotSubtype") return 12;
  if (node.type === "atomArchetype") return 14;
  if (node.type === "atomPattern") return 10;
  if (node.type === "bindingPrinciple" || node.type === "recompositionPolicy") return 13;
  if (node.type === "bindingPattern" || node.type === "rulePattern" || node.type === "implementationBundle") return 10;
  if (node.type === "unmappedVariant" || node.type === "needReviewItem") return 8;
  if (node.type === "sourceVariant") return 5;
  if (node.type === "libraryItem") return 20;
  if (node.type === "slotInstance") return 13;
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
  if (node.type === "needReviewItem") return [["variantId", data.variantId], ["variantKind", data.variantKind], ["affectedNodes", data.affectedNodes], ["reviewReason", data.reviewReason]];
  if (isGovernanceNode(node)) return [["id", data.id ?? data.governanceId], ["name", node.label], ["reviewStatus", data.reviewStatus], ["maturityStatus", data.maturityStatus], ["variantCount", supportValue(data.support, "variantCount")], ["sampleCount", supportValue(data.support, "sampleCount")], ["sourceVariantIds", data.sourceVariantIds], ["judgementReason", data.judgementReason], ["differenceNotes", data.differenceNotes], ["riskIfMisclassified", data.riskIfMisclassified]];
  if (node.type === "slotInstance") return [["stableId", data.stableId], ["slotType", data.slotType], ["before", data.viewerStateBefore], ["after", data.viewerStateAfter], ["task", data.persuasionTask], ["shots", sourceShots(data.sourceRefs)], ["needReview", data.needReview]];
  if (node.type === "atomInstance") return [["atomId", data.atomId], ["atomType", data.atomType], ["slotId", data.slotId], ["function", data.function], ["claim/pace/proof", data.claimType ?? data.pace ?? data.proofType], ["shots", sourceShots(data.sourceRefs)], ["needReview", data.needReview]];
  if (node.type === "binding") return [["bindingId", data.bindingId], ["type", data.bindingType], ["rule", data.rule], ["risk", data.riskIfBroken], ["confidence", data.confidence]];
  return Object.entries(data).slice(0, 8);
}

export function formatDetailValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "无";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function buildPositions(graph: FunctionSlotLibraryGraph) {
  const positions = new Map<string, { x: number; y: number }>();
  const root = graph.nodes.find((node) => node.type === "libraryItem");
  if (root) positions.set(root.id, CENTER);

  const slots = graph.nodes.filter((node) => node.type === "slotInstance").sort((left, right) => Number(left.data.slotOrder ?? 0) - Number(right.data.slotOrder ?? 0));
  const slotRadius = 210;
  slots.forEach((slot, index) => {
    const angle = -Math.PI / 2 + (index / Math.max(slots.length, 1)) * Math.PI * 2;
    const x = CENTER.x + Math.cos(angle) * slotRadius;
    const y = CENTER.y + Math.sin(angle) * slotRadius;
    positions.set(slot.id, { x, y });
    const atoms = graph.nodes.filter((node) => node.type === "atomInstance" && node.data.slotId === slot.data.slotId);
    atoms.forEach((atom, atomIndex) => {
      const atomAngle = angle + (atomIndex - 1) * 0.34;
      positions.set(atom.id, {
        x: CENTER.x + Math.cos(atomAngle) * 300,
        y: CENTER.y + Math.sin(atomAngle) * 300,
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

function visibleGovernanceNodeIds(graph: FunctionSlotLibraryGraph, filters: GraphFiltersState, focusNodeId: string | null) {
  const ids = new Set<string>();
  const root = graph.nodes.find((node) => node.type === "governanceRoot");
  if (root) ids.add(root.id);

  for (const node of graph.nodes) {
    if (node.type === "slotFamily" || node.type === "slotArchetype" || node.type === "slotSubtype") ids.add(node.id);
    if (filters.needReview && node.type === "needReviewItem") ids.add(node.id);
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
  if (!statusFilterMatch(node, filters)) return false;
  if (node.group === "needReview" || node.type === "needReviewItem") return filters.needReview;
  if (node.type === "unmappedVariant") return filters.unmapped;
  if (node.type === "sourceVariant") return true;
  if (node.type === "governanceRoot") return true;
  if (node.type.startsWith("slot")) return filters.slot;
  if (node.type.startsWith("atom")) return filters.atom;
  if (node.type.startsWith("binding")) return filters.binding;
  if (node.type === "rulePattern" || node.type === "recompositionPolicy") return filters.rule;
  if (node.type === "implementationBundle") return filters.bundle;
  return true;
}

function statusFilterMatch(node: FunctionSlotGraphNode, filters: GraphFiltersState) {
  const status = String(node.data?.reviewStatus ?? node.data?.maturityStatus ?? node.data?.status ?? "");
  if (status === "candidate") return filters.candidate;
  if (status === "reviewed") return filters.reviewed;
  if (status === "stable") return filters.stable;
  if (status === "needReview") return filters.needReview;
  if (status === "unmapped") return filters.unmapped;
  return true;
}

function buildGovernancePositions(graph: FunctionSlotLibraryGraph) {
  const positions = new Map<string, { x: number; y: number }>();
  const root = graph.nodes.find((node) => node.type === "governanceRoot");
  if (root) positions.set(root.id, { x: 150, y: CENTER.y });
  placeColumn(positions, graph.nodes.filter((node) => node.type === "slotFamily"), 310);
  placeColumn(positions, graph.nodes.filter((node) => node.type === "slotArchetype"), 520);
  placeColumn(positions, graph.nodes.filter((node) => node.type === "slotSubtype"), 740);
  placeColumn(positions, graph.nodes.filter((node) => node.type === "atomArchetype" || node.type === "bindingPrinciple" || node.type === "recompositionPolicy"), 920);
  placeColumn(positions, graph.nodes.filter((node) => node.type === "atomPattern" || node.type === "bindingPattern" || node.type === "rulePattern"), 1050);
  placeColumn(positions, graph.nodes.filter((node) => node.type === "implementationBundle"), 1060, 170, 84);
  placeColumn(positions, graph.nodes.filter((node) => node.type === "sourceVariant"), 1180, 90, 34);
  placeColumn(positions, graph.nodes.filter((node) => node.type === "unmappedVariant" || node.type === "needReviewItem"), 1180, 610, 28);
  return positions;
}

function placeColumn(positions: Map<string, { x: number; y: number }>, nodes: FunctionSlotGraphNode[], x: number, centerY = CENTER.y, spacing = 54) {
  const startY = centerY - ((nodes.length - 1) * spacing) / 2;
  nodes.forEach((node, index) => positions.set(node.id, { x, y: clamp(startY + index * spacing, 55, VIEWBOX.height - 55) }));
}

function edgeDistance(type: string) {
  if (type.includes("source_variant")) return 100;
  if (type.includes("bundle")) return 130;
  if (type.includes("pattern")) return 120;
  if (type.includes("archetype")) return 155;
  if (type === "slot_next") return 180;
  if (type === "library_contains_slot") return 250;
  if (type === "library_contains_binding") return 175;
  if (type.startsWith("binding_")) return 145;
  return 165;
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
  ].includes(node.type);
}

function supportValue(support: unknown, key: "variantCount" | "sampleCount") {
  return support && typeof support === "object" ? (support as Record<string, unknown>)[key] : null;
}

function shortLabel(node: FunctionSlotGraphNode) {
  if (node.type === "governanceRoot") return "Governance";
  if (node.type === "sourceVariant") return shortSourceVariant(String(node.data.variantId ?? node.label));
  if (node.type === "unmappedVariant") return `unmapped ${node.data.variantKind ?? ""}`.trim();
  if (node.type === "needReviewItem") return "needReview";
  if (isGovernanceNode(node)) return String(node.label ?? node.id).slice(0, 20);
  if (node.type === "libraryItem") return "LibraryItem";
  if (node.type === "slotInstance") return `${node.data.slotId ?? ""} ${node.label}`.slice(0, 18);
  if (node.type === "atomInstance") return String(node.data.atomId ?? node.label);
  if (node.type === "binding") return String(node.data.bindingId ?? node.label);
  if (node.type === "slotConcept") return "SlotConcept";
  return node.label;
}

function shortSourceVariant(value: string) {
  const parts = value.split("::");
  return parts.length >= 2 ? parts.slice(-2).join("::") : value.slice(-18);
}
