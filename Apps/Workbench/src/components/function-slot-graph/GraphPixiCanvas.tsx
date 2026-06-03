import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Simulation } from "d3-force";
import { Application, Container, Graphics } from "pixi.js";
import { getSampleArtifact } from "../../api/client";
import type { SampleArtifact } from "../../types/artifact";
import type { FunctionSlotLibraryGraph } from "../../types/library";
import { shortId } from "../../utils/format";
import {
  clamp,
  clampPreviewPosition,
  connectedNodeIds,
  constrainNodeToLayoutSector,
  createGraphSimulation,
  nodeRadius,
  previewPopoverSize,
  reverseTracePath,
  VIEWBOX,
} from "./graphUtils";
import {
  GraphCanvas,
  GraphLegend,
  governanceSummaryText,
  LibraryPreviewPopover,
  planTraceSummaryText,
} from "./GraphCanvas";
import {
  createPixiGraphObjects,
  destroyPixiGraphObjects,
  drawPixiBackground,
  pixiScreenPoint,
  syncPixiEdges,
  syncPixiFocus,
  syncPixiLayout,
  syncPixiNodes,
  type PixiGraphObjects,
  type PixiGraphRenderState,
} from "./graphPixiRenderer";
import type { D3Link, DragState, GovernanceLayoutMode, SimNode, VisibleGraph } from "./types";

type GraphMode = "structure" | "governance" | "planTrace";

type PixiLayers = {
  root: Container;
  background: Graphics;
  world: Container;
  edges: Container;
  nodes: Container;
  labels: Container;
};

type ViewportTransform = { x: number; y: number; k: number };
type HitGridEntry = { node: SimNode; index: number };
type HitGridIndex = { cellSize: number; cells: Map<string, HitGridEntry[]> };

const ZOOM_ANIMATION_MS = 220;
const HIT_GRID_CELL_SIZE = 96;

export function GraphPixiCanvas(props: {
  mode?: GraphMode;
  graph: FunctionSlotLibraryGraph;
  visible: VisibleGraph;
  layoutMode?: GovernanceLayoutMode;
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
}) {
  const [fallbackReason, setFallbackReason] = useState<string | null>(null);
  if (fallbackReason) return <GraphCanvas {...props} />;
  return <GraphPixiCanvasInner {...props} onPixiUnavailable={setFallbackReason} />;
}

