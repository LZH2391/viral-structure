import { clamp, nodeRadius, VIEWBOX } from "./graphUtils";
import { pixiScreenPoint } from "./graphPixiRenderer";
import type { GraphVisualTheme } from "./graphVisualStyles";
import type { SimNode, VisibleGraph } from "./types";

export type GraphMode = "structure" | "governance" | "planTrace";
export type ViewportTransform = { x: number; y: number; k: number };
export type ViewportEasing = (progress: number) => number;
export type ViewportAnimationOptions = { durationMs?: number; easing?: ViewportEasing };
export type StageTransform = { scale: number; offsetX: number; offsetY: number };
export type HitGridEntry = { node: SimNode; index: number };
export type HitGridIndex = { cellSize: number; cells: Map<string, HitGridEntry[]> };

export const SEARCH_RESULT_ANIMATION_MS = 800;
export const HIT_GRID_CELL_SIZE = 96;
export const MIN_ZOOM = 0.8;
export const MAX_ZOOM = 5;
export const FIT_WORLD_PADDING = 180;
export const INITIAL_ZOOM_BY_MODE: Record<GraphMode, number> = {
  structure: 3,
  governance: 1,
  planTrace: 1.5,
};
export const SEARCH_RESULT_FOCUS_ZOOM = 2.5;

export function buildHitGrid(nodes: SimNode[]): HitGridIndex {
  const cells = new Map<string, HitGridEntry[]>();
  nodes.forEach((node, index) => {
    const key = hitGridKey(node.x, node.y, HIT_GRID_CELL_SIZE);
    const entries = cells.get(key);
    if (entries) entries.push({ node, index });
    else cells.set(key, [{ node, index }]);
  });
  return { cellSize: HIT_GRID_CELL_SIZE, cells };
}

export function hitTestHitGrid(index: HitGridIndex, point: { x: number; y: number }, zoom: number) {
  const hitPad = clamp(10 / zoom, 4, 16);
  const queryRadius = 42 + hitPad;
  const minCellX = Math.floor((point.x - queryRadius) / index.cellSize);
  const maxCellX = Math.floor((point.x + queryRadius) / index.cellSize);
  const minCellY = Math.floor((point.y - queryRadius) / index.cellSize);
  const maxCellY = Math.floor((point.y + queryRadius) / index.cellSize);
  let best: HitGridEntry | null = null;
  for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
    for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
      for (const entry of index.cells.get(`${cellX}:${cellY}`) ?? []) {
        if (best && entry.index < best.index) continue;
        const radius = nodeRadius(entry.node) + hitPad;
        if (Math.hypot(point.x - entry.node.x, point.y - entry.node.y) <= radius) best = entry;
      }
    }
  }
  return best?.node ?? null;
}

export function currentHostGeometry(host: HTMLDivElement | null, fallbackSize: { width: number; height: number }) {
  const rect = host?.getBoundingClientRect() ?? null;
  if (!rect) return null;
  return {
    rect,
    size: {
      width: host?.offsetWidth || fallbackSize.width || rect.width || VIEWBOX.width,
      height: host?.offsetHeight || fallbackSize.height || rect.height || VIEWBOX.height,
    },
  };
}

export function visibleCanvasGeometryFor(
  host: HTMLDivElement | null,
  canvas: HTMLDivElement | null,
  fallbackSize: { width: number; height: number },
) {
  const hostGeometry = currentHostGeometry(host, fallbackSize);
  const canvasRect = canvas?.getBoundingClientRect() ?? null;
  if (!hostGeometry || !canvasRect) return null;
  const scaleX = hostGeometry.rect.width ? hostGeometry.size.width / hostGeometry.rect.width : 1;
  const scaleY = hostGeometry.rect.height ? hostGeometry.size.height / hostGeometry.rect.height : 1;
  const left = (canvasRect.left - hostGeometry.rect.left) * scaleX;
  const top = (canvasRect.top - hostGeometry.rect.top) * scaleY;
  const width = canvasRect.width * scaleX;
  const height = canvasRect.height * scaleY;
  return {
    bounds: {
      left,
      top,
      right: left + width,
      bottom: top + height,
    },
    size: { width, height },
  };
}

