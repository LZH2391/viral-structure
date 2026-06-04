import { useEffect, useRef, useState } from "react";
import { useResizableThreePaneLayout } from "../../hooks/useResizableThreePaneLayout";
import type { NewUiTheme } from "../../utils/workbenchPreferences";
import { SplitResizeHandle } from "../SplitResizeHandle";

type NewUiLayoutProps = {
  theme: NewUiTheme;
  onThemeChange: (theme: NewUiTheme) => void;
  onLeftCollapsedChange?: (collapsed: boolean) => void;
};

export function NewUiLayout({ theme, onThemeChange, onLeftCollapsedChange }: NewUiLayoutProps) {
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
    minLeft: 0,
    maxLeft: Number.POSITIVE_INFINITY,
    minCenter: 420,
    minRight: 0,
    maxRight: Number.POSITIVE_INFINITY,
    leftRatio: { min: 0.1, max: 0.3 },
    rightRatio: { min: 0.1, max: 0.3 },
  });

  useEffect(() => {
    onLeftCollapsedChange?.(leftCollapsed);
  }, [leftCollapsed, onLeftCollapsedChange]);

  const toggleLeftCollapsed = () => {
    setLeftCollapsed((value) => {
      const next = !value;
      onLeftCollapsedChange?.(next);
      return next;
    });
  };

  return (
    <section
      ref={layoutRef}
      className={`new-ui-layout ${leftCollapsed ? "is-left-collapsed" : ""} ${rightCollapsed ? "is-right-collapsed" : ""}`.trim()}
      aria-label="新 UI 三栏工作区"
    >
      <aside className="new-ui-pane new-ui-pane-left" aria-label="左侧栏">
        <PaneHeader collapsed={leftCollapsed} onToggle={toggleLeftCollapsed} side="left" />
        <div className="new-ui-pane-body" aria-hidden={leftCollapsed} />
        <ThemeToggle theme={theme} onThemeChange={onThemeChange} />
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
      <main className="new-ui-center" aria-label="中间工作区" />
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
        <PaneHeader collapsed={rightCollapsed} onToggle={() => setRightCollapsed((value) => !value)} side="right" />
        <div className="new-ui-pane-body" aria-hidden={rightCollapsed} />
      </aside>
    </section>
  );
}

type ThemeToggleProps = {
  theme: NewUiTheme;
  onThemeChange: (theme: NewUiTheme) => void;
};

function ThemeToggle({ theme, onThemeChange }: ThemeToggleProps) {
  const isLight = theme === "light";

  return (
    <div className="new-ui-pane-theme">
      <button
        className="new-ui-theme-toggle"
        type="button"
        aria-label={isLight ? "切换到黑夜主题" : "切换到白天主题"}
        aria-pressed={isLight}
        onClick={() => onThemeChange(isLight ? "dark" : "light")}
      >
        <span className="new-ui-theme-icon-wrap" aria-hidden="true">
          <svg className="new-ui-theme-icon new-ui-theme-icon-sun" viewBox="0 0 24 24" focusable="false">
            <path d="M12 4.5V2m0 20v-2.5M4.5 12H2m20 0h-2.5M5.64 5.64 3.86 3.86m16.28 16.28-1.78-1.78m0-12.72 1.78-1.78M3.86 20.14l1.78-1.78" />
            <circle cx="12" cy="12" r="4.2" />
          </svg>
          <svg className="new-ui-theme-icon new-ui-theme-icon-moon" viewBox="0 0 24 24" focusable="false">
            <path d="M20.2 14.6A7.7 7.7 0 0 1 9.4 3.8 8.8 8.8 0 1 0 20.2 14.6Z" />
          </svg>
        </span>
      </button>
    </div>
  );
}

type PaneHeaderProps = {
  collapsed: boolean;
  side: "left" | "right";
  onToggle: () => void;
};

function PaneHeader({ collapsed, side, onToggle }: PaneHeaderProps) {
  return (
    <header className="new-ui-pane-header">
      <button
        className={`new-ui-pane-toggle new-ui-pane-toggle-${side} ${collapsed ? "is-collapsed" : ""}`}
        type="button"
        aria-label={collapsed ? `展开${side === "left" ? "左" : "右"}栏` : `收起${side === "left" ? "左" : "右"}栏`}
        aria-expanded={!collapsed}
        onClick={onToggle}
      >
        <span className="new-ui-pane-toggle-icon" aria-hidden="true">
          <span className="new-ui-pane-toggle-panel" />
          <span className="new-ui-pane-toggle-rail" />
          <span className="new-ui-pane-toggle-arrow" />
        </span>
      </button>
    </header>
  );
}
