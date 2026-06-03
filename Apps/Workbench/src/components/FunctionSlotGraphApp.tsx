import { useCallback, useEffect, useMemo, useState } from "react";
import { getFunctionSlotConfirmedPlanTraceGraph, getFunctionSlotGovernanceGraph, getFunctionSlotLibraryGraph, getFunctionSlotLibraryItems } from "../api/client";
import type { FunctionSlotGraphNode, FunctionSlotLibraryGraph } from "../types/library";
import { shortId } from "../utils/format";
import { GraphPixiCanvas } from "./function-slot-graph/GraphPixiCanvas";
import { EmptyState, GraphFilters, NodeInspector } from "./function-slot-graph/GraphPanels";
import { buildVisibleGraph } from "./function-slot-graph/graphUtils";
import type { GovernanceLayoutMode, GraphFiltersState } from "./function-slot-graph/types";

type LibraryGraphSummary = {
  artifactId: string;
  sampleVideoId?: string | null;
  traceId?: string | null;
  counts?: Record<string, number>;
};

type GraphMode = "structure" | "governance" | "planTrace";

const STRUCTURE_FILTERS: GraphFiltersState = {
  slot: true,
  atom: true,
  binding: false,
  rule: false,
  bundle: false,
  unmapped: false,
  slotFamily: true,
  slotArchetype: true,
  slotSubtype: true,
  atomLayer: false,
  atomArchetype: true,
  atomPattern: true,
  sourceVariant: true,
};

const GOVERNANCE_FILTERS: GraphFiltersState = {
  ...STRUCTURE_FILTERS,
};

const PLAN_TRACE_FILTERS: GraphFiltersState = {
  ...STRUCTURE_FILTERS,
};

