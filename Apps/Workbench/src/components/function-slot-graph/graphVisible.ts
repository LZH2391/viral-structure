import type { FunctionSlotLibraryGraph } from "../../types/library";
import type { GovernanceLayoutMode, GraphFiltersState, VisibleGraph } from "./types";
import { centerPosition, type LayoutPosition } from "./graphCore";
import { projectVisibleEdges } from "./graphEdgeProjection";
import { shortLabel } from "./graphLabels";
import { buildGovernancePositions, buildLibraryColumnPositions, buildPlanTraceColumnPositions, buildPlanTracePositions, buildPositions, governanceFilterMatch, planTraceFilterMatch, visibleGovernanceNodeIds } from "./graphLayouts";

export function buildVisibleGraph(graph: FunctionSlotLibraryGraph | null, filters: GraphFiltersState, focusNodeId: string | null = null, governanceLayoutMode: GovernanceLayoutMode = "columns"): VisibleGraph {
  if (!graph) return { nodes: [], edges: [] };
  const projectedGraph = graph;
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
