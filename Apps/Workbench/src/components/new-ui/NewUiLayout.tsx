import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { listAgentChatConversations } from "../../api/client";
import { useResizableThreePaneLayout } from "../../hooks/useResizableThreePaneLayout";
import type { AgentChatConversation } from "../../types";
import type { NewUiTheme } from "../../utils/workbenchPreferences";
import { AppErrorBoundary } from "../AppErrorBoundary";
import { SplitResizeHandle } from "../SplitResizeHandle";
import { AnalysisHome } from "./AnalysisHome";
import { AnalysisWorkflowSidebar, type AnalysisDetailSidebarState } from "./AnalysisWorkflowSidebar";
import { FunctionSlotGraphWorkspace, type GraphMode } from "../FunctionSlotGraphApp";

type NewUiSectionId = "analysis" | "library" | "restructure";
type NewUiLibraryChildId = "sampleStructure" | "semanticGovernance" | "planTrace";

type NewUiSection = {
  id: NewUiSectionId;
  label: string;
  children?: NewUiNavChild[];
};

type NewUiNavChild = {
  id: string;
  label: string;
};

const NEW_UI_SECTIONS: NewUiSection[] = [
  { id: "analysis", label: "分析" },
  {
    id: "library",
    label: "库",
    children: [
      { id: "sampleStructure", label: "样例结构图" },
      { id: "semanticGovernance", label: "语义治理库" },
      { id: "planTrace", label: "方案溯源图" },
    ],
  },
  { id: "restructure", label: "重组" },
];

const NEW_UI_THREE_PANE_STORAGE_KEY = "new-ui:three-pane-layout";
const ANALYSIS_WORKFLOW_MOUNT_DELAY_MS = 280;
const PANE_TRANSITION_GUARD_MS = 420;
const LEFT_PANE_ANIMATION_MS = 280;
const analysisOpenRequestResolvers = new Map<number, (result: { ok: boolean; message?: string | null }) => void>();

type NewUiThreePanePreference = {
  leftCollapsed?: boolean;
  rightCollapsed?: boolean;
  right?: unknown;
  rightRatio?: unknown;
};

type StructureGraphReturnState = {
  artifactId: string;
  title: string;
} | null;

type AnalysisOpenRequest = {
  requestId: number;
  sampleVideoId: string;
  artifactId?: string | null;
  title?: string | null;
} | null;

type NewUiLayoutProps = {
  active?: boolean;
  theme: NewUiTheme;
  onThemeChange: (theme: NewUiTheme) => void;
  onLeftCollapsedChange?: (collapsed: boolean) => void;
};

