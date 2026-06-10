import type { FunctionSlotGraphEdge, FunctionSlotGraphNode } from "../../types/library";
import { nodeDataTextArray } from "./graphCore";

type FocusIndex = {
  incoming: Map<string, FunctionSlotGraphEdge[]>;
  outgoing: Map<string, FunctionSlotGraphEdge[]>;
};

const focusIndexCache = new WeakMap<FunctionSlotGraphEdge[], FocusIndex>();

export function connectedNodeIds(nodeId: string | null, edges: FunctionSlotGraphEdge[]) {
  const ids = new Set<string>();
  if (!nodeId) return ids;
  ids.add(nodeId);
  const index = focusIndex(edges);
  for (const edge of index.incoming.get(nodeId) ?? []) ids.add(edge.source);
  for (const edge of index.outgoing.get(nodeId) ?? []) ids.add(edge.target);
  return ids;
}

export function directedGraphFocus(nodeId: string | null, edges: FunctionSlotGraphEdge[], maxDepth: number) {
  const nodes = new Set<string>();
  const edgeIds = new Set<string>();
  const reversedEdgeIds = new Set<string>();
  if (!nodeId) return { nodes, edges: edgeIds, reversedEdges: reversedEdgeIds };
  nodes.add(nodeId);
  const index = focusIndex(edges);
  addDirectedFocusWalk(nodeId, index.incoming, "source", maxDepth, nodes, edgeIds, reversedEdgeIds);
  addDirectedFocusWalk(nodeId, index.outgoing, "target", maxDepth, nodes, edgeIds);
  return { nodes, edges: edgeIds, reversedEdges: reversedEdgeIds };
}

export function terminalShortestGraphFocus(nodeId: string | null, graphNodes: FunctionSlotGraphNode[], edges: FunctionSlotGraphEdge[]) {
  const nodes = new Set<string>();
  const edgeIds = new Set<string>();
  const reversedEdgeIds = new Set<string>();
  if (!nodeId) return { nodes, edges: edgeIds, reversedEdges: reversedEdgeIds };
  nodes.add(nodeId);

  const nodeById = new Map(graphNodes.map((node) => [node.id, node]));
  const relatedNodeIds = relatedFocusNodeIds(nodeId, graphNodes, edges);
  addNearestTerminalPaths(nodeId, edges, relatedNodeIds, (targetId) => nodeById.get(targetId)?.type === "governanceRoot", nodes, edgeIds, reversedEdgeIds);
  addAllTerminalPaths(nodeId, edges, relatedNodeIds, (targetId) => {
    const type = nodeById.get(targetId)?.type;
    return type === "sourceSample" || type === "libraryItem";
  }, nodes, edgeIds, reversedEdgeIds);
  return { nodes, edges: edgeIds, reversedEdges: reversedEdgeIds };
}

function addNearestTerminalPaths(
  startId: string,
  edges: FunctionSlotGraphEdge[],
  relatedNodeIds: Set<string>,
  isTerminal: (nodeId: string) => boolean,
  nodes: Set<string>,
  edgeIds: Set<string>,
  reversedEdgeIds: Set<string>,
) {
  if (isTerminal(startId)) return;
  const adjacency = undirectedFocusAdjacency(edges);
  const distances = new Map<string, number>([[startId, 0]]);
  const paths = new Map<string, Array<Array<{ nodeId: string; edgeId: string; reversed: boolean }>>>([[startId, [[]]]]);
  let frontier = [startId];
  let foundDepth: number | null = null;

  for (let depth = 0; frontier.length && (foundDepth === null || depth <= foundDepth); depth += 1) {
    const next = new Set<string>();
    for (const currentId of frontier) {
      const currentPaths = paths.get(currentId) ?? [];
      const currentDepth = distances.get(currentId) ?? 0;
      if (currentId !== startId && isTerminal(currentId)) {
        foundDepth = currentDepth;
        for (const path of currentPaths) addFocusPath(path, nodes, edgeIds, reversedEdgeIds);
        continue;
      }
      if (foundDepth !== null && currentDepth >= foundDepth) continue;
      for (const step of adjacency.get(currentId) ?? []) {
        if (!relatedNodeIds.has(step.nodeId)) continue;
        const nextDepth = currentDepth + 1;
        const previousDistance = distances.get(step.nodeId);
        if (previousDistance !== undefined && previousDistance < nextDepth) continue;
        const nextPaths = currentPaths.map((path) => [...path, step]);
        if (previousDistance === nextDepth) {
          paths.set(step.nodeId, [...(paths.get(step.nodeId) ?? []), ...nextPaths]);
        } else {
          distances.set(step.nodeId, nextDepth);
          paths.set(step.nodeId, nextPaths);
        }
        next.add(step.nodeId);
      }
    }
    frontier = [...next];
  }
}

