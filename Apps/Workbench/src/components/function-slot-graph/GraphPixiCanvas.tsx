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
  constrainNodeToLayoutSector,
  createGraphSimulation,
  directedGraphFocus,
  nodeRadius,
  previewPopoverSize,
  reverseTracePath,
  terminalShortestGraphFocus,
  VIEWBOX,
} from "./graphUtils";
import {
  GraphLegend,
  governanceSummaryText,
  LibraryPreviewPopover,
  planTraceSummaryText,
} from "./GraphSharedPanels";
import {
  applyPixiAlphaTween,
  capturePixiAlphaSnapshot,
  createPixiGraphObjects,
  destroyPixiGraphObjects,
  drawPixiBackground,
  pixiScreenPoint,
  syncPixiEdges,
  syncPixiFocus,
  syncPixiLabels,
  syncPixiLayout,
  syncPixiNodes,
  type PixiAlphaSnapshot,
  type PixiGraphObjects,
  type PixiGraphRenderState,
} from "./graphPixiRenderer";
import { GRAPH_VISUAL_THEME, readGraphVisualTheme, type GraphVisualTheme } from "./graphVisualStyles";
import type { D3Link, DragState, GovernanceLayoutMode, SimNode, VisibleGraph } from "./types";

type GraphMode = "structure" | "governance" | "planTrace";

type PixiLayers = {
  root: Container;
  background: Graphics;
  world: Container;
  edges: Container;
  nodeOcclusions: Container;
  nodes: Container;
  labels: Container;
};

type ViewportTransform = { x: number; y: number; k: number };
type ViewportEasing = (progress: number) => number;
type ViewportAnimationOptions = { durationMs?: number; easing?: ViewportEasing };
type StageTransform = { scale: number; offsetX: number; offsetY: number };
type HitGridEntry = { node: SimNode; index: number };
type HitGridIndex = { cellSize: number; cells: Map<string, HitGridEntry[]> };

const ZOOM_ANIMATION_MS = 220;
const SEARCH_RESULT_ANIMATION_MS = 800;
const FOCUS_TRANSITION_MS = 160;
const HIT_GRID_CELL_SIZE = 96;
const MIN_ZOOM = 0.8;
const MAX_ZOOM = 5;
const FIT_WORLD_PADDING = 180;
const INITIAL_ZOOM_BY_MODE: Record<GraphMode, number> = {
  structure: 3,
  governance: 1,
  planTrace: 1.5,
};
const HOVER_FOCUS_DEPTH = 1;
const CLICK_FOCUS_DEPTH = 1;
const SEARCH_RESULT_FOCUS_ZOOM = 2.5;
const POINTER_DRAG_THRESHOLD_PX = 3;

export function GraphPixiCanvas(props: {
  active?: boolean;
  mode?: GraphMode;
  graph: FunctionSlotLibraryGraph;
  visible: VisibleGraph;
  layoutMode?: GovernanceLayoutMode;
  titleLabel?: string | null;
  sourceTitlesBySampleId?: Record<string, string>;
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
}) {
  return <GraphPixiCanvasInner {...props} />;
}

