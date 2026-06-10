import { useEffect, useMemo, useRef, useState } from "react";
import type { Simulation } from "d3-force";
import { Application, Container, Graphics } from "pixi.js";
import { getSampleArtifact } from "../../api/client";
import type { SampleArtifact } from "../../types/artifact";
import type { FunctionSlotLibraryGraph } from "../../types/library";
import {
  clamp,
  clampPreviewPosition,
  directedGraphFocus,
  previewPopoverSize,
  reverseTracePath,
  terminalShortestGraphFocus,
  VIEWBOX,
} from "./graphUtils";
import { GraphPixiCanvasView } from "./GraphPixiCanvasView";
import {
  applyPixiAlphaTween,
  capturePixiAlphaSnapshot,
  createPixiGraphObjects,
  destroyPixiGraphObjects,
  drawPixiBackground,
  syncPixiEdges,
  syncPixiFocus,
  syncPixiLabels,
  syncPixiLayout,
  syncPixiNodes,
  type PixiAlphaSnapshot,
  type PixiGraphObjects,
  type PixiGraphRenderState,
} from "./graphPixiRenderer";
import {
  easeOutCubic,
  fitGraphViewport,
  graphVisualThemeKey,
  isSourceSampleNode,
  pixiVisiblePoint,
  sourceSampleSearchLabel,
  stageTransform,
  stringField,
  type GraphMode,
  type HitGridIndex,
  type ViewportAnimationOptions,
  type ViewportEasing,
  type ViewportTransform,
} from "./graphPixiCanvasUtils";
import { GRAPH_VISUAL_THEME, readGraphVisualTheme, type GraphVisualTheme } from "./graphVisualStyles";
import { useGraphPixiLifecycle } from "./useGraphPixiLifecycle";
import { useGraphPixiPointer } from "./useGraphPixiPointer";
import { useGraphPixiRendering } from "./useGraphPixiRendering";
import { useGraphPixiSimulation } from "./useGraphPixiSimulation";
import type { D3Link, DragState, GovernanceLayoutMode, SimNode, VisibleGraph } from "./types";

type PixiLayers = {
  root: Container;
  background: Graphics;
  world: Container;
  edges: Container;
  nodeOcclusions: Container;
  nodes: Container;
  labels: Container;
};

