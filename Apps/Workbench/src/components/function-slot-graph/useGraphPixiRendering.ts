import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { clamp } from "./graphUtils";
import {
  applyPixiAlphaTween,
  capturePixiAlphaSnapshot,
  createPixiGraphObjects,
  destroyPixiGraphObjects,
  drawPixiBackground,
  syncPixiEdges,
  syncPixiFocus,
  syncPixiLabels,
  syncPixiLayout,
  syncPixiNodes,
  type PixiAlphaSnapshot,
  type PixiGraphObjects,
  type PixiGraphRenderState,
} from "./graphPixiRenderer";
import { easeOutCubic, graphVisualThemeKey, stageTransform, type ViewportAnimationOptions, type ViewportEasing, type ViewportTransform } from "./graphPixiCanvasUtils";
import { readGraphVisualTheme, type GraphVisualTheme } from "./graphVisualStyles";
import type { D3Link, SimNode } from "./types";
import type { Application, Container, Graphics } from "pixi.js";
import type { FunctionSlotGraphEdge } from "../../types/library";

type Ref<T> = MutableRefObject<T>;

type PixiLayers = {
  root: Container;
  background: Graphics;
  world: Container;
  edges: Container;
  nodeOcclusions: Container;
  nodes: Container;
  labels: Container;
};

const FOCUS_TRANSITION_MS = 160;

