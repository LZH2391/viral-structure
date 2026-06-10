// Deprecated: SVG graph renderer kept only as historical reference.
// Runtime graph rendering must use GraphPixiCanvas; do not add new imports to this file.
import { PointerEvent, WheelEvent, useEffect, useMemo, useRef, useState } from "react";
import type { Simulation } from "d3-force";
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
  svgScreenPoint,
  VIEWBOX,
} from "./graphUtils";
import { GraphLegend, LibraryPreviewPopover } from "./GraphSharedPanels";
import {
  edgeArrowHeadPoints,
  GraphBackground,
  GraphSvgNode,
  isSamplePreviewNode,
  nodeLabelFontSize,
  nodeLabelOpacity,
} from "./GraphSvgPrimitives";
import type { D3Link, DragState, GovernanceLayoutMode, SimNode, VisibleGraph } from "./types";
import {
  edgeClassName,
  edgeLinePoints,
} from "./graphVisualStyles";

type ViewportTransform = { x: number; y: number; k: number };

export {
  GraphLegend,
  governanceSummaryText,
  LibraryPreviewPopover,
  planTraceSummaryText,
} from "./GraphSharedPanels";

const ZOOM_ANIMATION_MS = 140;
const POINTER_DRAG_THRESHOLD_PX = 3;

