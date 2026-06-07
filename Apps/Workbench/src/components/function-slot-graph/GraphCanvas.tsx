// Deprecated: SVG graph renderer kept only as historical reference.
// Runtime graph rendering must use GraphPixiCanvas; do not add new imports to this file.
import { PointerEvent, WheelEvent, type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import type { Simulation } from "d3-force";
import { getSampleArtifact, runtimeUrl } from "../../api/client";
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
  svgScreenPoint,
  VIEWBOX,
} from "./graphUtils";
import type { D3Link, DragState, GovernanceLayoutMode, SimNode, VisibleGraph } from "./types";
import {
  edgeClassName,
  edgeLinePoints,
  isSlotSequenceNode,
  nodeClassName,
  nodeLabelFontSize,
  nodeLabelOpacity,
  slotOrderBadge,
} from "./graphVisualStyles";

type ViewportTransform = { x: number; y: number; k: number };

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
        {mode !== "governance" ? <span>{mode === "planTrace" ? planTraceSummaryText(graph) : `${graph.summary.slotCount} slots / ${graph.summary.atomCount} atoms / ${graph.summary.bindingCount} bindings`}</span> : null}
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
            <GraphNode
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

function GraphNode({ node, focused, focusMuted, selected, pinnedPreview, labelOpacity, labelFontSize, onHover, onHoverOut, onStartDrag }: { node: SimNode; focused: boolean; focusMuted: boolean; selected: boolean; pinnedPreview: boolean; labelOpacity: number; labelFontSize: number; onHover: (id: string) => void; onHoverOut: (id: string) => void; onStartDrag: (event: PointerEvent<SVGGElement>, node: SimNode) => void }) {
  const radius = nodeRadius(node);
  const overlayColors = Array.isArray(node.data.overlayColors) ? node.data.overlayColors.filter((value): value is string => typeof value === "string") : [];
  const overlayUsageCount = Number(node.data.overlayUsageCount ?? overlayColors.length);
  const slotBadge = slotOrderBadge(node);
  return (
    <g
      className={nodeClassName(node, focused, selected, pinnedPreview, focusMuted)}
      onPointerDown={(event) => onStartDrag(event, node)}
      onPointerEnter={() => onHover(node.id)}
      onPointerLeave={() => onHoverOut(node.id)}
      tabIndex={0}
      role="button"
      aria-label={node.label}
    >
      {node.type === "confirmedPlan" || node.type === "governanceRoot" || node.type === "sourceSample" ? <circle className="slot-graph-plan-ring" cx={node.x} cy={node.y} r={radius + 7} /> : null}
      <circle cx={node.x} cy={node.y} r={radius} />
      {slotBadge ? (
        <g className="slot-graph-slot-badge">
          <circle cx={node.x - radius + 2} cy={node.y - radius + 2} r={8} />
          <text x={node.x - radius + 2} y={node.y - radius + 5}>{slotBadge}</text>
        </g>
      ) : null}
      {overlayColors.length ? (
        <g className="slot-graph-plan-badge">
          <circle cx={node.x + radius - 1} cy={node.y - radius + 1} r={7} style={{ fill: overlayColors[0] }} />
          <text x={node.x + radius - 1} y={node.y - radius + 4}>{overlayUsageCount > 1 ? overlayUsageCount : ""}</text>
        </g>
      ) : null}
      {labelOpacity > 0.01 ? <text x={node.x} y={node.y + radius + 14} style={{ opacity: labelOpacity, fontSize: labelFontSize }}>{node.shortLabel}</text> : null}
      <title>{node.label}</title>
    </g>
  );
}

function isSamplePreviewNode(node: SimNode | null) {
  return node?.type === "sourceSample" || node?.type === "libraryItem";
}

function edgeArrowHeadPoints(type: string, source: SimNode, target: SimNode, line: { x1: number; y1: number; x2: number; y2: number }) {
  if ((type !== "slot_next" && type !== "plan_slot_next") || !isSlotSequenceNode(source) || !isSlotSequenceNode(target)) return null;
  const dx = line.x2 - line.x1;
  const dy = line.y2 - line.y1;
  const angle = Math.atan2(dy, dx);
  const size = 8;
  const left = angle + Math.PI * 0.82;
  const right = angle - Math.PI * 0.82;
  const leftX = line.x2 + Math.cos(left) * size;
  const leftY = line.y2 + Math.sin(left) * size;
  const rightX = line.x2 + Math.cos(right) * size;
  const rightY = line.y2 + Math.sin(right) * size;
  return `M ${leftX} ${leftY} L ${line.x2} ${line.y2} L ${rightX} ${rightY}`;
}

