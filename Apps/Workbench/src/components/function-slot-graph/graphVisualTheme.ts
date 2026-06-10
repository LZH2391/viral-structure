export type GraphMode = "structure" | "governance" | "planTrace";

export type GraphStrokeStyle = {
  color: number;
  alpha: number;
  width: number;
  dash?: [number, number];
  distanceFade?: {
    minAlpha: number;
  };
  glow?: {
    color: number;
    alpha: number;
    width: number;
  };
  arrowColor: number;
  arrowAlpha: number;
};

export type GraphNodeDrawStyle = {
  fill: number;
  fillAlpha: number;
  stroke: number;
  strokeWidth: number;
  strokeAlpha: number;
  groupAlpha: number;
  dash?: [number, number];
  glow?: {
    color: number;
    alpha: number;
    radiusPad: number;
  };
  labelFill: string;
  labelFontSize: number;
};

export type GraphVisualTheme = {
  canvas: {
    nodeOcclusionFill: number;
  };
  state: {
    nodeMutedAlpha: number;
    nodeFocusMutedAlpha: number;
    edgeMutedOpacity: number;
  };
  edge: {
    default: number;
    slot: number;
    sequence: number;
    binding: number;
    plan: number;
    semantic: number;
    hierarchy: number;
    sourceTrace: number;
    script: number;
    rhythm: number;
    packaging: number;
    focusGlowAlpha: number;
  };
  node: {
    neutral: number;
    neutralStroke: number;
    selectedStroke: number;
    library: number;
    slot: number;
    slotFamily: number;
    slotFamilyStroke: number;
    slotArchetype: number;
    slotArchetypeStroke: number;
    slotSubtype: number;
    slotSubtypeStroke: number;
    tracedSlot: number;
    tracedSlotStroke: number;
    script: number;
    scriptStroke: number;
    rhythm: number;
    rhythmStroke: number;
    packaging: number;
    packagingStroke: number;
    concept: number;
    binding: number;
    governance: number;
    governanceStroke: number;
    policy: number;
    bundle: number;
    review: number;
    sourceVariant: number;
    sourceVariantTrace: number;
    projected: number;
    pinnedGlow: number;
    landmarkGlow: number;
  };
  text: {
    label: string;
  };
};

export const GRAPH_VISUAL_THEME: GraphVisualTheme = {
  canvas: {
    nodeOcclusionFill: 0x121318,
  },
  state: {
    nodeMutedAlpha: 0.7,
    nodeFocusMutedAlpha: 0.1,
    edgeMutedOpacity: 0.14,
  },
  edge: {
    default: 0x8a8a86,
    slot: 0x8fc89a,
    sequence: 0xc8b46a,
    binding: 0xb7a45c,
    plan: 0xeeeeea,
    semantic: 0xc8b46a,
    hierarchy: 0x7fb7ff,
    sourceTrace: 0xaeb3ad,
    script: 0xd86a5d,
    rhythm: 0x6fa9d8,
    packaging: 0x9b8ad8,
    focusGlowAlpha: 0.28,
  },
  node: {
    neutral: 0x20201f,
    neutralStroke: 0x8a8a86,
    selectedStroke: 0xf4f3ef,
    library: 0x6f6a86,
    slot: 0x6fa77a,
    slotFamily: 0x587b60,
    slotFamilyStroke: 0x8fc89a,
    slotArchetype: 0x4e6f94,
    slotArchetypeStroke: 0x7fb7ff,
    slotSubtype: 0x8b7742,
    slotSubtypeStroke: 0xc8b46a,
    tracedSlot: 0x74b89f,
    tracedSlotStroke: 0xb8ded1,
    script: 0xc9655a,
    scriptStroke: 0xd88376,
    rhythm: 0x5d99bd,
    rhythmStroke: 0x81b9da,
    packaging: 0x8d7ac8,
    packagingStroke: 0xa998d8,
    concept: 0x5f9d78,
    binding: 0xb9a85f,
    governance: 0x20201f,
    governanceStroke: 0xeeeeea,
    policy: 0x7f9fcf,
    bundle: 0xb99655,
    review: 0xc77566,
    sourceVariant: 0x262625,
    sourceVariantTrace: 0x303846,
    projected: 0x5e5e5a,
    pinnedGlow: 0x8f879f,
    landmarkGlow: 0xb8adc8,
  },
  text: {
    label: "#eeeeea",
  },
};

