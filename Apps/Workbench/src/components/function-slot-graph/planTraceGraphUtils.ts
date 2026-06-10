import type { FunctionSlotGraphNode, FunctionSlotLibraryGraph } from "../../types/library";

export function reconcileSelectedPlans(current: string[], graph: FunctionSlotLibraryGraph | null) {
  const plans = getTracePlans(graph);
  const ids = plans.map((plan) => plan.planId);
  const kept = current.filter((id) => ids.includes(id));
  return kept.length ? kept : ids;
}

export function filterPlanTraceGraph(graph: FunctionSlotLibraryGraph | null, selectedPlanIds: string[]) {
  if (!graph || graph.schemaVersion !== "confirmed_plan_trace_graph.v1") return graph;
  const selected = new Set(selectedPlanIds);
  const nodes = graph.nodes.filter((node) => planTraceNodeMatchesSelectedPlans(node, selected));
  const nodeIds = new Set(nodes.map((node) => node.id));
  return { ...graph, nodes, edges: graph.edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target)) };
}

export function mergePlanTraceSourceSamples(graph: FunctionSlotLibraryGraph | null) {
  if (!graph || graph.schemaVersion !== "confirmed_plan_trace_graph.v1") return graph;
  const canonicalByNodeId = new Map<string, string>();
  const sampleNodesByKey = new Map<string, FunctionSlotGraphNode>();
  const nodes: FunctionSlotGraphNode[] = [];
  for (const node of graph.nodes) {
    if (node.type !== "sourceSample") {
      nodes.push(node);
      continue;
    }
    const key = planTraceSourceSampleKey(node);
    if (!key) {
      nodes.push(node);
      continue;
    }
    const canonicalId = `sourceSample:${sanitizeGraphNodeId(key)}`;
    canonicalByNodeId.set(node.id, canonicalId);
    const existing = sampleNodesByKey.get(key);
    const planIds = collectPlanIds(existing, node);
    if (existing) {
      sampleNodesByKey.set(key, {
        ...existing,
        data: {
          ...existing.data,
          ...node.data,
          sampleVideoId: existing.data.sampleVideoId ?? node.data.sampleVideoId,
          sampleId: existing.data.sampleId ?? node.data.sampleId,
          sourceAlias: existing.data.sourceAlias ?? node.data.sourceAlias,
          planIds,
        },
      });
      continue;
    }
    const canonicalNode = {
      ...node,
      id: canonicalId,
      data: {
        ...node.data,
        planIds,
      },
    };
    sampleNodesByKey.set(key, canonicalNode);
    nodes.push(canonicalNode);
  }
  const mergedNodes = nodes.map((node) => {
    if (node.type !== "sourceSample") return node;
    const key = planTraceSourceSampleKey(node);
    return key ? sampleNodesByKey.get(key) ?? node : node;
  });
  const seenEdges = new Set<string>();
  const edges = graph.edges.flatMap((edge) => {
    const source = canonicalByNodeId.get(edge.source) ?? edge.source;
    const target = canonicalByNodeId.get(edge.target) ?? edge.target;
    if (source === target) return [];
    const edgeKey = `${source}->${target}:${edge.type}:${edge.label ?? ""}`;
    if (seenEdges.has(edgeKey)) return [];
    seenEdges.add(edgeKey);
    return [{ ...edge, id: edgeKey, source, target }];
  });
  return { ...graph, nodes: mergedNodes, edges };
}

export function getTracePlans(graph: FunctionSlotLibraryGraph | null) {
  return (graph?.nodes ?? [])
    .filter((node): node is FunctionSlotGraphNode & { data: { planId: string; color?: string; displayJsonPath?: string | null } } => node.type === "confirmedPlan" && typeof node.data?.planId === "string")
    .map((node) => ({
      planId: node.data.planId,
      color: typeof node.data.color === "string" ? node.data.color : "#6ea8fe",
      displayJsonPath: typeof node.data.displayJsonPath === "string" ? node.data.displayJsonPath : null,
    }));
}

function planTraceNodeMatchesSelectedPlans(node: FunctionSlotGraphNode, selectedPlanIds: Set<string>) {
  if (selectedPlanIds.has(String(node.data?.planId ?? ""))) return true;
  const planIds = Array.isArray(node.data?.planIds) ? node.data.planIds : [];
  return planIds.some((planId) => selectedPlanIds.has(String(planId)));
}

function planTraceSourceSampleKey(node: FunctionSlotGraphNode) {
  return String(node.data?.sampleVideoId ?? node.data?.sampleId ?? node.data?.sourceVideoName ?? node.label ?? "").trim();
}

function sanitizeGraphNodeId(value: string) {
  return value.replace(/[^A-Za-z0-9_.:-]/g, "_");
}

function collectPlanIds(...nodes: Array<FunctionSlotGraphNode | undefined>) {
  const ids = new Set<string>();
  for (const node of nodes) {
    const planId = String(node?.data?.planId ?? "").trim();
    if (planId) ids.add(planId);
    const planIds = Array.isArray(node?.data?.planIds) ? node.data.planIds : [];
    for (const value of planIds) {
      const text = String(value ?? "").trim();
      if (text) ids.add(text);
    }
  }
  return [...ids];
}
