import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { archiveAgentChatConversation, collectAgentChatTurn, listAgentChatConversations, sendAgentChatMessage, startAgentChatThread } from "../../api/client";
import { useResizableThreePaneLayout } from "../../hooks/useResizableThreePaneLayout";
import type { AgentChatConversation } from "../../types";
import type { NewUiTheme } from "../../utils/workbenchPreferences";
import { AppErrorBoundary } from "../AppErrorBoundary";
import { SplitResizeHandle } from "../SplitResizeHandle";
import { AnalysisHome } from "./AnalysisHome";
import { AnalysisWorkflowSidebar, type AnalysisDetailSidebarState } from "./AnalysisWorkflowSidebar";
import { FunctionSlotGraphWorkspace, type GraphMode } from "../FunctionSlotGraphApp";
import { NewUiRestructureWorkspace } from "./NewUiRestructureWorkspace";
import { NewUiTurnTimelinePanel, type NewUiTurnTimelineTarget } from "./NewUiTurnTimelinePanel";

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
  updatedAgoLabel?: string | null;
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
const RESTRUCTURE_TURN_POLL_INTERVAL_MS = 1600;
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

type RunningRestructureTurn = {
  conversationId: string;
  role?: string | null;
  threadId: string;
  turnId: string;
  workspaceRoot?: string | null;
};

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
  const runningRestructureTurnsRef = useRef<Record<string, RunningRestructureTurn>>({});
  const restructureTurnPollTimersRef = useRef<Record<string, number>>({});
  const [leftCollapsed, setLeftCollapsed] = useState(() => readStoredBooleanPreference("leftCollapsed", false));
  const [rightCollapsed, setRightCollapsed] = useState(true);
  const [activeSection, setActiveSection] = useState<NewUiSectionId>("analysis");
  const [activeLibraryChild, setActiveLibraryChild] = useState<NewUiLibraryChildId>("sampleStructure");
  const [activeRestructureConversationId, setActiveRestructureConversationId] = useState<string | null>(null);
  const [draftingRestructureConversation, setDraftingRestructureConversation] = useState(false);
  const [restructureConversations, setRestructureConversations] = useState<AgentChatConversation[]>([]);
  const [relativeTimeNowMs, setRelativeTimeNowMs] = useState(() => Date.now());
  const [creatingRestructureConversation, setCreatingRestructureConversation] = useState(false);
  const [sendingRestructureMessage, setSendingRestructureMessage] = useState(false);
  const [runningRestructureConversationIds, setRunningRestructureConversationIds] = useState<Record<string, boolean>>({});
  const [runningRestructureTurns, setRunningRestructureTurns] = useState<Record<string, RunningRestructureTurn>>({});
  const [archiveConfirmConversationId, setArchiveConfirmConversationId] = useState<string | null>(null);
  const [archivingConversationId, setArchivingConversationId] = useState<string | null>(null);
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
  const navSections = useMemo(() => NEW_UI_SECTIONS.map((section) => (
    section.id === "restructure"
      ? {
          ...section,
          children: restructureConversations.map((conversation, index) => ({
            id: conversation.conversationId,
            label: resolveConversationTitle(conversation, index),
            updatedAgoLabel: formatConversationUpdatedAgo(conversation.updatedAt, relativeTimeNowMs),
          })),
      }
      : section
  )), [relativeTimeNowMs, restructureConversations]);
  const selectedRestructureConversation = useMemo(() => (
    restructureConversations.find((conversation) => conversation.conversationId === activeRestructureConversationId) ?? null
  ), [activeRestructureConversationId, restructureConversations]);
  const selectedRunningRestructureTurn = activeRestructureConversationId ? runningRestructureTurns[activeRestructureConversationId] ?? null : null;
  const selectedRestructureTurnTarget = useMemo(
    () => resolveRestructureTurnTarget(selectedRestructureConversation, selectedRunningRestructureTurn),
    [selectedRestructureConversation, selectedRunningRestructureTurn],
  );
  const showAnalysisWorkflow = activeSection === "analysis" && analysisDetail.visible && Boolean(analysisDetail.item);
  const showLibraryGraphPanel = activeSection === "library";
  const showRestructureTracePanel = activeSection === "restructure" && Boolean(selectedRestructureConversation);
  const showRightPaneContent = showAnalysisWorkflow || showLibraryGraphPanel || showRestructureTracePanel;
  const analysisWorkflowRevealKey = showAnalysisWorkflow && analysisDetail.item
    ? `${analysisDetail.item.sampleVideoId}:${analysisDetail.item.workflowRunId ?? ""}:${analysisDetail.item.artifactId ?? ""}`
    : null;
  const layout = useResizableThreePaneLayout({
    containerRef: layoutRef,
    storageKey: NEW_UI_THREE_PANE_STORAGE_KEY,
    leftCssVar: "--new-ui-left-width",
    rightCssVar: "--new-ui-right-width",
    defaultLeft: 320,
    defaultRight: showAnalysisWorkflow ? 420 : showLibraryGraphPanel ? 360 : showRestructureTracePanel ? 380 : 320,
    minLeft: 0,
    maxLeft: Number.POSITIVE_INFINITY,
    minCenter: 420,
    minRight: showAnalysisWorkflow ? 420 : showLibraryGraphPanel ? 320 : showRestructureTracePanel ? 340 : 0,
    maxRight: Number.POSITIVE_INFINITY,
    leftRatio: { min: 0.1, max: 0.3 },
    rightRatio: showAnalysisWorkflow ? { min: 0.18, max: 0.34 } : showLibraryGraphPanel ? { min: 0.16, max: 0.32 } : showRestructureTracePanel ? { min: 0.16, max: 0.32 } : { min: 0.1, max: 0.3 },
    persistedSides: { left: true, right: false },
  });

  useEffect(() => {
    onLeftCollapsedChange?.(leftCollapsed);
  }, [leftCollapsed, onLeftCollapsedChange]);

  useEffect(() => {
    writeStoredLayoutPreference({ leftCollapsed });
  }, [leftCollapsed]);

  useEffect(() => {
    if (!active) return undefined;
    const timerId = window.setInterval(() => setRelativeTimeNowMs(Date.now()), 60000);
    return () => window.clearInterval(timerId);
  }, [active]);

  useEffect(() => {
    if (!analysisWorkflowRevealKey) {
      lastAnalysisWorkflowRevealKeyRef.current = null;
      setAnalysisWorkflowMounted(false);
      if (!showLibraryGraphPanel && !showRestructureTracePanel) setRightCollapsed(true);
      return;
    }
    if (lastAnalysisWorkflowRevealKeyRef.current === analysisWorkflowRevealKey) return;
    lastAnalysisWorkflowRevealKeyRef.current = analysisWorkflowRevealKey;
    setAnalysisWorkflowMounted(false);
    setRightCollapsed(false);
  }, [analysisWorkflowRevealKey, showLibraryGraphPanel, showRestructureTracePanel]);

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
    layoutElement.style.setProperty("--new-ui-left-divider-opacity", nextCollapsed ? "1" : "0");
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
      layoutElement.style.setProperty("--new-ui-left-divider-opacity", `${nextCollapsed ? 1 - eased : eased}`);
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
        layoutElement.style.removeProperty("--new-ui-left-divider-opacity");
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

  useEffect(() => {
    if (!showRestructureTracePanel) return;
    startPaneTransitionGuard();
    startRightPaneContentFreeze(false);
    setRightCollapsed(false);
  }, [showRestructureTracePanel, startPaneTransitionGuard, startRightPaneContentFreeze]);

  const toggleLeftCollapsed = () => {
    animateLeftCollapsed(!leftCollapsed);
  };

  const toggleRightCollapsed = () => {
    startPaneTransitionGuard();
    startRightPaneContentFreeze(!rightCollapsed);
    setRightCollapsed((value) => !value);
  };

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
    if (section === "restructure" && !activeRestructureConversationId) setDraftingRestructureConversation(true);
  }, [activeRestructureConversationId]);

  const handleSidebarLibraryChildChange = useCallback((child: NewUiLibraryChildId) => {
    setStructureGraphReturn(null);
    setActiveLibraryChild(child);
  }, []);

  const handleSidebarRestructureConversationChange = useCallback((conversationId: string) => {
    setStructureGraphReturn(null);
    setArchiveConfirmConversationId(null);
    setDraftingRestructureConversation(false);
    setActiveRestructureConversationId(conversationId);
  }, []);

  const refreshRestructureConversations = useCallback(async (preferredConversationId?: string | null) => {
    const payload = await listAgentChatConversations({ role: "function-slot-restructure", status: "active" });
    const conversations = payload.conversations ?? [];
    setRestructureConversations(conversations);
    setActiveRestructureConversationId((current) => {
      const target = preferredConversationId && conversations.some((conversation) => conversation.conversationId === preferredConversationId)
        ? preferredConversationId
        : current;
      return target && conversations.some((conversation) => conversation.conversationId === target)
        ? target
        : conversations[0]?.conversationId ?? null;
    });
    if (preferredConversationId && conversations.some((conversation) => conversation.conversationId === preferredConversationId)) {
      setDraftingRestructureConversation(false);
    }
    return conversations;
  }, []);

  const handleArchiveRestructureConversation = useCallback(async (conversationId: string) => {
    if (archivingConversationId) return;
    if (archiveConfirmConversationId !== conversationId) {
      setArchiveConfirmConversationId(conversationId);
      return;
    }
    setArchivingConversationId(conversationId);
    try {
      await archiveAgentChatConversation(conversationId);
      setArchiveConfirmConversationId(null);
      await refreshRestructureConversations(activeRestructureConversationId === conversationId ? null : activeRestructureConversationId);
    } catch {
      setArchiveConfirmConversationId(null);
    } finally {
      setArchivingConversationId(null);
    }
  }, [activeRestructureConversationId, archiveConfirmConversationId, archivingConversationId, refreshRestructureConversations]);

  const handleArchiveConfirmLeave = useCallback((conversationId: string) => {
    if (archivingConversationId === conversationId) return;
    setArchiveConfirmConversationId((current) => (current === conversationId ? null : current));
  }, [archivingConversationId]);

  const handleNewRestructureConversation = useCallback(() => {
    setStructureGraphReturn(null);
    setActiveSection("restructure");
    setActiveRestructureConversationId(null);
    setArchiveConfirmConversationId(null);
    setDraftingRestructureConversation(true);
  }, []);

  const clearRunningRestructureTurn = useCallback((conversationId: string) => {
    const timer = restructureTurnPollTimersRef.current[conversationId];
    if (timer) window.clearTimeout(timer);
    delete restructureTurnPollTimersRef.current[conversationId];
    delete runningRestructureTurnsRef.current[conversationId];
    setRunningRestructureTurns((current) => {
      if (!current[conversationId]) return current;
      const next = { ...current };
      delete next[conversationId];
      return next;
    });
    setRunningRestructureConversationIds((current) => {
      if (!current[conversationId]) return current;
      const next = { ...current };
      delete next[conversationId];
      return next;
    });
  }, []);

  const scheduleRestructureTurnPoll = useCallback((runningTurn: RunningRestructureTurn) => {
    const { conversationId } = runningTurn;
    const previousTimer = restructureTurnPollTimersRef.current[conversationId];
    if (previousTimer) window.clearTimeout(previousTimer);
    runningRestructureTurnsRef.current[conversationId] = runningTurn;
    setRunningRestructureTurns((current) => ({ ...current, [conversationId]: runningTurn }));
    setRunningRestructureConversationIds((current) => current[conversationId] ? current : { ...current, [conversationId]: true });

    const poll = async () => {
      try {
        const current = runningRestructureTurnsRef.current[conversationId];
        if (!current) return;
        const turn = await collectAgentChatTurn(
          current.threadId,
          current.turnId,
          current.workspaceRoot,
          current.conversationId,
          { role: current.role ?? "function-slot-restructure" },
        );
        await refreshRestructureConversations(current.conversationId);
        if (isTerminalAgentTurnStatus(turn.status)) {
          clearRunningRestructureTurn(current.conversationId);
          return;
        }
        restructureTurnPollTimersRef.current[current.conversationId] = window.setTimeout(poll, RESTRUCTURE_TURN_POLL_INTERVAL_MS);
      } catch {
        clearRunningRestructureTurn(conversationId);
      }
    };

    restructureTurnPollTimersRef.current[conversationId] = window.setTimeout(poll, RESTRUCTURE_TURN_POLL_INTERVAL_MS);
  }, [clearRunningRestructureTurn, refreshRestructureConversations]);

  const handleSendRestructureMessage = useCallback(async (message: string) => {
    const conversation = selectedRestructureConversation;
    if ((!conversation?.threadId && !draftingRestructureConversation) || sendingRestructureMessage) return;
    setSendingRestructureMessage(true);
    let startedSession: Awaited<ReturnType<typeof startAgentChatThread>> | null = null;
    try {
      if (!conversation?.threadId) {
        setCreatingRestructureConversation(true);
        startedSession = await startAgentChatThread({
          source: "threadpool-role",
          role: "function-slot-restructure",
        });
        if (!startedSession.threadId) throw new Error(startedSession.message ?? "新建重组会话失败");
      }
      const threadId = conversation?.threadId ?? startedSession?.threadId;
      if (!threadId) throw new Error("当前重组会话缺少可发送的 thread");
      const submitted = await sendAgentChatMessage(threadId, {
        message,
        source: conversation?.source === "direct" ? "direct" : "threadpool-role",
        role: conversation?.role ?? startedSession?.role ?? "function-slot-restructure",
        leaseId: conversation?.leaseId ?? startedSession?.leaseId ?? null,
        parentThreadId: conversation?.parentThreadId ?? startedSession?.parentThreadId ?? null,
        conversationId: conversation?.conversationId ?? startedSession?.conversationId ?? null,
        expectedRevision: conversation?.revision ?? startedSession?.conversationRevision ?? null,
        workspaceRoot: conversation?.workspaceRoot ?? startedSession?.workspaceRoot ?? null,
        skillPath: conversation?.skillPath ?? startedSession?.skillPath ?? null,
      });
      const nextConversationId = submitted.conversationId ?? conversation?.conversationId ?? startedSession?.conversationId ?? null;
      if (nextConversationId) scheduleRestructureTurnPoll({
        conversationId: nextConversationId,
        role: submitted.role ?? conversation?.role ?? startedSession?.role ?? "function-slot-restructure",
        threadId: submitted.threadId ?? threadId,
        turnId: submitted.turnId,
        workspaceRoot: submitted.workspaceRoot ?? conversation?.workspaceRoot ?? startedSession?.workspaceRoot ?? null,
      });
      setDraftingRestructureConversation(false);
      await refreshRestructureConversations(nextConversationId);
    } finally {
      setCreatingRestructureConversation(false);
      setSendingRestructureMessage(false);
    }
  }, [draftingRestructureConversation, refreshRestructureConversations, scheduleRestructureTurnPoll, selectedRestructureConversation, sendingRestructureMessage]);

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
      Object.values(restructureTurnPollTimersRef.current).forEach((timer) => window.clearTimeout(timer));
      restructureTurnPollTimersRef.current = {};
      runningRestructureTurnsRef.current = {};
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
            archiveConfirmConversationId={archiveConfirmConversationId}
            archivingConversationId={archivingConversationId}
            creatingRestructureConversation={creatingRestructureConversation}
            onArchiveConfirmLeave={handleArchiveConfirmLeave}
            onArchiveRestructureConversation={(conversationId) => void handleArchiveRestructureConversation(conversationId)}
            onLibraryChildChange={handleSidebarLibraryChildChange}
            onNewRestructureConversation={() => void handleNewRestructureConversation()}
            onRestructureConversationChange={handleSidebarRestructureConversationChange}
            onSectionChange={handleSidebarSectionChange}
            runningRestructureConversationIds={runningRestructureConversationIds}
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
        <div className="new-ui-center-section" hidden={activeSection !== "restructure"} aria-hidden={activeSection !== "restructure"}>
          {activeSection === "restructure" ? (
            <NewUiRestructureWorkspace
              conversation={selectedRestructureConversation}
              creatingConversation={creatingRestructureConversation}
              draftingConversation={draftingRestructureConversation}
              onNewConversation={() => void handleNewRestructureConversation()}
              onSendMessage={handleSendRestructureMessage}
              sendingMessage={sendingRestructureMessage}
            />
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
          {showRestructureTracePanel ? (
            <section className="new-ui-analysis-workflow-detail new-ui-restructure-trace-panel" aria-label="当前重组 turn 运行追踪">
              <div className="new-ui-analysis-workflow-detail-header">
                <h2 className="new-ui-analysis-workflow-detail-title">追踪 Timeline</h2>
                <span className={`new-ui-analysis-workflow-detail-status ${selectedRestructureTurnTarget?.running ? "is-running" : ""}`.trim()}>
                  {selectedRestructureTurnTarget?.running ? "生成中" : "最近一轮"}
                </span>
              </div>
              <NewUiTurnTimelinePanel title="当前会话 turn" target={selectedRestructureTurnTarget} />
            </section>
          ) : null}
        </div>
      </aside>
      <ThemedTooltipLayer rootRef={layoutRef} />
    </section>
  );
}