export function NewUiLayout({ active = true, theme, onThemeChange, onLeftCollapsedChange }: NewUiLayoutProps) {
  const layoutRef = useRef<HTMLElement>(null);
  const lastAnalysisWorkflowRevealKeyRef = useRef<string | null>(null);
  const leftPaneAnimationFrameRef = useRef<number | null>(null);
  const lastExpandedLeftMetricsRef = useRef<{ paneWidth: number; navWidth: number } | null>(null);
  const paneResizeGuardTimerRef = useRef<number | null>(null);
  const rightPaneTransitionTimerRef = useRef<number | null>(null);
  const [leftCollapsed, setLeftCollapsed] = useState(() => readStoredBooleanPreference("leftCollapsed", false));
  const [rightCollapsed, setRightCollapsed] = useState(true);
  const [activeSection, setActiveSection] = useState<NewUiSectionId>("analysis");
  const [activeLibraryChild, setActiveLibraryChild] = useState<NewUiLibraryChildId>("sampleStructure");
  const [activeRestructureConversationId, setActiveRestructureConversationId] = useState<string | null>(null);
  const [restructureConversations, setRestructureConversations] = useState<AgentChatConversation[]>([]);
  const [timelineSelectionClearRequest, setTimelineSelectionClearRequest] = useState(0);
  const [analysisOpenRequest, setAnalysisOpenRequest] = useState<AnalysisOpenRequest>(null);
  const [analysisWorkflowMounted, setAnalysisWorkflowMounted] = useState(false);
  const [paneTransitioning, setPaneTransitioning] = useState(false);
  const [leftPaneTransitioning, setLeftPaneTransitioning] = useState(false);
  const [rightPaneTransitioning, setRightPaneTransitioning] = useState(false);
  const [structureGraphReturn, setStructureGraphReturn] = useState<StructureGraphReturnState>(null);
  const [analysisDetail, setAnalysisDetail] = useState<AnalysisDetailSidebarState>({
    visible: false,
    title: "新建分析",
    item: null,
  });
  const showAnalysisWorkflow = activeSection === "analysis" && analysisDetail.visible && Boolean(analysisDetail.item);
  const showLibraryGraphPanel = activeSection === "library";
  const showRightPaneContent = showAnalysisWorkflow || showLibraryGraphPanel;
  const navSections = useMemo(() => NEW_UI_SECTIONS.map((section) => (
    section.id === "restructure"
      ? {
          ...section,
          children: restructureConversations.map((conversation, index) => ({
            id: conversation.conversationId,
            label: resolveConversationTitle(conversation, index),
          })),
      }
      : section
  )), [restructureConversations]);
  const selectedRestructureConversationTitle = useMemo(() => {
    const index = restructureConversations.findIndex((conversation) => conversation.conversationId === activeRestructureConversationId);
    return index >= 0 ? resolveConversationTitle(restructureConversations[index], index) : null;
  }, [activeRestructureConversationId, restructureConversations]);
  const analysisWorkflowRevealKey = showAnalysisWorkflow && analysisDetail.item
    ? `${analysisDetail.item.sampleVideoId}:${analysisDetail.item.workflowRunId ?? ""}:${analysisDetail.item.artifactId ?? ""}`
    : null;
  const layout = useResizableThreePaneLayout({
    containerRef: layoutRef,
    storageKey: NEW_UI_THREE_PANE_STORAGE_KEY,
    leftCssVar: "--new-ui-left-width",
    rightCssVar: "--new-ui-right-width",
    defaultLeft: 320,
    defaultRight: showAnalysisWorkflow ? 420 : showLibraryGraphPanel ? 360 : 320,
    minLeft: 0,
    maxLeft: Number.POSITIVE_INFINITY,
    minCenter: 420,
    minRight: showAnalysisWorkflow ? 420 : showLibraryGraphPanel ? 320 : 0,
    maxRight: Number.POSITIVE_INFINITY,
    leftRatio: { min: 0.1, max: 0.3 },
    rightRatio: showAnalysisWorkflow ? { min: 0.18, max: 0.34 } : showLibraryGraphPanel ? { min: 0.16, max: 0.32 } : { min: 0.1, max: 0.3 },
    persistedSides: { left: true, right: false },
  });

  useEffect(() => {
    onLeftCollapsedChange?.(leftCollapsed);
  }, [leftCollapsed, onLeftCollapsedChange]);

  useEffect(() => {
    writeStoredLayoutPreference({ leftCollapsed });
  }, [leftCollapsed]);

  useEffect(() => {
    if (!analysisWorkflowRevealKey) {
      lastAnalysisWorkflowRevealKeyRef.current = null;
      setAnalysisWorkflowMounted(false);
      if (!showLibraryGraphPanel) setRightCollapsed(true);
      return;
    }
    if (lastAnalysisWorkflowRevealKeyRef.current === analysisWorkflowRevealKey) return;
    lastAnalysisWorkflowRevealKeyRef.current = analysisWorkflowRevealKey;
    setAnalysisWorkflowMounted(false);
    setRightCollapsed(false);
  }, [analysisWorkflowRevealKey, showLibraryGraphPanel]);

  useEffect(() => {
    if (!showAnalysisWorkflow) {
      setAnalysisWorkflowMounted(false);
      return undefined;
    }
    if (rightCollapsed || analysisWorkflowMounted) return undefined;
    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      if (!cancelled) setAnalysisWorkflowMounted(true);
    }, ANALYSIS_WORKFLOW_MOUNT_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [analysisWorkflowMounted, rightCollapsed, showAnalysisWorkflow]);

  const handleAnalysisDetailStateChange = useCallback((nextDetail: AnalysisDetailSidebarState) => {
    setAnalysisDetail((current) => {
      if (
        current.visible === nextDetail.visible
        && current.title === nextDetail.title
        && current.item === nextDetail.item
        && current.selectedTimelineSegment === nextDetail.selectedTimelineSegment
        && current.rerunningStageKey === nextDetail.rerunningStageKey
        && current.onWorkflowStageRerun === nextDetail.onWorkflowStageRerun
        && sameStringList(current.rerunnableStageKeys, nextDetail.rerunnableStageKeys)
      ) {
        return current;
      }
      return nextDetail;
    });
  }, []);

  const startPaneTransitionGuard = useCallback(() => {
    setPaneTransitioning(true);
    if (paneResizeGuardTimerRef.current) window.clearTimeout(paneResizeGuardTimerRef.current);
    paneResizeGuardTimerRef.current = window.setTimeout(() => {
      paneResizeGuardTimerRef.current = null;
      setPaneTransitioning(false);
    }, PANE_TRANSITION_GUARD_MS);
  }, []);

  const animateLeftCollapsed = useCallback((nextCollapsed: boolean) => {
    const layoutElement = layoutRef.current;
    const paneElement = layoutElement?.querySelector<HTMLElement>(".new-ui-pane-left");
    const resizeHandle = layoutElement?.querySelector<HTMLElement>(".new-ui-resize-handle-left");
    const navGroups = Array.from(layoutElement?.querySelectorAll<HTMLElement>(".new-ui-pane-left .new-ui-sidebar-nav-group") ?? []);
    const navLabels = Array.from(layoutElement?.querySelectorAll<HTMLElement>(".new-ui-pane-left .new-ui-sidebar-nav-label") ?? []);
    const subnavs = Array.from(layoutElement?.querySelectorAll<HTMLElement>(".new-ui-pane-left .new-ui-sidebar-subnav") ?? []);
    if (!layoutElement || !paneElement) {
      setLeftCollapsed(nextCollapsed);
      return;
    }

    if (leftPaneAnimationFrameRef.current) {
      window.cancelAnimationFrame(leftPaneAnimationFrameRef.current);
      leftPaneAnimationFrameRef.current = null;
    }

    startPaneTransitionGuard();
    setLeftPaneTransitioning(true);
    const paneBasis = Number.parseFloat(getComputedStyle(paneElement).flexBasis) || paneElement.getBoundingClientRect().width;
    const paneScale = paneBasis > 0 ? paneElement.getBoundingClientRect().width / paneBasis : 1;
    const navBasis = navGroups[0] ? Number.parseFloat(getComputedStyle(navGroups[0]).width) || navGroups[0].getBoundingClientRect().width : 0;
    const navScale = navBasis > 0 && navGroups[0] ? navGroups[0].getBoundingClientRect().width / navBasis : paneScale;
    const toPaneCssPx = (value: number) => value / (paneScale || 1);
    const toNavCssPx = (value: number) => value / (navScale || 1);
    const expandedPaneWidth = Number.parseFloat(getComputedStyle(layoutElement).getPropertyValue("--new-ui-left-width")) || 320;
    const expandedNavWidth = Math.max(44, expandedPaneWidth - 10);
    const startPaneWidth = toPaneCssPx(paneElement.getBoundingClientRect().width);
    const startHandleWidth = resizeHandle ? toPaneCssPx(resizeHandle.getBoundingClientRect().width) : (leftCollapsed ? 0 : 10);
    const startNavWidth = navGroups[0] ? toNavCssPx(navGroups[0].getBoundingClientRect().width) : Math.max(44, startPaneWidth - 10);
    const subnavMetrics = subnavs.map((subnav) => {
      const subnavStyle = getComputedStyle(subnav);
      return {
        element: subnav,
        startHeight: toPaneCssPx(subnav.getBoundingClientRect().height),
        startPaddingTop: Number.parseFloat(subnavStyle.paddingTop) || 0,
      };
    });
    if (nextCollapsed) lastExpandedLeftMetricsRef.current = { paneWidth: expandedPaneWidth, navWidth: expandedNavWidth };

    const expandedMetrics = lastExpandedLeftMetricsRef.current;
    const targetPaneWidth = nextCollapsed ? 54 : expandedMetrics?.paneWidth ?? expandedPaneWidth;
    const targetHandleWidth = nextCollapsed ? 0 : 10;
    const targetNavWidth = nextCollapsed ? 44 : expandedMetrics?.navWidth ?? expandedNavWidth;
    const frozenSubnavWidth = nextCollapsed ? startNavWidth : targetNavWidth;
    const startTime = performance.now();
    const ease = (value: number) => 1 - Math.pow(1 - value, 3);
    const lerp = (from: number, to: number, progress: number) => from + (to - from) * progress;

    paneElement.style.transition = "none";
    paneElement.style.flexBasis = `${startPaneWidth.toFixed(2)}px`;
    paneElement.style.minWidth = `${startPaneWidth.toFixed(2)}px`;
    if (resizeHandle) resizeHandle.style.transition = "none";
    if (resizeHandle) {
      resizeHandle.style.flexBasis = `${startHandleWidth.toFixed(2)}px`;
      resizeHandle.style.minWidth = `${startHandleWidth.toFixed(2)}px`;
    }
    navGroups.forEach((group) => {
      group.style.transition = "none";
      group.style.width = `${startNavWidth.toFixed(2)}px`;
    });
    navLabels.forEach((label) => {
      label.style.transition = "none";
      label.style.opacity = nextCollapsed ? "1" : "0";
    });
    if (nextCollapsed) {
      subnavs.forEach((subnav) => {
        subnav.style.transition = "none";
        subnav.style.width = `${frozenSubnavWidth.toFixed(2)}px`;
        subnav.style.opacity = "1";
        const metric = subnavMetrics.find((item) => item.element === subnav);
        subnav.style.maxHeight = `${(metric?.startHeight ?? 0).toFixed(2)}px`;
        subnav.style.overflow = "hidden";
        subnav.style.paddingTop = `${(metric?.startPaddingTop ?? 0).toFixed(2)}px`;
      });
    }

    if (!nextCollapsed) setLeftCollapsed(false);

    const applyFrame = (now: number) => {
      const progress = Math.min(1, (now - startTime) / LEFT_PANE_ANIMATION_MS);
      const eased = ease(progress);
      const paneWidth = lerp(startPaneWidth, targetPaneWidth, eased).toFixed(2);
      paneElement.style.flexBasis = `${paneWidth}px`;
      paneElement.style.minWidth = `${paneWidth}px`;
      if (resizeHandle) {
        const handleWidth = lerp(startHandleWidth, targetHandleWidth, eased).toFixed(2);
        resizeHandle.style.flexBasis = `${handleWidth}px`;
        resizeHandle.style.minWidth = `${handleWidth}px`;
      }
      navGroups.forEach((group) => {
        group.style.width = `${lerp(startNavWidth, targetNavWidth, eased).toFixed(2)}px`;
      });
      navLabels.forEach((label) => {
        label.style.opacity = `${nextCollapsed ? 1 - eased : eased}`;
      });
      if (nextCollapsed) {
        subnavMetrics.forEach(({ element, startHeight, startPaddingTop }) => {
          element.style.opacity = `${1 - eased}`;
          element.style.maxHeight = `${lerp(startHeight, 0, eased).toFixed(2)}px`;
          element.style.paddingTop = `${lerp(startPaddingTop, 0, eased).toFixed(2)}px`;
        });
      }

      if (progress < 1) {
        leftPaneAnimationFrameRef.current = window.requestAnimationFrame(applyFrame);
        return;
      }

      leftPaneAnimationFrameRef.current = null;
      if (nextCollapsed) setLeftCollapsed(true);
      const clearInlineStyles = () => {
        paneElement.style.flexBasis = "";
        paneElement.style.minWidth = "";
        paneElement.style.transition = "";
        if (resizeHandle) {
          resizeHandle.style.flexBasis = "";
          resizeHandle.style.minWidth = "";
          resizeHandle.style.transition = "";
        }
        navGroups.forEach((group) => {
          group.style.width = "";
          group.style.transition = "";
        });
        navLabels.forEach((label) => {
          label.style.opacity = "";
          label.style.transition = "";
        });
        subnavs.forEach((subnav) => {
          subnav.style.width = "";
          subnav.style.opacity = "";
          subnav.style.transition = "";
          subnav.style.maxHeight = "";
          subnav.style.overflow = "";
          subnav.style.paddingTop = "";
        });
      };
      const waitForCollapsedClass = () => {
        if (!nextCollapsed || layoutElement.classList.contains("is-left-collapsed")) {
          clearInlineStyles();
          setLeftPaneTransitioning(false);
          return;
        }
        window.requestAnimationFrame(waitForCollapsedClass);
      };
      window.requestAnimationFrame(waitForCollapsedClass);
    };

    leftPaneAnimationFrameRef.current = window.requestAnimationFrame(applyFrame);
  }, [leftCollapsed, startPaneTransitionGuard]);

  const startRightPaneContentFreeze = useCallback((nextCollapsed: boolean) => {
    const layoutElement = layoutRef.current;
    const bodyElement = layoutElement?.querySelector<HTMLElement>(".new-ui-pane-right .new-ui-pane-body");
    const paneElement = layoutElement?.querySelector<HTMLElement>(".new-ui-pane-right");
    if (!layoutElement || !bodyElement || !paneElement) return;

    const rightWidth = Number.parseFloat(getComputedStyle(layoutElement).getPropertyValue("--new-ui-right-width"))
      || Number.parseFloat(getComputedStyle(paneElement).flexBasis)
      || bodyElement.getBoundingClientRect().width
      || 320;
    const bodyWidth = Number.parseFloat(getComputedStyle(bodyElement).width) || rightWidth;
    const frozenWidth = nextCollapsed ? bodyWidth : rightWidth;
    layoutElement.style.setProperty("--new-ui-right-content-width", `${Math.max(54, frozenWidth).toFixed(2)}px`);
    setRightPaneTransitioning(true);
    if (rightPaneTransitionTimerRef.current) window.clearTimeout(rightPaneTransitionTimerRef.current);
    rightPaneTransitionTimerRef.current = window.setTimeout(() => {
      rightPaneTransitionTimerRef.current = null;
      setRightPaneTransitioning(false);
      layoutElement.style.removeProperty("--new-ui-right-content-width");
    }, PANE_TRANSITION_GUARD_MS);
  }, []);

  useEffect(() => {
    if (!showLibraryGraphPanel) return;
    startPaneTransitionGuard();
    startRightPaneContentFreeze(false);
    setRightCollapsed(false);
  }, [showLibraryGraphPanel, startPaneTransitionGuard, startRightPaneContentFreeze]);

  const toggleLeftCollapsed = () => {
    animateLeftCollapsed(!leftCollapsed);
  };

  const toggleRightCollapsed = () => {
    startPaneTransitionGuard();
    startRightPaneContentFreeze(!rightCollapsed);
    setRightCollapsed((value) => !value);
  };

  const expandLeftSidebar = useCallback(() => {
    if (!leftCollapsed) return;
    animateLeftCollapsed(false);
  }, [animateLeftCollapsed, leftCollapsed]);

  const openStructureGraphFromAnalysis = useCallback((target: { artifactId: string; title: string }) => {
    startPaneTransitionGuard();
    setStructureGraphReturn(target);
    setActiveSection("library");
    setActiveLibraryChild("sampleStructure");
  }, [startPaneTransitionGuard]);

  const returnToAnalysisFromGraph = useCallback(() => {
    startPaneTransitionGuard();
    setActiveSection("analysis");
  }, [startPaneTransitionGuard]);

  const openSourceAnalysisFromGraph = useCallback((target: { sampleVideoId: string; artifactId: string; title: string }) => {
    startPaneTransitionGuard();
    return new Promise<{ ok: boolean; message?: string | null }>((resolve) => {
      const requestId = Date.now();
      analysisOpenRequestResolvers.set(requestId, resolve);
      setAnalysisOpenRequest({ requestId, ...target });
      window.setTimeout(() => {
        if (!analysisOpenRequestResolvers.has(requestId)) return;
        analysisOpenRequestResolvers.delete(requestId);
        resolve({ ok: false, message: "打开结构分析超时" });
      }, 6000);
    });
  }, [startPaneTransitionGuard]);

  const handleAnalysisOpenRequestResolved = useCallback((result: { requestId: number; ok: boolean; message?: string | null }) => {
    const resolve = analysisOpenRequestResolvers.get(result.requestId);
    analysisOpenRequestResolvers.delete(result.requestId);
    if (result.ok) setActiveSection("analysis");
    resolve?.({ ok: result.ok, message: result.message });
    setAnalysisOpenRequest((current) => current?.requestId === result.requestId ? null : current);
  }, []);

  const handleSidebarSectionChange = useCallback((section: NewUiSectionId) => {
    setStructureGraphReturn(null);
    setActiveSection(section);
  }, []);

  const handleSidebarLibraryChildChange = useCallback((child: NewUiLibraryChildId) => {
    setStructureGraphReturn(null);
    setActiveLibraryChild(child);
  }, []);

  const handleSidebarRestructureConversationChange = useCallback((conversationId: string) => {
    setStructureGraphReturn(null);
    setActiveRestructureConversationId(conversationId);
  }, []);

  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    const loadConversations = async () => {
      try {
        const payload = await listAgentChatConversations({ role: "function-slot-restructure", status: "active" });
        if (cancelled) return;
        const conversations = payload.conversations ?? [];
        setRestructureConversations(conversations);
        setActiveRestructureConversationId((current) => (
          current && conversations.some((conversation) => conversation.conversationId === current)
            ? current
            : conversations[0]?.conversationId ?? null
        ));
      } catch {
        if (!cancelled) setRestructureConversations([]);
      }
    };
    void loadConversations();
    return () => {
      cancelled = true;
    };
  }, [active]);

  useEffect(() => {
    return () => {
      if (leftPaneAnimationFrameRef.current) window.cancelAnimationFrame(leftPaneAnimationFrameRef.current);
      if (paneResizeGuardTimerRef.current) window.clearTimeout(paneResizeGuardTimerRef.current);
      if (rightPaneTransitionTimerRef.current) window.clearTimeout(rightPaneTransitionTimerRef.current);
    };
  }, []);

  return (
    <section
      ref={layoutRef}
      className={`new-ui-layout ${leftCollapsed ? "is-left-collapsed" : ""} ${rightCollapsed ? "is-right-collapsed" : ""} ${paneTransitioning ? "is-pane-transitioning-layout" : ""} ${leftPaneTransitioning ? "is-left-pane-transitioning-layout" : ""} ${rightPaneTransitioning ? "is-right-pane-transitioning-layout" : ""}`.trim()}
      aria-label="新 UI 三栏工作区"
    >
      <aside className="new-ui-pane new-ui-pane-left" aria-label="左侧栏">
        <PaneHeader collapsed={leftCollapsed} onToggle={toggleLeftCollapsed} side="left" />
        <div className="new-ui-pane-body">
          <SidebarNav
            activeLibraryChild={activeLibraryChild}
            activeRestructureConversationId={activeRestructureConversationId}
            activeSection={activeSection}
            collapsed={leftCollapsed}
            sections={navSections}
            onLibraryChildChange={handleSidebarLibraryChildChange}
            onRequestExpandSidebar={expandLeftSidebar}
            onRestructureConversationChange={handleSidebarRestructureConversationChange}
            onSectionChange={handleSidebarSectionChange}
          />
        </div>
        <ThemeToggle theme={theme} onThemeChange={onThemeChange} />
      </aside>
      <SplitResizeHandle
        className={`new-ui-resize-handle new-ui-resize-handle-left ${leftCollapsed ? "is-collapsed" : ""}`.trim()}
        disabled={leftCollapsed}
        label="调整左栏宽度"
        orientation="vertical"
        onResizeStart={(event) => layout.startResize("left", event)}
        onReset={() => layout.resetSize("left")}
        onNudge={(direction) => layout.nudgeSize("left", direction)}
      />
      <main
        className="new-ui-center"
        aria-label={`${resolveSectionLabel(activeSection, activeLibraryChild)}工作区`}
        data-active-library-child={activeSection === "library" ? activeLibraryChild : undefined}
        data-active-section={activeSection}
      >
        {activeSection === "restructure" && selectedRestructureConversationTitle ? (
          <header className="new-ui-center-page-header">
            <h1 className="new-ui-center-page-title" title={selectedRestructureConversationTitle}>
              {selectedRestructureConversationTitle}
            </h1>
          </header>
        ) : null}
        <div className="new-ui-center-section" hidden={activeSection !== "analysis"} aria-hidden={activeSection !== "analysis"}>
          <AnalysisHome
            onDetailStateChange={handleAnalysisDetailStateChange}
            openRequest={analysisOpenRequest}
            onOpenRequestResolved={handleAnalysisOpenRequestResolved}
            timelineSelectionClearRequest={timelineSelectionClearRequest}
          />
        </div>
        <div className="new-ui-center-section" hidden={activeSection !== "library"} aria-hidden={activeSection !== "library"}>
          {activeSection === "library" ? (
            <AppErrorBoundary title="库图谱暂时不可用" resetKey={`${activeLibraryChild}:${structureGraphReturn?.artifactId ?? ""}`} maxAutoRetries={2} autoRetryDelayMs={300}>
              <FunctionSlotGraphWorkspace
                embedded
                active={active}
                fixedMode={libraryChildToGraphMode(activeLibraryChild)}
                requestedArtifactId={activeLibraryChild === "sampleStructure" ? structureGraphReturn?.artifactId ?? null : null}
                sourceReturn={activeLibraryChild === "sampleStructure" && structureGraphReturn ? {
                  title: structureGraphReturn.title,
                  onBack: returnToAnalysisFromGraph,
                } : null}
                onClearSourceReturn={() => setStructureGraphReturn(null)}
                onOpenSourceAnalysis={openSourceAnalysisFromGraph}
                panelSlot={(panel) => <LibraryGraphPanelPortal>{panel}</LibraryGraphPanelPortal>}
              />
            </AppErrorBoundary>
          ) : null}
        </div>
      </main>
      {!rightCollapsed ? (
        <SplitResizeHandle
          className="new-ui-resize-handle new-ui-resize-handle-right"
          label="调整右栏宽度"
          orientation="vertical"
          onResizeStart={(event) => layout.startResize("right", event)}
          onReset={() => layout.resetSize("right")}
          onNudge={(direction) => layout.nudgeSize("right", direction)}
        />
      ) : <div className="new-ui-resize-spacer" aria-hidden="true" />}
      <aside className="new-ui-pane new-ui-pane-right" aria-label="右侧栏">
        <PaneHeader collapsed={rightCollapsed} onToggle={toggleRightCollapsed} side="right" />
        <div className="new-ui-pane-body new-ui-pane-body-analysis-workflow" aria-hidden={rightCollapsed || !showRightPaneContent}>
          {showAnalysisWorkflow && analysisWorkflowMounted ? (
            <AnalysisWorkflowSidebar
              detail={analysisDetail}
              onOpenStructureGraph={openStructureGraphFromAnalysis}
              onWorkflowStageSelect={() => setTimelineSelectionClearRequest((value) => value + 1)}
            />
          ) : null}
          {showLibraryGraphPanel ? <div id="new-ui-library-graph-panel" className="new-ui-library-graph-panel" /> : null}
        </div>
      </aside>
    </section>
  );
}

