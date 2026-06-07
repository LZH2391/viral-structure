import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getFunctionSlotConfirmedPlanTraceGraph, getFunctionSlotGovernanceGraph, getFunctionSlotLibraryGraph, getFunctionSlotLibraryItems } from "../api/client";
import type { FunctionSlotGraphNode, FunctionSlotLibraryGraph } from "../types/library";
import { shortId } from "../utils/format";
import { GraphPixiCanvas } from "./function-slot-graph/GraphPixiCanvas";
import { EmptyState, GraphFilters, NodeInspector } from "./function-slot-graph/GraphPanels";
import { buildVisibleGraph } from "./function-slot-graph/graphUtils";
import type { GovernanceLayoutMode, GraphFiltersState, VisibleGraph } from "./function-slot-graph/types";

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

type FunctionSlotGraphWorkspaceProps = {
  embedded?: boolean;
  active?: boolean;
  fixedMode?: GraphMode;
  panelSlot?: (panel: ReactNode) => ReactNode;
};

type GraphsByMode = Record<GraphMode, FunctionSlotLibraryGraph | null>;
type LoadingByMode = Record<GraphMode, boolean>;
type GovernancePrefetchResult = {
  graph: FunctionSlotLibraryGraph;
  visible: VisibleGraph;
};
type IdleCallbackHandle = number;
type IdleCallbackApi = {
  requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => IdleCallbackHandle;
  cancelIdleCallback?: (handle: IdleCallbackHandle) => void;
};

export function FunctionSlotGraphApp() {
  return <FunctionSlotGraphWorkspace />;
}

