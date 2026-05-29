import { RefObject, useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";

const SPLITTER_SIZE = 10;
const TOTAL_SPLITTER_WIDTH = SPLITTER_SIZE * 2;
const SMALL_SCREEN_QUERY = "(max-width: 980px)";

type ThreePaneLayout = {
  left: number;
  right: number;
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
}: UseResizableThreePaneLayoutOptions) {
  const layoutRef = useRef<ThreePaneLayout>({ left: defaultLeft, right: defaultRight });
  const dragRef = useRef<DragState | null>(null);

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
      window.localStorage.setItem(storageKey, JSON.stringify(layout));
    } catch {
      // Local layout preference is non-critical.
    }
  }, [storageKey]);

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

  const startResize = useCallback((kind: ResizeKind, event: ReactPointerEvent<HTMLElement>) => {
    if (window.matchMedia(SMALL_SCREEN_QUERY).matches) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      kind,
      startX: event.clientX,
      startLayout: layoutRef.current,
    };
    document.body.classList.add("is-resizing-workspace", "is-resizing-workspace-col");
  }, []);

  useEffect(() => {
    applyLayout(readStoredLayout(storageKey, defaultLeft, defaultRight));
  }, [applyLayout, defaultLeft, defaultRight, storageKey]);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const delta = event.clientX - drag.startX;
      applyLayout({
        left: drag.kind === "left" ? drag.startLayout.left + delta : drag.startLayout.left,
        right: drag.kind === "right" ? drag.startLayout.right - delta : drag.startLayout.right,
      });
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
      if (clamped.left !== current.left || clamped.right !== current.right) saveLayout(clamped);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [applyLayout, containerRef, saveLayout]);

  return { startResize, resetSize, nudgeSize };
}

function readStoredLayout(storageKey: string, defaultLeft: number, defaultRight: number): ThreePaneLayout {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) ?? "null");
    return {
      left: Number(parsed?.left ?? defaultLeft),
      right: Number(parsed?.right ?? defaultRight),
    };
  } catch {
    return { left: defaultLeft, right: defaultRight };
  }
}

function ratioPixels(width: number, ratio: number | undefined, fallback: number) {
  return ratio && width > 0 ? width * ratio : fallback;
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