const ZOOM_ANIMATION_MS = 220;
const FOCUS_TRANSITION_MS = 160;
const HOVER_FOCUS_DEPTH = 1;
const CLICK_FOCUS_DEPTH = 1;
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

  const {
    commitViewportState,
    schedulePreviewTick,
    scheduleDraw,
    stopPixiFocusTransition,
    stopZoomAnimation,
    animateViewportTo,
  } = useGraphPixiRendering({
    active,
    appRef,
    canvasRef,
    layersRef,
    graphObjectsRef,
    graphThemeRef,
    graphThemeKeyRef,
    nodesRef,
    visibleEdgesRef,
    stateRef,
    viewportRef,
    canvasSizeRef,
    drawFrameRef,
    focusTransitionFrameRef,
    focusTransitionStartedAtRef,
    focusTransitionStartSnapshotRef,
    focusTransitionEndSnapshotRef,
    viewportStateFrameRef,
    zoomAnimationFrameRef,
    zoomAnimationStartedAtRef,
    zoomAnimationDurationMsRef,
    zoomAnimationEasingRef,
    zoomStartViewportRef,
    zoomTargetViewportRef,
    pendingDrawAfterResizeRef,
    suspendPixiRenderRef,
    syncGraphObjectsRef,
    syncGraphLayoutRef,
    syncGraphLabelsRef,
    syncGraphFocusRef,
    syncGraphThemeRef,
    applyViewportTransformRef,
    renderViewportRef,
    previewTickFrameRef,
    renderFpsWindowRef,
    setViewport,
    setPreviewTick,
    setRenderFps,
  });

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

  useGraphPixiLifecycle({
    active,
    fixedLayout,
    paused,
    graphArtifactId: graph.artifactId,
    layoutMode,
    mode,
    initRetry,
    hostRef,
    canvasRef,
    appRef,
    layersRef,
    graphObjectsRef,
    graphThemeRef,
    dragRef,
    forcePanRef,
    simulationRef,
    forceFrameRef,
    drawFrameRef,
    focusTransitionFrameRef,
    viewportStateFrameRef,
    zoomAnimationFrameRef,
    previewTickFrameRef,
    hoverOutTimerRef,
    resizeSyncFrameRef,
    pendingViewportFitRef,
    hasUserAdjustedViewportRef,
    pendingDrawAfterResizeRef,
    suspendPixiRenderRef,
    restartSimulationRef,
    syncGraphThemeRef,
    syncGraphObjectsRef,
    setInitRetry,
    setHoveredNodeId,
    setPinnedPreviewNodeId,
    setPixiError,
    setResetToken,
    updateCanvasSize,
    scheduleDraw,
    stopZoomAnimation,
    stopPixiFocusTransition,
  });

  const {
    currentGeometry,
    visibleCanvasGeometry,
    markHitGridDirty,
    showHover,
    hideHoverSoon,
    closePreview,
    resetView,
    selectGovernanceSearchResult,
  } = useGraphPixiPointer({
    active,
    fixedLayout,
    mode,
    paused,
    hostRef,
    canvasRef,
    nodesRef,
    dragRef,
    forcePanRef,
    lastPointerEventAtRef,
    viewportRef,
    canvasSizeRef,
    hostRectRef,
    hitGridRef,
    hitGridDirtyRef,
    hoverOutTimerRef,
    hoverSuppressUntilRef,
    stateRef,
    zoomAnimationFrameRef,
    zoomTargetViewportRef,
    hasUserAdjustedViewportRef,
    pendingViewportFitRef,
    restartSimulationRef,
    syncGraphLayoutRef,
    renderViewportRef,
    startPointerRef,
    movePointerRef,
    endPointerRef,
    hideHoverSoonRef,
    onSelectNode,
    setSelectedFocusDepth,
    setHoveredNodeId,
    setPinnedPreviewNodeId,
    setResetToken,
    commitViewportState,
    schedulePreviewTick,
    stopZoomAnimation,
    animateViewportTo,
    visible,
    clickFocusDepth: CLICK_FOCUS_DEPTH,
    hoverFocusDepth: HOVER_FOCUS_DEPTH,
    pointerDragThresholdPx: POINTER_DRAG_THRESHOLD_PX,
  });

  useGraphPixiSimulation({
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
    visibleCanvasBounds: () => visibleCanvasGeometry()?.bounds,
  });

  const previewNodeId = pinnedPreviewNodeId ?? hoveredNodeId;
  const previewNode = previewNodeId ? nodesRef.current.find((entry) => entry.id === previewNodeId) ?? null : null;
  const previewSampleId = typeof previewNode?.data.sampleVideoId === "string" ? previewNode.data.sampleVideoId : null;
  const previewSampleArtifact = previewSampleId ? sampleArtifacts[previewSampleId] ?? sampleCacheRef.current.get(previewSampleId) ?? null : null;
  const previewSize = previewPopoverSize(previewSampleArtifact);
  const previewVisibleGeometry = visibleCanvasGeometry();
  const previewCanvasSize = previewVisibleGeometry?.size ?? canvasSizeRef.current;
  const previewPosition = previewNode && (previewNode.type === "libraryItem" || previewNode.type === "sourceSample")
    ? clampPreviewPosition(
      pixiVisiblePoint(previewNode, viewport, currentGeometry(), previewVisibleGeometry),
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

  return (
    <GraphPixiCanvasView
      canvasRef={canvasRef}
      hostRef={hostRef}
      mode={mode}
      graph={graph}
      titleLabel={titleLabel}
      renderFps={renderFps}
      resetView={resetView}
      paused={paused}
      setPaused={setPaused}
      viewport={viewport}
      pixiError={pixiError}
      governanceSearchQuery={governanceSearchQuery}
      governanceSearchResults={governanceSearchResults}
      selectedNodeId={selectedNodeId}
      selectGovernanceSearchResult={selectGovernanceSearchResult}
      showHover={showHover}
      hideHoverSoon={hideHoverSoon}
      governanceSearchText={governanceSearchText}
      setGovernanceSearchText={setGovernanceSearchText}
      previewNode={previewNode}
      previewSampleArtifact={previewSampleArtifact}
      previewSampleId={previewSampleId}
      sourceTitlesBySampleId={sourceTitlesBySampleId}
      previewPosition={previewPosition}
      previewSize={previewSize}
      pinnedPreviewNodeId={pinnedPreviewNodeId}
      closePreview={closePreview}
    />
  );
}