function LibraryGraphPanelPortal({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const nextHost = document.getElementById("new-ui-library-graph-panel");
    setHost(nextHost);
  }, []);

  return host ? createPortal(children, host) : null;
}

function sameStringList(a: string[] | null | undefined, b: string[] | null | undefined) {
  const left = a ?? [];
  const right = b ?? [];
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function readStoredBooleanPreference(key: keyof NewUiThreePanePreference, fallback: boolean) {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(NEW_UI_THREE_PANE_STORAGE_KEY) ?? "null");
    return typeof parsed?.[key] === "boolean" ? parsed[key] : fallback;
  } catch {
    return fallback;
  }
}

function writeStoredLayoutPreference(preference: NewUiThreePanePreference) {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(NEW_UI_THREE_PANE_STORAGE_KEY) ?? "null");
    const current: Record<string, unknown> = parsed && typeof parsed === "object" ? parsed : {};
    const next = { ...current, ...preference };
    delete next.rightCollapsed;
    delete next.right;
    delete next.rightRatio;
    window.localStorage.setItem(NEW_UI_THREE_PANE_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Local layout preference is non-critical.
  }
}

type SidebarNavProps = {
  activeLibraryChild: NewUiLibraryChildId;
  activeRestructureConversationId: string | null;
  activeSection: NewUiSectionId;
  collapsed: boolean;
  sections: NewUiSection[];
  onLibraryChildChange: (child: NewUiLibraryChildId) => void;
  onRequestExpandSidebar: () => void;
  onRestructureConversationChange: (conversationId: string) => void;
  onSectionChange: (section: NewUiSectionId) => void;
};

