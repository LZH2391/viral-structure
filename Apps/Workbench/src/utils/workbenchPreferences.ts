export type NewUiTheme = "dark" | "light";

const NEW_UI_THEME_STORAGE_KEY = "workbench:new-ui-theme";
const DEFAULT_NEW_UI_THEME: NewUiTheme = "dark";

export function readNewUiThemePreference(): NewUiTheme {
  try {
    const value = window.localStorage.getItem(NEW_UI_THEME_STORAGE_KEY);
    return normalizeNewUiTheme(value);
  } catch {
    return DEFAULT_NEW_UI_THEME;
  }
}

export function writeNewUiThemePreference(theme: NewUiTheme) {
  try {
    window.localStorage.setItem(NEW_UI_THEME_STORAGE_KEY, theme);
  } catch {
    // Preference persistence is best-effort; the in-memory theme still updates.
  }
}

function normalizeNewUiTheme(value: string | null): NewUiTheme {
  return value === "light" || value === "dark" ? value : DEFAULT_NEW_UI_THEME;
}