const GRAPH_VISUAL_THEME_TOKEN_MAP = {
  canvas: {
    nodeOcclusionFill: "--slot-graph-node-occlusion-fill",
  },
  state: {
    nodeMutedAlpha: "--slot-graph-node-muted-alpha",
    nodeFocusMutedAlpha: "--slot-graph-node-focus-muted-alpha",
    edgeMutedOpacity: "--slot-graph-edge-muted-opacity",
  },
  edge: {
    default: "--slot-graph-edge-default",
    slot: "--slot-graph-edge-slot",
    sequence: "--slot-graph-edge-sequence",
    binding: "--slot-graph-edge-binding",
    plan: "--slot-graph-edge-plan",
    semantic: "--slot-graph-edge-semantic",
    hierarchy: "--slot-graph-edge-hierarchy",
    sourceTrace: "--slot-graph-edge-source-trace",
    script: "--slot-graph-edge-script",
    rhythm: "--slot-graph-edge-rhythm",
    packaging: "--slot-graph-edge-packaging",
  },
  node: {
    neutral: "--slot-graph-node-neutral",
    neutralStroke: "--slot-graph-node-neutral-stroke",
    selectedStroke: "--slot-graph-node-selected-stroke",
    library: "--slot-graph-node-library",
    slot: "--slot-graph-node-slot",
    slotFamily: "--slot-graph-node-slot-family",
    slotFamilyStroke: "--slot-graph-node-slot-family-stroke",
    slotArchetype: "--slot-graph-node-slot-archetype",
    slotArchetypeStroke: "--slot-graph-node-slot-archetype-stroke",
    slotSubtype: "--slot-graph-node-slot-subtype",
    slotSubtypeStroke: "--slot-graph-node-slot-subtype-stroke",
    tracedSlot: "--slot-graph-node-traced-slot",
    tracedSlotStroke: "--slot-graph-node-traced-slot-stroke",
    script: "--slot-graph-node-script",
    scriptStroke: "--slot-graph-node-script-stroke",
    rhythm: "--slot-graph-node-rhythm",
    rhythmStroke: "--slot-graph-node-rhythm-stroke",
    packaging: "--slot-graph-node-packaging",
    packagingStroke: "--slot-graph-node-packaging-stroke",
    concept: "--slot-graph-node-concept",
    binding: "--slot-graph-node-binding",
    governance: "--slot-graph-node-governance",
    governanceStroke: "--slot-graph-node-governance-stroke",
    policy: "--slot-graph-node-policy",
    bundle: "--slot-graph-node-bundle",
    review: "--slot-graph-node-review",
    sourceVariant: "--slot-graph-node-source-variant",
    sourceVariantTrace: "--slot-graph-node-source-variant-trace",
    projected: "--slot-graph-node-projected",
    pinnedGlow: "--slot-graph-node-pinned-glow",
    landmarkGlow: "--slot-graph-node-landmark-glow",
  },
  text: {
    label: "--slot-graph-text-label",
  },
} as const;

