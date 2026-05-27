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
  createGraphSimulation,
  nodeRadius,
  previewPopoverSize,
  svgScreenPoint,
  VIEWBOX,
} from "./graphUtils";
import type { D3Link, DragState, SimNode, VisibleGraph } from "./types";

export function GraphCanvas({
  graph,
  visible,
  selectedNodeId,
  onSelectNode,
}: {
  graph: FunctionSlotLibraryGraph;
  visible: VisibleGraph;
  selectedNodeId: string | null;
  onSelectNode: (id: string) => void;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const nodesRef = useRef<SimNode[]>([]);
  const dragRef = useRef<DragState | null>(null);
  const simulationRef = useRef<Simulation<SimNode, D3Link> | null>(null);
  const sampleCacheRef = useRef<Map<string, SampleArtifact | null>>(new Map());
  const hoverOutTimerRef = useRef<number | null>(null);
  const hoverSuppressUntilRef = useRef(0);
  const viewportRef = useRef({ x: 0, y: 0, k: 1 });
  const [nodes, setNodes] = useState<SimNode[]>([]);
  const [viewport, setViewport] = useState(viewportRef.current);
  const [svgSize, setSvgSize] = useState({ width: VIEWBOX.width, height: VIEWBOX.height });
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [pinnedPreviewNodeId, setPinnedPreviewNodeId] = useState<string | null>(null);
  const [sampleArtifacts, setSampleArtifacts] = useState<Record<string, SampleArtifact | null>>({});
  const [paused, setPaused] = useState(false);
  const [resetToken, setResetToken] = useState(0);
  const positions = new Map(nodes.map((node) => [node.id, node]));
  const focusNodeId = hoveredNodeId ?? selectedNodeId;
  const focusedIds = useMemo(() => connectedNodeIds(focusNodeId, visible.edges), [focusNodeId, visible.edges]);
  const previewNodeId = pinnedPreviewNodeId ?? hoveredNodeId;
  const previewNode = useMemo(() => {
    const node = previewNodeId ? nodes.find((entry) => entry.id === previewNodeId) ?? null : null;
    return node?.type === "libraryItem" ? node : null;
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

  useEffect(() => {
    const previous = new Map(nodesRef.current.map((node) => [node.id, node]));
    const nextNodes: SimNode[] = visible.nodes.map((node) => {
      const existing = resetToken ? null : previous.get(node.id);
      return {
        ...node,
        x: existing?.x ?? node.x,
        y: existing?.y ?? node.y,
        vx: existing?.vx ?? 0,
        vy: existing?.vy ?? 0,
        fx: null,
        fy: null,
      };
    });
    const nextLinks: D3Link[] = visible.edges.map((edge) => ({ ...edge, source: edge.source, target: edge.target }));
    nodesRef.current = nextNodes;
    simulationRef.current?.stop();
    simulationRef.current = createGraphSimulation(nextNodes, nextLinks)
      .on("tick", () => {
        nodesRef.current = nextNodes;
        setNodes(nextNodes.map((node) => ({ ...node })));
      });
    setNodes(nextNodes);
    return () => {
      simulationRef.current?.stop();
      simulationRef.current = null;
      if (hoverOutTimerRef.current) window.clearTimeout(hoverOutTimerRef.current);
    };
  }, [resetToken, visible.edges, visible.nodes]);

  useEffect(() => {
    if (paused) simulationRef.current?.stop();
    else simulationRef.current?.alphaTarget(0.03).restart();
  }, [paused]);

  useEffect(() => {
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
  }, []);

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
    dragRef.current = { kind: "node", nodeId: node.id, dx: node.x - point.x, dy: node.y - point.y, moved: false };
    svgRef.current?.setPointerCapture(event.pointerId);
    onSelectNode(node.id);
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
    };
    svgRef.current?.setPointerCapture(event.pointerId);
  };

  const movePointer = (event: PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
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
      simulationRef.current?.alphaTarget(0.18).restart();
      setNodes(nodesRef.current.map((node) => ({ ...node })));
      return;
    }
    const nextViewport = {
      ...viewportRef.current,
      x: drag.startX + event.clientX - drag.clientX,
      y: drag.startY + event.clientY - drag.clientY,
    };
    viewportRef.current = nextViewport;
    setViewport(nextViewport);
  };

  const endPointer = (event: PointerEvent<SVGSVGElement>) => {
    svgRef.current?.releasePointerCapture(event.pointerId);
    const drag = dragRef.current;
    if (drag?.kind === "node" && drag.moved) {
      const draggedNode = nodesRef.current.find((node) => node.id === drag.nodeId);
      if (draggedNode) {
        draggedNode.fx = null;
        draggedNode.fy = null;
        draggedNode.vx = 0;
        draggedNode.vy = 0;
      }
      simulationRef.current?.alphaTarget(paused ? 0 : 0.03).restart();
      setNodes(nodesRef.current.map((node) => ({ ...node })));
    }
    if (drag?.kind === "node" && !drag.moved) {
      const clickedNode = nodesRef.current.find((node) => node.id === drag.nodeId);
      if (clickedNode?.type === "libraryItem") setPinnedPreviewNodeId(clickedNode.id);
    }
    dragRef.current = null;
  };

  const zoom = (event: WheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const rawX = ((event.clientX - rect.left) / rect.width) * VIEWBOX.width;
    const rawY = ((event.clientY - rect.top) / rect.height) * VIEWBOX.height;
    const current = viewportRef.current;
    const nextK = clamp(current.k * Math.exp(-event.deltaY * 0.0012), 0.45, 2.8);
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
    <div className="slot-graph-canvas">
      <div className="slot-graph-canvas-title">
        <strong>{shortId(graph.artifactId)}</strong>
        <span>{graph.summary.slotCount} slots / {graph.summary.atomCount} atoms / {graph.summary.bindingCount} bindings</span>
      </div>
      <div className="slot-graph-controls">
        <button type="button" onClick={resetView}>重置</button>
        <button type="button" onClick={() => setPaused((value) => !value)}>{paused ? "继续" : "暂停"}</button>
      </div>
      <GraphLegend />
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
            const focused = focusNodeId ? edge.source === focusNodeId || edge.target === focusNodeId : false;
            const muted = focusNodeId ? !focused : false;
            return <line key={edge.id} className={`slot-graph-edge edge-${edge.type} ${focused ? "focused" : ""} ${muted ? "muted" : ""}`} x1={source.x} y1={source.y} x2={target.x} y2={target.y} />;
          })}
          {nodes.map((node) => (
            <GraphNode
              key={node.id}
              node={node}
              focused={!focusNodeId || node.id === focusNodeId || focusedIds.has(node.id)}
              selected={node.id === selectedNodeId}
              pinnedPreview={node.id === pinnedPreviewNodeId}
              onHover={showHover}
              onHoverOut={hideHoverSoon}
              onStartDrag={startNodeDrag}
            />
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
          onMouseLeave={hideHoverSoon}
          onClose={closePreview}
        />
      ) : null}
    </div>
  );
}

