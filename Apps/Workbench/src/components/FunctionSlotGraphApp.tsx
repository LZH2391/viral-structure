import { PointerEvent, WheelEvent, type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from "d3-force";
import type { Simulation, SimulationLinkDatum, SimulationNodeDatum } from "d3-force";
import { getFunctionSlotLibraryGraph, getFunctionSlotLibraryItems, getSampleArtifact, runtimeUrl } from "../api/client";
import type { SampleArtifact } from "../types/artifact";
import type { FunctionSlotGraphEdge, FunctionSlotGraphNode, FunctionSlotLibraryGraph } from "../types/library";
import { shortId } from "../utils/format";

type LibraryGraphSummary = {
  artifactId: string;
  sampleVideoId?: string | null;
  traceId?: string | null;
  counts?: Record<string, number>;
};

const VIEWBOX = { width: 1280, height: 820 };
const CENTER = { x: 600, y: 410 };

export function FunctionSlotGraphApp() {
  const [items, setItems] = useState<LibraryGraphSummary[]>([]);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [graph, setGraph] = useState<FunctionSlotLibraryGraph | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [status, setStatus] = useState("读取结构图谱");
  const [filters, setFilters] = useState({
    slot: true,
    atom: true,
    binding: true,
  });

  const refresh = useCallback(async () => {
    setStatus("刷新中");
    const data = await getFunctionSlotLibraryItems();
    const nextItems = data.items ?? [];
    setItems(nextItems);
    setSelectedArtifactId((current) => (current && nextItems.some((item) => item.artifactId === current) ? current : nextItems[0]?.artifactId ?? null));
    setStatus("已同步");
  }, []);

  useEffect(() => {
    refresh().catch((error) => setStatus(error instanceof Error ? error.message : "读取失败"));
  }, [refresh]);

  useEffect(() => {
    if (!selectedArtifactId) {
      setGraph(null);
      return;
    }
    setStatus("读取图谱");
    getFunctionSlotLibraryGraph(selectedArtifactId)
      .then((nextGraph) => {
        setGraph(nextGraph);
        setSelectedNodeId(nextGraph.nodes.find((node) => node.type === "libraryItem")?.id ?? nextGraph.nodes[0]?.id ?? null);
        setStatus("已同步");
      })
      .catch((error) => setStatus(error instanceof Error ? error.message : "读取图谱失败"));
  }, [selectedArtifactId]);

  const visible = useMemo(() => buildVisibleGraph(graph, filters), [filters, graph]);
  const selectedNode = useMemo(() => visible.nodes.find((node) => node.id === selectedNodeId) ?? graph?.nodes.find((node) => node.id === selectedNodeId) ?? null, [graph, selectedNodeId, visible.nodes]);

  return (
    <div className="slot-graph-shell">
      <header className="topbar">
        <div className="project-block">
          <div className="project-name">结构图谱</div>
          <div className="save-status">{status}</div>
        </div>
        <div className="run-strip">
          <span className="run-pill">{items.length} library items</span>
          <span className="trace-label">FunctionSlotLibrary</span>
        </div>
        <div className="top-actions">
          <button className="tab-button" type="button" onClick={() => window.location.assign("/")}>
            工作台
          </button>
          <button className="tab-button" type="button" onClick={() => window.location.assign("/full-analysis")}>
            完整分析
          </button>
          <button className="tab-button" type="button" onClick={() => window.location.assign("/library")}>
            处理库
          </button>
          <button className="tab-button active" type="button">
            结构图谱
          </button>
          <button className="tab-button" type="button" onClick={() => window.location.assign("/threadpool")}>
            ThreadPool
          </button>
          <button className="primary-button" type="button" onClick={() => refresh().catch(() => undefined)}>
            刷新
          </button>
        </div>
      </header>
      <main className="slot-graph-layout">
        <aside className="slot-graph-list">
          <div className="section-heading">图谱来源</div>
          <div className="compact-list">
            {items.length ? items.map((item) => (
              <button key={item.artifactId} type="button" className={`library-item ${selectedArtifactId === item.artifactId ? "active" : ""}`} onClick={() => setSelectedArtifactId(item.artifactId)}>
                <strong>{shortId(item.artifactId)}</strong>
                <span>sample {shortId(item.sampleVideoId ?? "")}</span>
                <small>{item.counts?.slotCount ?? 0} slots / {item.counts?.atomCount ?? 0} atoms / trace {shortId(item.traceId ?? "")}</small>
              </button>
            )) : <EmptyState text="暂无 FunctionSlotLibrary" />}
          </div>
        </aside>
        <section className="slot-graph-stage">
          {graph ? <GraphCanvas graph={graph} visible={visible} selectedNodeId={selectedNodeId} onSelectNode={setSelectedNodeId} /> : <EmptyState text="选择左侧素材查看图谱" />}
        </section>
        <aside className="slot-graph-panel">
          <GraphFilters filters={filters} onChange={setFilters} />
          <NodeInspector node={selectedNode} graph={graph} />
        </aside>
      </main>
    </div>
  );
}

function GraphCanvas({
  graph,
  visible,
  selectedNodeId,
  onSelectNode,
}: {
  graph: FunctionSlotLibraryGraph;
  visible: { nodes: PositionedNode[]; edges: FunctionSlotGraphEdge[] };
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

function nodeRadius(node: Pick<FunctionSlotGraphNode, "type">) {
  if (node.type === "libraryItem") return 20;
  if (node.type === "slotInstance") return 13;
  if (node.type === "slotConcept") return 11;
  if (node.type === "binding") return 6;
  return 7;
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

function GraphFilters({ filters, onChange }: { filters: { slot: boolean; atom: boolean; binding: boolean }; onChange: (filters: { slot: boolean; atom: boolean; binding: boolean }) => void }) {
  const update = (key: keyof typeof filters) => onChange({ ...filters, [key]: !filters[key] });
  return (
    <section className="slot-graph-card">
      <div className="section-heading">筛选</div>
      <label><input type="checkbox" checked={filters.slot} onChange={() => update("slot")} /> SlotInstance</label>
      <label><input type="checkbox" checked={filters.atom} onChange={() => update("atom")} /> AtomInstance</label>
      <label><input type="checkbox" checked={filters.binding} onChange={() => update("binding")} /> Binding</label>
    </section>
  );
}

function NodeInspector({ node, graph }: { node: FunctionSlotGraphNode | null; graph: FunctionSlotLibraryGraph | null }) {
  if (!node) return <section className="slot-graph-card"><EmptyState text="选择节点查看详情" /></section>;
  const rows = nodeDetailRows(node);
  return (
    <section className="slot-graph-card slot-graph-inspector">
      <div className="section-heading">当前选中</div>
      <strong>{node.label}</strong>
      <span>{node.type} / {node.group}</span>
      {graph ? <small>artifact {shortId(graph.artifactId)}</small> : null}
      <div className="slot-graph-detail-rows">
        {rows.map(([label, value]) => <DetailRow key={label} label={label} value={value} />)}
      </div>
    </section>
  );
}

function DetailRow({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <b>{label}</b>
      <span>{formatDetailValue(value)}</span>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="empty-state">
      <strong>{text}</strong>
      <span>先导出 FunctionSlotLibrary 后刷新</span>
    </div>
  );
}

type PositionedNode = FunctionSlotGraphNode & { x: number; y: number; shortLabel: string };
type SimNode = PositionedNode & SimulationNodeDatum & { x: number; y: number; vx: number; vy: number; fx: number | null; fy: number | null };
type D3Link = Omit<FunctionSlotGraphEdge, "source" | "target"> & SimulationLinkDatum<SimNode> & { source: string | SimNode; target: string | SimNode };
type DragState =
  | { kind: "node"; nodeId: string; dx: number; dy: number; moved: boolean }
  | { kind: "pan"; clientX: number; clientY: number; startX: number; startY: number };

function buildVisibleGraph(graph: FunctionSlotLibraryGraph | null, filters: { slot: boolean; atom: boolean; binding: boolean }) {
  if (!graph) return { nodes: [], edges: [] };
  const positions = buildPositions(graph);
  const nodes = graph.nodes.filter((node) => {
    if (node.type === "slotInstance") return filters.slot;
    if (node.type === "atomInstance") return filters.atom;
    if (node.type === "binding") return filters.binding;
    if (node.type === "slotConcept") return false;
    return true;
  }).map((node) => ({ ...node, ...positions.get(node.id), shortLabel: shortLabel(node) })).filter((node): node is PositionedNode => Number.isFinite(node.x) && Number.isFinite(node.y));
  const nodeIds = new Set(nodes.map((node) => node.id));
  return {
    nodes,
    edges: graph.edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target)),
  };
}

function buildPositions(graph: FunctionSlotLibraryGraph) {
  const positions = new Map<string, { x: number; y: number }>();
  const root = graph.nodes.find((node) => node.type === "libraryItem");
  if (root) positions.set(root.id, CENTER);

  const slots = graph.nodes.filter((node) => node.type === "slotInstance").sort((left, right) => Number(left.data.slotOrder ?? 0) - Number(right.data.slotOrder ?? 0));
  const slotRadius = 210;
  slots.forEach((slot, index) => {
    const angle = -Math.PI / 2 + (index / Math.max(slots.length, 1)) * Math.PI * 2;
    const x = CENTER.x + Math.cos(angle) * slotRadius;
    const y = CENTER.y + Math.sin(angle) * slotRadius;
    positions.set(slot.id, { x, y });
    const atoms = graph.nodes.filter((node) => node.type === "atomInstance" && node.data.slotId === slot.data.slotId);
    atoms.forEach((atom, atomIndex) => {
      const atomAngle = angle + (atomIndex - 1) * 0.34;
      positions.set(atom.id, {
        x: CENTER.x + Math.cos(atomAngle) * 300,
        y: CENTER.y + Math.sin(atomAngle) * 300,
      });
    });
  });

  const bindings = graph.nodes.filter((node) => node.type === "binding");
  bindings.forEach((binding, index) => {
    const angle = -Math.PI / 2 + (index / Math.max(bindings.length, 1)) * Math.PI * 2 + 0.18;
    positions.set(binding.id, {
      x: CENTER.x + Math.cos(angle) * 105,
      y: CENTER.y + Math.sin(angle) * 105,
    });
  });

  const concepts = graph.nodes.filter((node) => node.type === "slotConcept");
  concepts.forEach((concept, index) => {
    const angle = Math.PI + (index / Math.max(concepts.length, 1)) * Math.PI * 0.8;
    positions.set(concept.id, {
      x: CENTER.x + Math.cos(angle) * 430,
      y: CENTER.y + Math.sin(angle) * 270,
    });
  });
  return positions;
}

function createGraphSimulation(nodes: SimNode[], links: D3Link[]) {
  return forceSimulation<SimNode>(nodes)
    .alpha(0.85)
    .alphaDecay(0.018)
    .velocityDecay(0.36)
    .force("center", forceCenter(CENTER.x, CENTER.y).strength(0.055))
    .force("x", forceX(CENTER.x).strength(0.006))
    .force("y", forceY(CENTER.y).strength(0.006))
    .force("charge", forceManyBody<SimNode>().strength((node) => (node.type === "libraryItem" ? -120 : node.type === "slotInstance" ? -170 : -90)).distanceMin(30).distanceMax(620))
    .force("collide", forceCollide<SimNode>().radius((node) => nodeRadius(node) + 30).strength(0.72).iterations(2))
    .force("link", forceLink<SimNode, D3Link>(links)
      .id((node) => node.id)
      .distance((edge) => edgeDistance(edge.type)));
}

function connectedNodeIds(nodeId: string | null, edges: FunctionSlotGraphEdge[]) {
  const ids = new Set<string>();
  if (!nodeId) return ids;
  ids.add(nodeId);
  for (const edge of edges) {
    if (edge.source === nodeId) ids.add(edge.target);
    if (edge.target === nodeId) ids.add(edge.source);
  }
  return ids;
}

function edgeDistance(type: string) {
  if (type === "slot_next") return 180;
  if (type === "library_contains_slot") return 250;
  if (type === "library_contains_binding") return 175;
  if (type.startsWith("binding_")) return 145;
  return 165;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function svgScreenPoint(svg: SVGSVGElement | null, node: SimNode, viewport: { x: number; y: number; k: number }) {
  if (!svg) return { x: node.x, y: node.y };
  const rect = svg.getBoundingClientRect();
  const point = svg.createSVGPoint();
  point.x = node.x * viewport.k + viewport.x;
  point.y = node.y * viewport.k + viewport.y;
  const transformed = point.matrixTransform(svg.getScreenCTM() ?? undefined);
  return {
    x: transformed.x - rect.left,
    y: transformed.y - rect.top,
  };
}

function previewPopoverSize(sampleArtifact: SampleArtifact | null) {
  const metadata = sampleArtifact?.metadata;
  const width = positiveNumber(metadata?.width) ?? 16;
  const height = positiveNumber(metadata?.height) ?? 9;
  const aspectRatio = clamp(width / height, 0.45, 2.1);
  const popoverWidth = aspectRatio < 0.9 ? 184 : 248;
  const mediaHeight = clamp(Math.round(popoverWidth / aspectRatio), 118, 322);
  return {
    width: popoverWidth,
    mediaHeight,
    totalHeight: mediaHeight + 82,
  };
}

function positiveNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function clampPreviewPosition(point: { x: number; y: number }, size: { width: number; height: number }, popoverSize: { width: number; totalHeight: number }) {
  const popoverWidth = popoverSize.width;
  const popoverHeight = popoverSize.totalHeight;
  const gap = 8;
  const left = point.x + gap + popoverWidth > size.width ? point.x - popoverWidth - gap : point.x + gap;
  const top = point.y - popoverHeight - gap < 0 ? point.y + gap : point.y - popoverHeight - gap;
  return {
    left: clamp(left, 12, Math.max(12, size.width - popoverWidth - 12)),
    top: clamp(top, 12, Math.max(12, size.height - popoverHeight - 12)),
  };
}

function shortLabel(node: FunctionSlotGraphNode) {
  if (node.type === "libraryItem") return "LibraryItem";
  if (node.type === "slotInstance") return `${node.data.slotId ?? ""} ${node.label}`.slice(0, 18);
  if (node.type === "atomInstance") return String(node.data.atomId ?? node.label);
  if (node.type === "binding") return String(node.data.bindingId ?? node.label);
  if (node.type === "slotConcept") return "SlotConcept";
  return node.label;
}

function nodeDetailRows(node: FunctionSlotGraphNode): Array<[string, unknown]> {
  const data = node.data ?? {};
  if (node.type === "slotInstance") return [["stableId", data.stableId], ["slotType", data.slotType], ["before", data.viewerStateBefore], ["after", data.viewerStateAfter], ["task", data.persuasionTask], ["shots", sourceShots(data.sourceRefs)], ["needReview", data.needReview]];
  if (node.type === "atomInstance") return [["atomId", data.atomId], ["atomType", data.atomType], ["slotId", data.slotId], ["function", data.function], ["claim/pace/proof", data.claimType ?? data.pace ?? data.proofType], ["shots", sourceShots(data.sourceRefs)], ["needReview", data.needReview]];
  if (node.type === "binding") return [["bindingId", data.bindingId], ["type", data.bindingType], ["rule", data.rule], ["risk", data.riskIfBroken], ["confidence", data.confidence]];
  return Object.entries(data).slice(0, 8);
}

function sourceShots(sourceRefs: unknown) {
  if (!sourceRefs || typeof sourceRefs !== "object") return null;
  const refs = (sourceRefs as { shotRefs?: unknown }).shotRefs;
  return Array.isArray(refs) ? refs.join(", ") : null;
}

function formatDetailValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "无";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}
