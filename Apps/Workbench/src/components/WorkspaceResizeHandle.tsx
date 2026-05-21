import type { KeyboardEvent, PointerEvent } from "react";
import type { ResizeHandleKind } from "../hooks/useResizableWorkspaceLayout";

type WorkspaceResizeHandleProps = {
  kind: ResizeHandleKind;
  onResizeStart: (kind: ResizeHandleKind, event: PointerEvent<HTMLElement>) => void;
  onReset: (kind: ResizeHandleKind) => void;
  onNudge: (kind: ResizeHandleKind, direction: number) => void;
};

const LABELS: Record<ResizeHandleKind, string> = {
  "left-panel": "调整左侧资源栏宽度",
  "right-panel": "调整右侧属性栏宽度",
  timeline: "调整底部时间线高度",
};

export function WorkspaceResizeHandle({ kind, onResizeStart, onReset, onNudge }: WorkspaceResizeHandleProps) {
  const isHorizontal = kind === "timeline";
  const className = ["workspace-resize-handle", isHorizontal ? "timeline-resizer" : kind === "left-panel" ? "left-resizer" : "right-resizer"].join(" ");

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const direction = nudgeDirection(kind, event.key);
    if (!direction) return;
    event.preventDefault();
    onNudge(kind, direction);
  };

  return (
    <div
      className={className}
      role="separator"
      tabIndex={0}
      aria-label={LABELS[kind]}
      aria-orientation={isHorizontal ? "horizontal" : "vertical"}
      title={`${LABELS[kind]}，双击重置`}
      onPointerDown={(event) => onResizeStart(kind, event)}
      onDoubleClick={() => onReset(kind)}
      onKeyDown={handleKeyDown}
    />
  );
}

function nudgeDirection(kind: ResizeHandleKind, key: string) {
  if (kind === "left-panel") {
    if (key === "ArrowRight") return 1;
    if (key === "ArrowLeft") return -1;
  }
  if (kind === "right-panel") {
    if (key === "ArrowLeft") return 1;
    if (key === "ArrowRight") return -1;
  }
  if (kind === "timeline") {
    if (key === "ArrowUp") return 1;
    if (key === "ArrowDown") return -1;
  }
  return 0;
}