export function useGraphPixiRendering({
  active,
  appRef,
  canvasRef,
  layersRef,
  graphObjectsRef,
  graphThemeRef,
  graphThemeKeyRef,
  nodesRef,
  visibleEdgesRef,
  stateRef,
  viewportRef,
  canvasSizeRef,
  drawFrameRef,
  focusTransitionFrameRef,
  focusTransitionStartedAtRef,
  focusTransitionStartSnapshotRef,
  focusTransitionEndSnapshotRef,
  viewportStateFrameRef,
  zoomAnimationFrameRef,
  zoomAnimationStartedAtRef,
  zoomAnimationDurationMsRef,
  zoomAnimationEasingRef,
  zoomStartViewportRef,
  zoomTargetViewportRef,
  pendingDrawAfterResizeRef,
  suspendPixiRenderRef,
  syncGraphObjectsRef,
  syncGraphLayoutRef,
  syncGraphLabelsRef,
  syncGraphFocusRef,
  syncGraphThemeRef,
  applyViewportTransformRef,
  renderViewportRef,
  previewTickFrameRef,
  renderFpsWindowRef,
  setViewport,
  setPreviewTick,
  setRenderFps,
}: {
  active: boolean;
  appRef: Ref<Application | null>;
  canvasRef: Ref<HTMLDivElement | null>;
  layersRef: Ref<PixiLayers | null>;
  graphObjectsRef: Ref<PixiGraphObjects>;
  graphThemeRef: Ref<GraphVisualTheme>;
  graphThemeKeyRef: Ref<string>;
  nodesRef: Ref<SimNode[]>;
  visibleEdgesRef: Ref<FunctionSlotGraphEdge[]>;
  stateRef: Ref<PixiGraphRenderState>;
  viewportRef: Ref<ViewportTransform>;
  canvasSizeRef: Ref<{ width: number; height: number }>;
  drawFrameRef: Ref<number | null>;
  focusTransitionFrameRef: Ref<number | null>;
  focusTransitionStartedAtRef: Ref<number>;
  focusTransitionStartSnapshotRef: Ref<PixiAlphaSnapshot | null>;
  focusTransitionEndSnapshotRef: Ref<PixiAlphaSnapshot | null>;
  viewportStateFrameRef: Ref<number | null>;
  zoomAnimationFrameRef: Ref<number | null>;
  zoomAnimationStartedAtRef: Ref<number>;
  zoomAnimationDurationMsRef: Ref<number>;
  zoomAnimationEasingRef: Ref<ViewportEasing>;
  zoomStartViewportRef: Ref<ViewportTransform>;
  zoomTargetViewportRef: Ref<ViewportTransform>;
  pendingDrawAfterResizeRef: Ref<boolean>;
  suspendPixiRenderRef: Ref<boolean>;
  syncGraphObjectsRef: Ref<() => void>;
  syncGraphLayoutRef: Ref<() => void>;
  syncGraphLabelsRef: Ref<() => boolean>;
  syncGraphFocusRef: Ref<(previous: PixiGraphRenderState, next: PixiGraphRenderState) => boolean>;
  syncGraphThemeRef: Ref<() => void>;
  applyViewportTransformRef: Ref<() => void>;
  renderViewportRef: Ref<() => void>;
  previewTickFrameRef: Ref<number | null>;
  renderFpsWindowRef: Ref<{ startedAt: number; frames: number }>;
  setViewport: Dispatch<SetStateAction<ViewportTransform>>;
  setPreviewTick: Dispatch<SetStateAction<number>>;
  setRenderFps: Dispatch<SetStateAction<number>>;
}) {
  const commitViewportState = () => {
    if (viewportStateFrameRef.current) return;
    viewportStateFrameRef.current = window.requestAnimationFrame(() => {
      viewportStateFrameRef.current = null;
      setViewport(viewportRef.current);
    });
  };

  const schedulePreviewTick = () => {
    if (!active) return;
    if (!stateRef.current.hoveredNodeId && !stateRef.current.pinnedPreviewNodeId) return;
    if (previewTickFrameRef.current) return;
    previewTickFrameRef.current = window.requestAnimationFrame(() => {
      previewTickFrameRef.current = null;
      setPreviewTick((value) => value + 1);
    });
  };

  const scheduleDraw = () => {
    if (!active) return;
    if (suspendPixiRenderRef.current) {
      pendingDrawAfterResizeRef.current = true;
      return;
    }
    if (drawFrameRef.current) return;
    drawFrameRef.current = window.requestAnimationFrame(() => {
      drawFrameRef.current = null;
      syncGraphObjectsRef.current();
    });
  };

  const renderPixi = () => {
    if (!appRef.current?.renderer) return;
    appRef.current.render();
    recordRenderFrame();
  };

  const stopPixiFocusTransition = () => {
    if (!focusTransitionFrameRef.current) return;
    window.cancelAnimationFrame(focusTransitionFrameRef.current);
    focusTransitionFrameRef.current = null;
  };

  const syncGraphObjects = () => {
    if (suspendPixiRenderRef.current) {
      pendingDrawAfterResizeRef.current = true;
      return;
    }
    const layers = layersRef.current;
    if (!layers) return;
    stopPixiFocusTransition();
    applyViewportTransformRef.current();
    drawPixiBackground(layers.background, graphThemeRef.current);
    syncPixiEdges(layers.edges, graphObjectsRef.current, visibleEdgesRef.current, nodesRef.current, stateRef.current);
    syncPixiNodes(layers.nodeOcclusions, layers.nodes, layers.labels, graphObjectsRef.current, nodesRef.current, stateRef.current, viewportRef.current.k);
    renderPixi();
  };
  syncGraphObjectsRef.current = syncGraphObjects;

  const syncGraphTheme = () => {
    const tokenSource = canvasRef.current ?? null;
    const nextTheme = readGraphVisualTheme(tokenSource);
    const nextThemeKey = graphVisualThemeKey(nextTheme);
    const themeChanged = graphThemeKeyRef.current !== nextThemeKey;
    graphThemeRef.current = nextTheme;
    stateRef.current = { ...stateRef.current, theme: nextTheme };
    if (layersRef.current && !suspendPixiRenderRef.current) drawPixiBackground(layersRef.current.background, nextTheme);
    if (themeChanged) {
      stopPixiFocusTransition();
      destroyPixiGraphObjects(graphObjectsRef.current);
      graphObjectsRef.current = createPixiGraphObjects();
      graphThemeKeyRef.current = nextThemeKey;
    }
    scheduleDraw();
  };
  syncGraphThemeRef.current = syncGraphTheme;

  const syncGraphLayout = () => {
    if (suspendPixiRenderRef.current) {
      pendingDrawAfterResizeRef.current = true;
      return;
    }
    const rendered = syncPixiLayout(graphObjectsRef.current, visibleEdgesRef.current, nodesRef.current, stateRef.current);
    if (!rendered) {
      syncGraphObjectsRef.current();
      return;
    }
    renderPixi();
  };
  syncGraphLayoutRef.current = syncGraphLayout;

  const syncGraphLabels = () => {
    if (suspendPixiRenderRef.current) return false;
    const layers = layersRef.current;
    if (!layers) return false;
    const rendered = syncPixiLabels(layers.labels, graphObjectsRef.current, nodesRef.current, stateRef.current, viewportRef.current.k);
    if (!rendered) return false;
    renderPixi();
    return true;
  };
  syncGraphLabelsRef.current = syncGraphLabels;

  const syncGraphFocus = (previousState: PixiGraphRenderState, nextState: PixiGraphRenderState) => {
    const start = capturePixiAlphaSnapshot(graphObjectsRef.current);
    const rendered = syncPixiFocus(graphObjectsRef.current, visibleEdgesRef.current, nodesRef.current, previousState, nextState, viewportRef.current.k);
    if (!rendered) return false;
    startPixiFocusTransition(start, capturePixiAlphaSnapshot(graphObjectsRef.current));
    return true;
  };
  syncGraphFocusRef.current = syncGraphFocus;

  const applyViewportTransform = () => {
    const layers = layersRef.current;
    if (!layers) return;
    const transform = stageTransform(canvasSizeRef.current);
    layers.root.position.set(transform.offsetX, transform.offsetY);
    layers.root.scale.set(transform.scale);
    layers.world.position.set(viewportRef.current.x, viewportRef.current.y);
    layers.world.scale.set(viewportRef.current.k);
  };
  applyViewportTransformRef.current = applyViewportTransform;

  const startPixiFocusTransition = (start: PixiAlphaSnapshot, end: PixiAlphaSnapshot) => {
    stopPixiFocusTransition();
    focusTransitionStartedAtRef.current = performance.now();
    focusTransitionStartSnapshotRef.current = start;
    focusTransitionEndSnapshotRef.current = end;
    applyPixiAlphaTween(graphObjectsRef.current, start, end, 0);
    renderPixi();

    const step = (time: number) => {
      const startSnapshot = focusTransitionStartSnapshotRef.current;
      const endSnapshot = focusTransitionEndSnapshotRef.current;
      if (!startSnapshot || !endSnapshot) {
        focusTransitionFrameRef.current = null;
        return;
      }
      const progress = clamp((time - focusTransitionStartedAtRef.current) / FOCUS_TRANSITION_MS, 0, 1);
      const eased = 1 - ((1 - progress) ** 3);
      applyPixiAlphaTween(graphObjectsRef.current, startSnapshot, endSnapshot, eased);
      renderPixi();
      if (progress < 1) {
        focusTransitionFrameRef.current = window.requestAnimationFrame(step);
        return;
      }
      focusTransitionFrameRef.current = null;
    };
    focusTransitionFrameRef.current = window.requestAnimationFrame(step);
  };

  const recordRenderFrame = () => {
    const now = performance.now();
    const windowState = renderFpsWindowRef.current;
    windowState.frames += 1;
    const elapsed = now - windowState.startedAt;
    if (elapsed < 500) return;
    setRenderFps(Math.round((windowState.frames * 1000) / elapsed));
    renderFpsWindowRef.current = { startedAt: now, frames: 0 };
  };

  const renderViewport = () => {
    applyViewportTransformRef.current();
    renderPixi();
  };
  renderViewportRef.current = renderViewport;

  const applyAnimatedViewport = (nextViewport: ViewportTransform) => {
    const previousZoom = viewportRef.current.k;
    viewportRef.current = nextViewport;
    setViewport(nextViewport);
    applyViewportTransformRef.current();
    if (previousZoom !== nextViewport.k && syncGraphLabelsRef.current()) {
      schedulePreviewTick();
      return;
    }
    renderPixi();
    schedulePreviewTick();
  };

  const stopZoomAnimation = () => {
    if (!zoomAnimationFrameRef.current) return;
    window.cancelAnimationFrame(zoomAnimationFrameRef.current);
    zoomAnimationFrameRef.current = null;
  };

  const stepZoomAnimation = (time: number) => {
    const progress = clamp((time - zoomAnimationStartedAtRef.current) / zoomAnimationDurationMsRef.current, 0, 1);
    const eased = zoomAnimationEasingRef.current(progress);
    const start = zoomStartViewportRef.current;
    const target = zoomTargetViewportRef.current;
    applyAnimatedViewport({
      x: start.x + (target.x - start.x) * eased,
      y: start.y + (target.y - start.y) * eased,
      k: start.k + (target.k - start.k) * eased,
    });
    if (progress < 1) {
      zoomAnimationFrameRef.current = window.requestAnimationFrame(stepZoomAnimation);
      return;
    }
    zoomAnimationFrameRef.current = null;
    scheduleDraw();
  };

  const animateViewportTo = (targetViewport: ViewportTransform, options: ViewportAnimationOptions = {}) => {
    zoomStartViewportRef.current = viewportRef.current;
    zoomTargetViewportRef.current = targetViewport;
    zoomAnimationDurationMsRef.current = options.durationMs ?? zoomAnimationDurationMsRef.current;
    zoomAnimationEasingRef.current = options.easing ?? easeOutCubic;
    zoomAnimationStartedAtRef.current = performance.now();
    if (!zoomAnimationFrameRef.current) zoomAnimationFrameRef.current = window.requestAnimationFrame(stepZoomAnimation);
  };

  return {
    commitViewportState,
    schedulePreviewTick,
    scheduleDraw,
    stopPixiFocusTransition,
    stopZoomAnimation,
    animateViewportTo,
  };
}
