import type { KeyboardEvent, PointerEvent } from "react";

type SplitResizeHandleProps = {
  className: string;
  label: string;
  orientation: "horizontal" | "vertical";
  onResizeStart: (event: PointerEvent<HTMLElement>) => void;
  onReset: () => void;
  onNudge: (direction: number) => void;
};

export function SplitResizeHandle({ className, label, orientation, onResizeStart, onReset, onNudge }: SplitResizeHandleProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const direction = nudgeDirection(orientation, event.key);
    if (!direction) return;
    event.preventDefault();
    onNudge(direction);
  };

  return (
    <div
      className={className}
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={orientation}
      title={`${label}，双击重置`}
      onPointerDown={onResizeStart}
      onDoubleClick={onReset}
      onKeyDown={handleKeyDown}
    />
  );
}

function nudgeDirection(orientation: "horizontal" | "vertical", key: string) {
  if (orientation === "vertical") {
    if (key === "ArrowRight") return 1;
    if (key === "ArrowLeft") return -1;
    return 0;
  }
  if (key === "ArrowDown") return 1;
  if (key === "ArrowUp") return -1;
  return 0;
}
