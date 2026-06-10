import type { GovernanceFilterPresetMode, GraphFiltersState } from "./types";

export const STRUCTURE_FILTERS: GraphFiltersState = {
  slot: true,
  atom: true,
  binding: false,
  rule: false,
  bundle: false,
  unmapped: false,
  slotFamily: true,
  slotArchetype: true,
  slotSubtype: true,
  atomArchetype: true,
  atomPattern: true,
  sourceVariant: true,
};

export const GOVERNANCE_LIGHT_FILTERS: GraphFiltersState = {
  ...STRUCTURE_FILTERS,
  slotArchetype: false,
  atomArchetype: false,
  sourceVariant: false,
  binding: false,
  rule: false,
  bundle: false,
  unmapped: false,
};

export const GOVERNANCE_FILTERS: GraphFiltersState = {
  ...STRUCTURE_FILTERS,
  binding: false,
  rule: false,
  bundle: false,
  unmapped: false,
};

export const GOVERNANCE_FULL_FILTERS: GraphFiltersState = {
  ...STRUCTURE_FILTERS,
  binding: true,
  rule: true,
  bundle: true,
  unmapped: true,
};

export const PLAN_TRACE_FILTERS: GraphFiltersState = {
  ...STRUCTURE_FILTERS,
};

export const GOVERNANCE_FILTER_PRESET_CONFIGS: Record<Exclude<GovernanceFilterPresetMode, "custom">, GraphFiltersState> = {
  light: GOVERNANCE_LIGHT_FILTERS,
  default: GOVERNANCE_FILTERS,
  full: GOVERNANCE_FULL_FILTERS,
};

const FUNCTION_SLOT_GRAPH_CONFIG_STORAGE_KEY = "function-slot-graph:config";

type FunctionSlotGraphConfig = {
  governancePresetMode: GovernanceFilterPresetMode;
  governanceFilters: GraphFiltersState;
};

export function readFunctionSlotGraphConfig(): FunctionSlotGraphConfig | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(FUNCTION_SLOT_GRAPH_CONFIG_STORAGE_KEY) ?? "null");
    if (!parsed || typeof parsed !== "object") return null;
    const governanceFilters = normalizeGraphFilters((parsed as Partial<FunctionSlotGraphConfig>).governanceFilters, GOVERNANCE_FILTERS);
    const storedMode = (parsed as Partial<FunctionSlotGraphConfig>).governancePresetMode;
    const governancePresetMode = isGovernancePresetMode(storedMode) ? storedMode : resolveGovernancePresetMode(governanceFilters);
    return { governancePresetMode, governanceFilters };
  } catch {
    return null;
  }
}

export function writeFunctionSlotGraphConfig(config: FunctionSlotGraphConfig) {
  try {
    window.localStorage.setItem(FUNCTION_SLOT_GRAPH_CONFIG_STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Ignore storage failures; the graph controls still work for the current session.
  }
}

export function resolveGovernancePresetMode(filters: GraphFiltersState): GovernanceFilterPresetMode {
  for (const [mode, presetFilters] of Object.entries(GOVERNANCE_FILTER_PRESET_CONFIGS) as Array<[Exclude<GovernanceFilterPresetMode, "custom">, GraphFiltersState]>) {
    if (graphFiltersEqual(filters, presetFilters)) return mode;
  }
  return "custom";
}

function normalizeGraphFilters(value: unknown, fallback: GraphFiltersState): GraphFiltersState {
  const source = value && typeof value === "object" ? value as Partial<Record<keyof GraphFiltersState, unknown>> : {};
  return (Object.keys(fallback) as Array<keyof GraphFiltersState>).reduce((next, key) => {
    next[key] = typeof source[key] === "boolean" ? source[key] : fallback[key];
    return next;
  }, {} as GraphFiltersState);
}

export function graphFiltersEqual(left: GraphFiltersState, right: GraphFiltersState) {
  return (Object.keys(right) as Array<keyof GraphFiltersState>).every((key) => left[key] === right[key]);
}

function isGovernancePresetMode(value: unknown): value is GovernanceFilterPresetMode {
  return value === "light" || value === "default" || value === "full" || value === "custom";
}