function addAllTerminalPaths(
  startId: string,
  edges: FunctionSlotGraphEdge[],
  relatedNodeIds: Set<string>,
  isTerminal: (nodeId: string) => boolean,
  nodes: Set<string>,
  edgeIds: Set<string>,
  reversedEdgeIds: Set<string>,
) {
  if (isTerminal(startId)) return;
  const adjacency = undirectedFocusAdjacency(edges);
  const distances = new Map<string, number>([[startId, 0]]);
  const paths = new Map<string, Array<Array<{ nodeId: string; edgeId: string; reversed: boolean }>>>([[startId, [[]]]]);
  let frontier = [startId];

  while (frontier.length) {
    const next = new Set<string>();
    for (const currentId of frontier) {
      const currentPaths = paths.get(currentId) ?? [];
      const currentDepth = distances.get(currentId) ?? 0;
      if (currentId !== startId && isTerminal(currentId)) {
        for (const path of currentPaths) addFocusPath(path, nodes, edgeIds, reversedEdgeIds);
        continue;
      }
      for (const step of adjacency.get(currentId) ?? []) {
        if (!relatedNodeIds.has(step.nodeId)) continue;
        const nextDepth = currentDepth + 1;
        const previousDistance = distances.get(step.nodeId);
        if (previousDistance !== undefined && previousDistance < nextDepth) continue;
        const nextPaths = currentPaths.map((path) => [...path, step]);
        if (previousDistance === nextDepth) {
          paths.set(step.nodeId, [...(paths.get(step.nodeId) ?? []), ...nextPaths]);
        } else {
          distances.set(step.nodeId, nextDepth);
          paths.set(step.nodeId, nextPaths);
        }
        next.add(step.nodeId);
      }
    }
    frontier = [...next];
  }
}

function undirectedFocusAdjacency(edges: FunctionSlotGraphEdge[]) {
  const adjacency = new Map<string, Array<{ nodeId: string; edgeId: string; reversed: boolean }>>();
  for (const edge of edges) {
    if (edge.type === "source_sample_slot_variant_to_subtype") continue;
    adjacency.set(edge.source, [...(adjacency.get(edge.source) ?? []), { nodeId: edge.target, edgeId: edge.id, reversed: false }]);
    adjacency.set(edge.target, [...(adjacency.get(edge.target) ?? []), { nodeId: edge.source, edgeId: edge.id, reversed: true }]);
  }
  return adjacency;
}

function relatedFocusNodeIds(startId: string, graphNodes: FunctionSlotGraphNode[], edges: FunctionSlotGraphEdge[]) {
  const nodeById = new Map(graphNodes.map((node) => [node.id, node]));
  const startNode = nodeById.get(startId) ?? null;
  const allowSlotEvidenceExpansion = startNode?.type === "atomArchetype" || startNode?.type === "atomPattern" || startNode?.type === "sourceVariant";
  const ids = new Set<string>([startId]);
  const descendantSlotIds = focusDescendantSlotNodeIds(startId, edges, nodeById);
  for (const id of descendantSlotIds) ids.add(id);
  const descendantAtomPatternIds = focusDescendantAtomPatternNodeIds(startId, edges, nodeById);
  for (const id of descendantAtomPatternIds) ids.add(id);
  const evidenceOwnerIds = new Set([startId, ...descendantSlotIds, ...descendantAtomPatternIds]);
  const evidenceVariantIds = new Set<string>();
  for (const id of evidenceOwnerIds) {
    for (const variantId of focusEvidenceVariantIds(nodeById.get(id) ?? null)) evidenceVariantIds.add(variantId);
  }
  const evidenceSampleIds = new Set([...evidenceVariantIds].map(sampleIdFromEvidenceVariantId).filter((sampleId): sampleId is string => Boolean(sampleId)));
  const explicitPatternIds = new Set(
    edges
      .filter((edge) => edge.type === "subtype_to_atom_pattern" && evidenceOwnerIds.has(edge.source))
      .map((edge) => edge.target),
  );

  let changed = true;
  while (changed) {
    changed = false;
    for (const node of graphNodes) {
      if (ids.has(node.id)) continue;
      if (isFocusRelatedNode(node, evidenceVariantIds, evidenceSampleIds, explicitPatternIds, ids, allowSlotEvidenceExpansion)) {
        ids.add(node.id);
        changed = true;
      }
    }
    for (const edge of edges) {
      if (edge.type === "source_sample_slot_variant_to_subtype") continue;
      if (ids.has(edge.target) && !ids.has(edge.source) && isGovernanceHierarchyEdge(edge, nodeById)) {
        ids.add(edge.source);
        changed = true;
      }
      if (ids.has(edge.source) && !ids.has(edge.target) && edge.type === "subtype_to_atom_archetype") {
        ids.add(edge.target);
        changed = true;
      }
      if (ids.has(edge.target) && !ids.has(edge.source) && edge.type === "atom_archetype_to_pattern") {
        ids.add(edge.source);
        changed = true;
      }
    }
  }

  for (const node of graphNodes) {
    if (node.type === "governanceRoot") ids.add(node.id);
  }
  return ids;
}

