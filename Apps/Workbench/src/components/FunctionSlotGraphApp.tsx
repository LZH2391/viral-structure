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

export type GraphMode = "structure" | "governance" | "planTrace";

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
  atomArchetype: false,
};

const PLAN_TRACE_FILTERS: GraphFiltersState = {
  ...STRUCTURE_FILTERS,
};

type FunctionSlotGraphWorkspaceProps = {
  embedded?: boolean;
  active?: boolean;
  fixedMode?: GraphMode;
};

export function FunctionSlotGraphApp() {
  return <FunctionSlotGraphWorkspace />;
}

export function FunctionSlotGraphWorkspace({ embedded = false, active = true, fixedMode }: FunctionSlotGraphWorkspaceProps = {}) {
  const [items, setItems] = useState<LibraryGraphSummary[]>([]);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [graph, setGraph] = useState<FunctionSlotLibraryGraph | null>(null);
  const [uncontrolledMode, setUncontrolledMode] = useState<GraphMode>(fixedMode ?? "structure");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [status, setStatus] = useState("读取结构图谱");
  const [filtersByMode, setFiltersByMode] = useState<Record<GraphMode, GraphFiltersState>>({
    structure: STRUCTURE_FILTERS,
    governance: GOVERNANCE_FILTERS,
    planTrace: PLAN_TRACE_FILTERS,
  });
  const [selectedPlanIds, setSelectedPlanIds] = useState<string[]>([]);
  const [layoutModesByMode, setLayoutModesByMode] = useState<Record<GraphMode, GovernanceLayoutMode>>({
    structure: "force",
    governance: "force",
    planTrace: "force",
  });

  const refresh = useCallback(async () => {
    if (!active) return;
    setStatus("刷新中");
    const data = await getFunctionSlotLibraryItems();
    const nextItems = data.items ?? [];
    setItems(nextItems);
    setSelectedArtifactId((current) => (current && nextItems.some((item) => item.artifactId === current) ? current : nextItems[0]?.artifactId ?? null));
    setStatus("已同步");
  }, [active]);

  useEffect(() => {
    if (!active) return;
    refresh().catch((error) => setStatus(error instanceof Error ? error.message : "读取失败"));
  }, [active, refresh]);

  const mode = fixedMode ?? uncontrolledMode;
  const setMode = useCallback((nextMode: GraphMode) => {
    if (!fixedMode) setUncontrolledMode(nextMode);
  }, [fixedMode]);

  useEffect(() => {
    if (!active) return undefined;
    if (mode !== "structure") return;
    if (!selectedArtifactId) {
      setGraph(null);
      return undefined;
    }
    let cancelled = false;
    setStatus("读取图谱");
    setGraph(null);
    getFunctionSlotLibraryGraph(selectedArtifactId)
      .then((nextGraph) => {
        if (cancelled) return;
        setGraph(nextGraph);
        setSelectedNodeId(nextGraph.nodes.find((node) => node.type === "libraryItem")?.id ?? nextGraph.nodes[0]?.id ?? null);
        setStatus("已同步");
      })
      .catch((error) => {
        if (!cancelled) setStatus(error instanceof Error ? error.message : "读取图谱失败");
      });
    return () => {
      cancelled = true;
    };
  }, [active, mode, selectedArtifactId]);

  useEffect(() => {
    if (!active) return undefined;
    if (mode !== "governance") return;
    let cancelled = false;
    setStatus("读取语义治理图");
    setGraph(null);
    getFunctionSlotGovernanceGraph()
      .then((nextGraph) => {
        if (cancelled) return;
        setGraph(nextGraph);
        setSelectedNodeId(nextGraph.nodes.find((node) => node.type === "slotFamily")?.id ?? nextGraph.nodes[0]?.id ?? null);
        setStatus("已同步");
      })
      .catch((error) => {
        if (!cancelled) setStatus(error instanceof Error ? error.message : "读取语义治理图失败");
      });
    return () => {
      cancelled = true;
    };
  }, [active, mode]);

  useEffect(() => {
    if (!active) return undefined;
    if (mode !== "planTrace") return;
    let cancelled = false;
    setStatus("读取确定方案溯源");
    setGraph(null);
    getFunctionSlotConfirmedPlanTraceGraph()
      .then((nextGraph) => {
        if (cancelled) return;
        setGraph(nextGraph);
        setSelectedPlanIds((current) => reconcileSelectedPlans(current, nextGraph));
        setSelectedNodeId(nextGraph.nodes.find((node) => node.type === "confirmedPlan")?.id ?? nextGraph.nodes[0]?.id ?? null);
        setStatus("已同步");
      })
      .catch((error) => {
        if (!cancelled) setStatus(error instanceof Error ? error.message : "读取确定方案溯源失败");
      });
    return () => {
      cancelled = true;
    };
  }, [active, mode]);

  useEffect(() => {
    if (!active) return undefined;
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
  }, [active, mode]);

  const filters = filtersByMode[mode];
  const governanceLayoutMode = layoutModesByMode[mode];
  const setActiveFilters = useCallback((nextFilters: GraphFiltersState) => {
    setFiltersByMode((current) => ({ ...current, [mode]: nextFilters }));
  }, [mode]);
  const setActiveLayoutMode = useCallback((nextLayoutMode: GovernanceLayoutMode) => {
    setLayoutModesByMode((current) => ({ ...current, [mode]: nextLayoutMode }));
  }, [mode]);
  const activeGraph = useMemo(() => mode === "planTrace" ? filterPlanTraceGraph(graph, selectedPlanIds) : graph, [graph, mode, selectedPlanIds]);
  const visible = useMemo(() => buildVisibleGraph(activeGraph, filters, null, governanceLayoutMode), [activeGraph, filters, governanceLayoutMode]);
  const selectedNode = useMemo(() => visible.nodes.find((node) => node.id === selectedNodeId) ?? activeGraph?.nodes.find((node) => node.id === selectedNodeId) ?? null, [activeGraph, selectedNodeId, visible.nodes]);

  return (
    <div className={`slot-graph-shell ${embedded ? "embedded" : ""}`.trim()}>
      {!embedded ? (
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
      ) : null}
      <main className="slot-graph-layout">
        <aside className="slot-graph-list">
          {embedded ? (
            <section className="slot-graph-library-brief" aria-label="当前库视图">
              <div>
                <span>当前库视图</span>
                <strong>{graphModeLabel(mode)}</strong>
                <small>{graphModeDescription(mode)}</small>
              </div>
              <button className="primary-button" type="button" onClick={() => refresh().catch(() => undefined)}>
                刷新
              </button>
              <p>{status}</p>
            </section>
          ) : (
            <>
              <div className="section-heading">图谱模式</div>
              <select className="slot-graph-mode-select" value={mode} onChange={(event) => setMode(event.target.value as GraphMode)}>
                <option value="structure">样例结构图</option>
                <option value="governance">语义治理图</option>
                <option value="planTrace">确定方案溯源</option>
              </select>
            </>
          )}
          <div className="section-heading">视图布局</div>
          {embedded ? (
            <div className="slot-graph-layout-options" role="group" aria-label="切换图谱布局">
              <button className={governanceLayoutMode === "force" ? "active" : ""} type="button" onClick={() => setActiveLayoutMode("force")}>
                自由散点
              </button>
              <button className={governanceLayoutMode === "columns" ? "active" : ""} type="button" onClick={() => setActiveLayoutMode("columns")}>
                列排布
              </button>
            </div>
          ) : (
            <select className="slot-graph-mode-select" value={governanceLayoutMode} onChange={(event) => setActiveLayoutMode(event.target.value as GovernanceLayoutMode)}>
              <option value="force">星图散点</option>
              <option value="columns">等距列排版</option>
            </select>
          )}
          <div className="section-heading">{sourceHeading(mode)}</div>
          {mode === "governance" ? (
            <GovernanceSummary graph={graph} />
          ) : mode === "planTrace" ? (
            <PlanTracePanel graph={graph} selectedPlanIds={selectedPlanIds} onChange={setSelectedPlanIds} />
          ) : (
            <div className="compact-list">
              {items.length ? items.map((item) => (
                <button key={item.artifactId} type="button" className={`library-item slot-graph-source-item ${selectedArtifactId === item.artifactId ? "active" : ""}`} onClick={() => setSelectedArtifactId(item.artifactId)}>
                  <strong>样例 {shortId(item.sampleVideoId ?? item.artifactId)}</strong>
                  <span>artifact {shortId(item.artifactId)}</span>
                  <small>{item.counts?.slotCount ?? 0} slots / {item.counts?.atomCount ?? 0} atoms / trace {shortId(item.traceId ?? "")}</small>
                </button>
              )) : <EmptyState text="暂无 FunctionSlotLibrary" />}
            </div>
          )}
        </aside>
        <section className="slot-graph-stage">
          {activeGraph ? (
            <GraphPixiCanvas key={`pixi-${mode}-${governanceLayoutMode}`} active={active} mode={mode} graph={activeGraph} visible={visible} layoutMode={governanceLayoutMode} selectedNodeId={selectedNodeId} onSelectNode={setSelectedNodeId} />
          ) : <EmptyState text={mode === "governance" ? "暂无语义治理图" : mode === "planTrace" ? "暂无确定方案溯源" : "选择左侧素材查看图谱"} />}
        </section>
        <aside className="slot-graph-panel">
          <GraphFilters mode={mode} filters={filters} onChange={setActiveFilters} />
          <NodeInspector node={selectedNode} graph={activeGraph} />
        </aside>
      </main>
    </div>
  );
}

