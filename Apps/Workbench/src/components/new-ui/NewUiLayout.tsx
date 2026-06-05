import { useEffect, useRef, useState } from "react";
import { useResizableThreePaneLayout } from "../../hooks/useResizableThreePaneLayout";
import type { NewUiTheme } from "../../utils/workbenchPreferences";
import { SplitResizeHandle } from "../SplitResizeHandle";
import { AnalysisHome } from "./AnalysisHome";

type NewUiSectionId = "analysis" | "library" | "restructure";
type NewUiLibraryChildId = "sampleStructure" | "semanticGovernance" | "planTrace";

type NewUiSection = {
  id: NewUiSectionId;
  label: string;
  children?: NewUiNavChild[];
};

type NewUiNavChild = {
  id: NewUiLibraryChildId;
  label: string;
};

const NEW_UI_SECTIONS: NewUiSection[] = [
  { id: "analysis", label: "分析" },
  {
    id: "library",
    label: "库",
    children: [
      { id: "sampleStructure", label: "旧UI样例结构图" },
      { id: "semanticGovernance", label: "语义治理库" },
      { id: "planTrace", label: "方案溯源图" },
    ],
  },
  { id: "restructure", label: "重组" },
];

type NewUiLayoutProps = {
  theme: NewUiTheme;
  onThemeChange: (theme: NewUiTheme) => void;
  onLeftCollapsedChange?: (collapsed: boolean) => void;
};

export function NewUiLayout({ theme, onThemeChange, onLeftCollapsedChange }: NewUiLayoutProps) {
  const layoutRef = useRef<HTMLElement>(null);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [activeSection, setActiveSection] = useState<NewUiSectionId>("analysis");
  const [activeLibraryChild, setActiveLibraryChild] = useState<NewUiLibraryChildId>("sampleStructure");
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
        <div className="new-ui-pane-body">
          <SidebarNav
            activeLibraryChild={activeLibraryChild}
            activeSection={activeSection}
            collapsed={leftCollapsed}
            onLibraryChildChange={setActiveLibraryChild}
            onSectionChange={setActiveSection}
          />
        </div>
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
      <main
        className="new-ui-center"
        aria-label={`${resolveSectionLabel(activeSection, activeLibraryChild)}工作区`}
        data-active-library-child={activeSection === "library" ? activeLibraryChild : undefined}
        data-active-section={activeSection}
      >
        {activeSection === "analysis" ? <AnalysisHome /> : null}
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
        <PaneHeader collapsed={rightCollapsed} onToggle={() => setRightCollapsed((value) => !value)} side="right" />
        <div className="new-ui-pane-body" aria-hidden={rightCollapsed} />
      </aside>
    </section>
  );
}

type SidebarNavProps = {
  activeLibraryChild: NewUiLibraryChildId;
  activeSection: NewUiSectionId;
  collapsed: boolean;
  onLibraryChildChange: (child: NewUiLibraryChildId) => void;
  onSectionChange: (section: NewUiSectionId) => void;
};

