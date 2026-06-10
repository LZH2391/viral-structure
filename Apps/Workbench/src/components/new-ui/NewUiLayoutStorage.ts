import { NEW_UI_THREE_PANE_STORAGE_KEY, type NewUiThreePanePreference } from "./NewUiLayoutTypes";

export function sameStringList(a: string[] | null | undefined, b: string[] | null | undefined) { const left = a ?? []; const right = b ?? []; if (left.length !== right.length)
    return false; return left.every((value, index) => value === right[index]); }

export function readStoredBooleanPreference(key: keyof NewUiThreePanePreference, fallback: boolean) { try {
    const parsed = JSON.parse(window.localStorage.getItem(NEW_UI_THREE_PANE_STORAGE_KEY) ?? "null");
    return typeof parsed?.[key] === "boolean" ? parsed[key] : fallback;
}
catch {
    return fallback;
} }

export function writeStoredLayoutPreference(preference: NewUiThreePanePreference) { try {
    const parsed = JSON.parse(window.localStorage.getItem(NEW_UI_THREE_PANE_STORAGE_KEY) ?? "null");
    const current: Record<string, unknown> = parsed && typeof parsed === "object" ? parsed : {};
    const next = { ...current, ...preference };
    delete next.rightCollapsed;
    delete next.right;
    delete next.rightRatio;
    window.localStorage.setItem(NEW_UI_THREE_PANE_STORAGE_KEY, JSON.stringify(next));
}
catch { } }