function ThemedTooltipLayer({ rootRef }: { rootRef: { current: HTMLElement | null } }) {
  const [tooltip, setTooltip] = useState<{ text: string; left: number; top: number; placement: "top" | "bottom"; variables: CSSProperties } | null>(null);
  const showTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;

    const clearShowTimer = () => {
      if (showTimerRef.current === null) return;
      window.clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    };

    const showTooltip = (target: Element | null) => {
      const anchor = target instanceof HTMLElement ? target.closest<HTMLElement>("[data-tooltip]") : null;
      const text = anchor?.dataset.tooltip?.trim();
      if (!anchor || !text) {
        setTooltip(null);
        return;
      }
      const rect = anchor.getBoundingClientRect();
      const placement = rect.top < 44 ? "bottom" : "top";
      const left = Math.min(Math.max(rect.left + rect.width / 2, 16), window.innerWidth - 16);
      const top = placement === "top" ? rect.top - 10 : rect.bottom + 10;
      setTooltip({ text, left, top, placement, variables: readTooltipVariables(root) });
    };

    const scheduleTooltip = (target: Element | null, delayMs: number) => {
      clearShowTimer();
      showTimerRef.current = window.setTimeout(() => {
        showTimerRef.current = null;
        showTooltip(target);
      }, delayMs);
    };

    const hideTooltip = () => {
      clearShowTimer();
      setTooltip(null);
    };
    const handlePointerOver = (event: PointerEvent) => scheduleTooltip(event.target as Element | null, 420);
    const handlePointerOut = (event: PointerEvent) => {
      const fromAnchor = event.target instanceof HTMLElement ? event.target.closest("[data-tooltip]") : null;
      const toAnchor = event.relatedTarget instanceof HTMLElement ? event.relatedTarget.closest("[data-tooltip]") : null;
      if (fromAnchor && fromAnchor === toAnchor) return;
      hideTooltip();
    };
    const handleFocusIn = (event: FocusEvent) => scheduleTooltip(event.target as Element | null, 120);

    root.addEventListener("pointerover", handlePointerOver);
    root.addEventListener("focusin", handleFocusIn);
    root.addEventListener("pointerout", handlePointerOut);
    root.addEventListener("focusout", hideTooltip);
    root.addEventListener("pointerdown", hideTooltip);
    window.addEventListener("scroll", hideTooltip, true);
    window.addEventListener("resize", hideTooltip);
    return () => {
      root.removeEventListener("pointerover", handlePointerOver);
      root.removeEventListener("focusin", handleFocusIn);
      root.removeEventListener("pointerout", handlePointerOut);
      root.removeEventListener("focusout", hideTooltip);
      root.removeEventListener("pointerdown", hideTooltip);
      window.removeEventListener("scroll", hideTooltip, true);
      window.removeEventListener("resize", hideTooltip);
      clearShowTimer();
    };
  }, [rootRef]);

  return tooltip ? createPortal(
    <div
      className="new-ui-tooltip-layer"
      data-placement={tooltip.placement}
      style={{ ...tooltip.variables, left: tooltip.left, top: tooltip.top }}
      role="tooltip"
    >
      {tooltip.text}
    </div>,
    document.body,
  ) : null;
}