export function FunctionSlotGraphApp() {
  const [items, setItems] = useState<LibraryGraphSummary[]>([]);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [graph, setGraph] = useState<FunctionSlotLibraryGraph | null>(null);
  const [mode, setMode] = useState<GraphMode>("structure");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [status, setStatus] = useState("读取结构图谱");
  const [filtersByMode, setFiltersByMode] = useState<Record<GraphMode, GraphFiltersState>>({
    structure: STRUCTURE_FILTERS,
    governance: GOVERNANCE_FILTERS,
    planTrace: PLAN_TRACE_FILTERS,
  });
  const [selectedPlanIds, setSelectedPlanIds] = useState<string[]>([]);
  const [governanceLayoutMode, setGovernanceLayoutMode] = useState<GovernanceLayoutMode>("force");

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

  useEffect(() => {
    if (mode !== "planTrace") return;
    setStatus("读取确定方案溯源");
    setGraph(null);
    getFunctionSlotConfirmedPlanTraceGraph()
      .then((nextGraph) => {
        setGraph(nextGraph);
        setSelectedPlanIds((current) => reconcileSelectedPlans(current, nextGraph));
        setSelectedNodeId(nextGraph.nodes.find((node) => node.type === "confirmedPlan")?.id ?? nextGraph.nodes[0]?.id ?? null);
        setStatus("已同步");
      })
      .catch((error) => setStatus(error instanceof Error ? error.message : "读取确定方案溯源失败"));
  }, [mode]);

  useEffect(() => {
    if (mode !== "planTrace") return undefined;
    const refreshTraceGraph = () => {
      getFunctionSlotConfirmedPlanTraceGraph()
        .then((nextGraph) => {
          setGraph(nextGraph);
          setSelectedPlanIds((current) => reconcileSelectedPlans(current, nextGraph));
          setStatus("确定方案溯源已同步");
        })
        .catch(() => undefined);
    };
    window.addEventListener("function-slot-plan-trace-updated", refreshTraceGraph);
    return () => window.removeEventListener("function-slot-plan-trace-updated", refreshTraceGraph);
  }, [mode]);

  const filters = filtersByMode[mode];
  const setActiveFilters = useCallback((nextFilters: GraphFiltersState) => {
    setFiltersByMode((current) => ({ ...current, [mode]: nextFilters }));
  }, [mode]);
  const activeGraph = useMemo(() => mode === "planTrace" ? filterPlanTraceGraph(graph, selectedPlanIds) : graph, [graph, mode, selectedPlanIds]);
  const visible = useMemo(() => buildVisibleGraph(activeGraph, filters, null, governanceLayoutMode), [activeGraph, filters, governanceLayoutMode]);
  const selectedNode = useMemo(() => visible.nodes.find((node) => node.id === selectedNodeId) ?? activeGraph?.nodes.find((node) => node.id === selectedNodeId) ?? null, [activeGraph, selectedNodeId, visible.nodes]);

  return (
    <div className="slot-graph-shell">
      <header className="topbar">
        <div className="project-block">
          <div className="project-name">结构图谱</div>
          <div className="save-status">{status}</div>
        </div>
        <div className="run-strip">
          <span className="run-pill">{items.length} library items</span>
          <span className="trace-label">{mode === "governance" ? "SemanticGovernance" : mode === "planTrace" ? "ConfirmedPlanTrace" : "FunctionSlotLibrary"}</span>
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
          <button className="tab-button" type="button" onClick={() => window.location.assign("/agent-chat")}>
            Agent 对话
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
            <option value="planTrace">确定方案溯源</option>
          </select>
          <div className="section-heading">布局模式</div>
          <select className="slot-graph-mode-select" value={governanceLayoutMode} onChange={(event) => setGovernanceLayoutMode(event.target.value as GovernanceLayoutMode)}>
            <option value="columns">等距列排版</option>
            <option value="force">星图散点</option>
          </select>
          <div className="section-heading">图谱来源</div>
          {mode === "governance" ? (
            <GovernanceSummary graph={graph} />
          ) : mode === "planTrace" ? (
            <PlanTracePanel graph={graph} selectedPlanIds={selectedPlanIds} onChange={setSelectedPlanIds} />
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
          {activeGraph ? <GraphPixiCanvas key={`${mode}-${governanceLayoutMode}`} mode={mode} graph={activeGraph} visible={visible} layoutMode={governanceLayoutMode} selectedNodeId={selectedNodeId} onSelectNode={setSelectedNodeId} /> : <EmptyState text={mode === "governance" ? "暂无语义治理图" : mode === "planTrace" ? "暂无确定方案溯源" : "选择左侧素材查看图谱"} />}
        </section>
        <aside className="slot-graph-panel">
          <GraphFilters mode={mode} filters={filters} onChange={setActiveFilters} />
          <NodeInspector node={selectedNode} graph={activeGraph} />
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
      <div><b>unmapped atoms</b><span>{summary?.unmappedAtomCount ?? 0}</span></div>
      <div><b>unmapped bindings</b><span>{summary?.unmappedBindingCount ?? 0}</span></div>
      <div><b>unmapped rules</b><span>{summary?.unmappedRuleCount ?? 0}</span></div>
      <div><b>validation</b><span>{summary?.validationOk ? "ok" : "unknown"}</span></div>
    </section>
  );
}

function PlanTracePanel({ graph, selectedPlanIds, onChange }: { graph: FunctionSlotLibraryGraph | null; selectedPlanIds: string[]; onChange: (ids: string[]) => void }) {
  const plans = getTracePlans(graph);
  const toggle = (planId: string) => {
    onChange(selectedPlanIds.includes(planId) ? selectedPlanIds.filter((id) => id !== planId) : [...selectedPlanIds, planId]);
  };
  return (
    <section className="slot-graph-card">
      <div className="section-heading">确认方案</div>
      <div className="detail-hint">{graph?.summary.planCount ?? 0} plans / {graph?.nodes.length ?? 0} nodes</div>
      {plans.length ? plans.map((plan) => (
        <label key={plan.planId} className="plan-overlay-option">
          <input type="checkbox" checked={selectedPlanIds.includes(plan.planId)} onChange={() => toggle(plan.planId)} />
          <i style={{ background: plan.color }} />
          <span title={plan.displayJsonPath ?? plan.planId}>{plan.planId}</span>
        </label>
      )) : <EmptyState text="暂无确认方案溯源" />}
    </section>
  );
}

function reconcileSelectedPlans(current: string[], graph: FunctionSlotLibraryGraph | null) {
  const plans = getTracePlans(graph);
  const ids = plans.map((plan) => plan.planId);
  const kept = current.filter((id) => ids.includes(id));
  return kept.length ? kept : ids;
}

function filterPlanTraceGraph(graph: FunctionSlotLibraryGraph | null, selectedPlanIds: string[]) {
  if (!graph || graph.schemaVersion !== "confirmed_plan_trace_graph.v1") return graph;
  const selected = new Set(selectedPlanIds);
  const nodes = graph.nodes.filter((node) => selected.has(String(node.data?.planId ?? "")));
  const nodeIds = new Set(nodes.map((node) => node.id));
  return { ...graph, nodes, edges: graph.edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target)) };
}

function getTracePlans(graph: FunctionSlotLibraryGraph | null) {
  return (graph?.nodes ?? [])
    .filter((node): node is FunctionSlotGraphNode & { data: { planId: string; color?: string; displayJsonPath?: string | null } } => node.type === "confirmedPlan" && typeof node.data?.planId === "string")
    .map((node) => ({
      planId: node.data.planId,
      color: typeof node.data.color === "string" ? node.data.color : "#6ea8fe",
      displayJsonPath: typeof node.data.displayJsonPath === "string" ? node.data.displayJsonPath : null,
    }));
}