export function FunctionSlotGraphWorkspace({ embedded = false, active = true, fixedMode, panelSlot }: FunctionSlotGraphWorkspaceProps = {}) {
  const [items, setItems] = useState<LibraryGraphSummary[]>([]);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [graphsByMode, setGraphsByMode] = useState<GraphsByMode>({ structure: null, governance: null, planTrace: null });
  const [loadingByMode, setLoadingByMode] = useState<LoadingByMode>({ structure: false, governance: false, planTrace: false });
  const [uncontrolledMode, setUncontrolledMode] = useState<GraphMode>(fixedMode ?? "structure");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [governanceSummaryCollapsed, setGovernanceSummaryCollapsed] = useState(false);
  const [status, setStatus] = useState("");
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
  const governancePrefetchStartedRef = useRef(false);
  const governancePrefetchGenerationRef = useRef(0);
  const governancePrefetchPromiseRef = useRef<Promise<GovernancePrefetchResult> | null>(null);
  const governancePrefetchVisibleRef = useRef<VisibleGraph | null>(null);

  const clearGovernanceGraphCache = useCallback(() => {
    governancePrefetchGenerationRef.current += 1;
    governancePrefetchStartedRef.current = false;
    governancePrefetchPromiseRef.current = null;
    governancePrefetchVisibleRef.current = null;
    setGraphsByMode((current) => current.governance ? { ...current, governance: null } : current);
  }, []);

  const startGovernancePrefetch = useCallback(() => {
    if (governancePrefetchPromiseRef.current) return governancePrefetchPromiseRef.current;
    const generation = governancePrefetchGenerationRef.current;
    governancePrefetchStartedRef.current = true;
    const promise = getFunctionSlotGovernanceGraph()
      .then((nextGraph) => {
        const nextVisible = buildVisibleGraph(nextGraph, GOVERNANCE_FILTERS, null, "force");
        if (governancePrefetchGenerationRef.current === generation) {
          governancePrefetchVisibleRef.current = nextVisible;
          setGraphsByMode((current) => current.governance ? current : { ...current, governance: nextGraph });
        }
        return { graph: nextGraph, visible: nextVisible };
      })
      .catch((error) => {
        if (governancePrefetchGenerationRef.current === generation) {
          governancePrefetchStartedRef.current = false;
          governancePrefetchPromiseRef.current = null;
        }
        throw error;
      });
    governancePrefetchPromiseRef.current = promise;
    return promise;
  }, []);

  const refresh = useCallback(async () => {
    if (!active) return;
    setStatus("刷新中");
    clearGovernanceGraphCache();
    const data = await getFunctionSlotLibraryItems();
    const nextItems = data.items ?? [];
    setItems(nextItems);
    setSelectedArtifactId((current) => (current && nextItems.some((item) => item.artifactId === current) ? current : nextItems[0]?.artifactId ?? null));
    setStatus("已同步");
  }, [active, clearGovernanceGraphCache]);

  useEffect(() => {
    if (!active) return;
    refresh().catch((error) => setStatus(error instanceof Error ? error.message : "读取失败"));
  }, [active, refresh]);

  const mode = fixedMode ?? uncontrolledMode;
  const setMode = useCallback((nextMode: GraphMode) => {
    if (!fixedMode) setUncontrolledMode(nextMode);
  }, [fixedMode]);
  const setModeGraph = useCallback((targetMode: GraphMode, nextGraph: FunctionSlotLibraryGraph | null) => {
    setGraphsByMode((current) => ({ ...current, [targetMode]: nextGraph }));
  }, []);
  const setModeLoading = useCallback((targetMode: GraphMode, loading: boolean) => {
    setLoadingByMode((current) => current[targetMode] === loading ? current : { ...current, [targetMode]: loading });
  }, []);

  useEffect(() => {
    setSelectedNodeId(null);
  }, [mode]);

  useEffect(() => {
    if (!fixedMode) return;
    setUncontrolledMode(fixedMode);
    setSelectedNodeId(null);
    setGovernanceSummaryCollapsed(false);
  }, [fixedMode]);

  useEffect(() => {
    if (!active) return undefined;
    if (mode !== "structure") return;
    if (!selectedArtifactId) {
      setModeGraph("structure", null);
      return undefined;
    }
    let cancelled = false;
    setSelectedNodeId(null);
    setModeLoading("structure", true);
    getFunctionSlotLibraryGraph(selectedArtifactId)
      .then((nextGraph) => {
        if (cancelled) return;
        setModeGraph("structure", nextGraph);
        setStatus("已同步");
      })
      .catch((error) => {
        if (!cancelled) setStatus(error instanceof Error ? error.message : "图谱同步失败");
      })
      .finally(() => {
        if (!cancelled) setModeLoading("structure", false);
      });
    return () => {
      cancelled = true;
    };
  }, [active, mode, selectedArtifactId]);

  useEffect(() => {
    if (!active) return undefined;
    if (graphsByMode.governance || governancePrefetchStartedRef.current) return undefined;
    let cancelled = false;
    const runPrefetch = () => {
      if (cancelled || graphsByMode.governance || governancePrefetchStartedRef.current) return;
      startGovernancePrefetch().catch(() => undefined);
    };
    const idleApi = globalThis as typeof globalThis & IdleCallbackApi;
    if (typeof idleApi.requestIdleCallback === "function") {
      const idleId = idleApi.requestIdleCallback(runPrefetch, { timeout: 2500 });
      return () => {
        cancelled = true;
        idleApi.cancelIdleCallback?.(idleId);
      };
    }
    const timeoutId = globalThis.setTimeout(runPrefetch, 1200);
    return () => {
      cancelled = true;
      globalThis.clearTimeout(timeoutId);
    };
  }, [active, graphsByMode.governance, startGovernancePrefetch]);

  useEffect(() => {
    if (!active) return undefined;
    if (mode !== "governance") return;
    if (graphsByMode.governance) {
      setModeLoading("governance", false);
      return undefined;
    }
    let cancelled = false;
    setSelectedNodeId(null);
    setModeLoading("governance", true);
    startGovernancePrefetch()
      .then(({ graph: nextGraph }) => {
        if (cancelled) return;
        setModeGraph("governance", nextGraph);
        setStatus("已同步");
      })
      .catch((error) => {
        if (!cancelled) setStatus(error instanceof Error ? error.message : "语义治理同步失败");
      })
      .finally(() => {
        if (!cancelled) setModeLoading("governance", false);
      });
    return () => {
      cancelled = true;
    };
  }, [active, graphsByMode.governance, mode, setModeGraph, setModeLoading, startGovernancePrefetch]);

  useEffect(() => {
    if (!active) return undefined;
    if (mode !== "planTrace") return;
    let cancelled = false;
    setSelectedNodeId(null);
    setModeLoading("planTrace", true);
    getFunctionSlotConfirmedPlanTraceGraph()
      .then((nextGraph) => {
        if (cancelled) return;
        setModeGraph("planTrace", nextGraph);
        setSelectedPlanIds((current) => reconcileSelectedPlans(current, nextGraph));
        setStatus("已同步");
      })
      .catch((error) => {
        if (!cancelled) setStatus(error instanceof Error ? error.message : "确定方案溯源同步失败");
      })
      .finally(() => {
        if (!cancelled) setModeLoading("planTrace", false);
      });
    return () => {
      cancelled = true;
    };
  }, [active, mode]);

  useEffect(() => {
    if (!active) return undefined;
    if (mode !== "planTrace") return undefined;
    const refreshTraceGraph = () => {
      setModeLoading("planTrace", true);
      getFunctionSlotConfirmedPlanTraceGraph()
        .then((nextGraph) => {
          setModeGraph("planTrace", nextGraph);
          setSelectedPlanIds((current) => reconcileSelectedPlans(current, nextGraph));
          setStatus("确定方案溯源已同步");
        })
        .catch(() => undefined)
        .finally(() => setModeLoading("planTrace", false));
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
  const rawGraph = graphsByMode[mode];
  const graph = mode === "structure" && rawGraph?.artifactId !== selectedArtifactId ? null : rawGraph;
  const waitingForSelectedStructureGraph = mode === "structure" && Boolean(selectedArtifactId) && rawGraph?.artifactId !== selectedArtifactId;
  const loadingGraph = loadingByMode[mode] || waitingForSelectedStructureGraph;
  const renderedGraph = graph ?? (loadingGraph ? rawGraph : null);
  const activeGraph = useMemo(() => mode === "planTrace" ? filterPlanTraceGraph(renderedGraph, selectedPlanIds) : renderedGraph, [renderedGraph, mode, selectedPlanIds]);
  const visible = useMemo(() => {
    if (
      mode === "governance"
      && activeGraph
      && activeGraph === graphsByMode.governance
      && filters === GOVERNANCE_FILTERS
      && governanceLayoutMode === "force"
      && governancePrefetchVisibleRef.current
    ) {
      return governancePrefetchVisibleRef.current;
    }
    return buildVisibleGraph(activeGraph, filters, null, governanceLayoutMode);
  }, [activeGraph, filters, governanceLayoutMode, graphsByMode.governance, mode]);
  const selectedNode = useMemo(() => {
    if (!graph) return null;
    return visible.nodes.find((node) => node.id === selectedNodeId) ?? activeGraph?.nodes.find((node) => node.id === selectedNodeId) ?? null;
  }, [activeGraph, graph, selectedNodeId, visible.nodes]);
  const graphPanel = (
    <aside className="slot-graph-panel">
      <GraphViewPanel
        embedded={embedded}
        fixedMode={Boolean(fixedMode)}
        mode={mode}
        status={status}
        governanceLayoutMode={governanceLayoutMode}
        onModeChange={setMode}
        onLayoutModeChange={setActiveLayoutMode}
        onRefresh={refresh}
      />
      <GraphSourcePanel
        mode={mode}
        graph={graph}
        items={items}
        selectedArtifactId={selectedArtifactId}
        selectedPlanIds={selectedPlanIds}
        onSelectArtifact={setSelectedArtifactId}
        onSelectedPlanIdsChange={setSelectedPlanIds}
      />
      <GraphFilters mode={mode} filters={filters} onChange={setActiveFilters} />
      {selectedNode ? <NodeInspector node={selectedNode} graph={activeGraph} /> : null}
    </aside>
  );

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
        <section className="slot-graph-stage">
          {activeGraph ? (
            <>
              <GraphPixiCanvas
                active={active}
                mode={mode}
                graph={activeGraph}
                visible={visible}
                layoutMode={governanceLayoutMode}
                selectedNodeId={graph ? selectedNodeId : null}
                onSelectNode={setSelectedNodeId}
              />
              {mode === "governance" ? <GovernanceSummary graph={graph} variant="overlay" collapsed={governanceSummaryCollapsed} onToggleCollapsed={() => setGovernanceSummaryCollapsed((value) => !value)} /> : null}
            </>
          ) : loadingGraph ? <GraphLoadingState /> : <EmptyState text={mode === "governance" ? "暂无语义治理图" : mode === "planTrace" ? "暂无确定方案溯源" : "选择右侧素材查看图谱"} />}
        </section>
        {panelSlot ? panelSlot(graphPanel) : graphPanel}
      </main>
    </div>
  );
}

function GraphViewPanel({
  embedded,
  fixedMode,
  mode,
  status,
  governanceLayoutMode,
  onModeChange,
  onLayoutModeChange,
  onRefresh,
}: {
  embedded: boolean;
  fixedMode: boolean;
  mode: GraphMode;
  status: string;
  governanceLayoutMode: GovernanceLayoutMode;
  onModeChange: (mode: GraphMode) => void;
  onLayoutModeChange: (mode: GovernanceLayoutMode) => void;
  onRefresh: () => Promise<void>;
}) {
  return (
    <section className="slot-graph-library-brief" aria-label={embedded ? "当前库视图" : "图谱视图设置"}>
      <div>
        <span>{embedded || fixedMode ? "当前库视图" : "图谱模式"}</span>
        <strong>{graphModeLabel(mode)}</strong>
        <small>{graphModeDescription(mode)}</small>
      </div>
      {!embedded ? (
        <button className="slot-graph-refresh-button" type="button" onClick={() => onRefresh().catch(() => undefined)}>
          刷新
        </button>
      ) : null}
      {status ? <p>{status}</p> : null}
      {!fixedMode ? (
        <label className="slot-graph-setting-field">
          <span>图谱模式</span>
          <select className="slot-graph-mode-select" value={mode} onChange={(event) => onModeChange(event.target.value as GraphMode)}>
            <option value="structure">样例结构图</option>
            <option value="governance">语义治理图</option>
            <option value="planTrace">确定方案溯源</option>
          </select>
        </label>
      ) : null}
      <div className="slot-graph-setting-field">
        <span>视图布局</span>
        {embedded ? (
          <div className="slot-graph-layout-options" role="group" aria-label="切换图谱布局">
            <button className={governanceLayoutMode === "force" ? "active" : ""} type="button" onClick={() => onLayoutModeChange("force")}>
              自由散点
            </button>
            <button className={governanceLayoutMode === "columns" ? "active" : ""} type="button" onClick={() => onLayoutModeChange("columns")}>
              列排布
            </button>
          </div>
        ) : (
          <select className="slot-graph-mode-select" value={governanceLayoutMode} onChange={(event) => onLayoutModeChange(event.target.value as GovernanceLayoutMode)}>
            <option value="force">星图散点</option>
            <option value="columns">等距列排版</option>
          </select>
        )}
      </div>
    </section>
  );
}

function GraphSourcePanel({
  mode,
  graph,
  items,
  selectedArtifactId,
  selectedPlanIds,
  onSelectArtifact,
  onSelectedPlanIdsChange,
}: {
  mode: GraphMode;
  graph: FunctionSlotLibraryGraph | null;
  items: LibraryGraphSummary[];
  selectedArtifactId: string | null;
  selectedPlanIds: string[];
  onSelectArtifact: (artifactId: string) => void;
  onSelectedPlanIdsChange: (ids: string[]) => void;
}) {
  if (mode === "governance") return null;
  return (
    <section className="slot-graph-source-panel">
      <div className="section-heading">{sourceHeading(mode)}</div>
      {mode === "planTrace" ? (
        <PlanTracePanel graph={graph} selectedPlanIds={selectedPlanIds} onChange={onSelectedPlanIdsChange} />
      ) : (
        <div className="compact-list">
          {items.length ? items.map((item) => (
            <button key={item.artifactId} type="button" className={`library-item slot-graph-source-item ${selectedArtifactId === item.artifactId ? "active" : ""}`} onClick={() => onSelectArtifact(item.artifactId)}>
              <strong>样例 {shortId(item.sampleVideoId ?? item.artifactId)}</strong>
              <span>artifact {shortId(item.artifactId)}</span>
              <small>{item.counts?.slotCount ?? 0} slots / {item.counts?.atomCount ?? 0} atoms / trace {shortId(item.traceId ?? "")}</small>
            </button>
          )) : <EmptyState text="暂无 FunctionSlotLibrary" />}
        </div>
      )}
    </section>
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

function GraphLoadingState() {
  return <div className="slot-graph-loading-state" aria-busy="true" />;
}

function GovernanceSummary({
  graph,
  variant = "panel",
  collapsed = false,
  onToggleCollapsed,
}: {
  graph: FunctionSlotLibraryGraph | null;
  variant?: "panel" | "overlay";
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}) {
  const summary = graph?.summary;
  const governanceCounts = countGovernanceNodes(graph);
  return (
    <section className={`slot-graph-card governance-summary ${variant === "overlay" ? "governance-summary-overlay" : ""}`.trim()}>
      {variant === "overlay" ? (
        <button className="governance-summary-toggle" type="button" onClick={onToggleCollapsed} aria-expanded={!collapsed}>
          <span>治理概览</span>
          <i>{collapsed ? "展开" : "收起"}</i>
        </button>
      ) : null}
      {!collapsed ? (
        <div className="governance-summary-grid">
      <div><b>样例数</b><span>{summary?.sampleCount ?? 0}</span></div>
      <div><b>槽位家族</b><span>{governanceCounts.slotFamily}</span></div>
      <div><b>槽位原型</b><span>{governanceCounts.slotArchetype}</span></div>
      <div><b>槽位变体</b><span>{summary?.slotCount ?? 0}</span></div>
      <div><b>原子原型</b><span>{governanceCounts.atomArchetype}</span></div>
      <div><b>原子模式</b><span>{governanceCounts.atomPattern}</span></div>
      <div><b>原子变体</b><span>{summary?.atomCount ?? 0}</span></div>
      <div><b>绑定关系</b><span>{summary?.bindingCount ?? 0}</span></div>
      <div><b>规则策略</b><span>{summary?.ruleCount ?? 0}</span></div>
      <div><b>待治理原子</b><span>{summary?.unmappedAtomCount ?? 0}</span></div>
      <div><b>未归类绑定</b><span>{summary?.unmappedBindingCount ?? 0}</span></div>
      <div><b>未归类规则</b><span>{summary?.unmappedRuleCount ?? 0}</span></div>
      <div><b>未治理样例</b><span>{(summary?.ungovernedSampleCount ?? 0) > 0 ? "有" : "无"}</span></div>
        </div>
      ) : null}
    </section>
  );
}

function countGovernanceNodes(graph: FunctionSlotLibraryGraph | null) {
  const counts = {
    slotFamily: 0,
    slotArchetype: 0,
    atomArchetype: 0,
    atomPattern: 0,
  };
  for (const node of graph?.nodes ?? []) {
    if (node.type === "slotFamily") counts.slotFamily += 1;
    if (node.type === "slotArchetype") counts.slotArchetype += 1;
    if (node.type === "atomArchetype") counts.atomArchetype += 1;
    if (node.type === "atomPattern") counts.atomPattern += 1;
  }
  return counts;
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
