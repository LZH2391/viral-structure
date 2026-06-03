import { type PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  createPixiTextMaps,
  drawPixiBackground,
  drawPixiEdges,
  drawPixiNodes,
  hitTestPixiNode,
  pixiScreenPoint,
  type PixiGraphRenderState,
  type PixiTextMaps,
} from "./graphPixiRenderer";
import type { D3Link, DragState, GovernanceLayoutMode, SimNode, VisibleGraph } from "./types";

type GraphMode = "structure" | "governance" | "planTrace";

type PixiLayers = {
  root: Container;
  background: Graphics;
  world: Container;
  edges: Graphics;
  nodes: Graphics;
  labels: Container;
};

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
  const textMapsRef = useRef<PixiTextMaps>(createPixiTextMaps());
  const nodesRef = useRef<SimNode[]>([]);
  const dragRef = useRef<DragState | null>(null);
  const simulationRef = useRef<Simulation<SimNode, D3Link> | null>(null);
  const visibleEdgesRef = useRef(visible.edges);
  const sampleCacheRef = useRef<Map<string, SampleArtifact | null>>(new Map());
  const hoverOutTimerRef = useRef<number | null>(null);
  const hoverSuppressUntilRef = useRef(0);
  const viewportRef = useRef({ x: 0, y: 0, k: 1 });
  const canvasSizeRef = useRef({ width: VIEWBOX.width, height: VIEWBOX.height });
  const drawFrameRef = useRef<number | null>(null);
  const drawGraphRef = useRef<() => void>(() => undefined);
  const previewTickFrameRef = useRef<number | null>(null);
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
  const fixedLayout = layoutMode === "columns";
  const focusNodeId = hoveredNodeId ?? selectedNodeId;
  const focusedPath = useMemo(
    () => mode === "planTrace"
      ? reverseTracePath(focusNodeId, visible.edges)
      : { nodes: connectedNodeIds(focusNodeId, visible.edges), edges: new Set<string>() },
    [focusNodeId, mode, visible.edges],
  );

  useEffect(() => {
    visibleEdgesRef.current = visible.edges;
    stateRef.current = {
      mode,
      selectedNodeId,
      hoveredNodeId,
      pinnedPreviewNodeId,
      focusedIds: focusedPath.nodes,
      focusedEdgeIds: focusedPath.edges,
      hasFocusNode: Boolean(focusNodeId),
      fixedLayout,
    };
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
    const edges = new Graphics();
    const nodes = new Graphics();
    const labels = new Container();
    root.addChild(background);
    world.addChild(edges);
    world.addChild(nodes);
    world.addChild(labels);
    root.addChild(world);
    layersRef.current = { root, background, world, edges, nodes, labels };

    app.init({
      antialias: true,
      autoDensity: true,
      backgroundAlpha: 0,
      preference: "webgl",
      resizeTo: host,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
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
      drawGraphRef.current();
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
      if (drawFrameRef.current) window.cancelAnimationFrame(drawFrameRef.current);
      if (previewTickFrameRef.current) window.cancelAnimationFrame(previewTickFrameRef.current);
      if (hoverOutTimerRef.current) window.clearTimeout(hoverOutTimerRef.current);
      clearTextMaps();
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
    pruneTextMaps(new Set(nextNodes.map((node) => node.id)));
    simulationRef.current?.stop();
    simulationRef.current = createGraphSimulation(nextNodes, nextLinks)
      .on("tick", () => {
        nextNodes.forEach(constrainNodeToLayoutSector);
        nodesRef.current = nextNodes;
        scheduleDraw();
        schedulePreviewTick();
      });
    if (fixedLayout) simulationRef.current.stop();
    drawGraphRef.current();
    return () => {
      simulationRef.current?.stop();
      simulationRef.current = null;
    };
  }, [fixedLayout, resetToken, visible.edges, visible.nodes]);

  useEffect(() => {
    if (fixedLayout || paused) simulationRef.current?.stop();
    else simulationRef.current?.alphaTarget(0.03).restart();
  }, [fixedLayout, paused]);

  useEffect(() => {
    scheduleDraw();
  }, [canvasSize, viewport]);

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
    const nextSize = { width: rect.width || VIEWBOX.width, height: rect.height || VIEWBOX.height };
    canvasSizeRef.current = nextSize;
    setCanvasSize(nextSize);
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
      drawGraphRef.current();
    });
  };

  const drawGraph = () => {
    const layers = layersRef.current;
    if (!layers) return;
    const size = canvasSizeRef.current;
    const scaleX = size.width / VIEWBOX.width;
    const scaleY = size.height / VIEWBOX.height;
    layers.root.scale.set(scaleX, scaleY);
    layers.world.position.set(viewportRef.current.x, viewportRef.current.y);
    layers.world.scale.set(viewportRef.current.k);
    drawPixiEdges(layers.edges, visibleEdgesRef.current, nodesRef.current, stateRef.current);
    drawPixiNodes(layers.nodes, layers.labels, textMapsRef.current, nodesRef.current, stateRef.current, viewportRef.current.k, Math.max(0.1, Math.min(scaleX, scaleY)));
  };
  drawGraphRef.current = drawGraph;

  const clearTextMaps = () => {
    for (const map of Object.values(textMapsRef.current)) {
      for (const text of map.values()) text.destroy();
      map.clear();
    }
  };

  const pruneTextMaps = (nodeIds: Set<string>) => {
    for (const map of Object.values(textMapsRef.current)) {
      for (const [id, text] of map.entries()) {
        if (nodeIds.has(id)) continue;
        text.destroy();
        map.delete(id);
      }
    }
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
    const rect = hostRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const rawX = ((clientX - rect.left) / Math.max(rect.width, 1)) * VIEWBOX.width;
    const rawY = ((clientY - rect.top) / Math.max(rect.height, 1)) * VIEWBOX.height;
    const view = viewportRef.current;
    return { x: (rawX - view.x) / view.k, y: (rawY - view.y) / view.k };
  };

  const startPointer = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const point = graphPoint(event.clientX, event.clientY);
    const hitNode = hitTestPixiNode(nodesRef.current, point, viewportRef.current.k);
    event.currentTarget.setPointerCapture(event.pointerId);
    if (hitNode) {
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

  const movePointer = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) {
      const hitNode = hitTestPixiNode(nodesRef.current, graphPoint(event.clientX, event.clientY), viewportRef.current.k);
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
      }
      dragRef.current = { ...drag, moved: true };
      if (!fixedLayout) simulationRef.current?.alphaTarget(0.18).restart();
      scheduleDraw();
      schedulePreviewTick();
      return;
    }
    const rect = hostRef.current?.getBoundingClientRect();
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
    setViewport(nextViewport);
  };

  const endPointer = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.releasePointerCapture(event.pointerId);
    const drag = dragRef.current;
    if (drag?.kind === "node" && drag.moved) {
      const draggedNode = nodesRef.current.find((node) => node.id === drag.nodeId);
      if (draggedNode) {
        draggedNode.fx = fixedLayout ? draggedNode.x : null;
        draggedNode.fy = fixedLayout ? draggedNode.y : null;
        draggedNode.vx = 0;
        draggedNode.vy = 0;
      }
      if (!fixedLayout) simulationRef.current?.alphaTarget(paused ? 0 : 0.03).restart();
      scheduleDraw();
    }
    if (drag?.kind === "node" && !drag.moved) {
      const clickedNode = nodesRef.current.find((node) => node.id === drag.nodeId);
      if (clickedNode?.type === "libraryItem" || clickedNode?.type === "sourceSample") setPinnedPreviewNodeId(clickedNode.id);
    }
    if (drag?.kind === "pan" && !drag.moved) onSelectNode(null);
    dragRef.current = null;
  };

  const zoom = useCallback((event: globalThis.WheelEvent) => {
    event.preventDefault();
    const rect = hostRef.current?.getBoundingClientRect();
    if (!rect) return;
    const rawX = ((event.clientX - rect.left) / rect.width) * VIEWBOX.width;
    const rawY = ((event.clientY - rect.top) / rect.height) * VIEWBOX.height;
    const current = viewportRef.current;
    const nextK = clamp(current.k * Math.exp(-event.deltaY * 0.0012), 0.45, 2.8);
    const worldX = (rawX - current.x) / current.k;
    const worldY = (rawY - current.y) / current.k;
    const nextViewport = { k: nextK, x: rawX - worldX * nextK, y: rawY - worldY * nextK };
    viewportRef.current = nextViewport;
    setViewport(nextViewport);
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    host.addEventListener("wheel", zoom, { passive: false });
    return () => host.removeEventListener("wheel", zoom);
  }, [zoom]);

  const resetView = () => {
    const nextViewport = { x: 0, y: 0, k: 1 };
    viewportRef.current = nextViewport;
    setViewport(nextViewport);
    setResetToken((value) => value + 1);
  };

  return (
    <div className={`slot-graph-canvas pixi ${mode === "planTrace" ? "plan-trace" : mode}`}>
      <div className="slot-graph-canvas-title">
        <strong>{mode === "governance" ? "Semantic Governance" : mode === "planTrace" ? "确定方案溯源" : shortId(graph.artifactId)}</strong>
        <span>{mode === "governance" ? governanceSummaryText(graph) : mode === "planTrace" ? planTraceSummaryText(graph) : `${graph.summary.slotCount} slots / ${graph.summary.atomCount} atoms / ${graph.summary.bindingCount} bindings`}</span>
      </div>
      <div className="slot-graph-controls">
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
        onPointerDown={startPointer}
        onPointerMove={movePointer}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onPointerLeave={hideHoverSoon}
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