function graphModeLabel(mode: GraphMode) {
  if (mode === "governance") return "语义治理库";
  if (mode === "planTrace") return "方案溯源图";
  return "样例结构图";
}

function graphModeDescription(mode: GraphMode) {
  if (mode === "governance") return "查看槽位家族、原型和模式治理关系";
  if (mode === "planTrace") return "查看确定方案回溯到库结构的证据链";
  return "查看单个样例沉淀出的槽位、原子和绑定";
}

function sourceHeading(mode: GraphMode) {
  if (mode === "governance") return "治理概览";
  if (mode === "planTrace") return "方案范围";
  return "样例来源";
}

function GovernanceSummary({ graph }: { graph: FunctionSlotLibraryGraph | null }) {
  const summary = graph?.summary;
  return (
    <section className="slot-graph-card governance-summary">
      <div><b>样例数</b><span>{summary?.sampleCount ?? 0}</span></div>
      <div><b>槽位变体</b><span>{summary?.slotCount ?? 0}</span></div>
      <div><b>原子变体</b><span>{summary?.atomCount ?? 0}</span></div>
      <div><b>绑定关系</b><span>{summary?.bindingCount ?? 0}</span></div>
      <div><b>规则策略</b><span>{summary?.ruleCount ?? 0}</span></div>
      <div><b>待治理原子</b><span>{summary?.unmappedAtomCount ?? 0}</span></div>
      <div><b>待治理绑定</b><span>{summary?.unmappedBindingCount ?? 0}</span></div>
      <div><b>待治理规则</b><span>{summary?.unmappedRuleCount ?? 0}</span></div>
      <div><b>校验状态</b><span>{summary?.validationOk ? "通过" : "未知"}</span></div>
    </section>
  );
}

function PlanTracePanel({ graph, selectedPlanIds, onChange }: { graph: FunctionSlotLibraryGraph | null; selectedPlanIds: string[]; onChange: (ids: string[]) => void }) {
  const plans = getTracePlans(graph);
  const toggle = (planId: string) => {
    onChange(selectedPlanIds.includes(planId) ? selectedPlanIds.filter((id) => id !== planId) : [...selectedPlanIds, planId]);
  };
  return (
    <section className="slot-graph-card slot-graph-plan-scope">
      <div className="detail-hint">已选 {selectedPlanIds.length} / {graph?.summary.planCount ?? 0} 个方案，{graph?.nodes.length ?? 0} 个节点</div>
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
