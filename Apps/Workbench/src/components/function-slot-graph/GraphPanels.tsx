import type { FunctionSlotGraphNode, FunctionSlotLibraryGraph } from "../../types/library";
import { shortId } from "../../utils/format";
import { formatDetailValue, nodeDetailRows } from "./graphUtils";
import type { GraphFiltersState } from "./types";

export function GraphFilters({ filters, onChange }: { filters: GraphFiltersState; onChange: (filters: GraphFiltersState) => void }) {
  const update = (key: keyof GraphFiltersState) => onChange({ ...filters, [key]: !filters[key] });
  return (
    <section className="slot-graph-card">
      <div className="section-heading">筛选</div>
      <label><input type="checkbox" checked={filters.slot} onChange={() => update("slot")} /> SlotInstance</label>
      <label><input type="checkbox" checked={filters.atom} onChange={() => update("atom")} /> AtomInstance</label>
      <label><input type="checkbox" checked={filters.binding} onChange={() => update("binding")} /> Binding</label>
    </section>
  );
}

export function NodeInspector({ node, graph }: { node: FunctionSlotGraphNode | null; graph: FunctionSlotLibraryGraph | null }) {
  if (!node) return <section className="slot-graph-card"><EmptyState text="选择节点查看详情" /></section>;
  const rows = nodeDetailRows(node);
  return (
    <section className="slot-graph-card slot-graph-inspector">
      <div className="section-heading">当前选中</div>
      <strong>{node.label}</strong>
      <span>{node.type} / {node.group}</span>
      {graph ? <small>artifact {shortId(graph.artifactId)}</small> : null}
      <div className="slot-graph-detail-rows">
        {rows.map(([label, value]) => <DetailRow key={label} label={label} value={value} />)}
      </div>
    </section>
  );
}

export function EmptyState({ text }: { text: string }) {
  return (
    <div className="empty-state">
      <strong>{text}</strong>
      <span>先导出 FunctionSlotLibrary 后刷新</span>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <b>{label}</b>
      <span>{formatDetailValue(value)}</span>
    </div>
  );
}
