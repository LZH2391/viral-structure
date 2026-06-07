import { RefObject, useCallback, useEffect, useLayoutEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";

const SPLITTER_SIZE = 10;
const TOTAL_SPLITTER_WIDTH = SPLITTER_SIZE * 2;
const SMALL_SCREEN_QUERY = "(max-width: 980px)";

type ThreePaneLayout = {
  left: number;
  right: number;
};

type StoredThreePaneLayout = Partial<ThreePaneLayout> & {
  leftRatio?: number;
  rightRatio?: number;
};

type PersistedResizeSides = {
  left?: boolean;
  right?: boolean;
};

type ResizeKind = "left" | "right";

type DragState = {
  kind: ResizeKind;
  startX: number;
  startLayout: ThreePaneLayout;
};

type RatioLimit = {
  min: number;
  max: number;
};

type UseResizableThreePaneLayoutOptions = {
  containerRef: RefObject<HTMLElement>;
  storageKey: string;
  leftCssVar: string;
  rightCssVar: string;
  defaultLeft: number;
  defaultRight: number;
  minLeft: number;
  maxLeft: number;
  minCenter: number;
  minRight: number;
  maxRight: number;
  leftRatio?: RatioLimit;
  rightRatio?: RatioLimit;
  persistedSides?: PersistedResizeSides;
};

export function useResizableThreePaneLayout({
  containerRef,
  storageKey,
  leftCssVar,
  rightCssVar,
  defaultLeft,
  defaultRight,
  minLeft,
  maxLeft,
  minCenter,
  minRight,
  maxRight,
  leftRatio,
  rightRatio,
  persistedSides,
}: UseResizableThreePaneLayoutOptions) {
  const layoutRef = useRef<ThreePaneLayout>({ left: defaultLeft, right: defaultRight });
  const dragRef = useRef<DragState | null>(null);
  const pendingDragLayoutRef = useRef<ThreePaneLayout | null>(null);
  const dragFrameRef = useRef<number | null>(null);
  const persistLeft = persistedSides?.left !== false;
  const persistRight = persistedSides?.right !== false;

  const writeLayout = useCallback((layout: ThreePaneLayout) => {
    const container = containerRef.current;
    if (!container) return;
    container.style.setProperty(leftCssVar, `${layout.left}px`);
    container.style.setProperty(rightCssVar, `${layout.right}px`);
  }, [containerRef, leftCssVar, rightCssVar]);

  const clampLayout = useCallback((layout: ThreePaneLayout) => {
    const containerWidth = containerRef.current?.getBoundingClientRect().width ?? 0;
    const availableWidth = Math.max(0, containerWidth - TOTAL_SPLITTER_WIDTH);
    const leftMin = Math.max(minLeft, ratioPixels(availableWidth, leftRatio?.min, minLeft));
    const leftMax = Math.min(maxLeft, ratioPixels(availableWidth, leftRatio?.max, maxLeft));
    const rightMin = Math.max(minRight, ratioPixels(availableWidth, rightRatio?.min, minRight));
    const rightMax = Math.min(maxRight, ratioPixels(availableWidth, rightRatio?.max, maxRight));
    let left = clamp(layout.left, leftMin, leftMax);
    let right = clamp(layout.right, rightMin, rightMax);
    const centerWidth = availableWidth - left - right;
    if (containerWidth > 0 && centerWidth < minCenter) {
      const overflow = minCenter - centerWidth;
      if (right > rightMin) {
        const nextRight = Math.max(rightMin, right - overflow);
        right = nextRight;
      }
      const remainingOverflow = minCenter - (availableWidth - left - right);
      if (remainingOverflow > 0 && left > leftMin) {
        left = Math.max(leftMin, left - remainingOverflow);
      }
    }
    return { left, right };
  }, [containerRef, leftRatio?.max, leftRatio?.min, maxLeft, maxRight, minCenter, minLeft, minRight, rightRatio?.max, rightRatio?.min]);

  const applyLayout = useCallback((next: ThreePaneLayout) => {
    const clamped = clampLayout(next);
    layoutRef.current = clamped;
    writeLayout(clamped);
    return clamped;
  }, [clampLayout, writeLayout]);

  const saveLayout = useCallback((layout: ThreePaneLayout) => {
    try {
      const current = readStoredLayoutPreference(storageKey);
      const ratios = layoutRatios(containerRef.current, layout, { left: persistLeft, right: persistRight });
      const next = {
        ...current,
        ...(persistLeft ? { left: layout.left } : {}),
        ...(persistRight ? { right: layout.right } : {}),
        ...ratios,
      };
      if (!persistLeft) {
        delete next.left;
        delete next.leftRatio;
      }
      if (!persistRight) {
        delete next.right;
        delete next.rightRatio;
      }
      window.localStorage.setItem(storageKey, JSON.stringify({
        ...next,
      }));
    } catch {
      // Local layout preference is non-critical.
    }
  }, [containerRef, persistLeft, persistRight, storageKey]);

  const resetSize = useCallback((kind: ResizeKind) => {
    const current = layoutRef.current;
    saveLayout(applyLayout({
      left: kind === "left" ? defaultLeft : current.left,
      right: kind === "right" ? defaultRight : current.right,
    }));
  }, [applyLayout, defaultLeft, defaultRight, saveLayout]);

  const nudgeSize = useCallback((kind: ResizeKind, direction: number) => {
    const current = layoutRef.current;
    const next = { ...current };
    if (kind === "left") next.left += direction * 16;
    if (kind === "right") next.right -= direction * 16;
    saveLayout(applyLayout(next));
  }, [applyLayout, saveLayout]);

  const flushPendingDragLayout = useCallback(() => {
    if (dragFrameRef.current) {
      window.cancelAnimationFrame(dragFrameRef.current);
      dragFrameRef.current = null;
    }
    const pending = pendingDragLayoutRef.current;
    pendingDragLayoutRef.current = null;
    if (pending) applyLayout(pending);
  }, [applyLayout]);

  const scheduleDragLayout = useCallback((next: ThreePaneLayout) => {
    pendingDragLayoutRef.current = next;
    if (dragFrameRef.current) return;
    dragFrameRef.current = window.requestAnimationFrame(() => {
      dragFrameRef.current = null;
      const pending = pendingDragLayoutRef.current;
      pendingDragLayoutRef.current = null;
      if (pending) applyLayout(pending);
    });
  }, [applyLayout]);

  const startResize = useCallback((kind: ResizeKind, event: ReactPointerEvent<HTMLElement>) => {
    if (window.matchMedia(SMALL_SCREEN_QUERY).matches) return;
    const container = containerRef.current;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    container?.classList.add("is-drag-resizing-layout");
    dragRef.current = {
      kind,
      startX: event.clientX,
      startLayout: layoutRef.current,
    };
    document.body.classList.add("is-resizing-workspace", "is-resizing-workspace-col");
  }, [containerRef]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    container.classList.add("is-restoring-layout");
    applyLayout(readStoredLayout(storageKey, defaultLeft, defaultRight, container, { left: persistLeft, right: persistRight }));
    const animationFrameId = window.requestAnimationFrame(() => {
      container.classList.remove("is-restoring-layout");
    });
    return () => {
      window.cancelAnimationFrame(animationFrameId);
      container.classList.remove("is-restoring-layout");
    };
  }, [applyLayout, containerRef, defaultLeft, defaultRight, persistLeft, persistRight, storageKey]);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const delta = event.clientX - drag.startX;
      scheduleDragLayout({
        left: drag.kind === "left" ? drag.startLayout.left + delta : drag.startLayout.left,
        right: drag.kind === "right" ? drag.startLayout.right - delta : drag.startLayout.right,
      });
    };
    const onPointerUp = () => {
      if (!dragRef.current) return;
      flushPendingDragLayout();
      dragRef.current = null;
      containerRef.current?.classList.remove("is-drag-resizing-layout");
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
      flushPendingDragLayout();
      containerRef.current?.classList.remove("is-drag-resizing-layout");
      document.body.classList.remove("is-resizing-workspace", "is-resizing-workspace-col", "is-resizing-workspace-row");
    };
  }, [containerRef, flushPendingDragLayout, saveLayout, scheduleDragLayout]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const observer = new ResizeObserver(() => {
      const current = layoutRef.current;
      const clamped = applyLayout(current);
      if (clamped.left !== current.left || clamped.right !== current.right) saveLayout(clamped);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [applyLayout, containerRef, saveLayout]);

  return { startResize, resetSize, nudgeSize };
}

