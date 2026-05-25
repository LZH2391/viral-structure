import type { PointerEvent } from "react";
import type { ResizeHandleKind } from "../hooks/useResizableWorkspaceLayout";
import { SplitResizeHandle } from "./SplitResizeHandle";

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

  return (
    <SplitResizeHandle
      className={className}
      label={LABELS[kind]}
      orientation={isHorizontal ? "horizontal" : "vertical"}
      onResizeStart={(event) => onResizeStart(kind, event)}
      onReset={() => onReset(kind)}
      onNudge={(direction) => onNudge(kind, translateDirection(kind, direction))}
    />
  );
}

function translateDirection(kind: ResizeHandleKind, direction: number) {
  if (kind === "right-panel") return -direction;
  if (kind === "timeline") return -direction;
  return direction;
}
