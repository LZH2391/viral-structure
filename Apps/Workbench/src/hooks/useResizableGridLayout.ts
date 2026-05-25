import { RefObject, useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";

const SPLITTER_SIZE = 6;
const SMALL_SCREEN_QUERY = "(max-width: 980px)";

type GridLayout = {
  left: number;
  top: number;
  bottomLeft: number;
};

type ResizeKind = "column" | "top-row" | "bottom-row";

type DragState = {
  kind: ResizeKind;
  startX: number;
  startY: number;
  startLayout: GridLayout;
};

type UseResizableGridLayoutOptions = {
  containerRef: RefObject<HTMLElement>;
  storageKey: string;
  leftCssVar: string;
  topCssVar: string;
  bottomLeftCssVar: string;
  defaultLeft: number;
  minLeft: number;
  maxLeft: number;
  minRight: number;
  defaultTop: number;
  minTop: number;
  maxTop: number;
  minBottomTop: number;
  defaultBottomLeft: number;
  minBottomLeft: number;
  maxBottomLeft: number;
  minBottomRight: number;
};

export function useResizableGridLayout({
  containerRef,
  storageKey,
  leftCssVar,
  topCssVar,
  bottomLeftCssVar,
  defaultLeft,
  minLeft,
  maxLeft,
  minRight,
  defaultTop,
  minTop,
  maxTop,
  minBottomTop,
  defaultBottomLeft,
  minBottomLeft,
  maxBottomLeft,
  minBottomRight,
}: UseResizableGridLayoutOptions) {
  const layoutRef = useRef<GridLayout>({ left: defaultLeft, top: defaultTop, bottomLeft: defaultBottomLeft });
  const dragRef = useRef<DragState | null>(null);

  const writeLayout = useCallback((layout: GridLayout) => {
    const container = containerRef.current;
    if (!container) return;
    container.style.setProperty(leftCssVar, `${layout.left}px`);
    container.style.setProperty(topCssVar, `${layout.top}px`);
    container.style.setProperty(bottomLeftCssVar, `${layout.bottomLeft}px`);
  }, [bottomLeftCssVar, containerRef, leftCssVar, topCssVar]);

  const clampLayout = useCallback((layout: GridLayout) => {
    const rect = containerRef.current?.getBoundingClientRect();
    const containerWidth = rect?.width ?? 0;
    const containerHeight = rect?.height ?? 0;
    const leftMax = containerWidth > 0
      ? Math.min(maxLeft, Math.max(minLeft, containerWidth - SPLITTER_SIZE - minRight))
      : maxLeft;
    const topMax = containerHeight > 0
      ? Math.min(maxTop, Math.max(minTop, containerHeight - SPLITTER_SIZE - minBottomTop))
      : maxTop;
    const bottomLeftMax = containerWidth > 0
      ? Math.min(maxBottomLeft, Math.max(minBottomLeft, containerWidth - SPLITTER_SIZE - minBottomRight))
      : maxBottomLeft;
    return {
      left: clamp(layout.left, minLeft, leftMax),
      top: clamp(layout.top, minTop, topMax),
      bottomLeft: clamp(layout.bottomLeft, minBottomLeft, bottomLeftMax),
    };
  }, [containerRef, maxBottomLeft, maxLeft, maxTop, minBottomLeft, minBottomRight, minBottomTop, minLeft, minRight, minTop]);

  const applyLayout = useCallback((next: GridLayout) => {
    const clamped = clampLayout(next);
    layoutRef.current = clamped;
    writeLayout(clamped);
    return clamped;
  }, [clampLayout, writeLayout]);

  const saveLayout = useCallback((layout: GridLayout) => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(layout));
    } catch {
      // Local layout preference is non-critical.
    }
  }, [storageKey]);

  const resetSize = useCallback((kind: ResizeKind) => {
    const current = layoutRef.current;
    const next = {
      left: kind === "column" ? defaultLeft : current.left,
      top: kind === "top-row" ? defaultTop : current.top,
      bottomLeft: kind === "bottom-row" ? defaultBottomLeft : current.bottomLeft,
    };
    saveLayout(applyLayout(next));
  }, [applyLayout, defaultBottomLeft, defaultLeft, defaultTop, saveLayout]);

  const nudgeSize = useCallback((kind: ResizeKind, direction: number) => {
    const current = layoutRef.current;
    const next = { ...current };
    if (kind === "column") next.left += direction * 16;
    if (kind === "top-row") next.top += direction * 12;
    if (kind === "bottom-row") next.bottomLeft += direction * 16;
    saveLayout(applyLayout(next));
  }, [applyLayout, saveLayout]);

  const startResize = useCallback((kind: ResizeKind, event: ReactPointerEvent<HTMLElement>) => {
    if (window.matchMedia(SMALL_SCREEN_QUERY).matches) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      kind,
      startX: event.clientX,
      startY: event.clientY,
      startLayout: layoutRef.current,
    };
    document.body.classList.add("is-resizing-workspace", kind === "top-row" ? "is-resizing-workspace-row" : "is-resizing-workspace-col");
  }, []);

  useEffect(() => {
    applyLayout(readStoredLayout(storageKey, defaultLeft, defaultTop, defaultBottomLeft));
  }, [applyLayout, defaultBottomLeft, defaultLeft, defaultTop, storageKey]);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const next = { ...drag.startLayout };
      if (drag.kind === "column") next.left = drag.startLayout.left + event.clientX - drag.startX;
      if (drag.kind === "top-row") next.top = drag.startLayout.top + event.clientY - drag.startY;
      if (drag.kind === "bottom-row") next.bottomLeft = drag.startLayout.bottomLeft + event.clientX - drag.startX;
      applyLayout(next);
    };
    const onPointerUp = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      document.body.classList.remove("is-resizing-workspace", "is-resizing-workspace-col", "is-resizing-workspace-row");
      saveLayout(layoutRef.current);
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      document.body.classList.remove("is-resizing-workspace", "is-resizing-workspace-col", "is-resizing-workspace-row");
    };
  }, [applyLayout, saveLayout]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const observer = new ResizeObserver(() => {
      const current = layoutRef.current;
      const clamped = applyLayout(current);
      if (clamped.left !== current.left || clamped.top !== current.top || clamped.bottomLeft !== current.bottomLeft) saveLayout(clamped);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [applyLayout, containerRef, saveLayout]);

  return { startResize, resetSize, nudgeSize };
}

function readStoredLayout(storageKey: string, defaultLeft: number, defaultTop: number, defaultBottomLeft: number): GridLayout {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) ?? "null");
    return {
      left: Number(parsed?.left ?? defaultLeft),
      top: Number(parsed?.top ?? defaultTop),
      bottomLeft: Number(parsed?.bottomLeft ?? defaultBottomLeft),
    };
  } catch {
    return { left: defaultLeft, top: defaultTop, bottomLeft: defaultBottomLeft };
  }
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