function focusDescendantSlotNodeIds(startId: string, edges: FunctionSlotGraphEdge[], nodeById: Map<string, FunctionSlotGraphNode>) {
  const ids = new Set<string>();
  const queue = [startId];
  while (queue.length) {
    const currentId = queue.shift();
    if (!currentId) continue;
    for (const edge of edges) {
      if (edge.source !== currentId) continue;
      if (!isSlotDescendantEdge(edge, nodeById)) continue;
      if (ids.has(edge.target)) continue;
      ids.add(edge.target);
      queue.push(edge.target);
    }
  }
  return ids;
}

function isSlotDescendantEdge(edge: FunctionSlotGraphEdge, nodeById: Map<string, FunctionSlotGraphNode>) {
  const sourceType = nodeById.get(edge.source)?.type;
  const targetType = nodeById.get(edge.target)?.type;
  return Boolean(
    (sourceType === "slotFamily" && (targetType === "slotArchetype" || targetType === "slotSubtype"))
    || (sourceType === "slotArchetype" && targetType === "slotSubtype"),
  );
}

function focusDescendantAtomPatternNodeIds(startId: string, edges: FunctionSlotGraphEdge[], nodeById: Map<string, FunctionSlotGraphNode>) {
  const ids = new Set<string>();
  const queue = [startId];
  while (queue.length) {
    const currentId = queue.shift();
    if (!currentId) continue;
    for (const edge of edges) {
      if (edge.source !== currentId) continue;
      if (!isAtomPatternDescendantEdge(edge, nodeById)) continue;
      if (ids.has(edge.target)) continue;
      ids.add(edge.target);
      queue.push(edge.target);
    }
  }
  return ids;
}

function isAtomPatternDescendantEdge(edge: FunctionSlotGraphEdge, nodeById: Map<string, FunctionSlotGraphNode>) {
  const sourceType = nodeById.get(edge.source)?.type;
  const targetType = nodeById.get(edge.target)?.type;
  return sourceType === "atomArchetype" && targetType === "atomPattern";
}

function focusEvidenceVariantIds(node: FunctionSlotGraphNode | null) {
  if (!node) return new Set<string>();
  return new Set([
    ...nodeDataTextArray(node, "sourceAtomVariantIds"),
    ...nodeDataTextArray(node, "sourceVariantIds"),
    textDataValue(node, "variantId"),
  ].filter((value): value is string => Boolean(value)));
}

function isFocusRelatedNode(
  node: FunctionSlotGraphNode,
  evidenceVariantIds: Set<string>,
  evidenceSampleIds: Set<string>,
  explicitPatternIds: Set<string>,
  currentIds: Set<string>,
  allowSlotEvidenceExpansion: boolean,
) {
  if (node.type === "governanceRoot") return true;
  if (node.type === "atomPattern") {
    return explicitPatternIds.has(node.id) || nodeDataTextArray(node, "sourceVariantIds").some((variantId) => evidenceVariantIds.has(variantId));
  }
  if (node.type === "sourceVariant") {
    const variantId = textDataValue(node, "variantId") ?? sourceVariantIdFromNodeId(node.id);
    return Boolean(variantId && evidenceVariantIds.has(variantId));
  }
  if (node.type === "sourceSample" || node.type === "libraryItem") {
    const sampleId = textDataValue(node, "sampleVideoId") ?? textDataValue(node, "sampleId") ?? sampleIdFromSourceSampleNodeId(node.id);
    return Boolean(sampleId && evidenceSampleIds.has(sampleId));
  }
  if (node.type === "slotSubtype") {
    return currentIds.has(node.id) || (
      allowSlotEvidenceExpansion
      && nodeDataTextArray(node, "sourceAtomVariantIds").some((variantId) => evidenceVariantIds.has(variantId))
    );
  }
  if (node.type === "slotFamily" || node.type === "slotArchetype" || node.type === "atomArchetype") {
    return currentIds.has(node.id);
  }
  return false;
}