function readTooltipVariables(source: HTMLElement): CSSProperties {
  const computed = getComputedStyle(source);
  return {
    "--new-ui-control-border": computed.getPropertyValue("--new-ui-control-border"),
    "--new-ui-control-shadow": computed.getPropertyValue("--new-ui-control-shadow"),
    "--new-ui-control-text": computed.getPropertyValue("--new-ui-control-text"),
    "--new-ui-surface": computed.getPropertyValue("--new-ui-surface"),
    "--new-ui-text": computed.getPropertyValue("--new-ui-text"),
  } as CSSProperties;
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
  archiveConfirmConversationId: string | null;
  archivingConversationId: string | null;
  collapsed: boolean;
  creatingRestructureConversation: boolean;
  sections: NewUiSection[];
  onArchiveConfirmLeave: (conversationId: string) => void;
  onArchiveRestructureConversation: (conversationId: string) => void;
  onLibraryChildChange: (child: NewUiLibraryChildId) => void;
  onNewRestructureConversation: () => void;
  onRestructureConversationChange: (conversationId: string) => void;
  onSectionChange: (section: NewUiSectionId) => void;
  runningRestructureConversationIds: Record<string, boolean>;
};

const DEFAULT_EXPANDED_SIDEBAR_SECTIONS: NewUiSectionId[] = ["library", "restructure"];

