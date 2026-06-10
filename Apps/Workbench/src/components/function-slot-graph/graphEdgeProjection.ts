import type { FunctionSlotGraphEdge, FunctionSlotGraphNode, FunctionSlotLibraryGraph } from "../../types/library";
import { graphId, nodeDataTextArray } from "./graphCore";

type ProjectedEdgesCacheEntry = {
  edgeSignature: string;
  evidenceSignature: string;
  atomArchetypeHidden: boolean;
  visibleSignature: string;
  edges: FunctionSlotGraphEdge[];
};

const projectedEdgesCache = new WeakMap<FunctionSlotLibraryGraph, ProjectedEdgesCacheEntry>();

export function projectVisibleEdges(graph: FunctionSlotLibraryGraph, visibleNodeIds: Set<string>) {
  const edgeSignature = graph.edges.map((edge) => `${edge.id}:${edge.source}>${edge.target}:${edge.type}`).join("|");
  const evidenceSignature = graph.nodes
    .filter((node) => node.type === "slotSubtype" || node.type === "atomPattern")
    .map((node) => `${node.id}:${nodeDataTextArray(node, "sourceAtomVariantIds").join(",")}:${nodeDataTextArray(node, "sourceVariantIds").join(",")}`)
    .join("|");
  const atomArchetypeHidden = graph.nodes.some((node) => node.type === "atomArchetype") && !graph.nodes.some((node) => node.type === "atomArchetype" && visibleNodeIds.has(node.id));
  const visibleSignature = [...visibleNodeIds].sort().join("|");
  const cached = projectedEdgesCache.get(graph);
  if (
    cached?.edgeSignature === edgeSignature
    && cached.evidenceSignature === evidenceSignature
    && cached.atomArchetypeHidden === atomArchetypeHidden
    && cached.visibleSignature === visibleSignature
  ) return cached.edges;

  const incoming = new Map<string, FunctionSlotGraphEdge[]>();
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  for (const edge of graph.edges) {
    incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge]);
  }
  const edges: FunctionSlotGraphEdge[] = [];
  for (const targetId of visibleNodeIds) {
    const ancestors = nearestVisibleAncestors(targetId, incoming, visibleNodeIds, nodeById);
    for (const ancestor of ancestors) {
      if (ancestor.id === targetId) continue;
      if (!shouldProjectHierarchyEdge(nodeById, ancestor.id, targetId, ancestor.hiddenTypes)) continue;
      edges.push({
        id: graphId("edge", "projected", ancestor.id, targetId),
        source: ancestor.id,
        target: targetId,
        type: "projected_hierarchy",
        label: "projected",
      });
    }
  }
  if (atomArchetypeHidden) {
    edges.push(...buildSubtypeAtomPatternEvidenceEdges(graph, visibleNodeIds));
  }
  for (const edge of graph.edges) {
    if (edge.type === "governance_contains_source_sample") continue;
    if (!visibleNodeIds.has(edge.source) || !visibleNodeIds.has(edge.target)) continue;
    if (isSubtypeAtomPatternEdge(edge, nodeById)) continue;
    edges.push(edge);
  }
  const result = dedupeEdges(edges);
  projectedEdgesCache.set(graph, { edgeSignature, evidenceSignature, atomArchetypeHidden, visibleSignature, edges: result });
  return result;
}

function shouldProjectHierarchyEdge(nodeById: Map<string, FunctionSlotGraphNode>, sourceId: string, targetId: string, hiddenTypes: Set<string>) {
  const source = nodeById.get(sourceId);
  const target = nodeById.get(targetId);
  const sourceType = source?.type;
  const targetType = target?.type;
  if (targetType === "atomPattern") return false;
  if (targetType === "sourceVariant") return sourceType === "atomPattern";
  if (targetType === "sourceSample") return sourceType === "sourceVariant" || sourceType === "atomPattern";
  return sourceType === "governanceRoot" || sourceType === "slotFamily" || sourceType === "slotArchetype";
}

function buildSubtypeAtomPatternEvidenceEdges(graph: FunctionSlotLibraryGraph, visibleNodeIds: Set<string>) {
  const subtypes = graph.nodes.filter((node) => node.type === "slotSubtype" && visibleNodeIds.has(node.id));
  const patterns = graph.nodes.filter((node) => node.type === "atomPattern" && visibleNodeIds.has(node.id));
  const edges: FunctionSlotGraphEdge[] = [];
  for (const subtype of subtypes) {
    const subtypeAtomVariantIds = new Set(nodeDataTextArray(subtype, "sourceAtomVariantIds"));
    if (!subtypeAtomVariantIds.size) continue;
    for (const pattern of patterns) {
      if (!nodeDataTextArray(pattern, "sourceVariantIds").some((variantId) => subtypeAtomVariantIds.has(variantId))) continue;
      edges.push({
        id: graphId("edge", "subtype_atom_pattern_evidence", subtype.id, pattern.id),
        source: subtype.id,
        target: pattern.id,
        type: "subtype_to_atom_pattern",
        label: "variant evidence",
      });
    }
  }
  return edges;
}

function isSubtypeAtomPatternEdge(edge: FunctionSlotGraphEdge, nodeById: Map<string, FunctionSlotGraphNode>) {
  return nodeById.get(edge.source)?.type === "slotSubtype" && nodeById.get(edge.target)?.type === "atomPattern";
}

function nearestVisibleAncestors(targetId: string, incoming: Map<string, FunctionSlotGraphEdge[]>, visibleNodeIds: Set<string>, nodeById: Map<string, FunctionSlotGraphNode>) {
  const ancestors = new Map<string, Set<string>>();
  const visitedHidden = new Set<string>([targetId]);
  let frontier = [{ nodeId: targetId, hiddenTypes: new Set<string>() }];
  while (frontier.length) {
    const next: Array<{ nodeId: string; hiddenTypes: Set<string> }> = [];
    for (const { nodeId, hiddenTypes } of frontier) {
      for (const edge of incoming.get(nodeId) ?? []) {
        if (visibleNodeIds.has(edge.source)) {
          if (hiddenTypes.size) ancestors.set(edge.source, hiddenTypes);
          continue;
        }
        if (visitedHidden.has(edge.source)) continue;
        visitedHidden.add(edge.source);
        const nextHiddenTypes = new Set(hiddenTypes);
        const sourceType = nodeById.get(edge.source)?.type;
        if (sourceType) nextHiddenTypes.add(sourceType);
        next.push({ nodeId: edge.source, hiddenTypes: nextHiddenTypes });
      }
    }
    frontier = next;
  }
  return [...ancestors.entries()].map(([id, hiddenTypes]) => ({ id, hiddenTypes }));
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
