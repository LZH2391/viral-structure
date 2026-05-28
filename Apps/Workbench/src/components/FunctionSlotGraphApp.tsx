import { useCallback, useEffect, useMemo, useState } from "react";
import { getFunctionSlotGovernanceGraph, getFunctionSlotLibraryGraph, getFunctionSlotLibraryItems } from "../api/client";
import type { FunctionSlotLibraryGraph } from "../types/library";
import { shortId } from "../utils/format";
import { GraphCanvas } from "./function-slot-graph/GraphCanvas";
import { EmptyState, GraphFilters, NodeInspector } from "./function-slot-graph/GraphPanels";
import { buildVisibleGraph } from "./function-slot-graph/graphUtils";
import type { GraphFiltersState } from "./function-slot-graph/types";

type LibraryGraphSummary = {
  artifactId: string;
  sampleVideoId?: string | null;
  traceId?: string | null;
  counts?: Record<string, number>;
};

type GraphMode = "structure" | "governance";

const DEFAULT_FILTERS: GraphFiltersState = {
  slot: true,
  atom: true,
  binding: true,
  rule: true,
  bundle: true,
  unmapped: false,
  needReview: true,
  candidate: true,
  reviewed: true,
  stable: true,
};

export function FunctionSlotGraphApp() {
  const [items, setItems] = useState<LibraryGraphSummary[]>([]);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [graph, setGraph] = useState<FunctionSlotLibraryGraph | null>(null);
  const [mode, setMode] = useState<GraphMode>("structure");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [status, setStatus] = useState("读取结构图谱");
  const [filters, setFilters] = useState(DEFAULT_FILTERS);

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
    if (mode !== "structure") return;
    if (!selectedArtifactId) {
      setGraph(null);
      return;
    }
    setStatus("读取图谱");
    setGraph(null);
    getFunctionSlotLibraryGraph(selectedArtifactId)
      .then((nextGraph) => {
        setGraph(nextGraph);
        setSelectedNodeId(nextGraph.nodes.find((node) => node.type === "libraryItem")?.id ?? nextGraph.nodes[0]?.id ?? null);
        setStatus("已同步");
      })
      .catch((error) => setStatus(error instanceof Error ? error.message : "读取图谱失败"));
  }, [mode, selectedArtifactId]);

  useEffect(() => {
    if (mode !== "governance") return;
    setStatus("读取语义治理图");
    setGraph(null);
    getFunctionSlotGovernanceGraph()
      .then((nextGraph) => {
        setGraph(nextGraph);
        setSelectedNodeId(nextGraph.nodes.find((node) => node.type === "slotFamily")?.id ?? nextGraph.nodes[0]?.id ?? null);
        setStatus("已同步");
      })
      .catch((error) => setStatus(error instanceof Error ? error.message : "读取语义治理图失败"));
  }, [mode]);

  const visible = useMemo(() => buildVisibleGraph(graph, filters, selectedNodeId), [filters, graph, selectedNodeId]);
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
          <span className="trace-label">{mode === "governance" ? "SemanticGovernance" : "FunctionSlotLibrary"}</span>
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
          <div className="section-heading">图谱模式</div>
          <select className="slot-graph-mode-select" value={mode} onChange={(event) => setMode(event.target.value as GraphMode)}>
            <option value="structure">样例结构图</option>
            <option value="governance">语义治理图</option>
          </select>
          <div className="section-heading">图谱来源</div>
          {mode === "governance" ? (
            <GovernanceSummary graph={graph} />
          ) : (
            <div className="compact-list">
              {items.length ? items.map((item) => (
              <button key={item.artifactId} type="button" className={`library-item ${selectedArtifactId === item.artifactId ? "active" : ""}`} onClick={() => setSelectedArtifactId(item.artifactId)}>
                <strong>{shortId(item.artifactId)}</strong>
                <span>sample {shortId(item.sampleVideoId ?? "")}</span>
                <small>{item.counts?.slotCount ?? 0} slots / {item.counts?.atomCount ?? 0} atoms / trace {shortId(item.traceId ?? "")}</small>
              </button>
              )) : <EmptyState text="暂无 FunctionSlotLibrary" />}
            </div>
          )}
        </aside>
        <section className="slot-graph-stage">
          {graph ? <GraphCanvas mode={mode} graph={graph} visible={visible} selectedNodeId={selectedNodeId} onSelectNode={setSelectedNodeId} /> : <EmptyState text={mode === "governance" ? "暂无语义治理图" : "选择左侧素材查看图谱"} />}
        </section>
        <aside className="slot-graph-panel">
          <GraphFilters mode={mode} filters={filters} onChange={setFilters} />
          <NodeInspector node={selectedNode} graph={graph} />
        </aside>
      </main>
    </div>
  );
}

function GovernanceSummary({ graph }: { graph: FunctionSlotLibraryGraph | null }) {
  const summary = graph?.summary;
  return (
    <section className="slot-graph-card governance-summary">
      <div className="section-heading">治理摘要</div>
      <div><b>samples</b><span>{summary?.sampleCount ?? 0}</span></div>
      <div><b>slot variants</b><span>{summary?.slotCount ?? 0}</span></div>
      <div><b>atom variants</b><span>{summary?.atomCount ?? 0}</span></div>
      <div><b>bindings</b><span>{summary?.bindingCount ?? 0}</span></div>
      <div><b>rules</b><span>{summary?.ruleCount ?? 0}</span></div>
      <div><b>needReview</b><span>{summary?.needReviewCount ?? 0}</span></div>
      <div><b>unmapped atoms</b><span>{summary?.unmappedAtomCount ?? 0}</span></div>
      <div><b>unmapped bindings</b><span>{summary?.unmappedBindingCount ?? 0}</span></div>
      <div><b>unmapped rules</b><span>{summary?.unmappedRuleCount ?? 0}</span></div>
      <div><b>validation</b><span>{summary?.validationOk ? "ok" : "unknown"}</span></div>
    </section>
  );
}