export function GraphCanvas({
  active = true,
  mode = "structure",
  graph,
  visible,
  layoutMode = "force",
  selectedNodeId,
  onSelectNode,
}: {
  active?: boolean;
  mode?: "structure" | "governance" | "planTrace";
  graph: FunctionSlotLibraryGraph;
  visible: VisibleGraph;
  layoutMode?: GovernanceLayoutMode;
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const nodesRef = useRef<SimNode[]>([]);
  const dragRef = useRef<DragState | null>(null);
  const simulationRef = useRef<Simulation<SimNode, D3Link> | null>(null);
  const sampleCacheRef = useRef<Map<string, SampleArtifact | null>>(new Map());
  const hoverOutTimerRef = useRef<number | null>(null);
  const hoverSuppressUntilRef = useRef(0);
  const viewportRef = useRef({ x: 0, y: 0, k: 1 });
  const zoomAnimationFrameRef = useRef<number | null>(null);
  const zoomAnimationStartedAtRef = useRef(0);
  const zoomStartViewportRef = useRef<ViewportTransform>(viewportRef.current);
  const zoomTargetViewportRef = useRef<ViewportTransform>(viewportRef.current);
  const [nodes, setNodes] = useState<SimNode[]>([]);
  const [viewport, setViewport] = useState(viewportRef.current);
  const [svgSize, setSvgSize] = useState({ width: VIEWBOX.width, height: VIEWBOX.height });
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [pinnedPreviewNodeId, setPinnedPreviewNodeId] = useState<string | null>(null);
  const [sampleArtifacts, setSampleArtifacts] = useState<Record<string, SampleArtifact | null>>({});
  const [paused, setPaused] = useState(false);
  const [resetToken, setResetToken] = useState(0);
  const fixedLayout = layoutMode === "columns";
  const positions = new Map(nodes.map((node) => [node.id, node]));
  const focusNodeId = hoveredNodeId ?? selectedNodeId;
  const hasFocusNode = Boolean(focusNodeId);
  const focusedPath = useMemo(() => mode === "planTrace" ? reverseTracePath(focusNodeId, visible.edges) : { nodes: connectedNodeIds(focusNodeId, visible.edges), edges: new Set<string>() }, [focusNodeId, mode, visible.edges]);
  const focusedIds = focusedPath.nodes;
  const focusedEdgeIds = focusedPath.edges;
  const previewNodeId = pinnedPreviewNodeId ?? hoveredNodeId;
  const previewNode = useMemo(() => {
    const node = previewNodeId ? nodes.find((entry) => entry.id === previewNodeId) ?? null : null;
    return node?.type === "libraryItem" || node?.type === "sourceSample" ? node : null;
  }, [nodes, previewNodeId]);
  const previewSampleId = typeof previewNode?.data.sampleVideoId === "string" ? previewNode.data.sampleVideoId : null;
  const previewSampleArtifact = previewSampleId ? sampleArtifacts[previewSampleId] ?? sampleCacheRef.current.get(previewSampleId) ?? null : null;
  const previewSize = previewPopoverSize(previewSampleArtifact);
  const previewPosition = previewNode ? clampPreviewPosition(svgScreenPoint(svgRef.current, previewNode, viewport), svgSize, previewSize) : null;

  const showHover = (nodeId: string | null) => {
    if (Date.now() < hoverSuppressUntilRef.current) return;
    if (hoverOutTimerRef.current) window.clearTimeout(hoverOutTimerRef.current);
    hoverOutTimerRef.current = null;
    setHoveredNodeId(nodeId);
  };
  const hideHoverSoon = (nodeId: string | null = hoveredNodeId) => {
    if (hoverOutTimerRef.current) window.clearTimeout(hoverOutTimerRef.current);
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

  const stopZoomAnimation = () => {
    if (!zoomAnimationFrameRef.current) return;
    window.cancelAnimationFrame(zoomAnimationFrameRef.current);
    zoomAnimationFrameRef.current = null;
  };

  const applyAnimatedViewport = (nextViewport: ViewportTransform) => {
    viewportRef.current = nextViewport;
    setViewport(nextViewport);
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

  useEffect(() => {
    if (!active) {
      simulationRef.current?.stop();
      stopZoomAnimation();
      if (hoverOutTimerRef.current) window.clearTimeout(hoverOutTimerRef.current);
      return;
    }
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
    simulationRef.current?.stop();
    simulationRef.current = createGraphSimulation(nextNodes, nextLinks)
      .on("tick", () => {
        nextNodes.forEach(constrainNodeToLayoutSector);
        nodesRef.current = nextNodes;
        setNodes(nextNodes.map((node) => ({ ...node })));
      });
    if (fixedLayout) simulationRef.current.stop();
    setNodes(nextNodes);
    return () => {
      simulationRef.current?.stop();
      simulationRef.current = null;
      stopZoomAnimation();
      if (hoverOutTimerRef.current) window.clearTimeout(hoverOutTimerRef.current);
    };
  }, [active, fixedLayout, resetToken, visible.edges, visible.nodes]);

  useEffect(() => {
    if (!active || fixedLayout || paused) simulationRef.current?.stop();
    else simulationRef.current?.alphaTarget(0.03).restart();
  }, [active, fixedLayout, paused]);

  useEffect(() => {
    if (!active) return undefined;
    const svg = svgRef.current;
    if (!svg) return undefined;
    const updateSize = () => {
      const rect = svg.getBoundingClientRect();
      setSvgSize({ width: rect.width || VIEWBOX.width, height: rect.height || VIEWBOX.height });
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(svg);
    return () => observer.disconnect();
  }, [active]);

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

  const graphPoint = (clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const rawX = ((clientX - rect.left) / rect.width) * VIEWBOX.width;
    const rawY = ((clientY - rect.top) / rect.height) * VIEWBOX.height;
    const view = viewportRef.current;
    return {
      x: (rawX - view.x) / view.k,
      y: (rawY - view.y) / view.k,
    };
  };

  const startNodeDrag = (event: PointerEvent<SVGGElement>, node: SimNode) => {
    event.stopPropagation();
    const point = graphPoint(event.clientX, event.clientY);
    dragRef.current = {
      kind: "node",
      nodeId: node.id,
      dx: node.x - point.x,
      dy: node.y - point.y,
      clientX: event.clientX,
      clientY: event.clientY,
      selectFocusDepth: 0,
      moved: false,
    };
    svgRef.current?.setPointerCapture(event.pointerId);
  };

  const startPan = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    closePreview();
    dragRef.current = {
      kind: "pan",
      clientX: event.clientX,
      clientY: event.clientY,
      startX: viewportRef.current.x,
      startY: viewportRef.current.y,
      moved: false,
    };
    svgRef.current?.setPointerCapture(event.pointerId);
  };

  const movePointer = (event: PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
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
      }
      dragRef.current = { ...drag, moved };
      if (active && !fixedLayout) simulationRef.current?.alphaTarget(0.18).restart();
      setNodes(nodesRef.current.map((node) => ({ ...node })));
      return;
    }
    const rect = svgRef.current?.getBoundingClientRect();
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

  const endPointer = (event: PointerEvent<SVGSVGElement>) => {
    svgRef.current?.releasePointerCapture(event.pointerId);
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
      if (active && !fixedLayout) simulationRef.current?.alphaTarget(paused ? 0 : 0.03).restart();
      setNodes(nodesRef.current.map((node) => ({ ...node })));
    }
    if (drag?.kind === "node" && !drag.moved) {
      const clickedNode = nodesRef.current.find((node) => node.id === drag.nodeId);
      onSelectNode(drag.nodeId);
      if (clickedNode?.type === "libraryItem" || clickedNode?.type === "sourceSample") setPinnedPreviewNodeId(clickedNode.id);
    }
    if (drag?.kind === "pan" && !drag.moved) onSelectNode(null);
    dragRef.current = null;
  };

  const zoom = (event: WheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const rawX = ((event.clientX - rect.left) / rect.width) * VIEWBOX.width;
    const rawY = ((event.clientY - rect.top) / rect.height) * VIEWBOX.height;
    const current = viewportRef.current;
    const nextK = clamp(current.k * Math.exp(-event.deltaY * 0.0012), 0.45, 5);
    const worldX = (rawX - current.x) / current.k;
    const worldY = (rawY - current.y) / current.k;
    const nextViewport = {
      k: nextK,
      x: rawX - worldX * nextK,
      y: rawY - worldY * nextK,
    };
    viewportRef.current = nextViewport;
    setViewport(nextViewport);
  };

  const resetView = () => {
    const nextViewport = { x: 0, y: 0, k: 1 };
    viewportRef.current = nextViewport;
    setViewport(nextViewport);
    setResetToken((value) => value + 1);
  };

  return (
    <div className={`slot-graph-canvas ${mode === "planTrace" ? "plan-trace" : mode}`}>
      <div className="slot-graph-canvas-title">
        <strong>{mode === "governance" ? "语义治理库" : mode === "planTrace" ? "确定方案溯源" : shortId(graph.artifactId)}</strong>
      </div>
      <div className="slot-graph-controls">
        <button type="button" onClick={resetView}>重置</button>
        <button type="button" onClick={() => setPaused((value) => !value)}>{paused ? "继续" : "暂停"}</button>
      </div>
      <GraphLegend mode={mode} />
      <div className="slot-graph-zoom-chip">{Math.round(viewport.k * 100)}%</div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEWBOX.width} ${VIEWBOX.height}`}
        role="img"
        aria-label="FunctionSlotLibrary 结构图谱"
        onPointerDown={startPan}
        onPointerMove={movePointer}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onWheel={zoom}
      >
        <GraphBackground />
        <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.k})`}>
          {visible.edges.map((edge) => {
            const source = positions.get(edge.source);
            const target = positions.get(edge.target);
            if (!source || !target) return null;
            const focused = focusNodeId ? (mode === "planTrace" ? focusedEdgeIds.has(edge.id) : edge.source === focusNodeId || edge.target === focusNodeId) : false;
            const muted = focusNodeId ? !focused : false;
            const line = edgeLinePoints(edge.type, source, target);
            const className = edgeClassName(edge.type, source, target, focused, muted);
            const arrowPoints = edgeArrowHeadPoints(edge.type, source, target, line);
            return (
              <g key={edge.id}>
                <line className={className} x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} />
                {arrowPoints ? <path className={className} d={arrowPoints} /> : null}
              </g>
            );
          })}
          {nodes.map((node) => (
            (() => {
              const nodeFocused = hasFocusNode && (node.id === focusNodeId || focusedIds.has(node.id));
              return (
            <GraphSvgNode
              key={node.id}
              node={node}
              focused={nodeFocused}
              focusMuted={hasFocusNode && !nodeFocused}
              selected={node.id === selectedNodeId}
              pinnedPreview={node.id === pinnedPreviewNodeId}
              labelOpacity={nodeLabelOpacity(mode, node, viewport.k)}
              labelFontSize={nodeLabelFontSize(mode, node)}
              onHover={showHover}
              onHoverOut={hideHoverSoon}
              onStartDrag={startNodeDrag}
            />
              );
            })()
          ))}
        </g>
      </svg>
      {previewNode && previewPosition ? (
        <LibraryPreviewPopover
          node={previewNode}
          sampleArtifact={previewSampleArtifact}
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
