import { RefObject, useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";

export type WorkspaceLayout = {
  left: number;
  right: number;
  timeline: number;
};

export type ResizeHandleKind = "left-panel" | "right-panel" | "timeline";

const STORAGE_KEY = "workbench:layout";
const SPLITTER_SIZE = 6;
const MIN_PREVIEW_WIDTH = 420;
const SMALL_SCREEN_QUERY = "(max-width: 980px)";

export const WORKSPACE_LAYOUT_DEFAULTS: WorkspaceLayout = {
  left: 260,
  right: 320,
  timeline: 190,
};

const LIMITS = {
  left: { min: 220, max: 420 },
  right: { min: 260, max: 560 },
  timeline: { min: 150, max: 360 },
};

type DragState = {
  kind: ResizeHandleKind;
  startX: number;
  startY: number;
  startLayout: WorkspaceLayout;
};

export function useResizableWorkspaceLayout(gridRef: RefObject<HTMLElement>) {
  const layoutRef = useRef<WorkspaceLayout>(WORKSPACE_LAYOUT_DEFAULTS);
  const dragRef = useRef<DragState | null>(null);

  const writeLayout = useCallback(
    (layout: WorkspaceLayout) => {
      const grid = gridRef.current;
      if (!grid) return;
      grid.style.setProperty("--workspace-left-width", `${layout.left}px`);
      grid.style.setProperty("--workspace-right-width", `${layout.right}px`);
      grid.style.setProperty("--workspace-timeline-height", `${layout.timeline}px`);
    },
    [gridRef],
  );

  const applyLayout = useCallback(
    (next: WorkspaceLayout) => {
      const clamped = clampWorkspaceLayout(next, gridRef.current);
      layoutRef.current = clamped;
      writeLayout(clamped);
      return clamped;
    },
    [gridRef, writeLayout],
  );

  const saveLayout = useCallback((layout: WorkspaceLayout) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
    } catch {
      // Local layout preference is non-critical.
    }
  }, []);

  const resetSize = useCallback(
    (kind: ResizeHandleKind) => {
      const current = layoutRef.current;
      const next = {
        ...current,
        [layoutKeyForHandle(kind)]: WORKSPACE_LAYOUT_DEFAULTS[layoutKeyForHandle(kind)],
      };
      saveLayout(applyLayout(next));
    },
    [applyLayout, saveLayout],
  );

  const nudgeSize = useCallback(
    (kind: ResizeHandleKind, direction: number) => {
      const key = layoutKeyForHandle(kind);
      const step = kind === "timeline" ? 12 : 16;
      const next = { ...layoutRef.current, [key]: layoutRef.current[key] + direction * step };
      saveLayout(applyLayout(next));
    },
    [applyLayout, saveLayout],
  );

  const startResize = useCallback(
    (kind: ResizeHandleKind, event: ReactPointerEvent<HTMLElement>) => {
      if (window.matchMedia(SMALL_SCREEN_QUERY).matches) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = {
        kind,
        startX: event.clientX,
        startY: event.clientY,
        startLayout: layoutRef.current,
      };
      document.body.classList.add("is-resizing-workspace", kind === "timeline" ? "is-resizing-workspace-row" : "is-resizing-workspace-col");
    },
    [],
  );

  useEffect(() => {
    applyLayout(readStoredLayout());
  }, [applyLayout]);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const next = { ...drag.startLayout };
      if (drag.kind === "left-panel") next.left = drag.startLayout.left + event.clientX - drag.startX;
      if (drag.kind === "right-panel") next.right = drag.startLayout.right + drag.startX - event.clientX;
      if (drag.kind === "timeline") next.timeline = drag.startLayout.timeline + drag.startY - event.clientY;
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
    const grid = gridRef.current;
    if (!grid) return undefined;
    const observer = new ResizeObserver(() => {
      const current = layoutRef.current;
      const clamped = applyLayout(layoutRef.current);
      if (clamped.left !== current.left || clamped.right !== current.right || clamped.timeline !== current.timeline) saveLayout(clamped);
    });
    observer.observe(grid);
    return () => observer.disconnect();
  }, [applyLayout, gridRef, saveLayout]);

  return { startResize, resetSize, nudgeSize };
}

export function clampWorkspaceLayout(layout: WorkspaceLayout, grid?: HTMLElement | null): WorkspaceLayout {
  const containerWidth = grid?.getBoundingClientRect().width ?? 0;
  const availableSideWidth = containerWidth > 0 ? Math.max(0, containerWidth - MIN_PREVIEW_WIDTH - SPLITTER_SIZE * 2) : Number.POSITIVE_INFINITY;
  const leftMax = Math.min(LIMITS.left.max, Math.max(LIMITS.left.min, availableSideWidth - LIMITS.right.min));
  const left = clamp(layout.left, LIMITS.left.min, leftMax);
  const rightMax = Math.min(LIMITS.right.max, Math.max(LIMITS.right.min, availableSideWidth - left));
  return {
    left,
    right: clamp(layout.right, LIMITS.right.min, rightMax),
    timeline: clamp(layout.timeline, LIMITS.timeline.min, LIMITS.timeline.max),
  };
}

function readStoredLayout(): WorkspaceLayout {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null");
    return {
      left: Number(parsed?.left ?? WORKSPACE_LAYOUT_DEFAULTS.left),
      right: Number(parsed?.right ?? WORKSPACE_LAYOUT_DEFAULTS.right),
      timeline: Number(parsed?.timeline ?? WORKSPACE_LAYOUT_DEFAULTS.timeline),
    };
  } catch {
    return WORKSPACE_LAYOUT_DEFAULTS;
  }
}

function layoutKeyForHandle(kind: ResizeHandleKind): keyof WorkspaceLayout {
  if (kind === "right-panel") return "right";
  if (kind === "timeline") return "timeline";
  return "left";
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