function SidebarNav({ activeLibraryChild, activeSection, collapsed, onLibraryChildChange, onSectionChange }: SidebarNavProps) {
  const [expandedSection, setExpandedSection] = useState<NewUiSectionId | null>(null);

  return (
    <nav className="new-ui-sidebar-nav" aria-label="新 UI 功能导航">
      {NEW_UI_SECTIONS.map((section) => {
        const isActive = section.id === activeSection;
        const hasChildren = Boolean(section.children?.length);
        const isExpanded = hasChildren && !collapsed && (expandedSection === section.id || isActive);
        const navButton = (
          <button
            key={hasChildren ? undefined : section.id}
            className={`new-ui-sidebar-nav-item ${isActive ? "is-active" : ""} ${hasChildren ? "has-children" : ""}`.trim()}
            data-section={section.id}
            type="button"
            aria-current={isActive ? "page" : undefined}
            aria-expanded={hasChildren ? isExpanded : undefined}
            aria-label={collapsed ? section.label : undefined}
            title={collapsed ? section.label : undefined}
            onClick={() => onSectionChange(section.id)}
          >
            <span className="new-ui-sidebar-nav-icon" aria-hidden="true">
              <SectionIcon section={section.id} />
            </span>
            <span className="new-ui-sidebar-nav-label">{section.label}</span>
            {hasChildren ? <ExpandIcon expanded={isExpanded} /> : null}
          </button>
        );

        if (!hasChildren) {
          return navButton;
        }

        return (
          <div
            key={section.id}
            className={`new-ui-sidebar-nav-group ${isExpanded ? "is-expanded" : ""}`.trim()}
            data-section={section.id}
            onBlur={(event) => {
              const nextTarget = event.relatedTarget;
              if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) setExpandedSection(null);
            }}
            onFocus={() => setExpandedSection(section.id)}
            onPointerEnter={() => setExpandedSection(section.id)}
            onPointerLeave={() => setExpandedSection(null)}
          >
            {navButton}
            <div className="new-ui-sidebar-subnav" aria-label={`${section.label}子类`}>
              {section.children?.map((child) => {
                const isChildActive = isActive && activeLibraryChild === child.id;
                return (
                  <button
                    key={child.id}
                    className={`new-ui-sidebar-subnav-item ${isChildActive ? "is-active" : ""}`.trim()}
                    type="button"
                    aria-current={isChildActive ? "page" : undefined}
                    onClick={() => {
                      onSectionChange(section.id);
                      onLibraryChildChange(child.id);
                    }}
                  >
                    {child.label}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </nav>
  );
}

function resolveSectionLabel(section: NewUiSectionId, libraryChild: NewUiLibraryChildId) {
  const active = NEW_UI_SECTIONS.find((item) => item.id === section);
  if (section === "library") {
    return active?.children?.find((child) => child.id === libraryChild)?.label ?? active?.label ?? "库";
  }
  return active?.label ?? "分析";
}

type SectionIconProps = {
  section: NewUiSectionId;
};

function SectionIcon({ section }: SectionIconProps) {
  if (section === "analysis") {
    return (
      <svg viewBox="0 0 24 24" focusable="false">
        <circle className="new-ui-section-icon-main" cx="10.2" cy="10.2" r="5.7" />
        <path className="new-ui-section-icon-main" d="M14.4 14.4 19.2 19.2" />
        <path className="new-ui-section-icon-detail new-ui-section-icon-analysis-line" d="M7.3 11.1 9.1 9.3 11.2 11.2 13.4 8.2" />
        <circle className="new-ui-section-icon-detail new-ui-section-icon-dot" cx="7.3" cy="11.1" r="0.55" />
        <circle className="new-ui-section-icon-detail new-ui-section-icon-dot" cx="9.1" cy="9.3" r="0.55" />
        <circle className="new-ui-section-icon-detail new-ui-section-icon-dot" cx="11.2" cy="11.2" r="0.55" />
        <circle className="new-ui-section-icon-detail new-ui-section-icon-dot" cx="13.4" cy="8.2" r="0.55" />
        <path className="new-ui-section-icon-alt new-ui-section-icon-analysis-scan" d="M7.2 10.2h6" />
        <path className="new-ui-section-icon-alt new-ui-section-icon-analysis-focus" d="M10.2 7.2v6" />
        <circle className="new-ui-section-icon-alt new-ui-section-icon-analysis-center" cx="10.2" cy="10.2" r="1" />
      </svg>
    );
  }

  if (section === "library") {
    return (
      <svg viewBox="0 0 24 24" focusable="false">
        <path className="new-ui-section-icon-main" d="M6.2 6.4h11.6a1.6 1.6 0 0 1 1.6 1.6v8a1.6 1.6 0 0 1-1.6 1.6H6.2A1.6 1.6 0 0 1 4.6 16V8a1.6 1.6 0 0 1 1.6-1.6Z" />
        <path className="new-ui-section-icon-detail new-ui-section-icon-library-top" d="M7.2 4.2h9.6" />
        <path className="new-ui-section-icon-detail new-ui-section-icon-library-bottom" d="M7.2 19.8h9.6" />
        <path className="new-ui-section-icon-detail new-ui-section-icon-library-row" d="M8.1 10h7.8" />
        <path className="new-ui-section-icon-detail new-ui-section-icon-library-row" d="M8.1 13.8h5.1" />
        <path className="new-ui-section-icon-alt new-ui-section-icon-library-handle" d="M9.2 10.1h5.6" />
        <path className="new-ui-section-icon-alt new-ui-section-icon-library-drawer" d="M7.4 13.9h9.2" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" focusable="false">
      <rect className="new-ui-section-icon-main new-ui-section-icon-node" x="4.4" y="4.4" width="5.2" height="5.2" rx="1.4" />
      <rect className="new-ui-section-icon-main new-ui-section-icon-node" x="14.4" y="4.4" width="5.2" height="5.2" rx="1.4" />
      <rect className="new-ui-section-icon-main new-ui-section-icon-node" x="9.4" y="14.4" width="5.2" height="5.2" rx="1.4" />
      <path className="new-ui-section-icon-detail new-ui-section-icon-link-top" d="M9.6 7h4.8" />
      <path className="new-ui-section-icon-detail new-ui-section-icon-link-left" d="M7 9.6c0.4 2.3 1.8 3.9 3.8 5.1" />
      <path className="new-ui-section-icon-detail new-ui-section-icon-link-right" d="M17 9.6c-0.4 2.3-1.8 3.9-3.8 5.1" />
      <path className="new-ui-section-icon-alt new-ui-section-icon-link-swap-a" d="M9.4 7.2c2.6 0.8 4.2 2.6 5.2 7.2" />
      <path className="new-ui-section-icon-alt new-ui-section-icon-link-swap-b" d="M14.6 7.2c-2.6 0.8-4.2 2.6-5.2 7.2" />
    </svg>
  );
}

function ExpandIcon({ expanded }: { expanded: boolean }) {
  return (
    <span className={`new-ui-sidebar-expand-icon ${expanded ? "is-expanded" : ""}`} aria-hidden="true">
      <svg viewBox="0 0 16 16" focusable="false">
        <path d="M5.6 3.8 9.8 8l-4.2 4.2" />
      </svg>
    </span>
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
            <path className="new-ui-theme-icon-rays" d="M12 4.5V2m0 20v-2.5M4.5 12H2m20 0h-2.5M5.64 5.64 3.86 3.86m16.28 16.28-1.78-1.78m0-12.72 1.78-1.78M3.86 20.14l1.78-1.78" />
            <circle className="new-ui-theme-icon-core" cx="12" cy="12" r="4.2" />
          </svg>
          <svg className="new-ui-theme-icon new-ui-theme-icon-moon" viewBox="0 0 24 24" focusable="false">
            <path className="new-ui-theme-icon-crescent" d="M20.2 14.6A7.7 7.7 0 0 1 9.4 3.8 8.8 8.8 0 1 0 20.2 14.6Z" />
            <path className="new-ui-theme-icon-star new-ui-theme-icon-star-a" d="M6.4 5.2v2M5.4 6.2h2" />
            <path className="new-ui-theme-icon-star new-ui-theme-icon-star-b" d="M17 4.5v1.8M16.1 5.4h1.8" />
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
        </span>
      </button>
    </header>
  );
}
