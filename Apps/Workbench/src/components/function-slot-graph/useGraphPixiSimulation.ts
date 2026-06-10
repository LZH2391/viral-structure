import { useEffect } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { Simulation } from "d3-force";
import { constrainNodeToLayoutSector, createGraphSimulation } from "./graphUtils";
import { fitGraphViewport, type GraphMode, type ViewportTransform } from "./graphPixiCanvasUtils";
import type { D3Link, SimNode, VisibleGraph } from "./types";

type Ref<T> = MutableRefObject<T>;

export function useGraphPixiSimulation({
  active,
  fixedLayout,
  paused,
  mode,
  resetToken,
  visible,
  canvasSizeRef,
  forceFrameRef,
  nodesRef,
  simulationRef,
  pausedRef,
  pendingViewportFitRef,
  viewportRef,
  zoomStartViewportRef,
  zoomTargetViewportRef,
  restartSimulationRef,
  syncGraphLayoutRef,
  syncGraphObjectsRef,
  setViewport,
  markHitGridDirty,
  schedulePreviewTick,
  visibleCanvasBounds,
}: {
  active: boolean;
  fixedLayout: boolean;
  paused: boolean;
  mode: GraphMode;
  resetToken: number;
  visible: VisibleGraph;
  canvasSizeRef: Ref<{ width: number; height: number }>;
  forceFrameRef: Ref<number | null>;
  nodesRef: Ref<SimNode[]>;
  simulationRef: Ref<Simulation<SimNode, D3Link> | null>;
  pausedRef: Ref<boolean>;
  pendingViewportFitRef: Ref<boolean>;
  viewportRef: Ref<ViewportTransform>;
  zoomStartViewportRef: Ref<ViewportTransform>;
  zoomTargetViewportRef: Ref<ViewportTransform>;
  restartSimulationRef: Ref<(alpha?: number) => void>;
  syncGraphLayoutRef: Ref<() => void>;
  syncGraphObjectsRef: Ref<() => void>;
  setViewport: Dispatch<SetStateAction<ViewportTransform>>;
  markHitGridDirty: () => void;
  schedulePreviewTick: () => void;
  visibleCanvasBounds: () => { left: number; top: number; right: number; bottom: number } | undefined;
}) {
  useEffect(() => {
    const previous = new Map(nodesRef.current.map((node) => [node.id, node]));
    const nextNodes: SimNode[] = visible.nodes.map((node) => {
      const existing = resetToken || fixedLayout ? null : previous.get(node.id);
      const pinnedRoot = node.type === "confirmedPlan" || node.type === "governanceRoot";
      return {
        ...node,
        x: existing?.x ?? node.x,
        y: existing?.y ?? node.y,
        layoutX: node.layoutX ?? node.x,
        layoutY: node.layoutY ?? node.y,
        layoutAngleMin: node.layoutAngleMin,
        layoutAngleMax: node.layoutAngleMax,
        layoutRadiusMin: node.layoutRadiusMin,
        layoutRadiusMax: node.layoutRadiusMax,
        layoutYScale: node.layoutYScale,
        layoutLevel: node.layoutLevel,
        vx: existing?.vx ?? 0,
        vy: existing?.vy ?? 0,
        fx: fixedLayout || pinnedRoot ? node.x : null,
        fy: fixedLayout || pinnedRoot ? node.y : null,
      };
    });
    const nextLinks: D3Link[] = visible.edges.map((edge) => ({ ...edge, source: edge.source, target: edge.target }));
    nodesRef.current = nextNodes;
    if (pendingViewportFitRef.current) {
      pendingViewportFitRef.current = false;
      const nextViewport = fitGraphViewport(nextNodes, canvasSizeRef.current, mode, visibleCanvasBounds());
      viewportRef.current = nextViewport;
      setViewport(nextViewport);
      zoomStartViewportRef.current = nextViewport;
      zoomTargetViewportRef.current = nextViewport;
    }
    markHitGridDirty();
    simulationRef.current?.stop();
    if (forceFrameRef.current) window.cancelAnimationFrame(forceFrameRef.current);
    forceFrameRef.current = null;
    simulationRef.current = createGraphSimulation(nextNodes, nextLinks)
      .alphaDecay(0.007)
      .velocityDecay(0.24)
      .stop();
    const simulation = simulationRef.current;
    const stepSimulation = () => {
      forceFrameRef.current = null;
      if (simulationRef.current !== simulation || fixedLayout || pausedRef.current) return;
      simulation.tick();
      nextNodes.forEach(constrainNodeToLayoutSector);
      nodesRef.current = nextNodes;
      markHitGridDirty();
      syncGraphLayoutRef.current();
      schedulePreviewTick();
      if (simulation.alpha() > simulation.alphaMin()) {
        forceFrameRef.current = window.requestAnimationFrame(stepSimulation);
      }
    };
    const restartSimulation = (alpha = 0.65) => {
      if (fixedLayout || pausedRef.current) return;
      simulation.alpha(Math.max(simulation.alpha(), alpha)).alphaTarget(0);
      if (!forceFrameRef.current) forceFrameRef.current = window.requestAnimationFrame(stepSimulation);
    };
    restartSimulationRef.current = restartSimulation;
    if (fixedLayout) simulation.stop();
    else restartSimulation(1);
    syncGraphObjectsRef.current();
    return () => {
      if (forceFrameRef.current) window.cancelAnimationFrame(forceFrameRef.current);
      forceFrameRef.current = null;
      simulation.stop();
      simulationRef.current = null;
      restartSimulationRef.current = () => undefined;
    };
  }, [fixedLayout, resetToken, visible.edges, visible.nodes]);

  useEffect(() => {
    pausedRef.current = !active || paused;
    if (!active || fixedLayout || paused) {
      if (forceFrameRef.current) window.cancelAnimationFrame(forceFrameRef.current);
      forceFrameRef.current = null;
      return;
    }
    restartSimulationRef.current(0.55);
  }, [active, fixedLayout, paused]);
}
