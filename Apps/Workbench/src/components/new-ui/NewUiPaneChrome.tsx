import type { NewUiTheme } from "../../utils/workbenchPreferences";

type ThemeToggleProps = {
    theme: NewUiTheme;
    onThemeChange: (theme: NewUiTheme) => void;
};

export function ThemeToggle({ theme, onThemeChange }: ThemeToggleProps) { const isLight = theme === "light"; return (<div className="new-ui-pane-theme"> <button className="new-ui-theme-toggle" type="button" aria-label={isLight ? "切换到黑夜主题" : "切换到白天主题"} aria-pressed={isLight} onClick={() => onThemeChange(isLight ? "dark" : "light")}> <span className="new-ui-theme-icon-wrap" aria-hidden="true"> <svg className="new-ui-theme-icon new-ui-theme-icon-sun" viewBox="0 0 24 24" focusable="false"> <path className="new-ui-theme-icon-rays" d="M12 4.5V2m0 20v-2.5M4.5 12H2m20 0h-2.5M5.64 5.64 3.86 3.86m16.28 16.28-1.78-1.78m0-12.72 1.78-1.78M3.86 20.14l1.78-1.78"/> <circle className="new-ui-theme-icon-core" cx="12" cy="12" r="4.2"/> </svg> <svg className="new-ui-theme-icon new-ui-theme-icon-moon" viewBox="0 0 24 24" focusable="false"> <path className="new-ui-theme-icon-crescent" d="M20.2 14.6A7.7 7.7 0 0 1 9.4 3.8 8.8 8.8 0 1 0 20.2 14.6Z"/> <path className="new-ui-theme-icon-star new-ui-theme-icon-star-a" d="M6.4 5.2v2M5.4 6.2h2"/> <path className="new-ui-theme-icon-star new-ui-theme-icon-star-b" d="M17 4.5v1.8M16.1 5.4h1.8"/> </svg> </span> </button> </div>); }

type PaneHeaderProps = {
    collapsed: boolean;
    side: "left" | "right";
    onToggle: () => void;
};

export function PaneHeader({ collapsed, side, onToggle }: PaneHeaderProps) { return (<header className="new-ui-pane-header"> <button className={`new-ui-pane-toggle new-ui-pane-toggle-${side} ${collapsed ? "is-collapsed" : ""}`} type="button" aria-label={collapsed ? `展开${side === "left" ? "左" : "右"}栏` : `收起${side === "left" ? "左" : "右"}栏`} aria-expanded={!collapsed} onClick={onToggle}> <span className="new-ui-pane-toggle-icon" aria-hidden="true"> <span className="new-ui-pane-toggle-panel"/> <span className="new-ui-pane-toggle-rail"/> </span> </button> </header>); }
