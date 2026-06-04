import { useRef, useState } from "react";
import { useResizableThreePaneLayout } from "../../hooks/useResizableThreePaneLayout";
import { SplitResizeHandle } from "../SplitResizeHandle";

export function NewUiLayout() {
  const layoutRef = useRef<HTMLElement>(null);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const layout = useResizableThreePaneLayout({
    containerRef: layoutRef,
    storageKey: "new-ui:three-pane-layout",
    leftCssVar: "--new-ui-left-width",
    rightCssVar: "--new-ui-right-width",
    defaultLeft: 320,
    defaultRight: 320,
    minLeft: 220,
    maxLeft: 960,
    minCenter: 420,
    minRight: 220,
    maxRight: 960,
    leftRatio: { min: 0.2, max: 0.4 },
    rightRatio: { min: 0.2, max: 0.4 },
  });

  return (
    <section
      ref={layoutRef}
      className={`new-ui-layout ${leftCollapsed ? "is-left-collapsed" : ""} ${rightCollapsed ? "is-right-collapsed" : ""}`.trim()}
      aria-label="新 UI 三栏工作区"
    >
      <aside className="new-ui-pane new-ui-pane-left" aria-label="左侧栏">
        <PaneHeader title="资源" collapsed={leftCollapsed} onToggle={() => setLeftCollapsed((value) => !value)} side="left" />
        <div className="new-ui-pane-body" aria-hidden={leftCollapsed}>
          <div className="new-ui-placeholder-line wide" />
          <div className="new-ui-placeholder-line" />
          <div className="new-ui-placeholder-stack">
            <span />
            <span />
            <span />
          </div>
        </div>
      </aside>
      {!leftCollapsed ? (
        <SplitResizeHandle
          className="new-ui-resize-handle new-ui-resize-handle-left"
          label="调整左栏宽度"
          orientation="vertical"
          onResizeStart={(event) => layout.startResize("left", event)}
          onReset={() => layout.resetSize("left")}
          onNudge={(direction) => layout.nudgeSize("left", direction)}
        />
      ) : <div className="new-ui-resize-spacer" aria-hidden="true" />}
      <main className="new-ui-center" aria-label="中间工作区">
        <div className="new-ui-center-top">
          <span>新工作台</span>
        </div>
        <div className="new-ui-canvas" />
      </main>
      {!rightCollapsed ? (
        <SplitResizeHandle
          className="new-ui-resize-handle new-ui-resize-handle-right"
          label="调整右栏宽度"
          orientation="vertical"
          onResizeStart={(event) => layout.startResize("right", event)}
          onReset={() => layout.resetSize("right")}
          onNudge={(direction) => layout.nudgeSize("right", direction)}
        />
      ) : <div className="new-ui-resize-spacer" aria-hidden="true" />}
      <aside className="new-ui-pane new-ui-pane-right" aria-label="右侧栏">
        <PaneHeader title="检查器" collapsed={rightCollapsed} onToggle={() => setRightCollapsed((value) => !value)} side="right" />
        <div className="new-ui-pane-body" aria-hidden={rightCollapsed}>
          <div className="new-ui-placeholder-line wide" />
          <div className="new-ui-placeholder-line short" />
          <div className="new-ui-placeholder-stack">
            <span />
            <span />
          </div>
        </div>
      </aside>
    </section>
  );
}

type PaneHeaderProps = {
  title: string;
  collapsed: boolean;
  side: "left" | "right";
  onToggle: () => void;
};

function PaneHeader({ title, collapsed, side, onToggle }: PaneHeaderProps) {
  const collapseIcon = side === "left" ? "<" : ">";
  const expandIcon = side === "left" ? ">" : "<";

  return (
    <header className="new-ui-pane-header">
      <strong>{title}</strong>
      <button
        className="new-ui-pane-toggle"
        type="button"
        aria-label={collapsed ? `展开${side === "left" ? "左" : "右"}栏` : `收起${side === "left" ? "左" : "右"}栏`}
        aria-expanded={!collapsed}
        onClick={onToggle}
      >
        {collapsed ? expandIcon : collapseIcon}
      </button>
    </header>
  );
}