const DEFAULT_EXPANDED_SIDEBAR_SECTIONS: NewUiSectionId[] = ["library", "restructure"];

function SidebarNav({
  activeLibraryChild,
  activeRestructureConversationId,
  activeSection,
  collapsed,
  sections,
  onLibraryChildChange,
  onRequestExpandSidebar,
  onRestructureConversationChange,
  onSectionChange,
}: SidebarNavProps) {
  const [expandedSections, setExpandedSections] = useState<NewUiSectionId[]>(DEFAULT_EXPANDED_SIDEBAR_SECTIONS);
  const expandedSectionsBeforeCollapseRef = useRef<NewUiSectionId[] | null>(DEFAULT_EXPANDED_SIDEBAR_SECTIONS);

  useEffect(() => {
    setExpandedSections((current) => {
      if (collapsed) {
        expandedSectionsBeforeCollapseRef.current = current;
        return [];
      }
      return current.length ? current : expandedSectionsBeforeCollapseRef.current ?? DEFAULT_EXPANDED_SIDEBAR_SECTIONS;
    });
  }, [collapsed]);

  return (
    <nav className="new-ui-sidebar-nav" aria-label="新 UI 功能导航">
      {sections.map((section) => {
        const isActive = section.id === activeSection;
        const hasChildren = Boolean(section.children?.length);
        const isExpanded = hasChildren && !collapsed && expandedSections.includes(section.id);
        const subnavStyle = hasChildren
          ? {
              "--new-ui-sidebar-subnav-expanded-height": `${((section.children?.length ?? 0) * 40) + 4}px`,
            } as CSSProperties
          : undefined;
        const navButton = (
          <button
            key={hasChildren ? undefined : section.id}
            className={`new-ui-sidebar-nav-item ${isActive ? "is-active" : ""} ${hasChildren ? "has-children" : ""}`.trim()}
            data-section={section.id}
            type="button"
            aria-current={isActive ? "page" : undefined}
            aria-expanded={hasChildren ? isExpanded : undefined}
            aria-label={collapsed ? section.label : undefined}
            title={collapsed ? section.label : undefined}
            onClick={() => {
              if (hasChildren) {
                if (section.id === "restructure") onSectionChange(section.id);
                if (collapsed) {
                  onRequestExpandSidebar();
                  setExpandedSections(expandedSectionsBeforeCollapseRef.current ?? DEFAULT_EXPANDED_SIDEBAR_SECTIONS);
                  return;
                }
                setExpandedSections((current) => current.includes(section.id)
                  ? current.filter((item) => item !== section.id)
                  : [...current, section.id]);
                return;
              }
              onSectionChange(section.id);
            }}
          >
            <span className="new-ui-sidebar-nav-icon" aria-hidden="true">
              <SectionIcon section={section.id} />
            </span>
            <span className="new-ui-sidebar-nav-label">{section.label}</span>
            {hasChildren ? <ExpandIndicator expanded={isExpanded} /> : null}
          </button>
        );

        if (!hasChildren) {
          return navButton;
        }

        return (
          <div
            key={section.id}
            className={`new-ui-sidebar-nav-group ${isExpanded ? "is-expanded" : ""}`.trim()}
            data-section={section.id}
          >
            {navButton}
            <div className="new-ui-sidebar-subnav" style={subnavStyle} aria-label={`${section.label}子类`}>
              {section.children?.map((child) => {
                const isChildActive = isActive && (
                  section.id === "library"
                    ? activeLibraryChild === child.id
                    : activeRestructureConversationId === child.id
                );
                return (
                  <button
                    key={child.id}
                    className={`new-ui-sidebar-subnav-item ${isChildActive ? "is-active" : ""}`.trim()}
                    type="button"
                    aria-current={isChildActive ? "page" : undefined}
                    onClick={() => {
                      onSectionChange(section.id);
                      if (section.id === "library") onLibraryChildChange(child.id as NewUiLibraryChildId);
                      if (section.id === "restructure") onRestructureConversationChange(child.id);
                    }}
                  >
                    {child.label}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </nav>
  );
}

function resolveSectionLabel(section: NewUiSectionId, libraryChild: NewUiLibraryChildId) {
  const active = NEW_UI_SECTIONS.find((item) => item.id === section);
  if (section === "library") {
    return active?.children?.find((child) => child.id === libraryChild)?.label ?? active?.label ?? "库";
  }
  return active?.label ?? "分析";
}

function libraryChildToGraphMode(child: NewUiLibraryChildId): GraphMode {
  if (child === "semanticGovernance") return "governance";
  if (child === "planTrace") return "planTrace";
  return "structure";
}

type SectionIconProps = {
  section: NewUiSectionId;
};

function SectionIcon({ section }: SectionIconProps) {
  if (section === "analysis") {
    return (
      <svg viewBox="0 0 24 24" focusable="false">
        <circle className="new-ui-section-icon-main" cx="10.2" cy="10.2" r="5.7" />
        <path className="new-ui-section-icon-main" d="M14.4 14.4 19.2 19.2" />
        <path className="new-ui-section-icon-detail new-ui-section-icon-analysis-line" d="M7.3 11.1 9.1 9.3 11.2 11.2 13.4 8.2" />
        <circle className="new-ui-section-icon-detail new-ui-section-icon-dot" cx="7.3" cy="11.1" r="0.55" />
        <circle className="new-ui-section-icon-detail new-ui-section-icon-dot" cx="9.1" cy="9.3" r="0.55" />
        <circle className="new-ui-section-icon-detail new-ui-section-icon-dot" cx="11.2" cy="11.2" r="0.55" />
        <circle className="new-ui-section-icon-detail new-ui-section-icon-dot" cx="13.4" cy="8.2" r="0.55" />
        <path className="new-ui-section-icon-alt new-ui-section-icon-analysis-scan" d="M7.2 10.2h6" />
        <path className="new-ui-section-icon-alt new-ui-section-icon-analysis-focus" d="M10.2 7.2v6" />
        <circle className="new-ui-section-icon-alt new-ui-section-icon-analysis-center" cx="10.2" cy="10.2" r="1" />
      </svg>
    );
  }

  if (section === "library") {
    return (
      <svg viewBox="0 0 24 24" focusable="false">
        <path className="new-ui-section-icon-main" d="M6.1 6.2h11.8a1.7 1.7 0 0 1 1.7 1.7v8.2a1.7 1.7 0 0 1-1.7 1.7H6.1a1.7 1.7 0 0 1-1.7-1.7V7.9a1.7 1.7 0 0 1 1.7-1.7Z" />
        <path className="new-ui-section-icon-detail new-ui-section-icon-library-top" d="M7.1 4.6h9.8" />
        <path className="new-ui-section-icon-detail new-ui-section-icon-library-bottom" d="M7.1 19.4h9.8" />
        <path className="new-ui-section-icon-detail new-ui-section-icon-library-row" d="M8 10.1h8" />
        <path className="new-ui-section-icon-detail new-ui-section-icon-library-row" d="M8 13.9h5.4" />
        <path className="new-ui-section-icon-alt new-ui-section-icon-library-handle" d="M9 10.1h6" />
        <path className="new-ui-section-icon-alt new-ui-section-icon-library-drawer" d="M7.4 13.9h9.2" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" focusable="false">
      <rect className="new-ui-section-icon-main new-ui-section-icon-node" x="4.4" y="4.4" width="5.2" height="5.2" rx="1.4" />
      <rect className="new-ui-section-icon-main new-ui-section-icon-node" x="14.4" y="4.4" width="5.2" height="5.2" rx="1.4" />
      <rect className="new-ui-section-icon-main new-ui-section-icon-node" x="9.4" y="14.4" width="5.2" height="5.2" rx="1.4" />
      <path className="new-ui-section-icon-detail new-ui-section-icon-link-top" d="M9.6 7h4.8" />
      <path className="new-ui-section-icon-detail new-ui-section-icon-link-left" d="M7 9.6c0.4 2.3 1.8 3.9 3.8 5.1" />
      <path className="new-ui-section-icon-detail new-ui-section-icon-link-right" d="M17 9.6c-0.4 2.3-1.8 3.9-3.8 5.1" />
      <path className="new-ui-section-icon-alt new-ui-section-icon-link-swap-a" d="M9.4 7.2c2.6 0.8 4.2 2.6 5.2 7.2" />
      <path className="new-ui-section-icon-alt new-ui-section-icon-link-swap-b" d="M14.6 7.2c-2.6 0.8-4.2 2.6-5.2 7.2" />
    </svg>
  );
}

function resolveConversationTitle(conversation: AgentChatConversation, index: number) {
  return conversation.title?.trim() || `会话 ${index + 1}`;
}

function ExpandIndicator({ expanded }: { expanded: boolean }) {
  return (
    <span className="new-ui-sidebar-expand-indicator" aria-hidden="true">
      <svg viewBox="0 0 16 16" focusable="false">
        {expanded ? <path d="M4.4 6.3 8 9.9l3.6-3.6" /> : <path d="M6.1 4.4 9.7 8l-3.6 3.6" />}
      </svg>
    </span>
  );
}

type ThemeToggleProps = {
  theme: NewUiTheme;
  onThemeChange: (theme: NewUiTheme) => void;
};

function ThemeToggle({ theme, onThemeChange }: ThemeToggleProps) {
  const isLight = theme === "light";

  return (
    <div className="new-ui-pane-theme">
      <button
        className="new-ui-theme-toggle"
        type="button"
        aria-label={isLight ? "切换到黑夜主题" : "切换到白天主题"}
        aria-pressed={isLight}
        onClick={() => onThemeChange(isLight ? "dark" : "light")}
      >
        <span className="new-ui-theme-icon-wrap" aria-hidden="true">
          <svg className="new-ui-theme-icon new-ui-theme-icon-sun" viewBox="0 0 24 24" focusable="false">
            <path className="new-ui-theme-icon-rays" d="M12 4.5V2m0 20v-2.5M4.5 12H2m20 0h-2.5M5.64 5.64 3.86 3.86m16.28 16.28-1.78-1.78m0-12.72 1.78-1.78M3.86 20.14l1.78-1.78" />
            <circle className="new-ui-theme-icon-core" cx="12" cy="12" r="4.2" />
          </svg>
          <svg className="new-ui-theme-icon new-ui-theme-icon-moon" viewBox="0 0 24 24" focusable="false">
            <path className="new-ui-theme-icon-crescent" d="M20.2 14.6A7.7 7.7 0 0 1 9.4 3.8 8.8 8.8 0 1 0 20.2 14.6Z" />
            <path className="new-ui-theme-icon-star new-ui-theme-icon-star-a" d="M6.4 5.2v2M5.4 6.2h2" />
            <path className="new-ui-theme-icon-star new-ui-theme-icon-star-b" d="M17 4.5v1.8M16.1 5.4h1.8" />
          </svg>
        </span>
      </button>
    </div>
  );
}

type PaneHeaderProps = {
  collapsed: boolean;
  side: "left" | "right";
  onToggle: () => void;
};

function PaneHeader({ collapsed, side, onToggle }: PaneHeaderProps) {
  return (
    <header className="new-ui-pane-header">
      <button
        className={`new-ui-pane-toggle new-ui-pane-toggle-${side} ${collapsed ? "is-collapsed" : ""}`}
        type="button"
        aria-label={collapsed ? `展开${side === "left" ? "左" : "右"}栏` : `收起${side === "left" ? "左" : "右"}栏`}
        aria-expanded={!collapsed}
        onClick={onToggle}
      >
        <span className="new-ui-pane-toggle-icon" aria-hidden="true">
          <span className="new-ui-pane-toggle-panel" />
          <span className="new-ui-pane-toggle-rail" />
        </span>
      </button>
    </header>
  );
}