function isGovernanceHierarchyEdge(edge: FunctionSlotGraphEdge, nodeById: Map<string, FunctionSlotGraphNode>) {
  const sourceType = nodeById.get(edge.source)?.type;
  const targetType = nodeById.get(edge.target)?.type;
  return Boolean(sourceType && targetType && (
    (sourceType === "governanceRoot" && (targetType === "slotFamily" || targetType === "slotSubtype" || targetType === "atomArchetype" || targetType === "atomPattern"))
    || (sourceType === "slotFamily" && targetType === "slotArchetype")
    || (sourceType === "slotFamily" && targetType === "slotSubtype")
    || (sourceType === "slotArchetype" && targetType === "slotSubtype")
    || (sourceType === "atomArchetype" && targetType === "atomPattern")
  ));
}

function textDataValue(node: FunctionSlotGraphNode, key: string) {
  const value = node.data?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function sourceVariantIdFromNodeId(nodeId: string) {
  return nodeId.startsWith("sourceVariant:") ? nodeId.slice("sourceVariant:".length) : null;
}

function sampleIdFromSourceSampleNodeId(nodeId: string) {
  return nodeId.startsWith("sourceSample:") ? nodeId.slice("sourceSample:".length) : null;
}

function sampleIdFromEvidenceVariantId(variantId: string) {
  const parts = variantId.split("::");
  return parts.length >= 2 ? parts[0] : null;
}

function addFocusPath(
  path: Array<{ nodeId: string; edgeId: string; reversed: boolean }>,
  nodes: Set<string>,
  edgeIds: Set<string>,
  reversedEdgeIds: Set<string>,
) {
  for (const step of path) {
    nodes.add(step.nodeId);
    edgeIds.add(step.edgeId);
    if (step.reversed) reversedEdgeIds.add(step.edgeId);
  }
}

function addDirectedFocusWalk(
  nodeId: string,
  edgesByNode: Map<string, FunctionSlotGraphEdge[]>,
  nextKey: "source" | "target",
  maxDepth: number,
  nodes: Set<string>,
  edgeIds: Set<string>,
  reversedEdgeIds?: Set<string>,
) {
  let frontier = new Set<string>([nodeId]);
  const visited = new Set<string>([nodeId]);
  for (let depth = 0; frontier.size && depth < maxDepth; depth += 1) {
    const next = new Set<string>();
    for (const currentId of frontier) {
      for (const edge of edgesByNode.get(currentId) ?? []) {
        edgeIds.add(edge.id);
        reversedEdgeIds?.add(edge.id);
        const connectedId = edge[nextKey];
        nodes.add(connectedId);
        if (visited.has(connectedId)) continue;
        visited.add(connectedId);
        next.add(connectedId);
      }
    }
    frontier = next;
  }
}

export function reverseTracePath(nodeId: string | null, edges: FunctionSlotGraphEdge[]) {
  const nodes = new Set<string>();
  const edgeIds = new Set<string>();
  const reversedEdgeIds = new Set<string>();
  if (!nodeId) return { nodes, edges: edgeIds, reversedEdges: reversedEdgeIds };
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
  return { nodes, edges: edgeIds, reversedEdges: reversedEdgeIds };
}

function focusIndex(edges: FunctionSlotGraphEdge[]) {
  const cached = focusIndexCache.get(edges);
  if (cached) return cached;
  const incoming = new Map<string, FunctionSlotGraphEdge[]>();
  const outgoing = new Map<string, FunctionSlotGraphEdge[]>();
  for (const edge of edges) {
    incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge]);
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge]);
  }
  const index = { incoming, outgoing };
  focusIndexCache.set(edges, index);
  return index;
}