function readStoredLayout(storageKey: string, defaultLeft: number, defaultRight: number, container: HTMLElement | null, persistedSides: Required<PersistedResizeSides>): ThreePaneLayout {
  const stored = readStoredLayoutPreference(storageKey);
  const availableWidth = availableContentWidth(container);
  const leftFromRatio = ratioPixels(availableWidth, stored.leftRatio, Number.NaN);
  const rightFromRatio = ratioPixels(availableWidth, stored.rightRatio, Number.NaN);
  return {
    left: persistedSides.left ? finiteNumber(leftFromRatio) ?? finiteNumber(stored.left) ?? defaultLeft : defaultLeft,
    right: persistedSides.right ? finiteNumber(rightFromRatio) ?? finiteNumber(stored.right) ?? defaultRight : defaultRight,
  };
}

function readStoredLayoutPreference(storageKey: string): StoredThreePaneLayout {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) ?? "null");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function ratioPixels(width: number, ratio: number | undefined, fallback: number) {
  return ratio && width > 0 ? width * ratio : fallback;
}

function layoutRatios(container: HTMLElement | null, layout: ThreePaneLayout, persistedSides: Required<PersistedResizeSides>) {
  const availableWidth = availableContentWidth(container);
  if (availableWidth <= 0) return {};
  return {
    ...(persistedSides.left ? { leftRatio: layout.left / availableWidth } : {}),
    ...(persistedSides.right ? { rightRatio: layout.right / availableWidth } : {}),
  };
}

function availableContentWidth(container: HTMLElement | null) {
  const containerWidth = container?.getBoundingClientRect().width ?? 0;
  return Math.max(0, containerWidth - TOTAL_SPLITTER_WIDTH);
}

function finiteNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
