import type { SimulationLinkDatum, SimulationNodeDatum } from "d3-force";
import type { FunctionSlotGraphEdge, FunctionSlotGraphNode } from "../../types/library";

export type GraphFiltersState = {
  slot: boolean;
  atom: boolean;
  binding: boolean;
  rule: boolean;
  bundle: boolean;
  unmapped: boolean;
  slotFamily: boolean;
  slotArchetype: boolean;
  slotSubtype: boolean;
  atomArchetype: boolean;
  atomPattern: boolean;
  sourceVariant: boolean;
};

export type GovernanceLayoutMode = "columns" | "force";

export type PositionedNode = FunctionSlotGraphNode & {
  x: number;
  y: number;
  layoutX?: number;
  layoutY?: number;
  layoutAngleMin?: number;
  layoutAngleMax?: number;
  layoutRadiusMin?: number;
  layoutRadiusMax?: number;
  layoutYScale?: number;
  layoutLevel?: number;
  shortLabel: string;
};

export type SimNode = PositionedNode & SimulationNodeDatum & {
  x: number;
  y: number;
  vx: number;
  vy: number;
  fx: number | null;
  fy: number | null;
};

export type D3Link = Omit<FunctionSlotGraphEdge, "source" | "target"> &
  SimulationLinkDatum<SimNode> & {
    source: string | SimNode;
    target: string | SimNode;
  };

export type DragState =
  | { kind: "node"; nodeId: string; dx: number; dy: number; moved: boolean }
  | { kind: "pan"; clientX: number; clientY: number; startX: number; startY: number; moved: boolean };

export type VisibleGraph = {
  nodes: PositionedNode[];
  edges: FunctionSlotGraphEdge[];
};