export function readGraphVisualTheme(element: Element | null): GraphVisualTheme {
  if (!element || typeof window === "undefined") return GRAPH_VISUAL_THEME;
  const style = window.getComputedStyle(element);
  return {
    canvas: {
      nodeOcclusionFill: readColorToken(style, GRAPH_VISUAL_THEME_TOKEN_MAP.canvas.nodeOcclusionFill, cssColorToNumber(style.backgroundColor) ?? GRAPH_VISUAL_THEME.canvas.nodeOcclusionFill),
    },
    state: {
      nodeMutedAlpha: readNumberToken(style, GRAPH_VISUAL_THEME_TOKEN_MAP.state.nodeMutedAlpha, GRAPH_VISUAL_THEME.state.nodeMutedAlpha),
      nodeFocusMutedAlpha: readNumberToken(style, GRAPH_VISUAL_THEME_TOKEN_MAP.state.nodeFocusMutedAlpha, GRAPH_VISUAL_THEME.state.nodeFocusMutedAlpha),
      edgeMutedOpacity: readNumberToken(style, GRAPH_VISUAL_THEME_TOKEN_MAP.state.edgeMutedOpacity, GRAPH_VISUAL_THEME.state.edgeMutedOpacity),
    },
    edge: {
      default: readColorToken(style, GRAPH_VISUAL_THEME_TOKEN_MAP.edge.default, GRAPH_VISUAL_THEME.edge.default),
      slot: readColorToken(style, GRAPH_VISUAL_THEME_TOKEN_MAP.edge.slot, GRAPH_VISUAL_THEME.edge.slot),
      sequence: readColorToken(style, GRAPH_VISUAL_THEME_TOKEN_MAP.edge.sequence, GRAPH_VISUAL_THEME.edge.sequence),
      binding: readColorToken(style, GRAPH_VISUAL_THEME_TOKEN_MAP.edge.binding, GRAPH_VISUAL_THEME.edge.binding),
      plan: readColorToken(style, GRAPH_VISUAL_THEME_TOKEN_MAP.edge.plan, GRAPH_VISUAL_THEME.edge.plan),
      semantic: readColorToken(style, GRAPH_VISUAL_THEME_TOKEN_MAP.edge.semantic, GRAPH_VISUAL_THEME.edge.semantic),
      hierarchy: readColorToken(style, GRAPH_VISUAL_THEME_TOKEN_MAP.edge.hierarchy, GRAPH_VISUAL_THEME.edge.hierarchy),
      sourceTrace: readColorToken(style, GRAPH_VISUAL_THEME_TOKEN_MAP.edge.sourceTrace, GRAPH_VISUAL_THEME.edge.sourceTrace),
      script: readColorToken(style, GRAPH_VISUAL_THEME_TOKEN_MAP.edge.script, GRAPH_VISUAL_THEME.edge.script),
      rhythm: readColorToken(style, GRAPH_VISUAL_THEME_TOKEN_MAP.edge.rhythm, GRAPH_VISUAL_THEME.edge.rhythm),
      packaging: readColorToken(style, GRAPH_VISUAL_THEME_TOKEN_MAP.edge.packaging, GRAPH_VISUAL_THEME.edge.packaging),
      focusGlowAlpha: readNumberToken(style, "--slot-graph-edge-focus-glow-alpha", GRAPH_VISUAL_THEME.edge.focusGlowAlpha),
    },
    node: {
      neutral: readColorToken(style, GRAPH_VISUAL_THEME_TOKEN_MAP.node.neutral, GRAPH_VISUAL_THEME.node.neutral),
      neutralStroke: readColorToken(style, GRAPH_VISUAL_THEME_TOKEN_MAP.node.neutralStroke, GRAPH_VISUAL_THEME.node.neutralStroke),
      selectedStroke: readColorToken(style, GRAPH_VISUAL_THEME_TOKEN_MAP.node.selectedStroke, GRAPH_VISUAL_THEME.node.selectedStroke),
      library: readColorToken(style, GRAPH_VISUAL_THEME_TOKEN_MAP.node.library, GRAPH_VISUAL_THEME.node.library),
      slot: readColorToken(style, GRAPH_VISUAL_THEME_TOKEN_MAP.node.slot, GRAPH_VISUAL_THEME.node.slot),
      slotFamily: readColorToken(style, GRAPH_VISUAL_THEME_TOKEN_MAP.node.slotFamily, GRAPH_VISUAL_THEME.node.slotFamily),
      slotFamilyStroke: readColorToken(style, GRAPH_VISUAL_THEME_TOKEN_MAP.node.slotFamilyStroke, GRAPH_VISUAL_THEME.node.slotFamilyStroke),
      slotArchetype: readColorToken(style, GRAPH_VISUAL_THEME_TOKEN_MAP.node.slotArchetype, GRAPH_VISUAL_THEME.node.slotArchetype),
      slotArchetypeStroke: readColorToken(style, GRAPH_VISUAL_THEME_TOKEN_MAP.node.slotArchetypeStroke, GRAPH_VISUAL_THEME.node.slotArchetypeStroke),
      slotSubtype: readColorToken(style, GRAPH_VISUAL_THEME_TOKEN_MAP.node.slotSubtype, GRAPH_VISUAL_THEME.node.slotSubtype),
      slotSubtypeStroke: readColorToken(style, GRAPH_VISUAL_THEME_TOKEN_MAP.node.slotSubtypeStroke, GRAPH_VISUAL_THEME.node.slotSubtypeStroke),
      tracedSlot: readColorToken(style, GRAPH_VISUAL_THEME_TOKEN_MAP.node.tracedSlot, GRAPH_VISUAL_THEME.node.tracedSlot),
      tracedSlotStroke: readColorToken(style, GRAPH_VISUAL_THEME_TOKEN_MAP.node.tracedSlotStroke, GRAPH_VISUAL_THEME.node.tracedSlotStroke),
      script: readColorToken(style, GRAPH_VISUAL_THEME_TOKEN_MAP.node.script, GRAPH_VISUAL_THEME.node.script),
      scriptStroke: readColorToken(style, GRAPH_VISUAL_THEME_TOKEN_MAP.node.scriptStroke, GRAPH_VISUAL_THEME.node.scriptStroke),
      rhythm: readColorToken(style, GRAPH_VISUAL_THEME_TOKEN_MAP.node.rhythm, GRAPH_VISUAL_THEME.node.rhythm),
      rhythmStroke: readColorToken(style, GRAPH_VISUAL_THEME_TOKEN_MAP.node.rhythmStroke, GRAPH_VISUAL_THEME.node.rhythmStroke),
      packaging: readColorToken(style, GRAPH_VISUAL_THEME_TOKEN_MAP.node.packaging, GRAPH_VISUAL_THEME.node.packaging),
      packagingStroke: readColorToken(style, GRAPH_VISUAL_THEME_TOKEN_MAP.node.packagingStroke, GRAPH_VISUAL_THEME.node.packagingStroke),
      concept: readColorToken(style, GRAPH_VISUAL_THEME_TOKEN_MAP.node.concept, GRAPH_VISUAL_THEME.node.concept),
      binding: readColorToken(style, GRAPH_VISUAL_THEME_TOKEN_MAP.node.binding, GRAPH_VISUAL_THEME.node.binding),
      governance: readColorToken(style, GRAPH_VISUAL_THEME_TOKEN_MAP.node.governance, GRAPH_VISUAL_THEME.node.governance),
      governanceStroke: readColorToken(style, GRAPH_VISUAL_THEME_TOKEN_MAP.node.governanceStroke, GRAPH_VISUAL_THEME.node.governanceStroke),
      policy: readColorToken(style, GRAPH_VISUAL_THEME_TOKEN_MAP.node.policy, GRAPH_VISUAL_THEME.node.policy),
      bundle: readColorToken(style, GRAPH_VISUAL_THEME_TOKEN_MAP.node.bundle, GRAPH_VISUAL_THEME.node.bundle),
      review: readColorToken(style, GRAPH_VISUAL_THEME_TOKEN_MAP.node.review, GRAPH_VISUAL_THEME.node.review),
      sourceVariant: readColorToken(style, GRAPH_VISUAL_THEME_TOKEN_MAP.node.sourceVariant, GRAPH_VISUAL_THEME.node.sourceVariant),
      sourceVariantTrace: readColorToken(style, GRAPH_VISUAL_THEME_TOKEN_MAP.node.sourceVariantTrace, GRAPH_VISUAL_THEME.node.sourceVariantTrace),
      projected: readColorToken(style, GRAPH_VISUAL_THEME_TOKEN_MAP.node.projected, GRAPH_VISUAL_THEME.node.projected),
      pinnedGlow: readColorToken(style, GRAPH_VISUAL_THEME_TOKEN_MAP.node.pinnedGlow, GRAPH_VISUAL_THEME.node.pinnedGlow),
      landmarkGlow: readColorToken(style, GRAPH_VISUAL_THEME_TOKEN_MAP.node.landmarkGlow, GRAPH_VISUAL_THEME.node.landmarkGlow),
    },
    text: {
      label: readTextToken(style, GRAPH_VISUAL_THEME_TOKEN_MAP.text.label, GRAPH_VISUAL_THEME.text.label),
    },
  };
}