export function pixiVisiblePoint(
  node: SimNode,
  viewport: { x: number; y: number; k: number },
  hostGeometry: ReturnType<typeof currentHostGeometry>,
  visibleGeometry: ReturnType<typeof visibleCanvasGeometryFor>,
) {
  const size = hostGeometry?.size ?? visibleGeometry?.size ?? { width: VIEWBOX.width, height: VIEWBOX.height };
  const bounds = visibleGeometry?.bounds ?? { left: 0, top: 0 };
  const point = pixiScreenPoint(node, viewport, size);
  return {
    x: point.x - bounds.left,
    y: point.y - bounds.top,
  };
}

export function stageTransform(size: { width: number; height: number }): StageTransform {
  const scale = Math.min(size.width / VIEWBOX.width, size.height / VIEWBOX.height) || 1;
  return {
    scale,
    offsetX: (size.width - VIEWBOX.width * scale) / 2,
    offsetY: (size.height - VIEWBOX.height * scale) / 2,
  };
}

export function fitGraphViewport(
  nodes: SimNode[],
  size: { width: number; height: number },
  mode: GraphMode,
  visibleBounds?: { left: number; top: number; right: number; bottom: number },
): ViewportTransform {
  if (!nodes.length) return { x: 0, y: 0, k: 1 };
  const transform = stageTransform(size);
  const fitBounds = visibleBounds ?? { left: 0, top: 0, right: size.width, bottom: size.height };
  const fitWidth = Math.max(1, fitBounds.right - fitBounds.left);
  const fitHeight = Math.max(1, fitBounds.bottom - fitBounds.top);
  const centerX = (fitBounds.left + fitWidth / 2 - transform.offsetX) / transform.scale;
  const centerY = (fitBounds.top + fitHeight / 2 - transform.offsetY) / transform.scale;
  const bounds = graphBounds(nodes);
  const k = clamp(INITIAL_ZOOM_BY_MODE[mode], MIN_ZOOM, MAX_ZOOM);
  return {
    x: centerX - bounds.centerX * k,
    y: centerY - bounds.centerY * k,
    k,
  };
}

export function isSamplePreviewNode(node: SimNode | null) {
  return node?.type === "sourceSample" || node?.type === "libraryItem";
}

export function isSourceSampleNode(node: SimNode | VisibleGraph["nodes"][number]) {
  return node.type === "sourceSample";
}

export function sourceSampleSearchLabel(node: SimNode | VisibleGraph["nodes"][number], mappedTitle?: string | null) {
  return stringField(node.data.sourceVideoName)
    ?? stringField(node.data.sourceAlias)
    ?? stringField(mappedTitle)
    ?? stringField(node.label)
    ?? stringField(node.data.sampleVideoId)
    ?? node.id;
}

export function stringField(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function easeOutCubic(progress: number) {
  return 1 - ((1 - progress) ** 3);
}

export function easeOutQuad(progress: number) {
  return 1 - ((1 - progress) ** 2);
}

export function graphVisualThemeKey(theme: GraphVisualTheme) {
  return JSON.stringify(theme);
}

function hitGridKey(x: number, y: number, cellSize: number) {
  return `${Math.floor(x / cellSize)}:${Math.floor(y / cellSize)}`;
}

function graphBounds(nodes: SimNode[]) {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const node of nodes) {
    const radius = nodeRadius(node) + FIT_WORLD_PADDING;
    minX = Math.min(minX, node.x - radius);
    minY = Math.min(minY, node.y - radius);
    maxX = Math.max(maxX, node.x + radius);
    maxY = Math.max(maxY, node.y + radius);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return { centerX: VIEWBOX.width / 2, centerY: VIEWBOX.height / 2, width: VIEWBOX.width, height: VIEWBOX.height };
  }
  return {
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}
