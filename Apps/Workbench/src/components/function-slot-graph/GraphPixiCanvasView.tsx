import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { SampleArtifact } from "../../types/artifact";
import type { FunctionSlotLibraryGraph } from "../../types/library";
import { shortId } from "../../utils/format";
import { GraphLegend, LibraryPreviewPopover } from "./GraphSharedPanels";
import type { GraphMode, ViewportTransform } from "./graphPixiCanvasUtils";
import type { SimNode, VisibleGraph } from "./types";

export function GraphPixiCanvasView({
  canvasRef,
  hostRef,
  mode,
  graph,
  titleLabel,
  renderFps,
  resetView,
  paused,
  setPaused,
  viewport,
  pixiError,
  governanceSearchQuery,
  governanceSearchResults,
  selectedNodeId,
  selectGovernanceSearchResult,
  showHover,
  hideHoverSoon,
  governanceSearchText,
  setGovernanceSearchText,
  previewNode,
  previewSampleArtifact,
  previewSampleId,
  sourceTitlesBySampleId,
  previewPosition,
  previewSize,
  pinnedPreviewNodeId,
  closePreview,
}: {
  canvasRef: MutableRefObject<HTMLDivElement | null>;
  hostRef: MutableRefObject<HTMLDivElement | null>;
  mode: GraphMode;
  graph: FunctionSlotLibraryGraph;
  titleLabel?: string | null;
  renderFps: number;
  resetView: () => void;
  paused: boolean;
  setPaused: Dispatch<SetStateAction<boolean>>;
  viewport: ViewportTransform;
  pixiError: string | null;
  governanceSearchQuery: string;
  governanceSearchResults: Array<{ node: VisibleGraph["nodes"][number]; name: string; sampleId: string; matched: boolean }>;
  selectedNodeId: string | null;
  selectGovernanceSearchResult: (nodeId: string) => void;
  showHover: (nodeId: string | null) => void;
  hideHoverSoon: (nodeId?: string | null) => void;
  governanceSearchText: string;
  setGovernanceSearchText: Dispatch<SetStateAction<string>>;
  previewNode: SimNode | null;
  previewSampleArtifact: SampleArtifact | null;
  previewSampleId: string | null;
  sourceTitlesBySampleId: Record<string, string>;
  previewPosition: { left: number; top: number } | null;
  previewSize: { width: number; mediaHeight: number; totalHeight: number };
  pinnedPreviewNodeId: string | null;
  closePreview: () => void;
}) {
  return (
    <div ref={canvasRef} className={`slot-graph-canvas pixi ${mode === "planTrace" ? "plan-trace" : mode}`}>
      {titleLabel !== null ? (
        <div className="slot-graph-canvas-title">
          <strong>{titleLabel ?? (mode === "governance" ? "语义治理库" : mode === "planTrace" ? "确定方案溯源" : shortId(graph.artifactId))}</strong>
        </div>
      ) : null}
      <div className="slot-graph-controls">
        <span className="slot-graph-fps-chip">FPS {renderFps}</span>
        <button type="button" onClick={resetView}>重置</button>
        <button type="button" onClick={() => setPaused((value) => !value)}>{paused ? "继续" : "暂停"}</button>
      </div>
      <GraphLegend mode={mode} />
      <div className="slot-graph-zoom-chip">{Math.round(viewport.k * 100)}%</div>
      {pixiError ? <div className="slot-graph-pixi-error">Pixi 图谱初始化失败：{pixiError}</div> : null}
      {mode === "governance" ? (
        <div className="slot-graph-governance-search">
          {governanceSearchQuery ? (
            <div className="slot-graph-governance-search-results" role="listbox" aria-label="治理库搜索结果">
              {governanceSearchResults.length ? governanceSearchResults.map((item) => (
                <button
                  key={item.node.id}
                  type="button"
                  className={item.node.id === selectedNodeId ? "active" : ""}
                  title={item.name}
                  onClick={() => selectGovernanceSearchResult(item.node.id)}
                  onMouseEnter={() => showHover(item.node.id)}
                  onMouseLeave={() => hideHoverSoon(item.node.id)}
                >
                  <strong>{item.name}</strong>
                  <span>{item.sampleId}</span>
                </button>
              )) : (
                <div className="slot-graph-governance-search-empty">无匹配样例</div>
              )}
            </div>
          ) : null}
          <input
            aria-label="搜索治理库"
            placeholder="搜索治理库"
            value={governanceSearchText}
            onChange={(event) => setGovernanceSearchText(event.target.value)}
          />
        </div>
      ) : null}
      <div
        ref={hostRef}
        className="slot-graph-pixi-stage"
        role="img"
        aria-label="FunctionSlotLibrary 结构图谱"
      />
      {previewNode && previewPosition ? (
        <LibraryPreviewPopover
          node={previewNode}
          sampleArtifact={previewSampleArtifact}
          sourceTitle={previewSampleId ? sourceTitlesBySampleId[previewSampleId] ?? null : null}
          position={previewPosition}
          size={previewSize}
          pinned={pinnedPreviewNodeId === previewNode.id}
          onMouseEnter={() => showHover(previewNode.id)}
          onMouseLeave={() => hideHoverSoon(previewNode.id)}
          onClose={closePreview}
        />
      ) : null}
    </div>
  );
}