function GraphPixiCanvasInner({
  active = true,
  mode = "structure",
  graph,
  visible,
  layoutMode = "force",
  titleLabel,
  sourceTitlesBySampleId = {},
  selectedNodeId,
  onSelectNode,
}: {
  active?: boolean;
  mode?: GraphMode;
  graph: FunctionSlotLibraryGraph;
  visible: VisibleGraph;
  layoutMode?: GovernanceLayoutMode;
  titleLabel?: string | null;
  sourceTitlesBySampleId?: Record<string, string>;
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<Application | null>(null);
  const layersRef = useRef<PixiLayers | null>(null);
  const graphObjectsRef = useRef<PixiGraphObjects>(createPixiGraphObjects());
  const graphThemeRef = useRef<GraphVisualTheme>(GRAPH_VISUAL_THEME);
  const graphThemeKeyRef = useRef(graphVisualThemeKey(GRAPH_VISUAL_THEME));
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
  const focusTransitionFrameRef = useRef<number | null>(null);
  const focusTransitionStartedAtRef = useRef(0);
  const focusTransitionStartSnapshotRef = useRef<PixiAlphaSnapshot | null>(null);
  const focusTransitionEndSnapshotRef = useRef<PixiAlphaSnapshot | null>(null);
  const viewportStateFrameRef = useRef<number | null>(null);
  const zoomAnimationFrameRef = useRef<number | null>(null);
  const zoomAnimationStartedAtRef = useRef(0);
  const zoomAnimationDurationMsRef = useRef(ZOOM_ANIMATION_MS);
  const zoomAnimationEasingRef = useRef<ViewportEasing>(easeOutCubic);
  const zoomStartViewportRef = useRef<ViewportTransform>(viewportRef.current);
  const zoomTargetViewportRef = useRef<ViewportTransform>(viewportRef.current);
  const pendingViewportFitRef = useRef(true);
  const hasUserAdjustedViewportRef = useRef(false);
  const pendingDrawAfterResizeRef = useRef(false);
  const resizeSyncFrameRef = useRef<number | null>(null);
  const suspendPixiRenderRef = useRef(false);
  const syncGraphObjectsRef = useRef<() => void>(() => undefined);
  const syncGraphLayoutRef = useRef<() => void>(() => undefined);
  const syncGraphLabelsRef = useRef<() => boolean>(() => false);
  const syncGraphFocusRef = useRef<(previous: PixiGraphRenderState, next: PixiGraphRenderState) => boolean>(() => false);
  const syncGraphThemeRef = useRef<() => void>(() => undefined);
  const applyViewportTransformRef = useRef<() => void>(() => undefined);
  const renderViewportRef = useRef<() => void>(() => undefined);
  const restartSimulationRef = useRef<(alpha?: number) => void>(() => undefined);
  const startPointerRef = useRef<(event: globalThis.PointerEvent | MouseEvent) => void>(() => undefined);
  const movePointerRef = useRef<(event: globalThis.PointerEvent | MouseEvent) => void>(() => undefined);
  const endPointerRef = useRef<(event: globalThis.PointerEvent | MouseEvent) => void>(() => undefined);
  const hideHoverSoonRef = useRef<(nodeId?: string | null) => void>(() => undefined);
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
    focusReverseEdgeIds: new Set<string>(),
    hasFocusNode: false,
    showFocusArrows: false,
    fixedLayout: layoutMode === "columns",
    theme: GRAPH_VISUAL_THEME,
  });
  const [viewport, setViewport] = useState(viewportRef.current);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [selectedFocusDepth, setSelectedFocusDepth] = useState(CLICK_FOCUS_DEPTH);
  const [pinnedPreviewNodeId, setPinnedPreviewNodeId] = useState<string | null>(null);
  const [sampleArtifacts, setSampleArtifacts] = useState<Record<string, SampleArtifact | null>>({});
  const [paused, setPaused] = useState(false);
  const [resetToken, setResetToken] = useState(0);
  const [previewTick, setPreviewTick] = useState(0);
  const [renderFps, setRenderFps] = useState(0);
  const [pixiError, setPixiError] = useState<string | null>(null);
  const [initRetry, setInitRetry] = useState(0);
  const [governanceSearchText, setGovernanceSearchText] = useState("");
  const governanceSearchQuery = governanceSearchText.trim().toLocaleLowerCase();
  const fixedLayout = layoutMode === "columns";
  const focusNodeId = hoveredNodeId ?? selectedNodeId;
  const focusDepth = hoveredNodeId && hoveredNodeId !== selectedNodeId ? HOVER_FOCUS_DEPTH : selectedNodeId ? selectedFocusDepth : HOVER_FOCUS_DEPTH;
  const selectedPathFocus = Boolean(selectedNodeId && (!hoveredNodeId || hoveredNodeId === selectedNodeId));
  const terminalPathFocus = selectedPathFocus && selectedFocusDepth === Number.POSITIVE_INFINITY;
  const showFocusArrows = Boolean(selectedNodeId && selectedFocusDepth === Number.POSITIVE_INFINITY && (!hoveredNodeId || hoveredNodeId === selectedNodeId));
  const governanceSearchResults = useMemo(() => {
    if (mode !== "governance" || !governanceSearchQuery) return [];
    return visible.nodes
      .filter(isSourceSampleNode)
      .map((node) => {
        const sampleId = stringField(node.data.sampleVideoId) ?? stringField(node.data.sampleId) ?? node.id;
        const name = sourceSampleSearchLabel(node, sourceTitlesBySampleId[sampleId]);
        const haystack = [name, sampleId, stringField(node.data.sourceAlias), stringField(node.data.artifactId)]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase();
        return { node, name, sampleId, matched: haystack.includes(governanceSearchQuery) };
      })
      .filter((item) => item.matched)
      .slice(0, 8);
  }, [governanceSearchQuery, mode, sourceTitlesBySampleId, visible.nodes]);
  const focusedPath = useMemo(
    () => mode === "planTrace"
      ? reverseTracePath(focusNodeId, visible.edges)
      : terminalPathFocus
        ? terminalShortestGraphFocus(focusNodeId, visible.nodes, visible.edges)
        : directedGraphFocus(focusNodeId, visible.edges, focusDepth),
    [focusDepth, focusNodeId, mode, terminalPathFocus, visible.edges, visible.nodes],
  );

  useEffect(() => {
    pausedRef.current = !active || paused;
    if (!active && forceFrameRef.current) {
      window.cancelAnimationFrame(forceFrameRef.current);
      forceFrameRef.current = null;
    }
    if (!active && drawFrameRef.current) {
      window.cancelAnimationFrame(drawFrameRef.current);
      drawFrameRef.current = null;
    }
    if (!active && focusTransitionFrameRef.current) {
      window.cancelAnimationFrame(focusTransitionFrameRef.current);
      focusTransitionFrameRef.current = null;
    }
    if (!active && viewportStateFrameRef.current) {
      window.cancelAnimationFrame(viewportStateFrameRef.current);
      viewportStateFrameRef.current = null;
    }
    if (!active && zoomAnimationFrameRef.current) {
      window.cancelAnimationFrame(zoomAnimationFrameRef.current);
      zoomAnimationFrameRef.current = null;
    }
    if (!active && previewTickFrameRef.current) {
      window.cancelAnimationFrame(previewTickFrameRef.current);
      previewTickFrameRef.current = null;
    }
    if (!active) {
      simulationRef.current?.stop();
      return;
    }
    if (!fixedLayout && !paused) restartSimulationRef.current(0.55);
    scheduleDraw();
  }, [active, fixedLayout, paused]);

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
    if (!active) return;
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
      focusReverseEdgeIds: focusedPath.reversedEdges,
      hasFocusNode: Boolean(focusNodeId),
      showFocusArrows,
      fixedLayout,
      theme: graphThemeRef.current,
    };
    stateRef.current = nextState;
    if (!edgesChanged && previousState.fixedLayout === nextState.fixedLayout && syncGraphFocusRef.current(previousState, nextState)) return;
    scheduleDraw();
  }, [active, fixedLayout, focusNodeId, focusedPath.edges, focusedPath.nodes, focusedPath.reversedEdges, hoveredNodeId, mode, pinnedPreviewNodeId, selectedNodeId, showFocusArrows, visible.edges]);

  useEffect(() => {
    pendingViewportFitRef.current = true;
    hasUserAdjustedViewportRef.current = false;
    pendingDrawAfterResizeRef.current = false;
    suspendPixiRenderRef.current = false;
    setHoveredNodeId(null);
    setPinnedPreviewNodeId(null);
    dragRef.current = null;
    stopZoomAnimation();
    stopPixiFocusTransition();
    if (drawFrameRef.current) {
      window.cancelAnimationFrame(drawFrameRef.current);
      drawFrameRef.current = null;
    }
    if (focusTransitionFrameRef.current) {
      window.cancelAnimationFrame(focusTransitionFrameRef.current);
      focusTransitionFrameRef.current = null;
    }
    destroyPixiGraphObjects(graphObjectsRef.current);
    graphObjectsRef.current = createPixiGraphObjects();
    updateCanvasSize();
    if (hoverOutTimerRef.current) {
      window.clearTimeout(hoverOutTimerRef.current);
      hoverOutTimerRef.current = null;
    }
    setResetToken((value) => value + 1);
    scheduleDraw();
  }, [graph.artifactId, layoutMode, mode]);

  useEffect(() => {
    let disposed = false;
    let initialized = false;
    const host = hostRef.current;
    if (!host) return undefined;
    const initialRect = host.getBoundingClientRect();
    if (initialRect.width <= 0 || initialRect.height <= 0) {
      const frameId = window.requestAnimationFrame(() => {
        if (!disposed) setInitRetry((value) => value + 1);
      });
      return () => {
        disposed = true;
        window.cancelAnimationFrame(frameId);
      };
    }
    const app = new Application();
    appRef.current = app;
    const root = new Container();
    const background = new Graphics();
    const world = new Container();
    const edges = new Container();
    const nodeOcclusions = new Container();
    const nodes = new Container();
    const labels = new Container();
    root.addChild(background);
    world.addChild(edges);
    world.addChild(nodeOcclusions);
    world.addChild(nodes);
    world.addChild(labels);
    root.addChild(world);
    layersRef.current = { root, background, world, edges, nodeOcclusions, nodes, labels };

    app.init({
      antialias: true,
      autoStart: false,
      autoDensity: true,
      backgroundAlpha: 0,
      preference: "webgl",
      width: host.offsetWidth || VIEWBOX.width,
      height: host.offsetHeight || VIEWBOX.height,
      resolution: Math.max(1, Math.min(window.devicePixelRatio || 1, 2)),
    }).then(() => {
      initialized = true;
      if (disposed) {
        app.destroy(true);
        return;
      }
      host.appendChild(app.canvas);
      app.stage.addChild(root);
      updateCanvasSize();
      syncGraphThemeRef.current();
      drawPixiBackground(background, graphThemeRef.current);
      syncGraphObjectsRef.current();
    }).catch((error) => {
      setPixiError(error instanceof Error ? error.message : "Pixi 初始化失败");
    });

    const syncResize = () => {
      suspendPixiRenderRef.current = false;
      const sizeChanged = updateCanvasSize();
      if (sizeChanged) drawPixiBackground(background, graphThemeRef.current);
      if (sizeChanged || pendingDrawAfterResizeRef.current) {
        pendingDrawAfterResizeRef.current = false;
        scheduleDraw();
      }
    };
    const queueResizeSync = () => {
      suspendPixiRenderRef.current = true;
      if (resizeSyncFrameRef.current) return;
      resizeSyncFrameRef.current = window.requestAnimationFrame(() => {
        resizeSyncFrameRef.current = null;
        syncResize();
      });
    };
    const resizeObserver = new ResizeObserver(queueResizeSync);
    resizeObserver.observe(host);

    return () => {
      disposed = true;
      resizeObserver.disconnect();
      if (resizeSyncFrameRef.current) window.cancelAnimationFrame(resizeSyncFrameRef.current);
      resizeSyncFrameRef.current = null;
      pendingDrawAfterResizeRef.current = false;
      suspendPixiRenderRef.current = false;
      simulationRef.current?.stop();
      simulationRef.current = null;
      if (forceFrameRef.current) window.cancelAnimationFrame(forceFrameRef.current);
      if (drawFrameRef.current) window.cancelAnimationFrame(drawFrameRef.current);
      if (focusTransitionFrameRef.current) window.cancelAnimationFrame(focusTransitionFrameRef.current);
      if (viewportStateFrameRef.current) window.cancelAnimationFrame(viewportStateFrameRef.current);
      if (zoomAnimationFrameRef.current) window.cancelAnimationFrame(zoomAnimationFrameRef.current);
      if (previewTickFrameRef.current) window.cancelAnimationFrame(previewTickFrameRef.current);
      if (hoverOutTimerRef.current) window.clearTimeout(hoverOutTimerRef.current);
      destroyPixiGraphObjects(graphObjectsRef.current);
      if (initialized) app.destroy(true);
      appRef.current = null;
      layersRef.current = null;
    };
  }, [initRetry]);

  useEffect(() => {
    if (!active) return undefined;
    syncGraphThemeRef.current();
    const host = hostRef.current;
    const shell = host?.closest(".slot-graph-shell");
    const themeRoot = host?.closest(".new-ui-shell");
    const canvas = canvasRef.current;
    const observer = new MutationObserver(() => syncGraphThemeRef.current());
    if (shell) observer.observe(shell, { attributes: true, attributeFilter: ["class", "style"] });
    if (themeRoot) observer.observe(themeRoot, { attributes: true, attributeFilter: ["data-theme", "class", "style"] });
    if (canvas) observer.observe(canvas, { attributes: true, attributeFilter: ["class", "style"] });
    return () => observer.disconnect();
  }, [active]);

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
      const nextViewport = fitGraphViewport(nextNodes, canvasSizeRef.current, mode, visibleCanvasGeometry()?.bounds);
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

  const previewNodeId = pinnedPreviewNodeId ?? hoveredNodeId;
  const previewNode = previewNodeId ? nodesRef.current.find((entry) => entry.id === previewNodeId) ?? null : null;
  const previewSampleId = typeof previewNode?.data.sampleVideoId === "string" ? previewNode.data.sampleVideoId : null;
  const previewSampleArtifact = previewSampleId ? sampleArtifacts[previewSampleId] ?? sampleCacheRef.current.get(previewSampleId) ?? null : null;
  const previewSize = previewPopoverSize(previewSampleArtifact);
  const previewVisibleGeometry = visibleCanvasGeometry();
  const previewCanvasSize = previewVisibleGeometry?.size ?? canvasSizeRef.current;
  const previewPosition = previewNode && (previewNode.type === "libraryItem" || previewNode.type === "sourceSample")
    ? clampPreviewPosition(
      pixiVisiblePoint(previewNode, viewport, currentHostGeometry(hostRef.current, canvasSizeRef.current), previewVisibleGeometry),
      previewCanvasSize,
      previewSize,
    )
    : null;
  void previewTick;

  useEffect(() => {
    if (!active) return;
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
  }, [active, previewSampleId]);

  const updateCanvasSize = () => {
    const host = hostRef.current;
    const rect = host?.getBoundingClientRect();
    if (!rect) return false;
    hostRectRef.current = rect;
    const nextSize = {
      width: host?.offsetWidth || rect.width || VIEWBOX.width,
      height: host?.offsetHeight || rect.height || VIEWBOX.height,
    };
    if (canvasSizeRef.current.width === nextSize.width && canvasSizeRef.current.height === nextSize.height) return false;
    appRef.current?.renderer?.resize(nextSize.width, nextSize.height);
    canvasSizeRef.current = nextSize;
    return true;
  };

  const applyFittedViewport = () => {
    if (!nodesRef.current.length) return;
    stopZoomAnimation();
    const nextViewport = fitGraphViewport(nodesRef.current, canvasSizeRef.current, mode, visibleCanvasGeometry()?.bounds);
    viewportRef.current = nextViewport;
    setViewport(nextViewport);
    zoomStartViewportRef.current = nextViewport;
    zoomTargetViewportRef.current = nextViewport;
    applyViewportTransformRef.current();
  };

  const commitViewportState = () => {
    if (viewportStateFrameRef.current) return;
    viewportStateFrameRef.current = window.requestAnimationFrame(() => {
      viewportStateFrameRef.current = null;
      setViewport(viewportRef.current);
    });
  };

  const schedulePreviewTick = () => {
    if (!active) return;
    if (!stateRef.current.hoveredNodeId && !stateRef.current.pinnedPreviewNodeId) return;
    if (previewTickFrameRef.current) return;
    previewTickFrameRef.current = window.requestAnimationFrame(() => {
      previewTickFrameRef.current = null;
      setPreviewTick((value) => value + 1);
    });
  };

  const scheduleDraw = () => {
    if (!active) return;
    if (suspendPixiRenderRef.current) {
      pendingDrawAfterResizeRef.current = true;
      return;
    }
    if (drawFrameRef.current) return;
    drawFrameRef.current = window.requestAnimationFrame(() => {
      drawFrameRef.current = null;
      syncGraphObjectsRef.current();
    });
  };

  const syncGraphObjects = () => {
    if (suspendPixiRenderRef.current) {
      pendingDrawAfterResizeRef.current = true;
      return;
    }
    const layers = layersRef.current;
    if (!layers) return;
    stopPixiFocusTransition();
    applyViewportTransformRef.current();
    drawPixiBackground(layers.background, graphThemeRef.current);
    syncPixiEdges(layers.edges, graphObjectsRef.current, visibleEdgesRef.current, nodesRef.current, stateRef.current);
    syncPixiNodes(layers.nodeOcclusions, layers.nodes, layers.labels, graphObjectsRef.current, nodesRef.current, stateRef.current, viewportRef.current.k);
    renderPixi();
  };
  syncGraphObjectsRef.current = syncGraphObjects;

  const syncGraphTheme = () => {
    const host = hostRef.current;
    const tokenSource = canvasRef.current ?? host?.closest(".slot-graph-shell") ?? host;
    const nextTheme = readGraphVisualTheme(tokenSource);
    const nextThemeKey = graphVisualThemeKey(nextTheme);
    const themeChanged = graphThemeKeyRef.current !== nextThemeKey;
    graphThemeRef.current = nextTheme;
    stateRef.current = { ...stateRef.current, theme: nextTheme };
    if (layersRef.current && !suspendPixiRenderRef.current) drawPixiBackground(layersRef.current.background, nextTheme);
    if (themeChanged) {
      stopPixiFocusTransition();
      destroyPixiGraphObjects(graphObjectsRef.current);
      graphObjectsRef.current = createPixiGraphObjects();
      graphThemeKeyRef.current = nextThemeKey;
    }
    scheduleDraw();
  };
  syncGraphThemeRef.current = syncGraphTheme;

  const syncGraphLayout = () => {
    if (suspendPixiRenderRef.current) {
      pendingDrawAfterResizeRef.current = true;
      return;
    }
    const rendered = syncPixiLayout(graphObjectsRef.current, visibleEdgesRef.current, nodesRef.current, stateRef.current);
    if (!rendered) {
      syncGraphObjectsRef.current();
      return;
    }
    renderPixi();
  };
  syncGraphLayoutRef.current = syncGraphLayout;

  const syncGraphLabels = () => {
    if (suspendPixiRenderRef.current) return false;
    const layers = layersRef.current;
    if (!layers) return false;
    const rendered = syncPixiLabels(layers.labels, graphObjectsRef.current, nodesRef.current, stateRef.current, viewportRef.current.k);
    if (!rendered) return false;
    renderPixi();
    return true;
  };
  syncGraphLabelsRef.current = syncGraphLabels;

  const syncGraphFocus = (previousState: PixiGraphRenderState, nextState: PixiGraphRenderState) => {
    const start = capturePixiAlphaSnapshot(graphObjectsRef.current);
    const rendered = syncPixiFocus(graphObjectsRef.current, visibleEdgesRef.current, nodesRef.current, previousState, nextState, viewportRef.current.k);
    if (!rendered) return false;
    startPixiFocusTransition(start, capturePixiAlphaSnapshot(graphObjectsRef.current));
    return true;
  };
  syncGraphFocusRef.current = syncGraphFocus;

  const applyViewportTransform = () => {
    const layers = layersRef.current;
    if (!layers) return;
    const size = canvasSizeRef.current;
    const transform = stageTransform(size);
    layers.root.position.set(transform.offsetX, transform.offsetY);
    layers.root.scale.set(transform.scale);
    layers.world.position.set(viewportRef.current.x, viewportRef.current.y);
    layers.world.scale.set(viewportRef.current.k);
  };
  applyViewportTransformRef.current = applyViewportTransform;

  const renderPixi = () => {
    if (!appRef.current?.renderer) return;
    appRef.current.render();
    recordRenderFrame();
  };

  const stopPixiFocusTransition = () => {
    if (!focusTransitionFrameRef.current) return;
    window.cancelAnimationFrame(focusTransitionFrameRef.current);
    focusTransitionFrameRef.current = null;
  };

  const startPixiFocusTransition = (start: PixiAlphaSnapshot, end: PixiAlphaSnapshot) => {
    stopPixiFocusTransition();
    focusTransitionStartedAtRef.current = performance.now();
    focusTransitionStartSnapshotRef.current = start;
    focusTransitionEndSnapshotRef.current = end;
    applyPixiAlphaTween(graphObjectsRef.current, start, end, 0);
    renderPixi();

    const step = (time: number) => {
      const startSnapshot = focusTransitionStartSnapshotRef.current;
      const endSnapshot = focusTransitionEndSnapshotRef.current;
      if (!startSnapshot || !endSnapshot) {
        focusTransitionFrameRef.current = null;
        return;
      }
      const progress = clamp((time - focusTransitionStartedAtRef.current) / FOCUS_TRANSITION_MS, 0, 1);
      const eased = 1 - ((1 - progress) ** 3);
      applyPixiAlphaTween(graphObjectsRef.current, startSnapshot, endSnapshot, eased);
      renderPixi();
      if (progress < 1) {
        focusTransitionFrameRef.current = window.requestAnimationFrame(step);
        return;
      }
      focusTransitionFrameRef.current = null;
    };
    focusTransitionFrameRef.current = window.requestAnimationFrame(step);
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
    const previousZoom = viewportRef.current.k;
    viewportRef.current = nextViewport;
    setViewport(nextViewport);
    applyViewportTransformRef.current();
    if (previousZoom !== nextViewport.k && syncGraphLabelsRef.current()) {
      schedulePreviewTick();
      return;
    }
    renderPixi();
    schedulePreviewTick();
  };

  const stopZoomAnimation = () => {
    if (!zoomAnimationFrameRef.current) return;
    window.cancelAnimationFrame(zoomAnimationFrameRef.current);
    zoomAnimationFrameRef.current = null;
  };

  const stepZoomAnimation = (time: number) => {
    const progress = clamp((time - zoomAnimationStartedAtRef.current) / zoomAnimationDurationMsRef.current, 0, 1);
    const eased = zoomAnimationEasingRef.current(progress);
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
    scheduleDraw();
  };

  const animateViewportTo = (targetViewport: ViewportTransform, options: ViewportAnimationOptions = {}) => {
    zoomStartViewportRef.current = viewportRef.current;
    zoomTargetViewportRef.current = targetViewport;
    zoomAnimationDurationMsRef.current = options.durationMs ?? ZOOM_ANIMATION_MS;
    zoomAnimationEasingRef.current = options.easing ?? easeOutCubic;
    zoomAnimationStartedAtRef.current = performance.now();
    if (!zoomAnimationFrameRef.current) zoomAnimationFrameRef.current = window.requestAnimationFrame(stepZoomAnimation);
  };

  const showHover = (nodeId: string | null) => {
    if (Date.now() < hoverSuppressUntilRef.current) return;
    if (hoverOutTimerRef.current) window.clearTimeout(hoverOutTimerRef.current);
    hoverOutTimerRef.current = null;
    setHoveredNodeId(nodeId);
  };

  const hideHoverSoon = (nodeId: string | null = stateRef.current.hoveredNodeId) => {
    if (hoverOutTimerRef.current) {
      if (isSamplePreviewNode(nodesRef.current.find((node) => node.id === nodeId) ?? null)) return;
      window.clearTimeout(hoverOutTimerRef.current);
    }
    hoverOutTimerRef.current = null;
    if (!isSamplePreviewNode(nodesRef.current.find((node) => node.id === nodeId) ?? null)) {
      setHoveredNodeId(null);
      return;
    }
    hoverOutTimerRef.current = window.setTimeout(() => setHoveredNodeId(null), 150);
  };

  const closePreview = () => {
    if (hoverOutTimerRef.current) window.clearTimeout(hoverOutTimerRef.current);
    hoverOutTimerRef.current = null;
    hoverSuppressUntilRef.current = Date.now() + 240;
    setPinnedPreviewNodeId(null);
    setHoveredNodeId(null);
  };

  const currentGeometry = () => {
    const geometry = currentHostGeometry(hostRef.current, canvasSizeRef.current);
    if (geometry) hostRectRef.current = geometry.rect;
    return geometry;
  };

  function visibleCanvasGeometry() {
    return visibleCanvasGeometryFor(hostRef.current, canvasRef.current, canvasSizeRef.current);
  }

  const screenToLayoutPoint = (clientX: number, clientY: number) => {
    const geometry = currentGeometry();
    if (!geometry) return null;
    const scaleX = geometry.rect.width ? geometry.size.width / geometry.rect.width : 1;
    const scaleY = geometry.rect.height ? geometry.size.height / geometry.rect.height : 1;
    return {
      x: (clientX - geometry.rect.left) * scaleX,
      y: (clientY - geometry.rect.top) * scaleY,
      size: geometry.size,
    };
  };

  const graphPoint = (clientX: number, clientY: number) => {
    const localPoint = screenToLayoutPoint(clientX, clientY);
    if (!localPoint) return { x: 0, y: 0 };
    const transform = stageTransform(localPoint.size);
    const rawX = (localPoint.x - transform.offsetX) / transform.scale;
    const rawY = (localPoint.y - transform.offsetY) / transform.scale;
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

  const blurGovernanceSearch = () => {
    const activeElement = document.activeElement as HTMLElement | null;
    if (activeElement?.closest(".slot-graph-governance-search")) activeElement.blur();
  };

  const startPointer = (event: globalThis.PointerEvent | MouseEvent) => {
    const shouldForcePan = forcePanRef.current || event.shiftKey || event.button === 1 || event.button === 2;
    if (event.button !== 0 && !shouldForcePan) return;
    blurGovernanceSearch();
    event.preventDefault();
    stopZoomAnimation();
    const host = hostRef.current;
    const point = graphPoint(event.clientX, event.clientY);
    const hitNode = hitTestNode(point);
    if ("pointerId" in event) host?.setPointerCapture(event.pointerId);
    if (hitNode && !shouldForcePan) {
      dragRef.current = {
        kind: "node",
        nodeId: hitNode.id,
        dx: hitNode.x - point.x,
        dy: hitNode.y - point.y,
        clientX: event.clientX,
        clientY: event.clientY,
        selectFocusDepth: event.ctrlKey ? Number.POSITIVE_INFINITY : CLICK_FOCUS_DEPTH,
        moved: false,
      };
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
      const moved = drag.moved || Math.hypot(event.clientX - drag.clientX, event.clientY - drag.clientY) > POINTER_DRAG_THRESHOLD_PX;
      if (!moved) return;
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
      dragRef.current = { ...drag, moved };
      if (active && !fixedLayout) restartSimulationRef.current(0.75);
      syncGraphLayoutRef.current();
      schedulePreviewTick();
      return;
    }
    const moved = drag.moved || Math.hypot(event.clientX - drag.clientX, event.clientY - drag.clientY) > 3;
    const geometry = currentGeometry();
    const size = geometry?.size ?? canvasSizeRef.current;
    const screenRect = geometry?.rect ?? hostRectRef.current;
    const transform = stageTransform(size);
    const scaleX = screenRect?.width ? size.width / screenRect.width : 1;
    const scaleY = screenRect?.height ? size.height / screenRect.height : 1;
    const nextViewport = {
      ...viewportRef.current,
      x: drag.startX + ((event.clientX - drag.clientX) * scaleX) / transform.scale,
      y: drag.startY + ((event.clientY - drag.clientY) * scaleY) / transform.scale,
    };
    dragRef.current = { ...drag, moved };
    if (moved) hasUserAdjustedViewportRef.current = true;
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
        const anchorX = draggedNode.layoutX ?? draggedNode.x;
        const anchorY = draggedNode.layoutY ?? draggedNode.y;
        draggedNode.fx = fixedLayout ? anchorX : null;
        draggedNode.fy = fixedLayout ? anchorY : null;
        if (fixedLayout) {
          draggedNode.x = anchorX;
          draggedNode.y = anchorY;
        }
        draggedNode.vx = 0;
        draggedNode.vy = 0;
      }
      if (active && !fixedLayout) restartSimulationRef.current(paused ? 0 : 0.55);
      syncGraphLayoutRef.current();
    }
    if (drag?.kind === "node" && !drag.moved) {
      const clickedNode = nodesRef.current.find((node) => node.id === drag.nodeId);
      setSelectedFocusDepth(drag.selectFocusDepth);
      onSelectNode(drag.nodeId);
      if (clickedNode?.type === "libraryItem" || clickedNode?.type === "sourceSample") setPinnedPreviewNodeId(clickedNode.id);
    }
    if (drag?.kind === "pan" && !drag.moved) {
      setSelectedFocusDepth(CLICK_FOCUS_DEPTH);
      onSelectNode(null);
    }
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
    hasUserAdjustedViewportRef.current = true;
    const localPoint = screenToLayoutPoint(event.clientX, event.clientY);
    if (!localPoint) return;
    const transform = stageTransform(localPoint.size);
    const rawX = (localPoint.x - transform.offsetX) / transform.scale;
    const rawY = (localPoint.y - transform.offsetY) / transform.scale;
    const current = zoomAnimationFrameRef.current ? zoomTargetViewportRef.current : viewportRef.current;
    const nextK = clamp(current.k * Math.exp(-event.deltaY * 0.0012), MIN_ZOOM, MAX_ZOOM);
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
    pendingViewportFitRef.current = false;
    hasUserAdjustedViewportRef.current = false;
    const nextViewport = fitGraphViewport(nodesRef.current, canvasSizeRef.current, mode, visibleCanvasGeometry()?.bounds);
    setResetToken((value) => value + 1);
    animateViewportTo(nextViewport);
  };

  const selectGovernanceSearchResult = (nodeId: string) => {
    const node = nodesRef.current.find((entry) => entry.id === nodeId) ?? visible.nodes.find((entry) => entry.id === nodeId);
    if (!node) return;
    stopZoomAnimation();
    setSelectedFocusDepth(HOVER_FOCUS_DEPTH);
    setHoveredNodeId(null);
    setPinnedPreviewNodeId(null);
    onSelectNode(node.id);
    const size = canvasSizeRef.current;
    const transform = stageTransform(size);
    const bounds = visibleCanvasGeometry()?.bounds ?? { left: 0, top: 0, right: size.width, bottom: size.height };
    const centerX = ((bounds.left + bounds.right) / 2 - transform.offsetX) / transform.scale;
    const centerY = ((bounds.top + bounds.bottom) / 2 - transform.offsetY) / transform.scale;
    const targetK = clamp(SEARCH_RESULT_FOCUS_ZOOM, MIN_ZOOM, MAX_ZOOM);
    animateViewportTo(
      {
        k: targetK,
        x: centerX - node.x * targetK,
        y: centerY - node.y * targetK,
      },
      { durationMs: SEARCH_RESULT_ANIMATION_MS, easing: easeOutQuad },
    );
  };

  return (
    <div ref={canvasRef} className={`slot-graph-canvas pixi ${mode === "planTrace" ? "plan-trace" : mode}`}>
      {titleLabel !== null ? (
        <div className="slot-graph-canvas-title">
          <strong>{titleLabel ?? (mode === "governance" ? "语义治理库" : mode === "planTrace" ? "确定方案溯源" : shortId(graph.artifactId))}</strong>
        </div>
      ) : null}
      <div className="slot-graph-controls">
        <span className="slot-graph-fps-chip">FPS {renderFps}</span>
        <button type="button" onClick={resetView}>重置</button>
        <button type="button" onClick={() => setPaused((value) => !value)}>{paused ? "继续" : "暂停"}</button>
      </div>
      <GraphLegend mode={mode} />
      <div className="slot-graph-zoom-chip">{Math.round(viewport.k * 100)}%</div>
      {pixiError ? <div className="slot-graph-pixi-error">Pixi 图谱初始化失败：{pixiError}</div> : null}
      {mode === "governance" ? (
        <div className="slot-graph-governance-search">
          {governanceSearchQuery ? (
            <div className="slot-graph-governance-search-results" role="listbox" aria-label="治理库搜索结果">
              {governanceSearchResults.length ? governanceSearchResults.map((item) => (
                <button
                  key={item.node.id}
                  type="button"
                  className={item.node.id === selectedNodeId ? "active" : ""}
                  title={item.name}
                  onClick={() => selectGovernanceSearchResult(item.node.id)}
                  onMouseEnter={() => showHover(item.node.id)}
                  onMouseLeave={() => hideHoverSoon(item.node.id)}
                >
                  <strong>{item.name}</strong>
                  <span>{item.sampleId}</span>
                </button>
              )) : (
                <div className="slot-graph-governance-search-empty">无匹配样例</div>
              )}
            </div>
          ) : null}
          <input
            aria-label="搜索治理库"
            placeholder="搜索治理库"
            value={governanceSearchText}
            onChange={(event) => setGovernanceSearchText(event.target.value)}
          />
        </div>
      ) : null}
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
          sourceTitle={previewSampleId ? sourceTitlesBySampleId[previewSampleId] ?? null : null}
          position={previewPosition}
          size={previewSize}
          pinned={pinnedPreviewNodeId === previewNode.id}
          onMouseEnter={() => showHover(previewNode.id)}
          onMouseLeave={() => hideHoverSoon(previewNode.id)}
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

function currentHostGeometry(host: HTMLDivElement | null, fallbackSize: { width: number; height: number }) {
  const rect = host?.getBoundingClientRect() ?? null;
  if (!rect) return null;
  return {
    rect,
    size: {
      width: host?.offsetWidth || fallbackSize.width || rect.width || VIEWBOX.width,
      height: host?.offsetHeight || fallbackSize.height || rect.height || VIEWBOX.height,
    },
  };
}

function visibleCanvasGeometryFor(
  host: HTMLDivElement | null,
  canvas: HTMLDivElement | null,
  fallbackSize: { width: number; height: number },
) {
  const hostGeometry = currentHostGeometry(host, fallbackSize);
  const canvasRect = canvas?.getBoundingClientRect() ?? null;
  if (!hostGeometry || !canvasRect) return null;
  const scaleX = hostGeometry.rect.width ? hostGeometry.size.width / hostGeometry.rect.width : 1;
  const scaleY = hostGeometry.rect.height ? hostGeometry.size.height / hostGeometry.rect.height : 1;
  const left = (canvasRect.left - hostGeometry.rect.left) * scaleX;
  const top = (canvasRect.top - hostGeometry.rect.top) * scaleY;
  const width = canvasRect.width * scaleX;
  const height = canvasRect.height * scaleY;
  return {
    bounds: {
      left,
      top,
      right: left + width,
      bottom: top + height,
    },
    size: { width, height },
  };
}

function pixiVisiblePoint(
  node: SimNode,
  viewport: { x: number; y: number; k: number },
  hostGeometry: ReturnType<typeof currentHostGeometry>,
  visibleGeometry: ReturnType<typeof visibleCanvasGeometryFor>,
) {
  const size = hostGeometry?.size ?? visibleGeometry?.size ?? { width: VIEWBOX.width, height: VIEWBOX.height };
  const bounds = visibleGeometry?.bounds ?? { left: 0, top: 0 };
  const point = pixiScreenPoint(node, viewport, size);
  return {
    x: point.x - bounds.left,
    y: point.y - bounds.top,
  };
}

function stageTransform(size: { width: number; height: number }): StageTransform {
  const scale = Math.min(size.width / VIEWBOX.width, size.height / VIEWBOX.height) || 1;
  return {
    scale,
    offsetX: (size.width - VIEWBOX.width * scale) / 2,
    offsetY: (size.height - VIEWBOX.height * scale) / 2,
  };
}

function fitGraphViewport(
  nodes: SimNode[],
  size: { width: number; height: number },
  mode: GraphMode,
  visibleBounds?: { left: number; top: number; right: number; bottom: number },
): ViewportTransform {
  if (!nodes.length) return { x: 0, y: 0, k: 1 };
  const transform = stageTransform(size);
  const fitBounds = visibleBounds ?? { left: 0, top: 0, right: size.width, bottom: size.height };
  const fitWidth = Math.max(1, fitBounds.right - fitBounds.left);
  const fitHeight = Math.max(1, fitBounds.bottom - fitBounds.top);
  const centerX = (fitBounds.left + fitWidth / 2 - transform.offsetX) / transform.scale;
  const centerY = (fitBounds.top + fitHeight / 2 - transform.offsetY) / transform.scale;
  const bounds = graphBounds(nodes);
  const k = clamp(INITIAL_ZOOM_BY_MODE[mode], MIN_ZOOM, MAX_ZOOM);
  return {
    x: centerX - bounds.centerX * k,
    y: centerY - bounds.centerY * k,
    k,
  };
}

function graphBounds(nodes: SimNode[]) {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const node of nodes) {
    const radius = nodeRadius(node) + FIT_WORLD_PADDING;
    minX = Math.min(minX, node.x - radius);
    minY = Math.min(minY, node.y - radius);
    maxX = Math.max(maxX, node.x + radius);
    maxY = Math.max(maxY, node.y + radius);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return { centerX: VIEWBOX.width / 2, centerY: VIEWBOX.height / 2, width: VIEWBOX.width, height: VIEWBOX.height };
  }
  return {
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

function isSamplePreviewNode(node: SimNode | null) {
  return node?.type === "sourceSample" || node?.type === "libraryItem";
}

function isSourceSampleNode(node: SimNode | VisibleGraph["nodes"][number]) {
  return node.type === "sourceSample";
}

function sourceSampleSearchLabel(node: SimNode | VisibleGraph["nodes"][number], mappedTitle?: string | null) {
  return stringField(node.data.sourceVideoName)
    ?? stringField(node.data.sourceAlias)
    ?? stringField(mappedTitle)
    ?? stringField(node.label)
    ?? stringField(node.data.sampleVideoId)
    ?? node.id;
}

function stringField(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function easeOutCubic(progress: number) {
  return 1 - ((1 - progress) ** 3);
}

function easeOutQuad(progress: number) {
  return 1 - ((1 - progress) ** 2);
}

function graphVisualThemeKey(theme: GraphVisualTheme) {
  return JSON.stringify(theme);
}
