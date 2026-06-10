import { useEffect } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { Application, Container, Graphics } from "pixi.js";
import { createPixiGraphObjects, destroyPixiGraphObjects, drawPixiBackground, type PixiGraphObjects } from "./graphPixiRenderer";
import { VIEWBOX } from "./graphUtils";
import type { GraphMode } from "./graphPixiCanvasUtils";
import type { GraphVisualTheme } from "./graphVisualStyles";
import type { D3Link, DragState, GovernanceLayoutMode, SimNode } from "./types";
import type { Simulation } from "d3-force";

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

export function useGraphPixiLifecycle({
  active,
  fixedLayout,
  paused,
  graphArtifactId,
  layoutMode,
  mode,
  initRetry,
  hostRef,
  canvasRef,
  appRef,
  layersRef,
  graphObjectsRef,
  graphThemeRef,
  dragRef,
  forcePanRef,
  simulationRef,
  forceFrameRef,
  drawFrameRef,
  focusTransitionFrameRef,
  viewportStateFrameRef,
  zoomAnimationFrameRef,
  previewTickFrameRef,
  hoverOutTimerRef,
  resizeSyncFrameRef,
  pendingViewportFitRef,
  hasUserAdjustedViewportRef,
  pendingDrawAfterResizeRef,
  suspendPixiRenderRef,
  restartSimulationRef,
  syncGraphThemeRef,
  syncGraphObjectsRef,
  setInitRetry,
  setHoveredNodeId,
  setPinnedPreviewNodeId,
  setPixiError,
  setResetToken,
  updateCanvasSize,
  scheduleDraw,
  stopZoomAnimation,
  stopPixiFocusTransition,
}: {
  active: boolean;
  fixedLayout: boolean;
  paused: boolean;
  graphArtifactId: string;
  layoutMode: GovernanceLayoutMode;
  mode: GraphMode;
  initRetry: number;
  hostRef: Ref<HTMLDivElement | null>;
  canvasRef: Ref<HTMLDivElement | null>;
  appRef: Ref<Application | null>;
  layersRef: Ref<PixiLayers | null>;
  graphObjectsRef: Ref<PixiGraphObjects>;
  graphThemeRef: Ref<GraphVisualTheme>;
  dragRef: Ref<DragState | null>;
  forcePanRef: Ref<boolean>;
  simulationRef: Ref<Simulation<SimNode, D3Link> | null>;
  forceFrameRef: Ref<number | null>;
  drawFrameRef: Ref<number | null>;
  focusTransitionFrameRef: Ref<number | null>;
  viewportStateFrameRef: Ref<number | null>;
  zoomAnimationFrameRef: Ref<number | null>;
  previewTickFrameRef: Ref<number | null>;
  hoverOutTimerRef: Ref<number | null>;
  resizeSyncFrameRef: Ref<number | null>;
  pendingViewportFitRef: Ref<boolean>;
  hasUserAdjustedViewportRef: Ref<boolean>;
  pendingDrawAfterResizeRef: Ref<boolean>;
  suspendPixiRenderRef: Ref<boolean>;
  restartSimulationRef: Ref<(alpha?: number) => void>;
  syncGraphThemeRef: Ref<() => void>;
  syncGraphObjectsRef: Ref<() => void>;
  setInitRetry: Dispatch<SetStateAction<number>>;
  setHoveredNodeId: Dispatch<SetStateAction<string | null>>;
  setPinnedPreviewNodeId: Dispatch<SetStateAction<string | null>>;
  setPixiError: Dispatch<SetStateAction<string | null>>;
  setResetToken: Dispatch<SetStateAction<number>>;
  updateCanvasSize: () => boolean;
  scheduleDraw: () => void;
  stopZoomAnimation: () => void;
  stopPixiFocusTransition: () => void;
}) {
  useEffect(() => {
    if (!active && forceFrameRef.current) cancelAnimationFrame(forceFrameRef.current);
    if (!active && drawFrameRef.current) cancelAnimationFrame(drawFrameRef.current);
    if (!active && focusTransitionFrameRef.current) cancelAnimationFrame(focusTransitionFrameRef.current);
    if (!active && viewportStateFrameRef.current) cancelAnimationFrame(viewportStateFrameRef.current);
    if (!active && zoomAnimationFrameRef.current) cancelAnimationFrame(zoomAnimationFrameRef.current);
    if (!active && previewTickFrameRef.current) cancelAnimationFrame(previewTickFrameRef.current);
    if (!active) {
      simulationRef.current?.stop();
      return;
    }
    if (!fixedLayout && !paused) restartSimulationRef.current(0.55);
    scheduleDraw();
  }, [active, fixedLayout, paused]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space") return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, button")) return;
      forcePanRef.current = true;
      event.preventDefault();
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") forcePanRef.current = false;
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  useEffect(() => {
    pendingViewportFitRef.current = true;
    hasUserAdjustedViewportRef.current = false;
    pendingDrawAfterResizeRef.current = false;
    suspendPixiRenderRef.current = false;
    setHoveredNodeId(null);
    setPinnedPreviewNodeId(null);
    dragRef.current = null;
    stopZoomAnimation();
    stopPixiFocusTransition();
    if (drawFrameRef.current) {
      cancelAnimationFrame(drawFrameRef.current);
      drawFrameRef.current = null;
    }
    if (focusTransitionFrameRef.current) {
      cancelAnimationFrame(focusTransitionFrameRef.current);
      focusTransitionFrameRef.current = null;
    }
    destroyPixiGraphObjects(graphObjectsRef.current);
    graphObjectsRef.current = createPixiGraphObjects();
    updateCanvasSize();
    if (hoverOutTimerRef.current) {
      clearTimeout(hoverOutTimerRef.current);
      hoverOutTimerRef.current = null;
    }
    setResetToken((value) => value + 1);
    scheduleDraw();
  }, [graphArtifactId, layoutMode, mode]);

  useEffect(() => {
    let disposed = false;
    let initialized = false;
    const host = hostRef.current;
    if (!host) return undefined;
    const initialRect = host.getBoundingClientRect();
    if (initialRect.width <= 0 || initialRect.height <= 0) {
      const frameId = requestAnimationFrame(() => {
        if (!disposed) setInitRetry((value) => value + 1);
      });
      return () => {
        disposed = true;
        cancelAnimationFrame(frameId);
      };
    }
    const app = new Application();
    appRef.current = app;
    const root = new Container();
    const background = new Graphics();
    const world = new Container();
    const edges = new Container();
    const nodeOcclusions = new Container();
    const nodes = new Container();
    const labels = new Container();
    root.addChild(background);
    world.addChild(edges);
    world.addChild(nodeOcclusions);
    world.addChild(nodes);
    world.addChild(labels);
    root.addChild(world);
    layersRef.current = { root, background, world, edges, nodeOcclusions, nodes, labels };

    app.init({
      antialias: true,
      autoStart: false,
      autoDensity: true,
      backgroundAlpha: 0,
      preference: "webgl",
      width: host.offsetWidth || VIEWBOX.width,
      height: host.offsetHeight || VIEWBOX.height,
      resolution: Math.max(1, Math.min(window.devicePixelRatio || 1, 2)),
    }).then(() => {
      initialized = true;
      if (disposed) {
        app.destroy(true);
        return;
      }
      host.appendChild(app.canvas);
      app.stage.addChild(root);
      updateCanvasSize();
      syncGraphThemeRef.current();
      drawPixiBackground(background, graphThemeRef.current);
      syncGraphObjectsRef.current();
    }).catch((error) => {
      setPixiError(error instanceof Error ? error.message : "Pixi 初始化失败");
    });

    const syncResize = () => {
      suspendPixiRenderRef.current = false;
      const sizeChanged = updateCanvasSize();
      if (sizeChanged) drawPixiBackground(background, graphThemeRef.current);
      if (sizeChanged || pendingDrawAfterResizeRef.current) {
        pendingDrawAfterResizeRef.current = false;
        scheduleDraw();
      }
    };
    const queueResizeSync = () => {
      suspendPixiRenderRef.current = true;
      if (resizeSyncFrameRef.current) return;
      resizeSyncFrameRef.current = requestAnimationFrame(() => {
        resizeSyncFrameRef.current = null;
        syncResize();
      });
    };
    const resizeObserver = new ResizeObserver(queueResizeSync);
    resizeObserver.observe(host);

    return () => {
      disposed = true;
      resizeObserver.disconnect();
      if (resizeSyncFrameRef.current) cancelAnimationFrame(resizeSyncFrameRef.current);
      resizeSyncFrameRef.current = null;
      pendingDrawAfterResizeRef.current = false;
      suspendPixiRenderRef.current = false;
      simulationRef.current?.stop();
      simulationRef.current = null;
      if (forceFrameRef.current) cancelAnimationFrame(forceFrameRef.current);
      if (drawFrameRef.current) cancelAnimationFrame(drawFrameRef.current);
      if (focusTransitionFrameRef.current) cancelAnimationFrame(focusTransitionFrameRef.current);
      if (viewportStateFrameRef.current) cancelAnimationFrame(viewportStateFrameRef.current);
      if (zoomAnimationFrameRef.current) cancelAnimationFrame(zoomAnimationFrameRef.current);
      if (previewTickFrameRef.current) cancelAnimationFrame(previewTickFrameRef.current);
      if (hoverOutTimerRef.current) clearTimeout(hoverOutTimerRef.current);
      destroyPixiGraphObjects(graphObjectsRef.current);
      if (initialized) app.destroy(true);
      appRef.current = null;
      layersRef.current = null;
    };
  }, [initRetry]);

  useEffect(() => {
    if (!active) return undefined;
    syncGraphThemeRef.current();
    const host = hostRef.current;
    const shell = host?.closest(".slot-graph-shell");
    const themeRoot = host?.closest(".new-ui-shell");
    const canvas = canvasRef.current;
    const observer = new MutationObserver(() => syncGraphThemeRef.current());
    if (shell) observer.observe(shell, { attributes: true, attributeFilter: ["class", "style"] });
    if (themeRoot) observer.observe(themeRoot, { attributes: true, attributeFilter: ["data-theme", "class", "style"] });
    if (canvas) observer.observe(canvas, { attributes: true, attributeFilter: ["class", "style"] });
    return () => observer.disconnect();
  }, [active]);
}
