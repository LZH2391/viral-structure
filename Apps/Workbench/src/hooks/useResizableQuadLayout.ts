import { RefObject, useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";

const SPLITTER_SIZE = 6;
const SMALL_SCREEN_QUERY = "(max-width: 980px)";

type QuadLayout = {
  left: number;
  top: number;
};

type ResizeKind = "column" | "row";

type DragState = {
  kind: ResizeKind;
  startX: number;
  startY: number;
  startLayout: QuadLayout;
};

type UseResizableQuadLayoutOptions = {
  containerRef: RefObject<HTMLElement>;
  storageKey: string;
  leftCssVar: string;
  topCssVar: string;
  defaultLeft: number;
  minLeft: number;
  maxLeft: number;
  minRight: number;
  defaultTop: number;
  minTop: number;
  maxTop: number;
  minBottom: number;
};

export function useResizableQuadLayout({
  containerRef,
  storageKey,
  leftCssVar,
  topCssVar,
  defaultLeft,
  minLeft,
  maxLeft,
  minRight,
  defaultTop,
  minTop,
  maxTop,
  minBottom,
}: UseResizableQuadLayoutOptions) {
  const layoutRef = useRef<QuadLayout>({ left: defaultLeft, top: defaultTop });
  const dragRef = useRef<DragState | null>(null);

  const writeLayout = useCallback((layout: QuadLayout) => {
    const container = containerRef.current;
    if (!container) return;
    container.style.setProperty(leftCssVar, `${layout.left}px`);
    container.style.setProperty(topCssVar, `${layout.top}px`);
  }, [containerRef, leftCssVar, topCssVar]);

  const clampLayout = useCallback((layout: QuadLayout) => {
    const rect = containerRef.current?.getBoundingClientRect();
    const containerWidth = rect?.width ?? 0;
    const containerHeight = rect?.height ?? 0;
    const widthMax = containerWidth > 0
      ? Math.min(maxLeft, Math.max(minLeft, containerWidth - SPLITTER_SIZE - minRight))
      : maxLeft;
    const heightMax = containerHeight > 0
      ? Math.min(maxTop, Math.max(minTop, containerHeight - SPLITTER_SIZE - minBottom))
      : maxTop;
    return {
      left: clamp(layout.left, minLeft, widthMax),
      top: clamp(layout.top, minTop, heightMax),
    };
  }, [containerRef, maxLeft, maxTop, minBottom, minLeft, minRight, minTop]);

  const applyLayout = useCallback((next: QuadLayout) => {
    const clamped = clampLayout(next);
    layoutRef.current = clamped;
    writeLayout(clamped);
    return clamped;
  }, [clampLayout, writeLayout]);

  const saveLayout = useCallback((layout: QuadLayout) => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(layout));
    } catch {
      // Local layout preference is non-critical.
    }
  }, [storageKey]);

  const resetSize = useCallback((kind: ResizeKind) => {
    const current = layoutRef.current;
    const next = kind === "column"
      ? { ...current, left: defaultLeft }
      : { ...current, top: defaultTop };
    saveLayout(applyLayout(next));
  }, [applyLayout, defaultLeft, defaultTop, saveLayout]);

  const nudgeSize = useCallback((kind: ResizeKind, direction: number) => {
    const current = layoutRef.current;
    const next = kind === "column"
      ? { ...current, left: current.left + direction * 16 }
      : { ...current, top: current.top + direction * 12 };
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
    document.body.classList.add("is-resizing-workspace", kind === "row" ? "is-resizing-workspace-row" : "is-resizing-workspace-col");
  }, []);

  useEffect(() => {
    applyLayout(readStoredLayout(storageKey, defaultLeft, defaultTop));
  }, [applyLayout, defaultLeft, defaultTop, storageKey]);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const next = { ...drag.startLayout };
      if (drag.kind === "column") next.left = drag.startLayout.left + event.clientX - drag.startX;
      if (drag.kind === "row") next.top = drag.startLayout.top + event.clientY - drag.startY;
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
      if (clamped.left !== current.left || clamped.top !== current.top) saveLayout(clamped);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [applyLayout, containerRef, saveLayout]);

  return { startResize, resetSize, nudgeSize };
}

function readStoredLayout(storageKey: string, defaultLeft: number, defaultTop: number): QuadLayout {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) ?? "null");
    return {
      left: Number(parsed?.left ?? defaultLeft),
      top: Number(parsed?.top ?? defaultTop),
    };
  } catch {
    return { left: defaultLeft, top: defaultTop };
  }
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