function GraphNode({ node, focused, selected, pinnedPreview, onHover, onHoverOut, onStartDrag }: { node: SimNode; focused: boolean; selected: boolean; pinnedPreview: boolean; onHover: (id: string) => void; onHoverOut: () => void; onStartDrag: (event: PointerEvent<SVGGElement>, node: SimNode) => void }) {
  const radius = nodeRadius(node);
  return (
    <g
      className={`slot-graph-node node-${node.group} ${focused ? "" : "muted"} ${selected ? "selected" : ""} ${pinnedPreview ? "preview-pinned" : ""}`}
      onPointerDown={(event) => onStartDrag(event, node)}
      onPointerEnter={() => onHover(node.id)}
      onPointerLeave={onHoverOut}
      tabIndex={0}
      role="button"
      aria-label={node.label}
    >
      <circle cx={node.x} cy={node.y} r={radius} />
      <text x={node.x} y={node.y + radius + 18}>{node.shortLabel}</text>
      <title>{node.label}</title>
    </g>
  );
}

function LibraryPreviewPopover({
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

function GraphLegend() {
  return (
    <div className="slot-graph-legend">
      <span><i className="legend-library" />Library</span>
      <span><i className="legend-slot" />Slot</span>
      <span><i className="legend-script" />Script</span>
      <span><i className="legend-rhythm" />Rhythm</span>
      <span><i className="legend-packaging" />Packaging</span>
    </div>
  );
}

function GraphBackground() {
  const dots = Array.from({ length: 70 }, (_, index) => ({
    x: 50 + ((index * 157) % 1160),
    y: 38 + ((index * 89) % 742),
    r: 2 + (index % 4),
  }));
  return (
    <g className="slot-graph-bg">
      {dots.map((dot, index) => <circle key={index} cx={dot.x} cy={dot.y} r={dot.r} />)}
    </g>
  );
}