function SidebarNav({
  activeLibraryChild,
  activeRestructureConversationId,
  activeSection,
  archiveConfirmConversationId,
  archivingConversationId,
  collapsed,
  creatingRestructureConversation,
  sections,
  onArchiveConfirmLeave,
  onArchiveRestructureConversation,
  onLibraryChildChange,
  onNewRestructureConversation,
  onRestructureConversationChange,
  onSectionChange,
  runningRestructureConversationIds,
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
        const navItemClassName = `new-ui-sidebar-nav-item ${isActive ? "is-active" : ""} ${hasChildren ? "has-children is-static" : ""}`.trim();
        const navContent = (
          <>
            <span className="new-ui-sidebar-nav-icon" aria-hidden="true">
              <SectionIcon section={section.id} />
            </span>
            <span className="new-ui-sidebar-nav-label">
              <span className="new-ui-sidebar-nav-label-text">{section.label}</span>
            </span>
          </>
        );
        const navButton = hasChildren ? (
          <div
            className={navItemClassName}
            data-section={section.id}
            aria-current={isActive ? "page" : undefined}
          >
            {navContent}
          </div>
        ) : (
          <button
            key={section.id}
            className={navItemClassName}
            data-section={section.id}
            type="button"
            aria-current={isActive ? "page" : undefined}
            aria-label={collapsed ? section.label : undefined}
            data-tooltip={collapsed ? section.label : undefined}
            onClick={() => onSectionChange(section.id)}
          >
            {navContent}
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
            <div className="new-ui-sidebar-nav-row">
              {navButton}
              {section.id === "restructure" ? (
                <button
                  className="new-ui-sidebar-nav-action"
                  type="button"
                  aria-label="新建重组会话"
                  data-tooltip="新会话"
                  disabled={creatingRestructureConversation}
                  onClick={(event) => {
                    event.stopPropagation();
                    onNewRestructureConversation();
                  }}
                >
                  <NewConversationIcon />
                </button>
              ) : null}
            </div>
            <div className="new-ui-sidebar-subnav" style={subnavStyle} aria-label={`${section.label}子类`}>
              {section.children?.map((child) => {
                const isChildActive = isActive && (
                  section.id === "library"
                    ? activeLibraryChild === child.id
                    : activeRestructureConversationId === child.id
                );
                if (section.id === "restructure") {
                  const confirmingArchive = archiveConfirmConversationId === child.id;
                  const archiving = archivingConversationId === child.id;
                  const runningTurn = Boolean(runningRestructureConversationIds[child.id]);
                  return (
                    <div
                      key={child.id}
                      className={`new-ui-sidebar-subnav-item has-meta has-archive ${isChildActive ? "is-active" : ""} ${confirmingArchive ? "is-confirming-archive" : ""} ${runningTurn ? "is-running-turn" : ""}`.trim()}
                      onMouseLeave={confirmingArchive ? () => onArchiveConfirmLeave(child.id) : undefined}
                    >
                      <button
                        className="new-ui-sidebar-subnav-select"
                        type="button"
                        aria-current={isChildActive ? "page" : undefined}
                        data-tooltip={child.updatedAgoLabel ? `${child.label}，最新更新 ${child.updatedAgoLabel}前` : child.label}
                        onClick={() => {
                          onSectionChange(section.id);
                          onRestructureConversationChange(child.id);
                        }}
                      >
                        <span className="new-ui-sidebar-subnav-label">{child.label}</span>
                      </button>
                      <button
                        className="new-ui-sidebar-subnav-archive"
                        type="button"
                        aria-label={confirmingArchive ? `确认归档${child.label}` : `归档${child.label}`}
                        data-tooltip={confirmingArchive ? "确认归档" : "归档会话"}
                        disabled={Boolean(archivingConversationId)}
                        onClick={() => onArchiveRestructureConversation(child.id)}
                      >
                        <span className="new-ui-sidebar-subnav-time" aria-hidden={confirmingArchive || archiving || runningTurn ? "true" : undefined}>
                          {child.updatedAgoLabel}
                        </span>
                        {runningTurn ? <SidebarTurnSpinnerIcon /> : null}
                        {confirmingArchive ? <ArchiveConfirmIcon /> : <ArchiveTrashIcon />}
                      </button>
                    </div>
                  );
                }
                return (
                  <button
                    key={child.id}
                    className={`new-ui-sidebar-subnav-item has-icon ${isChildActive ? "is-active" : ""}`.trim()}
                    type="button"
                    aria-current={isChildActive ? "page" : undefined}
                    data-tooltip={child.label}
                    onClick={() => {
                      onSectionChange(section.id);
                      if (section.id === "library") onLibraryChildChange(child.id as NewUiLibraryChildId);
                    }}
                  >
                    <span className="new-ui-sidebar-subnav-icon" aria-hidden="true">
                      <LibraryChildIcon child={child.id as NewUiLibraryChildId} />
                    </span>
                    <span className="new-ui-sidebar-subnav-label">{child.label}</span>
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

function resolveRestructureTurnTarget(
  conversation: AgentChatConversation | null,
  runningTurn: RunningRestructureTurn | null,
): NewUiTurnTimelineTarget | null {
  if (runningTurn) {
    return {
      threadId: runningTurn.threadId,
      turnId: runningTurn.turnId,
      workspaceRoot: runningTurn.workspaceRoot,
      running: true,
    };
  }
  const threadId = conversation?.threadId?.trim();
  if (!threadId) return null;
  const messages = conversation?.messages ?? [];
  const runningMessage = [...messages].reverse().find((message) => message.role === "assistant" && message.status === "running" && message.turnId);
  const latestAssistant = [...messages].reverse().find((message) => message.role === "assistant" && message.turnId);
  const latestMessage = [...messages].reverse().find((message) => message.turnId);
  const turnId = runningMessage?.turnId ?? conversation?.latestTurnId ?? latestAssistant?.turnId ?? latestMessage?.turnId ?? null;
  if (!turnId) return null;
  return {
    threadId,
    turnId,
    workspaceRoot: conversation?.workspaceRoot ?? null,
    running: runningMessage?.turnId === turnId,
  };
}

type SectionIconProps = {
  section: NewUiSectionId;
};

type LibraryChildIconProps = {
  child: NewUiLibraryChildId;
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

function LibraryChildIcon({ child }: LibraryChildIconProps) {
  if (child === "semanticGovernance") {
    return (
      <svg viewBox="0 0 24 24" focusable="false">
        <path d="M3 8v4.172a2 2 0 0 0 .586 1.414l5.71 5.71a2.41 2.41 0 0 0 3.408 0l3.592 -3.592a2.41 2.41 0 0 0 0 -3.408l-5.71 -5.71a2 2 0 0 0 -1.414 -.586h-4.172a2 2 0 0 0 -2 2" />
        <path d="M18 19l1.592 -1.592a4.82 4.82 0 0 0 0 -6.816l-4.592 -4.592" />
        <path d="M7 10h-.01" />
      </svg>
    );
  }

  if (child === "planTrace") {
    return (
      <svg viewBox="0 0 24 24" focusable="false">
        <path d="M4 16l6 -7l5 5l5 -6" />
        <path d="M14 14a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" />
        <path d="M9 9a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" />
        <path d="M3 16a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" />
        <path d="M19 8a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" focusable="false">
      <path d="M3 7a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" />
      <path d="M14 15a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" />
      <path d="M15 6a3 3 0 1 0 6 0a3 3 0 1 0 -6 0" />
      <path d="M3 18a3 3 0 1 0 6 0a3 3 0 1 0 -6 0" />
      <path d="M9 17l5 -1.5" />
      <path d="M6.5 8.5l7.81 5.37" />
      <path d="M7 7l8 -1" />
    </svg>
  );
}

function resolveConversationTitle(conversation: AgentChatConversation, index: number) {
  return conversation.title?.trim() || `会话 ${index + 1}`;
}

function formatConversationUpdatedAgo(value: string | null | undefined, nowMs: number) {
  const timestamp = Date.parse(value ?? "");
  if (!Number.isFinite(timestamp)) return null;
  const elapsedMs = Math.max(0, nowMs - timestamp);
  const minuteMs = 60000;
  const hourMs = 60 * minuteMs;
  const dayMs = 24 * hourMs;
  if (elapsedMs < hourMs) return `${Math.max(1, Math.floor(elapsedMs / minuteMs))}分`;
  if (elapsedMs < dayMs) return `${Math.max(1, Math.floor(elapsedMs / hourMs))}小时`;
  return `${Math.max(1, Math.floor(elapsedMs / dayMs))}天`;
}

function isTerminalAgentTurnStatus(status: string | null | undefined) {
  const normalized = String(status ?? "").toLowerCase();
  if (!normalized) return false;
  return !["placeholder", "pending", "queued", "submitted", "running", "processing"].includes(normalized);
}

function NewConversationIcon() {
  return (
    <svg viewBox="0 0 18 18" focusable="false" aria-hidden="true">
      <path d="M9 3.4v11.2M3.4 9h11.2" />
    </svg>
  );
}

function SidebarTurnSpinnerIcon() {
  return (
    <svg className="new-ui-sidebar-subnav-spinner" viewBox="0 0 20 20" focusable="false" aria-hidden="true">
      <circle className="new-ui-sidebar-subnav-spinner-track" cx="10" cy="10" r="6.4" />
      <path className="new-ui-sidebar-subnav-spinner-arc" d="M10 3.6a6.4 6.4 0 0 1 6.2 4.8" />
    </svg>
  );
}

function ArchiveTrashIcon() {
  return (
    <svg className="new-ui-sidebar-subnav-archive-icon new-ui-sidebar-subnav-trash-icon" viewBox="0 0 18 18" focusable="false" aria-hidden="true">
      <path d="M5.2 6.8h7.6" />
      <path d="M7.4 6.8V5.5a1 1 0 0 1 1-1h1.2a1 1 0 0 1 1 1v1.3" />
      <path d="M6.1 6.8 6.6 13a1.3 1.3 0 0 0 1.3 1.2h2.2a1.3 1.3 0 0 0 1.3-1.2l0.5-6.2" />
      <path d="M8.1 8.7v3.1M9.9 8.7v3.1" />
    </svg>
  );
}

function ArchiveConfirmIcon() {
  return (
    <svg className="new-ui-sidebar-subnav-archive-icon" viewBox="0 0 18 18" focusable="false" aria-hidden="true">
      <path d="M4.6 9.3 7.5 12.1 13.5 5.9" />
    </svg>
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
