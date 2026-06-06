import type { NewUiTheme } from "../utils/workbenchPreferences";
import { NewUiLayout } from "./new-ui/NewUiLayout";

type NewUiAppProps = {
  active?: boolean;
  theme: NewUiTheme;
  onThemeChange: (theme: NewUiTheme) => void;
  onLeftCollapsedChange?: (collapsed: boolean) => void;
};

export function NewUiApp({ active = true, theme, onThemeChange, onLeftCollapsedChange }: NewUiAppProps) {
  return (
    <main className="new-ui-shell" data-theme={theme} aria-label="新工作台">
      <NewUiLayout active={active} theme={theme} onThemeChange={onThemeChange} onLeftCollapsedChange={onLeftCollapsedChange} />
    </main>
  );
}
