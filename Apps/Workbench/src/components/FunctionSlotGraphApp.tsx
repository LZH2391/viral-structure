import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  getFunctionSlotGovernanceGraph,
  getFunctionSlotLibraryGraph,
  getFunctionSlotLibraryItems,
  getFunctionSlotPlanTraceRecordGraph,
  listFunctionSlotPlanTraceRecords,
  type FunctionSlotPlanTraceBucket,
  type FunctionSlotPlanTraceRecord,
} from "../api/client";
import type { FunctionSlotLibraryGraph } from "../types/library";
import { shortId } from "../utils/format";
import { GraphPixiCanvas } from "./function-slot-graph/GraphPixiCanvas";
import { EmptyState, GraphFilters, NodeInspector } from "./function-slot-graph/GraphPanels";
import { GOVERNANCE_FILTER_PRESET_CONFIGS, GOVERNANCE_FILTERS, PLAN_TRACE_FILTERS, STRUCTURE_FILTERS, graphFiltersEqual, readFunctionSlotGraphConfig, resolveGovernancePresetMode, writeFunctionSlotGraphConfig } from "./function-slot-graph/FunctionSlotGraphConfig";
import { GovernanceSummary, GraphLoadingState, GraphSourcePanel, GraphViewPanel, StructureGraphReturnBar, stripMediaExtension, type GraphMode, type LibraryGraphSummary } from "./function-slot-graph/FunctionSlotGraphPanels";
import { buildVisibleGraph } from "./function-slot-graph/graphUtils";
import { filterPlanTraceGraph, mergePlanTraceSourceSamples, reconcileSelectedPlans } from "./function-slot-graph/planTraceGraphUtils";
import type { GovernanceFilterPresetMode, GovernanceLayoutMode, GraphFiltersState, VisibleGraph } from "./function-slot-graph/types";

export type { GraphMode };

type FunctionSlotGraphWorkspaceProps = {
  embedded?: boolean;
  active?: boolean;
  fixedMode?: GraphMode;
  requestedArtifactId?: string | null;
  sourceReturn?: { title: string; onBack: () => void } | null;
  onClearSourceReturn?: () => void;
  onOpenSourceAnalysis?: (target: { sampleVideoId: string; artifactId: string; title: string }) => Promise<{ ok: boolean; message?: string | null }> | { ok: boolean; message?: string | null };
  panelSlot?: (panel: ReactNode) => ReactNode;
};

type GraphsByMode = Record<GraphMode, FunctionSlotLibraryGraph | null>;
type LoadingByMode = Record<GraphMode, boolean>;
type GovernancePrefetchResult = { graph: FunctionSlotLibraryGraph; visible: VisibleGraph };
type IdleCallbackHandle = number;
type IdleCallbackApi = {
  requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => IdleCallbackHandle;
  cancelIdleCallback?: (handle: IdleCallbackHandle) => void;
};

export function FunctionSlotGraphApp() {
  return <FunctionSlotGraphWorkspace />;
}

