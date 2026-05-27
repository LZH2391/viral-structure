import { useCallback, useEffect, useMemo, useState } from "react";
import { getFunctionSlotLibraryGraph, getFunctionSlotLibraryItems } from "../api/client";
import type { FunctionSlotGraphEdge, FunctionSlotGraphNode, FunctionSlotLibraryGraph } from "../types";
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
    concept: true,
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
          <button className="tab-button" type="button" onClick={() => window.location.assign("/library")}>
            处理库
          </button>
          <button className="tab-button active" type="button">
            结构图谱
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

function GraphCanvas({ graph, visible, selectedNodeId, onSelectNode }: { graph: FunctionSlotLibraryGraph; visible: { nodes: PositionedNode[]; edges: FunctionSlotGraphEdge[] }; selectedNodeId: string | null; onSelectNode: (id: string) => void }) {
  const positions = new Map(visible.nodes.map((node) => [node.id, node]));
  return (
    <div className="slot-graph-canvas">
      <div className="slot-graph-canvas-title">
        <strong>{shortId(graph.artifactId)}</strong>
        <span>{graph.summary.slotCount} slots / {graph.summary.atomCount} atoms / {graph.summary.bindingCount} bindings</span>
      </div>
      <svg viewBox={`0 0 ${VIEWBOX.width} ${VIEWBOX.height}`} role="img" aria-label="FunctionSlotLibrary 结构图谱">
        <GraphBackground />
        <g>
          {visible.edges.map((edge) => {
            const source = positions.get(edge.source);
            const target = positions.get(edge.target);
            if (!source || !target) return null;
            return <line key={edge.id} className={`slot-graph-edge edge-${edge.type}`} x1={source.x} y1={source.y} x2={target.x} y2={target.y} />;
          })}
        </g>
        <g>
          {visible.nodes.map((node) => (
            <GraphNode key={node.id} node={node} selected={node.id === selectedNodeId} onSelect={onSelectNode} />
          ))}
        </g>
      </svg>
    </div>
  );
}

function GraphNode({ node, selected, onSelect }: { node: PositionedNode; selected: boolean; onSelect: (id: string) => void }) {
  const radius = node.type === "libraryItem" ? 20 : node.type === "slotInstance" ? 13 : node.type === "slotConcept" ? 11 : node.type === "binding" ? 6 : 7;
  return (
    <g className={`slot-graph-node node-${node.group} ${selected ? "selected" : ""}`} onClick={() => onSelect(node.id)} tabIndex={0} role="button" aria-label={node.label}>
      <circle cx={node.x} cy={node.y} r={radius} />
      <text x={node.x} y={node.y + radius + 18}>{node.shortLabel}</text>
    </g>
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

function GraphFilters({ filters, onChange }: { filters: { slot: boolean; atom: boolean; binding: boolean; concept: boolean }; onChange: (filters: { slot: boolean; atom: boolean; binding: boolean; concept: boolean }) => void }) {
  const update = (key: keyof typeof filters) => onChange({ ...filters, [key]: !filters[key] });
  return (
    <section className="slot-graph-card">
      <div className="section-heading">筛选</div>
      <label><input type="checkbox" checked={filters.slot} onChange={() => update("slot")} /> SlotInstance</label>
      <label><input type="checkbox" checked={filters.atom} onChange={() => update("atom")} /> AtomInstance</label>
      <label><input type="checkbox" checked={filters.binding} onChange={() => update("binding")} /> Binding</label>
      <label><input type="checkbox" checked={filters.concept} onChange={() => update("concept")} /> SlotConcept</label>
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

function buildVisibleGraph(graph: FunctionSlotLibraryGraph | null, filters: { slot: boolean; atom: boolean; binding: boolean; concept: boolean }) {
  if (!graph) return { nodes: [], edges: [] };
  const positions = buildPositions(graph);
  const nodes = graph.nodes.filter((node) => {
    if (node.type === "slotInstance") return filters.slot;
    if (node.type === "atomInstance") return filters.atom;
    if (node.type === "binding") return filters.binding;
    if (node.type === "slotConcept") return filters.concept;
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
      const atomAngle = angle + (atomIndex - 1) * 0.28;
      positions.set(atom.id, {
        x: CENTER.x + Math.cos(atomAngle) * 330,
        y: CENTER.y + Math.sin(atomAngle) * 330,
      });
    });
  });

  const bindings = graph.nodes.filter((node) => node.type === "binding");
  bindings.forEach((binding, index) => {
    const angle = -Math.PI / 2 + (index / Math.max(bindings.length, 1)) * Math.PI * 2 + 0.18;
    positions.set(binding.id, {
      x: CENTER.x + Math.cos(angle) * 125,
      y: CENTER.y + Math.sin(angle) * 125,
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