function GraphPixiCanvasInner({
  mode = "structure",
  graph,
  visible,
  layoutMode = "force",
  selectedNodeId,
  onSelectNode,
  onPixiUnavailable,
}: {
  mode?: GraphMode;
  graph: FunctionSlotLibraryGraph;
  visible: VisibleGraph;
  layoutMode?: GovernanceLayoutMode;
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
  onPixiUnavailable: (reason: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<Application | null>(null);
  const layersRef = useRef<PixiLayers | null>(null);
  const graphObjectsRef = useRef<PixiGraphObjects>(createPixiGraphObjects());
  const nodesRef = useRef<SimNode[]>([]);
  const dragRef = useRef<DragState | null>(null);
  const forcePanRef = useRef(false);
  const lastPointerEventAtRef = useRef(0);
  const simulationRef = useRef<Simulation<SimNode, D3Link> | null>(null);
  const visibleEdgesRef = useRef(visible.edges);
  const sampleCacheRef = useRef<Map<string, SampleArtifact | null>>(new Map());
  const hoverOutTimerRef = useRef<number | null>(null);
  const hoverSuppressUntilRef = useRef(0);
  const viewportRef = useRef({ x: 0, y: 0, k: 1 });
  const canvasSizeRef = useRef({ width: VIEWBOX.width, height: VIEWBOX.height });
  const hostRectRef = useRef<DOMRectReadOnly | null>(null);
  const hitGridRef = useRef<HitGridIndex | null>(null);
  const hitGridDirtyRef = useRef(true);
  const drawFrameRef = useRef<number | null>(null);
  const forceFrameRef = useRef<number | null>(null);
  const viewportStateFrameRef = useRef<number | null>(null);
  const zoomAnimationFrameRef = useRef<number | null>(null);
  const zoomAnimationStartedAtRef = useRef(0);
  const zoomStartViewportRef = useRef<ViewportTransform>(viewportRef.current);
  const zoomTargetViewportRef = useRef<ViewportTransform>(viewportRef.current);
  const syncGraphObjectsRef = useRef<() => void>(() => undefined);
  const syncGraphLayoutRef = useRef<() => void>(() => undefined);
  const syncGraphFocusRef = useRef<(previous: PixiGraphRenderState, next: PixiGraphRenderState) => boolean>(() => false);
  const applyViewportTransformRef = useRef<() => void>(() => undefined);
  const renderViewportRef = useRef<() => void>(() => undefined);
  const restartSimulationRef = useRef<(alpha?: number) => void>(() => undefined);
  const startPointerRef = useRef<(event: globalThis.PointerEvent | MouseEvent) => void>(() => undefined);
  const movePointerRef = useRef<(event: globalThis.PointerEvent | MouseEvent) => void>(() => undefined);
  const endPointerRef = useRef<(event: globalThis.PointerEvent | MouseEvent) => void>(() => undefined);
  const hideHoverSoonRef = useRef<() => void>(() => undefined);
  const previewTickFrameRef = useRef<number | null>(null);
  const pausedRef = useRef(false);
  const renderFpsWindowRef = useRef({ startedAt: performance.now(), frames: 0 });
  const stateRef = useRef<PixiGraphRenderState>({
    mode,
    selectedNodeId,
    hoveredNodeId: null as string | null,
    pinnedPreviewNodeId: null as string | null,
    focusedIds: new Set<string>(),
    focusedEdgeIds: new Set<string>(),
    hasFocusNode: false,
    fixedLayout: layoutMode === "columns",
  });
  const [viewport, setViewport] = useState(viewportRef.current);
  const [canvasSize, setCanvasSize] = useState({ width: VIEWBOX.width, height: VIEWBOX.height });
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [pinnedPreviewNodeId, setPinnedPreviewNodeId] = useState<string | null>(null);
  const [sampleArtifacts, setSampleArtifacts] = useState<Record<string, SampleArtifact | null>>({});
  const [paused, setPaused] = useState(false);
  const [resetToken, setResetToken] = useState(0);
  const [previewTick, setPreviewTick] = useState(0);
  const [renderFps, setRenderFps] = useState(0);
  const fixedLayout = layoutMode === "columns";
  const focusNodeId = hoveredNodeId ?? selectedNodeId;
  const focusedPath = useMemo(
    () => mode === "planTrace"
      ? reverseTracePath(focusNodeId, visible.edges)
      : { nodes: connectedNodeIds(focusNodeId, visible.edges), edges: new Set<string>() },
    [focusNodeId, mode, visible.edges],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space") return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, button")) return;
      forcePanRef.current = true;
      event.preventDefault();
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") forcePanRef.current = false;
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  useEffect(() => {
    const previousState = stateRef.current;
    const edgesChanged = visibleEdgesRef.current !== visible.edges;
    visibleEdgesRef.current = visible.edges;
    const nextState = {
      mode,
      selectedNodeId,
      hoveredNodeId,
      pinnedPreviewNodeId,
      focusedIds: focusedPath.nodes,
      focusedEdgeIds: focusedPath.edges,
      hasFocusNode: Boolean(focusNodeId),
      fixedLayout,
    };
    stateRef.current = nextState;
    if (!edgesChanged && previousState.fixedLayout === nextState.fixedLayout && syncGraphFocusRef.current(previousState, nextState)) return;
    scheduleDraw();
  }, [fixedLayout, focusNodeId, focusedPath.edges, focusedPath.nodes, hoveredNodeId, mode, pinnedPreviewNodeId, selectedNodeId, visible.edges]);

  useEffect(() => {
    let disposed = false;
    let initialized = false;
    const host = hostRef.current;
    if (!host) return undefined;
    const app = new Application();
    appRef.current = app;
    const root = new Container();
    const background = new Graphics();
    const world = new Container();
    const edges = new Container();
    const nodes = new Container();
    const labels = new Container();
    root.addChild(background);
    world.addChild(edges);
    world.addChild(nodes);
    world.addChild(labels);
    root.addChild(world);
    layersRef.current = { root, background, world, edges, nodes, labels };

    app.init({
      antialias: true,
      autoStart: false,
      autoDensity: true,
      backgroundAlpha: 0,
      preference: "webgl",
      resizeTo: host,
      resolution: mode === "governance" ? 1 : Math.min(window.devicePixelRatio || 1, 2),
    }).then(() => {
      initialized = true;
      if (disposed) {
        app.destroy(true);
        return;
      }
      host.appendChild(app.canvas);
      app.stage.addChild(root);
      updateCanvasSize();
      drawPixiBackground(background);
      syncGraphObjectsRef.current();
    }).catch((error) => {
      onPixiUnavailable(error instanceof Error ? error.message : "Pixi 初始化失败");
    });

    const resizeObserver = new ResizeObserver(() => {
      updateCanvasSize();
      drawPixiBackground(background);
      scheduleDraw();
    });
    resizeObserver.observe(host);

    return () => {
      disposed = true;
      resizeObserver.disconnect();
      simulationRef.current?.stop();
      simulationRef.current = null;
      if (forceFrameRef.current) window.cancelAnimationFrame(forceFrameRef.current);
      if (drawFrameRef.current) window.cancelAnimationFrame(drawFrameRef.current);
      if (viewportStateFrameRef.current) window.cancelAnimationFrame(viewportStateFrameRef.current);
      if (zoomAnimationFrameRef.current) window.cancelAnimationFrame(zoomAnimationFrameRef.current);
      if (previewTickFrameRef.current) window.cancelAnimationFrame(previewTickFrameRef.current);
      if (hoverOutTimerRef.current) window.clearTimeout(hoverOutTimerRef.current);
      destroyPixiGraphObjects(graphObjectsRef.current);
      if (initialized) app.destroy(true);
      appRef.current = null;
      layersRef.current = null;
    };
  }, [onPixiUnavailable]);

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
        vx: existing?.vx ?? 0,
        vy: existing?.vy ?? 0,
        fx: fixedLayout || pinnedRoot ? node.x : null,
        fy: fixedLayout || pinnedRoot ? node.y : null,
      };
    });
    const nextLinks: D3Link[] = visible.edges.map((edge) => ({ ...edge, source: edge.source, target: edge.target }));
    nodesRef.current = nextNodes;
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
    pausedRef.current = paused;
    if (fixedLayout || paused) {
      if (forceFrameRef.current) window.cancelAnimationFrame(forceFrameRef.current);
      forceFrameRef.current = null;
      return;
    }
    restartSimulationRef.current(0.55);
  }, [fixedLayout, paused]);

  useEffect(() => {
    scheduleDraw();
  }, [canvasSize]);

  const previewNodeId = pinnedPreviewNodeId ?? hoveredNodeId;
  const previewNode = previewNodeId ? nodesRef.current.find((entry) => entry.id === previewNodeId) ?? null : null;
  const previewSampleId = typeof previewNode?.data.sampleVideoId === "string" ? previewNode.data.sampleVideoId : null;
  const previewSampleArtifact = previewSampleId ? sampleArtifacts[previewSampleId] ?? sampleCacheRef.current.get(previewSampleId) ?? null : null;
  const previewSize = previewPopoverSize(previewSampleArtifact);
  const previewPosition = previewNode && (previewNode.type === "libraryItem" || previewNode.type === "sourceSample")
    ? clampPreviewPosition(pixiScreenPoint(previewNode, viewport, canvasSize), canvasSize, previewSize)
    : null;
  void previewTick;

  useEffect(() => {
    if (!previewSampleId || sampleCacheRef.current.has(previewSampleId)) return;
    sampleCacheRef.current.set(previewSampleId, null);
    getSampleArtifact(previewSampleId)
      .then((artifact) => {
        sampleCacheRef.current.set(previewSampleId, artifact);
        setSampleArtifacts((current) => ({ ...current, [previewSampleId]: artifact }));
      })
      .catch(() => {
        sampleCacheRef.current.set(previewSampleId, null);
        setSampleArtifacts((current) => ({ ...current, [previewSampleId]: null }));
      });
  }, [previewSampleId]);

  const updateCanvasSize = () => {
    const rect = hostRef.current?.getBoundingClientRect();
    if (!rect) return;
    hostRectRef.current = rect;
    const nextSize = { width: rect.width || VIEWBOX.width, height: rect.height || VIEWBOX.height };
    if (canvasSizeRef.current.width === nextSize.width && canvasSizeRef.current.height === nextSize.height) return;
    canvasSizeRef.current = nextSize;
    setCanvasSize(nextSize);
  };

  const commitViewportState = () => {
    if (viewportStateFrameRef.current) return;
    viewportStateFrameRef.current = window.requestAnimationFrame(() => {
      viewportStateFrameRef.current = null;
      setViewport(viewportRef.current);
    });
  };

  const schedulePreviewTick = () => {
    if (!stateRef.current.hoveredNodeId && !stateRef.current.pinnedPreviewNodeId) return;
    if (previewTickFrameRef.current) return;
    previewTickFrameRef.current = window.requestAnimationFrame(() => {
      previewTickFrameRef.current = null;
      setPreviewTick((value) => value + 1);
    });
  };

  const scheduleDraw = () => {
    if (drawFrameRef.current) return;
    drawFrameRef.current = window.requestAnimationFrame(() => {
      drawFrameRef.current = null;
      syncGraphObjectsRef.current();
    });
  };

  const syncGraphObjects = () => {
    const layers = layersRef.current;
    if (!layers) return;
    applyViewportTransformRef.current();
    syncPixiEdges(layers.edges, graphObjectsRef.current, visibleEdgesRef.current, nodesRef.current, stateRef.current);
    syncPixiNodes(layers.nodes, layers.labels, graphObjectsRef.current, nodesRef.current, stateRef.current, viewportRef.current.k);
    renderPixi();
  };
  syncGraphObjectsRef.current = syncGraphObjects;

  const syncGraphLayout = () => {
    const rendered = syncPixiLayout(graphObjectsRef.current, visibleEdgesRef.current, nodesRef.current, stateRef.current);
    if (!rendered) {
      syncGraphObjectsRef.current();
      return;
    }
    renderPixi();
  };
  syncGraphLayoutRef.current = syncGraphLayout;

  const syncGraphFocus = (previousState: PixiGraphRenderState, nextState: PixiGraphRenderState) => {
    const rendered = syncPixiFocus(graphObjectsRef.current, visibleEdgesRef.current, nodesRef.current, previousState, nextState, viewportRef.current.k);
    if (!rendered) return false;
    renderPixi();
    return true;
  };
  syncGraphFocusRef.current = syncGraphFocus;

  const applyViewportTransform = () => {
    const layers = layersRef.current;
    if (!layers) return;
    const size = canvasSizeRef.current;
    const scaleX = size.width / VIEWBOX.width;
    const scaleY = size.height / VIEWBOX.height;
    layers.root.scale.set(scaleX, scaleY);
    layers.world.position.set(viewportRef.current.x, viewportRef.current.y);
    layers.world.scale.set(viewportRef.current.k);
  };
  applyViewportTransformRef.current = applyViewportTransform;

  const renderPixi = () => {
    if (!appRef.current?.renderer) return;
    appRef.current.render();
    recordRenderFrame();
  };

  const recordRenderFrame = () => {
    const now = performance.now();
    const windowState = renderFpsWindowRef.current;
    windowState.frames += 1;
    const elapsed = now - windowState.startedAt;
    if (elapsed < 500) return;
    setRenderFps(Math.round((windowState.frames * 1000) / elapsed));
    renderFpsWindowRef.current = { startedAt: now, frames: 0 };
  };

  const renderViewport = () => {
    applyViewportTransformRef.current();
    renderPixi();
  };
  renderViewportRef.current = renderViewport;

  const applyAnimatedViewport = (nextViewport: ViewportTransform) => {
    viewportRef.current = nextViewport;
    commitViewportState();
    renderViewportRef.current();
    scheduleDraw();
    schedulePreviewTick();
  };

  const stopZoomAnimation = () => {
    if (!zoomAnimationFrameRef.current) return;
    window.cancelAnimationFrame(zoomAnimationFrameRef.current);
    zoomAnimationFrameRef.current = null;
  };

  const stepZoomAnimation = (time: number) => {
    const progress = clamp((time - zoomAnimationStartedAtRef.current) / ZOOM_ANIMATION_MS, 0, 1);
    const eased = 1 - ((1 - progress) ** 3);
    const start = zoomStartViewportRef.current;
    const target = zoomTargetViewportRef.current;
    applyAnimatedViewport({
      x: start.x + (target.x - start.x) * eased,
      y: start.y + (target.y - start.y) * eased,
      k: start.k + (target.k - start.k) * eased,
    });
    if (progress < 1) {
      zoomAnimationFrameRef.current = window.requestAnimationFrame(stepZoomAnimation);
      return;
    }
    zoomAnimationFrameRef.current = null;
  };

  const animateViewportTo = (targetViewport: ViewportTransform) => {
    zoomStartViewportRef.current = viewportRef.current;
    zoomTargetViewportRef.current = targetViewport;
    zoomAnimationStartedAtRef.current = performance.now();
    if (!zoomAnimationFrameRef.current) zoomAnimationFrameRef.current = window.requestAnimationFrame(stepZoomAnimation);
  };

  const showHover = (nodeId: string | null) => {
    if (Date.now() < hoverSuppressUntilRef.current) return;
    if (hoverOutTimerRef.current) window.clearTimeout(hoverOutTimerRef.current);
    hoverOutTimerRef.current = null;
    setHoveredNodeId(nodeId);
  };

  const hideHoverSoon = () => {
    if (hoverOutTimerRef.current) window.clearTimeout(hoverOutTimerRef.current);
    hoverOutTimerRef.current = window.setTimeout(() => setHoveredNodeId(null), 150);
  };

  const closePreview = () => {
    if (hoverOutTimerRef.current) window.clearTimeout(hoverOutTimerRef.current);
    hoverOutTimerRef.current = null;
    hoverSuppressUntilRef.current = Date.now() + 240;
    setPinnedPreviewNodeId(null);
    setHoveredNodeId(null);
  };

  const graphPoint = (clientX: number, clientY: number) => {
    const rect = hostRectRef.current ?? hostRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    hostRectRef.current = rect;
    const rawX = ((clientX - rect.left) / Math.max(rect.width, 1)) * VIEWBOX.width;
    const rawY = ((clientY - rect.top) / Math.max(rect.height, 1)) * VIEWBOX.height;
    const view = viewportRef.current;
    return { x: (rawX - view.x) / view.k, y: (rawY - view.y) / view.k };
  };

  const markHitGridDirty = () => {
    hitGridDirtyRef.current = true;
  };

  const hitTestNode = (point: { x: number; y: number }) => {
    if (hitGridDirtyRef.current || !hitGridRef.current) {
      hitGridRef.current = buildHitGrid(nodesRef.current);
      hitGridDirtyRef.current = false;
    }
    return hitGridRef.current ? hitTestHitGrid(hitGridRef.current, point, viewportRef.current.k) : null;
  };

  const startPointer = (event: globalThis.PointerEvent | MouseEvent) => {
    const shouldForcePan = forcePanRef.current || event.shiftKey || event.button === 1 || event.button === 2;
    if (event.button !== 0 && !shouldForcePan) return;
    event.preventDefault();
    stopZoomAnimation();
    const host = hostRef.current;
    const point = graphPoint(event.clientX, event.clientY);
    const hitNode = hitTestNode(point);
    if ("pointerId" in event) host?.setPointerCapture(event.pointerId);
    if (hitNode && !shouldForcePan) {
      dragRef.current = { kind: "node", nodeId: hitNode.id, dx: hitNode.x - point.x, dy: hitNode.y - point.y, moved: false };
      onSelectNode(hitNode.id);
      showHover(hitNode.id);
      return;
    }
    closePreview();
    dragRef.current = {
      kind: "pan",
      clientX: event.clientX,
      clientY: event.clientY,
      startX: viewportRef.current.x,
      startY: viewportRef.current.y,
      moved: false,
    };
  };

  const movePointer = (event: globalThis.PointerEvent | MouseEvent) => {
    const drag = dragRef.current;
    if (!drag) {
      const hitNode = hitTestNode(graphPoint(event.clientX, event.clientY));
      if (hitNode) showHover(hitNode.id);
      else hideHoverSoon();
      return;
    }
    if (drag.kind === "node") {
      const point = graphPoint(event.clientX, event.clientY);
      const draggedNode = nodesRef.current.find((node) => node.id === drag.nodeId);
      if (draggedNode) {
        draggedNode.fx = point.x + drag.dx;
        draggedNode.fy = point.y + drag.dy;
        draggedNode.x = draggedNode.fx;
        draggedNode.y = draggedNode.fy;
        draggedNode.vx = 0;
        draggedNode.vy = 0;
        markHitGridDirty();
      }
      dragRef.current = { ...drag, moved: true };
      if (!fixedLayout) restartSimulationRef.current(0.75);
      scheduleDraw();
      schedulePreviewTick();
      return;
    }
    const rect = hostRectRef.current ?? hostRef.current?.getBoundingClientRect();
    const moved = drag.moved || Math.hypot(event.clientX - drag.clientX, event.clientY - drag.clientY) > 3;
    const scaleX = rect?.width ? VIEWBOX.width / rect.width : 1;
    const scaleY = rect?.height ? VIEWBOX.height / rect.height : 1;
    const nextViewport = {
      ...viewportRef.current,
      x: drag.startX + (event.clientX - drag.clientX) * scaleX,
      y: drag.startY + (event.clientY - drag.clientY) * scaleY,
    };
    dragRef.current = { ...drag, moved };
    viewportRef.current = nextViewport;
    commitViewportState();
    renderViewportRef.current();
    schedulePreviewTick();
  };

  const endPointer = (event: globalThis.PointerEvent | MouseEvent) => {
    const host = hostRef.current;
    if ("pointerId" in event && host?.hasPointerCapture(event.pointerId)) host.releasePointerCapture(event.pointerId);
    const drag = dragRef.current;
    if (drag?.kind === "node" && drag.moved) {
      const draggedNode = nodesRef.current.find((node) => node.id === drag.nodeId);
      if (draggedNode) {
        draggedNode.fx = fixedLayout ? draggedNode.x : null;
        draggedNode.fy = fixedLayout ? draggedNode.y : null;
        draggedNode.vx = 0;
        draggedNode.vy = 0;
      }
      if (!fixedLayout) restartSimulationRef.current(paused ? 0 : 0.55);
      scheduleDraw();
    }
    if (drag?.kind === "node" && !drag.moved) {
      const clickedNode = nodesRef.current.find((node) => node.id === drag.nodeId);
      if (clickedNode?.type === "libraryItem" || clickedNode?.type === "sourceSample") setPinnedPreviewNodeId(clickedNode.id);
    }
    if (drag?.kind === "pan" && !drag.moved) onSelectNode(null);
    dragRef.current = null;
  };

  startPointerRef.current = startPointer;
  movePointerRef.current = movePointer;
  endPointerRef.current = endPointer;
  hideHoverSoonRef.current = hideHoverSoon;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const preventContextMenu = (event: MouseEvent) => event.preventDefault();
    const markPointer = () => {
      lastPointerEventAtRef.current = Date.now();
    };
    const hidePointerHoverSoon = () => {
      hideHoverSoonRef.current();
    };
    const handlePointerDown = (event: globalThis.PointerEvent) => {
      markPointer();
      startPointerRef.current(event);
    };
    const handlePointerMove = (event: globalThis.PointerEvent) => {
      markPointer();
      movePointerRef.current(event);
    };
    const handlePointerEnd = (event: globalThis.PointerEvent) => {
      markPointer();
      endPointerRef.current(event);
    };
    const shouldIgnoreMouse = () => Date.now() - lastPointerEventAtRef.current < 500;
    const handleMouseMove = (event: MouseEvent) => {
      if (!shouldIgnoreMouse()) movePointerRef.current(event);
    };
    const handleMouseUp = (event: MouseEvent) => {
      if (!shouldIgnoreMouse()) endPointerRef.current(event);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
    const handleMouseDown = (event: MouseEvent) => {
      if (shouldIgnoreMouse()) return;
      startPointerRef.current(event);
      if (!dragRef.current) return;
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    };
    host.addEventListener("pointerdown", handlePointerDown);
    host.addEventListener("pointermove", handlePointerMove);
    host.addEventListener("pointerup", handlePointerEnd);
    host.addEventListener("pointercancel", handlePointerEnd);
    host.addEventListener("pointerleave", hidePointerHoverSoon);
    host.addEventListener("mousemove", handleMouseMove);
    host.addEventListener("mousedown", handleMouseDown);
    host.addEventListener("contextmenu", preventContextMenu);
    return () => {
      host.removeEventListener("pointerdown", handlePointerDown);
      host.removeEventListener("pointermove", handlePointerMove);
      host.removeEventListener("pointerup", handlePointerEnd);
      host.removeEventListener("pointercancel", handlePointerEnd);
      host.removeEventListener("pointerleave", hidePointerHoverSoon);
      host.removeEventListener("mousemove", handleMouseMove);
      host.removeEventListener("mousedown", handleMouseDown);
      host.removeEventListener("contextmenu", preventContextMenu);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  const zoom = useCallback((event: globalThis.WheelEvent) => {
    event.preventDefault();
    const rect = hostRectRef.current ?? hostRef.current?.getBoundingClientRect();
    if (!rect) return;
    hostRectRef.current = rect;
    const rawX = ((event.clientX - rect.left) / rect.width) * VIEWBOX.width;
    const rawY = ((event.clientY - rect.top) / rect.height) * VIEWBOX.height;
    const current = zoomAnimationFrameRef.current ? zoomTargetViewportRef.current : viewportRef.current;
    const nextK = clamp(current.k * Math.exp(-event.deltaY * 0.0012), 0.45, 2.8);
    const worldX = (rawX - current.x) / current.k;
    const worldY = (rawY - current.y) / current.k;
    const nextViewport = { k: nextK, x: rawX - worldX * nextK, y: rawY - worldY * nextK };
    animateViewportTo(nextViewport);
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    host.addEventListener("wheel", zoom, { passive: false });
    return () => host.removeEventListener("wheel", zoom);
  }, [zoom]);

  const resetView = () => {
    stopZoomAnimation();
    const nextViewport = { x: 0, y: 0, k: 1 };
    setResetToken((value) => value + 1);
    animateViewportTo(nextViewport);
  };

  return (
    <div className={`slot-graph-canvas pixi ${mode === "planTrace" ? "plan-trace" : mode}`}>
      <div className="slot-graph-canvas-title">
        <strong>{mode === "governance" ? "Semantic Governance" : mode === "planTrace" ? "确定方案溯源" : shortId(graph.artifactId)}</strong>
        <span>{mode === "governance" ? governanceSummaryText(graph) : mode === "planTrace" ? planTraceSummaryText(graph) : `${graph.summary.slotCount} slots / ${graph.summary.atomCount} atoms / ${graph.summary.bindingCount} bindings`}</span>
      </div>
      <div className="slot-graph-controls">
        <span className="slot-graph-fps-chip">FPS {renderFps}</span>
        <button type="button" onClick={resetView}>重置</button>
        <button type="button" onClick={() => setPaused((value) => !value)}>{paused ? "继续" : "暂停"}</button>
      </div>
      <GraphLegend mode={mode} />
      <div className="slot-graph-zoom-chip">{Math.round(viewport.k * 100)}%</div>
      <div
        ref={hostRef}
        className="slot-graph-pixi-stage"
        role="img"
        aria-label="FunctionSlotLibrary 结构图谱"
      />
      {previewNode && previewPosition ? (
        <LibraryPreviewPopover
          node={previewNode}
          sampleArtifact={previewSampleArtifact}
          position={previewPosition}
          size={previewSize}
          pinned={pinnedPreviewNodeId === previewNode.id}
          onMouseEnter={() => showHover(previewNode.id)}
          onMouseLeave={hideHoverSoon}
          onClose={closePreview}
        />
      ) : null}
    </div>
  );
}

function buildHitGrid(nodes: SimNode[]): HitGridIndex {
  const cells = new Map<string, HitGridEntry[]>();
  nodes.forEach((node, index) => {
    const key = hitGridKey(node.x, node.y, HIT_GRID_CELL_SIZE);
    const entries = cells.get(key);
    if (entries) entries.push({ node, index });
    else cells.set(key, [{ node, index }]);
  });
  return { cellSize: HIT_GRID_CELL_SIZE, cells };
}

function hitTestHitGrid(index: HitGridIndex, point: { x: number; y: number }, zoom: number) {
  const hitPad = clamp(10 / zoom, 4, 16);
  const queryRadius = 42 + hitPad;
  const minCellX = Math.floor((point.x - queryRadius) / index.cellSize);
  const maxCellX = Math.floor((point.x + queryRadius) / index.cellSize);
  const minCellY = Math.floor((point.y - queryRadius) / index.cellSize);
  const maxCellY = Math.floor((point.y + queryRadius) / index.cellSize);
  let best: HitGridEntry | null = null;
  for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
    for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
      for (const entry of index.cells.get(`${cellX}:${cellY}`) ?? []) {
        if (best && entry.index < best.index) continue;
        const radius = nodeRadius(entry.node) + hitPad;
        if (Math.hypot(point.x - entry.node.x, point.y - entry.node.y) <= radius) best = entry;
      }
    }
  }
  return best?.node ?? null;
}

function hitGridKey(x: number, y: number, cellSize: number) {
  return `${Math.floor(x / cellSize)}:${Math.floor(y / cellSize)}`;
}