export function FunctionSlotGraphWorkspace({ embedded = false, active = true, fixedMode, requestedArtifactId = null, sourceReturn = null, onClearSourceReturn, onOpenSourceAnalysis, panelSlot }: FunctionSlotGraphWorkspaceProps = {}) {
  const initialGraphConfig = useMemo(() => readFunctionSlotGraphConfig(), []);
  const [items, setItems] = useState<LibraryGraphSummary[]>([]);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [graphsByMode, setGraphsByMode] = useState<GraphsByMode>({ structure: null, governance: null, planTrace: null });
  const [loadingByMode, setLoadingByMode] = useState<LoadingByMode>({ structure: false, governance: false, planTrace: false });
  const [uncontrolledMode, setUncontrolledMode] = useState<GraphMode>(fixedMode ?? "structure");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [governanceSummaryCollapsed, setGovernanceSummaryCollapsed] = useState(false);
  const [status, setStatus] = useState("");
  const [planTraceBucket, setPlanTraceBucket] = useState<FunctionSlotPlanTraceBucket>("recent");
  const [planTraceRecords, setPlanTraceRecords] = useState<FunctionSlotPlanTraceRecord[]>([]);
  const [selectedPlanTraceRecordId, setSelectedPlanTraceRecordId] = useState<string | null>(null);
  const [planTracePreviewActive, setPlanTracePreviewActive] = useState(false);
  const [planTraceReloadKey, setPlanTraceReloadKey] = useState(0);
  const [filtersByMode, setFiltersByMode] = useState<Record<GraphMode, GraphFiltersState>>({
    structure: STRUCTURE_FILTERS,
    governance: initialGraphConfig?.governanceFilters ?? GOVERNANCE_FILTERS,
    planTrace: PLAN_TRACE_FILTERS,
  });
  const [governanceFilterPresetMode, setGovernanceFilterPresetMode] = useState<GovernanceFilterPresetMode>(initialGraphConfig?.governancePresetMode ?? "default");
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

  useEffect(() => {
    writeFunctionSlotGraphConfig({
      governancePresetMode: governanceFilterPresetMode,
      governanceFilters: filtersByMode.governance,
    });
  }, [filtersByMode.governance, governanceFilterPresetMode]);

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
    setSelectedArtifactId((current) => {
      if (requestedArtifactId) return requestedArtifactId;
      return current && nextItems.some((item) => item.artifactId === current) ? current : nextItems[0]?.artifactId ?? null;
    });
    setStatus("已同步");
  }, [active, clearGovernanceGraphCache, requestedArtifactId]);

  useEffect(() => {
    if (!active) return;
    refresh().catch((error) => setStatus(error instanceof Error ? error.message : "读取失败"));
  }, [active, refresh]);

  useEffect(() => {
    if (!requestedArtifactId) return;
    setSelectedArtifactId(requestedArtifactId);
  }, [requestedArtifactId]);

  const mode = fixedMode ?? uncontrolledMode;
  const setMode = useCallback((nextMode: GraphMode) => {
    if (nextMode !== "structure") onClearSourceReturn?.();
    if (!fixedMode) setUncontrolledMode(nextMode);
  }, [fixedMode, onClearSourceReturn]);
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
    if (planTracePreviewActive) return undefined;
    let cancelled = false;
    setSelectedNodeId(null);
    setModeLoading("planTrace", true);
    listFunctionSlotPlanTraceRecords(planTraceBucket)
      .then((response) => {
        if (cancelled) return;
        const records = response.records ?? [];
        setPlanTraceRecords(records);
        setSelectedPlanTraceRecordId((current) => current && records.some((record) => record.recordId === current) ? current : records[0]?.recordId ?? null);
        if (!records.length) {
          setModeGraph("planTrace", null);
          setSelectedPlanIds([]);
          setStatus(planTraceBucket === "recent" ? "最近暂无方案溯源记录" : "暂无历史方案溯源记录");
        }
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
  }, [active, mode, planTraceBucket, planTracePreviewActive, planTraceReloadKey]);

  useEffect(() => {
    if (!active) return undefined;
    if (mode !== "planTrace") return;
    if (planTracePreviewActive) return undefined;
    if (!selectedPlanTraceRecordId) return undefined;
    let cancelled = false;
    setModeLoading("planTrace", true);
    getFunctionSlotPlanTraceRecordGraph(selectedPlanTraceRecordId)
      .then((nextGraph) => {
        if (cancelled) return;
        setModeGraph("planTrace", nextGraph);
        setSelectedPlanIds((current) => reconcileSelectedPlans(current, nextGraph));
        setStatus("方案溯源已同步");
      })
      .catch((error) => {
        if (!cancelled) setStatus(error instanceof Error ? error.message : "方案溯源图同步失败");
      })
      .finally(() => {
        if (!cancelled) setModeLoading("planTrace", false);
      });
    return () => {
      cancelled = true;
    };
  }, [active, mode, planTracePreviewActive, selectedPlanTraceRecordId]);

  useEffect(() => {
    const refreshTraceGraph = () => {
      setPlanTracePreviewActive(false);
      setPlanTraceReloadKey((value) => value + 1);
    };
    const previewTraceGraph = (event: Event) => {
      const detail = (event as CustomEvent<{ graph?: FunctionSlotLibraryGraph; record?: FunctionSlotPlanTraceRecord | null }>).detail;
      const nextGraph = detail?.graph;
      if (!nextGraph) return;
      if (detail.record) {
        setPlanTraceRecords([detail.record]);
        setSelectedPlanTraceRecordId(detail.record.recordId);
      }
      setPlanTracePreviewActive(true);
      setModeGraph("planTrace", nextGraph);
      setSelectedPlanIds((current) => reconcileSelectedPlans(current, nextGraph));
      setStatus("当前方案溯源预览");
    };
    window.addEventListener("function-slot-plan-trace-updated", refreshTraceGraph);
    window.addEventListener("function-slot-plan-trace-preview", previewTraceGraph);
    return () => {
      window.removeEventListener("function-slot-plan-trace-updated", refreshTraceGraph);
      window.removeEventListener("function-slot-plan-trace-preview", previewTraceGraph);
    };
  }, [setModeGraph]);

  const filters = filtersByMode[mode];
  const governanceLayoutMode = layoutModesByMode[mode];
  const setActiveFilters = useCallback((nextFilters: GraphFiltersState) => {
    setFiltersByMode((current) => ({ ...current, [mode]: nextFilters }));
    if (mode === "governance") setGovernanceFilterPresetMode(resolveGovernancePresetMode(nextFilters));
  }, [mode]);
  const setGovernanceFilterPreset = useCallback((nextPresetMode: GovernanceFilterPresetMode) => {
    setGovernanceFilterPresetMode(nextPresetMode);
    if (nextPresetMode === "custom") return;
    setFiltersByMode((current) => ({ ...current, governance: GOVERNANCE_FILTER_PRESET_CONFIGS[nextPresetMode] }));
  }, []);
  const setActiveLayoutMode = useCallback((nextLayoutMode: GovernanceLayoutMode) => {
    setLayoutModesByMode((current) => ({ ...current, [mode]: nextLayoutMode }));
  }, [mode]);
  const handleSelectArtifact = useCallback((artifactId: string) => {
    if (sourceReturn) onClearSourceReturn?.();
    setSelectedArtifactId(artifactId);
  }, [onClearSourceReturn, sourceReturn]);
  const rawGraph = graphsByMode[mode];
  const graph = mode === "structure" && rawGraph?.artifactId !== selectedArtifactId ? null : rawGraph;
  const selectedSourceItem = mode === "structure" ? items.find((item) => item.artifactId === selectedArtifactId) ?? null : null;
  const selectedSourceTitle = selectedSourceItem ? stripMediaExtension(selectedSourceItem.sourceVideoName) || `样例 ${shortId(selectedSourceItem.sampleVideoId ?? selectedSourceItem.artifactId)}` : null;
  const openSelectedSourceAnalysis = useCallback(async () => {
    if (sourceReturn) {
      sourceReturn.onBack();
      return;
    }
    if (!selectedSourceItem?.sampleVideoId || !selectedSourceTitle || !onOpenSourceAnalysis) {
      setStatus("未找到对应结构分析入口");
      return;
    }
    setStatus("正在打开结构分析");
    try {
      const result = await onOpenSourceAnalysis({
        sampleVideoId: selectedSourceItem.sampleVideoId,
        artifactId: selectedSourceItem.artifactId,
        title: selectedSourceTitle,
      });
      setStatus(result.ok ? "已打开结构分析" : result.message ?? "未找到对应结构分析");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "打开结构分析失败");
    }
  }, [onOpenSourceAnalysis, selectedSourceItem, selectedSourceTitle, sourceReturn]);
  const sourceNavigation = sourceReturn
    ? { title: sourceReturn.title, onBack: sourceReturn.onBack }
    : selectedSourceTitle && selectedSourceItem?.sampleVideoId && onOpenSourceAnalysis
      ? { title: selectedSourceTitle, onBack: openSelectedSourceAnalysis }
      : null;
  const sourceTitlesBySampleId = useMemo(() => {
    const titles: Record<string, string> = {};
    for (const item of items) {
      if (!item.sampleVideoId) continue;
      const title = stripMediaExtension(item.sourceVideoName);
      if (title) titles[item.sampleVideoId] = title;
    }
    return titles;
  }, [items]);
  const waitingForSelectedStructureGraph = mode === "structure" && Boolean(selectedArtifactId) && rawGraph?.artifactId !== selectedArtifactId;
  const loadingGraph = loadingByMode[mode] || waitingForSelectedStructureGraph;
  const renderedGraph = graph ?? (loadingGraph ? rawGraph : null);
  const activeGraph = useMemo(() => mode === "planTrace" ? filterPlanTraceGraph(mergePlanTraceSourceSamples(renderedGraph), selectedPlanIds) : renderedGraph, [renderedGraph, mode, selectedPlanIds]);
  const visible = useMemo(() => {
    if (
      mode === "governance"
      && activeGraph
      && activeGraph === graphsByMode.governance
      && graphFiltersEqual(filters, GOVERNANCE_FILTERS)
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
      {mode !== "planTrace" ? (
        <GraphFilters
          mode={mode}
          filters={filters}
          governancePresetMode={mode === "governance" ? governanceFilterPresetMode : undefined}
          onGovernancePresetModeChange={mode === "governance" ? setGovernanceFilterPreset : undefined}
          onChange={setActiveFilters}
        />
      ) : null}
      <GraphSourcePanel
        mode={mode}
        graph={graph}
        items={items}
        selectedArtifactId={selectedArtifactId}
        planTraceBucket={planTraceBucket}
        planTraceRecords={planTraceRecords}
        selectedPlanTraceRecordId={selectedPlanTraceRecordId}
        selectedPlanIds={selectedPlanIds}
        onSelectArtifact={handleSelectArtifact}
        onPlanTraceBucketChange={(bucket) => {
          setPlanTracePreviewActive(false);
          setPlanTraceBucket(bucket);
        }}
        onSelectPlanTraceRecord={(recordId) => {
          setPlanTracePreviewActive(false);
          setSelectedPlanTraceRecordId(recordId);
        }}
        onSelectedPlanIdsChange={setSelectedPlanIds}
      />
      <NodeInspector node={selectedNode} graph={activeGraph} />
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
          {sourceNavigation ? <StructureGraphReturnBar title={sourceNavigation.title} onBack={sourceNavigation.onBack} /> : null}
          {activeGraph ? (
            <>
              <GraphPixiCanvas
                active={active}
                mode={mode}
                graph={activeGraph}
                visible={visible}
                layoutMode={governanceLayoutMode}
                titleLabel={mode === "structure" ? null : undefined}
                sourceTitlesBySampleId={sourceTitlesBySampleId}
                selectedNodeId={graph ? selectedNodeId : null}
                onSelectNode={setSelectedNodeId}
              />
              {mode === "governance" ? <GovernanceSummary graph={graph} variant="overlay" collapsed={governanceSummaryCollapsed} onToggleCollapsed={() => setGovernanceSummaryCollapsed((value) => !value)} /> : null}
            </>
          ) : loadingGraph ? <GraphLoadingState /> : <EmptyState text="" hint={null} />}
        </section>
        {panelSlot ? panelSlot(graphPanel) : graphPanel}
      </main>
    </div>
  );
}
