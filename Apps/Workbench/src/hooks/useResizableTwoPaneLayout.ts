import { RefObject, useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";

const SPLITTER_SIZE = 6;
const SMALL_SCREEN_QUERY = "(max-width: 980px)";

type TwoPaneLayout = {
  left: number;
};

type DragState = {
  startX: number;
  startLeft: number;
};

type UseResizableTwoPaneLayoutOptions = {
  containerRef: RefObject<HTMLElement>;
  storageKey: string;
  cssVar: string;
  defaultLeft: number;
  minLeft: number;
  maxLeft: number;
  minRight: number;
};

export function useResizableTwoPaneLayout({
  containerRef,
  storageKey,
  cssVar,
  defaultLeft,
  minLeft,
  maxLeft,
  minRight,
}: UseResizableTwoPaneLayoutOptions) {
  const layoutRef = useRef<TwoPaneLayout>({ left: defaultLeft });
  const dragRef = useRef<DragState | null>(null);

  const writeLayout = useCallback((layout: TwoPaneLayout) => {
    const container = containerRef.current;
    if (!container) return;
    container.style.setProperty(cssVar, `${layout.left}px`);
  }, [containerRef, cssVar]);

  const clampLayout = useCallback((layout: TwoPaneLayout) => {
    const containerWidth = containerRef.current?.getBoundingClientRect().width ?? 0;
    const widthMax = containerWidth > 0
      ? Math.min(maxLeft, Math.max(minLeft, containerWidth - SPLITTER_SIZE - minRight))
      : maxLeft;
    return {
      left: clamp(layout.left, minLeft, widthMax),
    };
  }, [containerRef, maxLeft, minLeft, minRight]);

  const applyLayout = useCallback((next: TwoPaneLayout) => {
    const clamped = clampLayout(next);
    layoutRef.current = clamped;
    writeLayout(clamped);
    return clamped;
  }, [clampLayout, writeLayout]);

  const saveLayout = useCallback((layout: TwoPaneLayout) => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(layout));
    } catch {
      // Local layout preference is non-critical.
    }
  }, [storageKey]);

  const resetSize = useCallback(() => {
    saveLayout(applyLayout({ left: defaultLeft }));
  }, [applyLayout, defaultLeft, saveLayout]);

  const nudgeSize = useCallback((direction: number) => {
    saveLayout(applyLayout({ left: layoutRef.current.left + direction * 16 }));
  }, [applyLayout, saveLayout]);

  const startResize = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (window.matchMedia(SMALL_SCREEN_QUERY).matches) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      startX: event.clientX,
      startLeft: layoutRef.current.left,
    };
    document.body.classList.add("is-resizing-workspace", "is-resizing-workspace-col");
  }, []);

  useEffect(() => {
    applyLayout(readStoredLayout(storageKey, defaultLeft));
  }, [applyLayout, defaultLeft, storageKey]);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      applyLayout({ left: drag.startLeft + event.clientX - drag.startX });
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
      if (clamped.left !== current.left) saveLayout(clamped);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [applyLayout, containerRef, saveLayout]);

  return { startResize, resetSize, nudgeSize };
}

function readStoredLayout(storageKey: string, defaultLeft: number): TwoPaneLayout {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) ?? "null");
    return {
      left: Number(parsed?.left ?? defaultLeft),
    };
  } catch {
    return { left: defaultLeft };
  }
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
