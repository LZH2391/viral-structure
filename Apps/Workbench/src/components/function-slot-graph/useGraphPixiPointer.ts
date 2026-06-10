import { useCallback, useEffect } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { clamp } from "./graphUtils";
import {
  buildHitGrid,
  currentHostGeometry,
  easeOutQuad,
  fitGraphViewport,
  hitTestHitGrid,
  isSamplePreviewNode,
  MAX_ZOOM,
  MIN_ZOOM,
  SEARCH_RESULT_ANIMATION_MS,
  SEARCH_RESULT_FOCUS_ZOOM,
  stageTransform,
  visibleCanvasGeometryFor,
  type GraphMode,
  type HitGridIndex,
  type ViewportAnimationOptions,
  type ViewportTransform,
} from "./graphPixiCanvasUtils";
import type { DragState, SimNode, VisibleGraph } from "./types";

type Ref<T> = MutableRefObject<T>;

export function useGraphPixiPointer({
  active,
  fixedLayout,
  mode,
  paused,
  hostRef,
  canvasRef,
  nodesRef,
  dragRef,
  forcePanRef,
  lastPointerEventAtRef,
  viewportRef,
  canvasSizeRef,
  hostRectRef,
  hitGridRef,
  hitGridDirtyRef,
  hoverOutTimerRef,
  hoverSuppressUntilRef,
  stateRef,
  zoomAnimationFrameRef,
  zoomTargetViewportRef,
  hasUserAdjustedViewportRef,
  pendingViewportFitRef,
  restartSimulationRef,
  syncGraphLayoutRef,
  renderViewportRef,
  startPointerRef,
  movePointerRef,
  endPointerRef,
  hideHoverSoonRef,
  onSelectNode,
  setSelectedFocusDepth,
  setHoveredNodeId,
  setPinnedPreviewNodeId,
  setResetToken,
  commitViewportState,
  schedulePreviewTick,
  stopZoomAnimation,
  animateViewportTo,
  visible,
  clickFocusDepth,
  hoverFocusDepth,
  pointerDragThresholdPx,
}: {
  active: boolean;
  fixedLayout: boolean;
  mode: GraphMode;
  paused: boolean;
  hostRef: Ref<HTMLDivElement | null>;
  canvasRef: Ref<HTMLDivElement | null>;
  nodesRef: Ref<SimNode[]>;
  dragRef: Ref<DragState | null>;
  forcePanRef: Ref<boolean>;
  lastPointerEventAtRef: Ref<number>;
  viewportRef: Ref<ViewportTransform>;
  canvasSizeRef: Ref<{ width: number; height: number }>;
  hostRectRef: Ref<DOMRectReadOnly | null>;
  hitGridRef: Ref<HitGridIndex | null>;
  hitGridDirtyRef: Ref<boolean>;
  hoverOutTimerRef: Ref<number | null>;
  hoverSuppressUntilRef: Ref<number>;
  stateRef: Ref<{ hoveredNodeId: string | null }>;
  zoomAnimationFrameRef: Ref<number | null>;
  zoomTargetViewportRef: Ref<ViewportTransform>;
  hasUserAdjustedViewportRef: Ref<boolean>;
  pendingViewportFitRef: Ref<boolean>;
  restartSimulationRef: Ref<(alpha?: number) => void>;
  syncGraphLayoutRef: Ref<() => void>;
  renderViewportRef: Ref<() => void>;
  startPointerRef: Ref<(event: globalThis.PointerEvent | MouseEvent) => void>;
  movePointerRef: Ref<(event: globalThis.PointerEvent | MouseEvent) => void>;
  endPointerRef: Ref<(event: globalThis.PointerEvent | MouseEvent) => void>;
  hideHoverSoonRef: Ref<(nodeId?: string | null) => void>;
  onSelectNode: (id: string | null) => void;
  setSelectedFocusDepth: Dispatch<SetStateAction<number>>;
  setHoveredNodeId: Dispatch<SetStateAction<string | null>>;
  setPinnedPreviewNodeId: Dispatch<SetStateAction<string | null>>;
  setResetToken: Dispatch<SetStateAction<number>>;
  commitViewportState: () => void;
  schedulePreviewTick: () => void;
  stopZoomAnimation: () => void;
  animateViewportTo: (targetViewport: ViewportTransform, options?: ViewportAnimationOptions) => void;
  visible: VisibleGraph;
  clickFocusDepth: number;
  hoverFocusDepth: number;
  pointerDragThresholdPx: number;
}) {
  const currentGeometry = () => {
    const geometry = currentHostGeometry(hostRef.current, canvasSizeRef.current);
    if (geometry) hostRectRef.current = geometry.rect;
    return geometry;
  };

  const visibleCanvasGeometry = () => visibleCanvasGeometryFor(hostRef.current, canvasRef.current, canvasSizeRef.current);

  const screenToLayoutPoint = (clientX: number, clientY: number) => {
    const geometry = currentGeometry();
    if (!geometry) return null;
    const scaleX = geometry.rect.width ? geometry.size.width / geometry.rect.width : 1;
    const scaleY = geometry.rect.height ? geometry.size.height / geometry.rect.height : 1;
    return {
      x: (clientX - geometry.rect.left) * scaleX,
      y: (clientY - geometry.rect.top) * scaleY,
      size: geometry.size,
    };
  };

  const graphPoint = (clientX: number, clientY: number) => {
    const localPoint = screenToLayoutPoint(clientX, clientY);
    if (!localPoint) return { x: 0, y: 0 };
    const transform = stageTransform(localPoint.size);
    const rawX = (localPoint.x - transform.offsetX) / transform.scale;
    const rawY = (localPoint.y - transform.offsetY) / transform.scale;
    const view = viewportRef.current;
    return { x: (rawX - view.x) / view.k, y: (rawY - view.y) / view.k };
  };

  const markHitGridDirty = () => {
    hitGridDirtyRef.current = true;
  };

  const hitTestNode = (point: { x: number; y: number }) => {
    if (hitGridDirtyRef.current || !hitGridRef.current) {
      hitGridRef.current = buildHitGrid(nodesRef.current);
      hitGridDirtyRef.current = false;
    }
    return hitGridRef.current ? hitTestHitGrid(hitGridRef.current, point, viewportRef.current.k) : null;
  };

  const showHover = (nodeId: string | null) => {
    if (Date.now() < hoverSuppressUntilRef.current) return;
    if (hoverOutTimerRef.current) window.clearTimeout(hoverOutTimerRef.current);
    hoverOutTimerRef.current = null;
    setHoveredNodeId(nodeId);
  };

  const hideHoverSoon = (nodeId: string | null = stateRef.current.hoveredNodeId) => {
    if (hoverOutTimerRef.current) {
      if (isSamplePreviewNode(nodesRef.current.find((node) => node.id === nodeId) ?? null)) return;
      window.clearTimeout(hoverOutTimerRef.current);
    }
    hoverOutTimerRef.current = null;
    if (!isSamplePreviewNode(nodesRef.current.find((node) => node.id === nodeId) ?? null)) {
      setHoveredNodeId(null);
      return;
    }
    hoverOutTimerRef.current = window.setTimeout(() => setHoveredNodeId(null), 150);
  };

  const closePreview = () => {
    if (hoverOutTimerRef.current) window.clearTimeout(hoverOutTimerRef.current);
    hoverOutTimerRef.current = null;
    hoverSuppressUntilRef.current = Date.now() + 240;
    setPinnedPreviewNodeId(null);
    setHoveredNodeId(null);
  };

  const blurGovernanceSearch = () => {
    const activeElement = document.activeElement as HTMLElement | null;
    if (activeElement?.closest(".slot-graph-governance-search")) activeElement.blur();
  };

  const startPointer = (event: globalThis.PointerEvent | MouseEvent) => {
    const shouldForcePan = forcePanRef.current || event.shiftKey || event.button === 1 || event.button === 2;
    if (event.button !== 0 && !shouldForcePan) return;
    blurGovernanceSearch();
    event.preventDefault();
    stopZoomAnimation();
    const host = hostRef.current;
    const point = graphPoint(event.clientX, event.clientY);
    const hitNode = hitTestNode(point);
    if ("pointerId" in event) host?.setPointerCapture(event.pointerId);
    if (hitNode && !shouldForcePan) {
      dragRef.current = {
        kind: "node",
        nodeId: hitNode.id,
        dx: hitNode.x - point.x,
        dy: hitNode.y - point.y,
        clientX: event.clientX,
        clientY: event.clientY,
        selectFocusDepth: event.ctrlKey ? Number.POSITIVE_INFINITY : clickFocusDepth,
        moved: false,
      };
      showHover(hitNode.id);
      return;
    }
    closePreview();
    dragRef.current = {
      kind: "pan",
      clientX: event.clientX,
      clientY: event.clientY,
      startX: viewportRef.current.x,
      startY: viewportRef.current.y,
      moved: false,
    };
  };

  const movePointer = (event: globalThis.PointerEvent | MouseEvent) => {
    const drag = dragRef.current;
    if (!drag) {
      const hitNode = hitTestNode(graphPoint(event.clientX, event.clientY));
      if (hitNode) showHover(hitNode.id);
      else hideHoverSoon();
      return;
    }
    if (drag.kind === "node") {
      const moved = drag.moved || Math.hypot(event.clientX - drag.clientX, event.clientY - drag.clientY) > pointerDragThresholdPx;
      if (!moved) return;
      const point = graphPoint(event.clientX, event.clientY);
      const draggedNode = nodesRef.current.find((node) => node.id === drag.nodeId);
      if (draggedNode) {
        draggedNode.fx = point.x + drag.dx;
        draggedNode.fy = point.y + drag.dy;
        draggedNode.x = draggedNode.fx;
        draggedNode.y = draggedNode.fy;
        draggedNode.vx = 0;
        draggedNode.vy = 0;
        markHitGridDirty();
      }
      dragRef.current = { ...drag, moved };
      if (active && !fixedLayout) restartSimulationRef.current(0.75);
      syncGraphLayoutRef.current();
      schedulePreviewTick();
      return;
    }
    const moved = drag.moved || Math.hypot(event.clientX - drag.clientX, event.clientY - drag.clientY) > 3;
    const geometry = currentGeometry();
    const size = geometry?.size ?? canvasSizeRef.current;
    const screenRect = geometry?.rect ?? hostRectRef.current;
    const transform = stageTransform(size);
    const scaleX = screenRect?.width ? size.width / screenRect.width : 1;
    const scaleY = screenRect?.height ? size.height / screenRect.height : 1;
    const nextViewport = {
      ...viewportRef.current,
      x: drag.startX + ((event.clientX - drag.clientX) * scaleX) / transform.scale,
      y: drag.startY + ((event.clientY - drag.clientY) * scaleY) / transform.scale,
    };
    dragRef.current = { ...drag, moved };
    if (moved) hasUserAdjustedViewportRef.current = true;
    viewportRef.current = nextViewport;
    commitViewportState();
    renderViewportRef.current();
    schedulePreviewTick();
  };

  const endPointer = (event: globalThis.PointerEvent | MouseEvent) => {
    const host = hostRef.current;
    if ("pointerId" in event && host?.hasPointerCapture(event.pointerId)) host.releasePointerCapture(event.pointerId);
    const drag = dragRef.current;
    if (drag?.kind === "node" && drag.moved) {
      const draggedNode = nodesRef.current.find((node) => node.id === drag.nodeId);
      if (draggedNode) {
        const anchorX = draggedNode.layoutX ?? draggedNode.x;
        const anchorY = draggedNode.layoutY ?? draggedNode.y;
        draggedNode.fx = fixedLayout ? anchorX : null;
        draggedNode.fy = fixedLayout ? anchorY : null;
        if (fixedLayout) {
          draggedNode.x = anchorX;
          draggedNode.y = anchorY;
        }
        draggedNode.vx = 0;
        draggedNode.vy = 0;
      }
      if (active && !fixedLayout) restartSimulationRef.current(paused ? 0 : 0.55);
      syncGraphLayoutRef.current();
    }
    if (drag?.kind === "node" && !drag.moved) {
      const clickedNode = nodesRef.current.find((node) => node.id === drag.nodeId);
      setSelectedFocusDepth(drag.selectFocusDepth);
      onSelectNode(drag.nodeId);
      if (clickedNode?.type === "libraryItem" || clickedNode?.type === "sourceSample") setPinnedPreviewNodeId(clickedNode.id);
    }
    if (drag?.kind === "pan" && !drag.moved) {
      setSelectedFocusDepth(clickFocusDepth);
      onSelectNode(null);
    }
    dragRef.current = null;
  };

  startPointerRef.current = startPointer;
  movePointerRef.current = movePointer;
  endPointerRef.current = endPointer;
  hideHoverSoonRef.current = hideHoverSoon;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const preventContextMenu = (event: MouseEvent) => event.preventDefault();
    const markPointer = () => {
      lastPointerEventAtRef.current = Date.now();
    };
    const hidePointerHoverSoon = () => {
      hideHoverSoonRef.current();
    };
    const handlePointerDown = (event: globalThis.PointerEvent) => {
      markPointer();
      startPointerRef.current(event);
    };
    const handlePointerMove = (event: globalThis.PointerEvent) => {
      markPointer();
      movePointerRef.current(event);
    };
    const handlePointerEnd = (event: globalThis.PointerEvent) => {
      markPointer();
      endPointerRef.current(event);
    };
    const shouldIgnoreMouse = () => Date.now() - lastPointerEventAtRef.current < 500;
    const handleMouseMove = (event: MouseEvent) => {
      if (!shouldIgnoreMouse()) movePointerRef.current(event);
    };
    const handleMouseUp = (event: MouseEvent) => {
      if (!shouldIgnoreMouse()) endPointerRef.current(event);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
    const handleMouseDown = (event: MouseEvent) => {
      if (shouldIgnoreMouse()) return;
      startPointerRef.current(event);
      if (!dragRef.current) return;
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    };
    host.addEventListener("pointerdown", handlePointerDown);
    host.addEventListener("pointermove", handlePointerMove);
    host.addEventListener("pointerup", handlePointerEnd);
    host.addEventListener("pointercancel", handlePointerEnd);
    host.addEventListener("pointerleave", hidePointerHoverSoon);
    host.addEventListener("mousemove", handleMouseMove);
    host.addEventListener("mousedown", handleMouseDown);
    host.addEventListener("contextmenu", preventContextMenu);
    return () => {
      host.removeEventListener("pointerdown", handlePointerDown);
      host.removeEventListener("pointermove", handlePointerMove);
      host.removeEventListener("pointerup", handlePointerEnd);
      host.removeEventListener("pointercancel", handlePointerEnd);
      host.removeEventListener("pointerleave", hidePointerHoverSoon);
      host.removeEventListener("mousemove", handleMouseMove);
      host.removeEventListener("mousedown", handleMouseDown);
      host.removeEventListener("contextmenu", preventContextMenu);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  const zoom = useCallback((event: globalThis.WheelEvent) => {
    event.preventDefault();
    hasUserAdjustedViewportRef.current = true;
    const localPoint = screenToLayoutPoint(event.clientX, event.clientY);
    if (!localPoint) return;
    const transform = stageTransform(localPoint.size);
    const rawX = (localPoint.x - transform.offsetX) / transform.scale;
    const rawY = (localPoint.y - transform.offsetY) / transform.scale;
    const current = zoomAnimationFrameRef.current ? zoomTargetViewportRef.current : viewportRef.current;
    const nextK = clamp(current.k * Math.exp(-event.deltaY * 0.0012), MIN_ZOOM, MAX_ZOOM);
    const worldX = (rawX - current.x) / current.k;
    const worldY = (rawY - current.y) / current.k;
    const nextViewport = { k: nextK, x: rawX - worldX * nextK, y: rawY - worldY * nextK };
    animateViewportTo(nextViewport);
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    host.addEventListener("wheel", zoom, { passive: false });
    return () => host.removeEventListener("wheel", zoom);
  }, [zoom]);

  const resetView = () => {
    stopZoomAnimation();
    pendingViewportFitRef.current = false;
    hasUserAdjustedViewportRef.current = false;
    const nextViewport = fitGraphViewport(nodesRef.current, canvasSizeRef.current, mode, visibleCanvasGeometry()?.bounds);
    setResetToken((value) => value + 1);
    animateViewportTo(nextViewport);
  };

  const selectGovernanceSearchResult = (nodeId: string) => {
    const node = nodesRef.current.find((entry) => entry.id === nodeId) ?? visible.nodes.find((entry) => entry.id === nodeId);
    if (!node) return;
    stopZoomAnimation();
    setSelectedFocusDepth(hoverFocusDepth);
    setHoveredNodeId(null);
    setPinnedPreviewNodeId(null);
    onSelectNode(node.id);
    const size = canvasSizeRef.current;
    const transform = stageTransform(size);
    const bounds = visibleCanvasGeometry()?.bounds ?? { left: 0, top: 0, right: size.width, bottom: size.height };
    const centerX = ((bounds.left + bounds.right) / 2 - transform.offsetX) / transform.scale;
    const centerY = ((bounds.top + bounds.bottom) / 2 - transform.offsetY) / transform.scale;
    const targetK = clamp(SEARCH_RESULT_FOCUS_ZOOM, MIN_ZOOM, MAX_ZOOM);
    animateViewportTo(
      {
        k: targetK,
        x: centerX - node.x * targetK,
        y: centerY - node.y * targetK,
      },
      { durationMs: SEARCH_RESULT_ANIMATION_MS, easing: easeOutQuad },
    );
  };

  return {
    currentGeometry,
    visibleCanvasGeometry,
    markHitGridDirty,
    showHover,
    hideHoverSoon,
    closePreview,
    resetView,
    selectGovernanceSearchResult,
    zoom,
  };
}