export function cssToken(value: unknown) {
  return String(value ?? "").replace(/[^A-Za-z0-9_-]/g, "_");
}

export function classSet(tokens: string[]) {
  return new Set(tokens);
}

export function rgba(color: number, alpha: number) {
  return { color, alpha };
}

function readTextToken(style: CSSStyleDeclaration, token: string, fallback: string) {
  return resolveCssToken(style, token) || fallback;
}

function readNumberToken(style: CSSStyleDeclaration, token: string, fallback: number) {
  const value = Number(resolveCssToken(style, token));
  return Number.isFinite(value) ? value : fallback;
}

function readColorToken(style: CSSStyleDeclaration, token: string, fallback: number) {
  return cssColorToNumber(resolveCssToken(style, token)) ?? fallback;
}

function resolveCssToken(style: CSSStyleDeclaration, token: string, seen = new Set<string>()): string {
  if (seen.has(token)) return "";
  seen.add(token);
  const raw = style.getPropertyValue(token).trim();
  const variable = raw.match(/^var\(\s*(--[A-Za-z0-9_-]+)(?:\s*,\s*(.+))?\)$/);
  if (!variable) return raw;
  return resolveCssToken(style, variable[1], seen) || variable[2]?.trim() || "";
}

function cssColorToNumber(value: string) {
  if (!value) return null;
  if (value.startsWith("#")) {
    const normalized = value.length === 4
      ? `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`
      : value;
    const parsed = Number.parseInt(normalized.slice(1, 7), 16);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const rgb = value.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  if (!rgb) return null;
  const [r, g, b] = rgb.slice(1, 4).map((channel) => Math.max(0, Math.min(255, Math.round(Number(channel)))));
  if (![r, g, b].every(Number.isFinite)) return null;
  return (r << 16) + (g << 8) + b;
}