export function LibraryPreviewPopover({
  node,
  sampleArtifact,
  position,
  size,
  pinned,
  onMouseEnter,
  onMouseLeave,
  onClose,
}: {
  node: SimNode;
  sampleArtifact: SampleArtifact | null;
  position: { left: number; top: number };
  size: { width: number; mediaHeight: number; totalHeight: number };
  pinned: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onClose: () => void;
}) {
  const sampleVideoId = typeof node.data.sampleVideoId === "string" ? node.data.sampleVideoId : null;
  const videoUrl = runtimeUrl(sampleArtifact?.sampleVideo.normalized.uri ?? sampleArtifact?.sampleVideo.original.uri ?? null);
  const fileName = sampleArtifact?.sampleVideoId ?? sampleVideoId ?? "源视频";
  return (
    <div
      className={`slot-graph-preview-popover ${pinned ? "pinned" : ""}`}
      style={{ left: position.left, top: position.top, "--preview-width": `${size.width}px`, "--preview-media-height": `${size.mediaHeight}px` } as CSSProperties}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="slot-graph-preview-head">
        <strong>{shortId(sampleVideoId ?? "")}</strong>
        <span>{pinned ? "已固定" : "源视频"}</span>
        {pinned ? <button type="button" aria-label="关闭预览" onClick={onClose}>x</button> : null}
      </div>
      {videoUrl ? (
        <video src={videoUrl} controls playsInline preload="metadata" />
      ) : (
        <div className="slot-graph-preview-empty">加载源视频</div>
      )}
      <div className="slot-graph-preview-meta">
        <span title={fileName}>{fileName}</span>
        <small>artifact {shortId(String(node.data.artifactId ?? ""))}</small>
      </div>
    </div>
  );
}

export function GraphLegend({ mode }: { mode: "structure" | "governance" | "planTrace" }) {
  if (mode === "governance") {
    return (
      <div className="slot-graph-legend">
        <span><i className="legend-slot" />Slot governance</span>
        <span><i className="legend-script" />Script atom</span>
        <span><i className="legend-rhythm" />Rhythm atom</span>
        <span><i className="legend-packaging" />Packaging atom</span>
        <span><i className="legend-binding" />Binding</span>
        <span><i className="legend-rule" />Rule / Policy</span>
        <span><i className="legend-unmapped" />Unmapped evidence</span>
      </div>
    );
  }
  if (mode === "planTrace") {
    return (
      <div className="slot-graph-legend">
        <span><i className="legend-plan" />Confirmed plan</span>
        <span><i className="legend-subtype" />Subtype</span>
        <span><i className="legend-source-variant" />SourceVariantAtom</span>
        <span><i className="legend-source-sample" />SourceSample</span>
      </div>
    );
  }
  return (
      <div className="slot-graph-legend">
      <span><i className="legend-library" />SourceSample</span>
      <span><i className="legend-slot" />Slot</span>
      <span><i className="legend-script" />Script</span>
      <span><i className="legend-rhythm" />Rhythm</span>
      <span><i className="legend-packaging" />Packaging</span>
    </div>
  );
}

export function governanceSummaryText(graph: FunctionSlotLibraryGraph) {
  return `${graph.summary.sampleCount ?? 0} 个样例 / ${graph.summary.slotCount} 个槽位变体`;
}

export function planTraceSummaryText(graph: FunctionSlotLibraryGraph) {
  return `${graph.summary.planCount ?? 0} plans / ${graph.summary.slotCount ?? 0} slots / ${graph.summary.atomCount ?? 0} atoms`;
}

function GraphBackground() {
  const dots = Array.from({ length: 110 }, (_, index) => ({
    x: 50 + ((index * 157) % (VIEWBOX.width - 100)),
    y: 38 + ((index * 89) % (VIEWBOX.height - 76)),
    r: 2 + (index % 4),
  }));
  return (
    <g className="slot-graph-bg">
      {dots.map((dot, index) => <circle key={index} cx={dot.x} cy={dot.y} r={dot.r} />)}
    </g>
  );
}
