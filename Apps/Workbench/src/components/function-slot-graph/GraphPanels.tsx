import type { FunctionSlotGraphNode, FunctionSlotLibraryGraph } from "../../types/library";
import { shortId } from "../../utils/format";
import { formatDetailValue, nodeDetailRows } from "./graphUtils";
import type { GraphFiltersState } from "./types";

export function GraphFilters({ mode, filters, onChange }: { mode: "structure" | "governance"; filters: GraphFiltersState; onChange: (filters: GraphFiltersState) => void }) {
  const update = (key: keyof GraphFiltersState) => onChange({ ...filters, [key]: !filters[key] });
  if (mode === "governance") {
    return (
      <section className="slot-graph-card">
        <div className="section-heading">治理筛选</div>
        <label><input type="checkbox" checked={filters.slot} onChange={() => update("slot")} /> Slot Governance</label>
        <label><input type="checkbox" checked={filters.atom} onChange={() => update("atom")} /> Atom Governance</label>
        <label><input type="checkbox" checked={filters.binding} onChange={() => update("binding")} /> Binding Governance</label>
        <label><input type="checkbox" checked={filters.rule} onChange={() => update("rule")} /> Rule / Policy</label>
        <label><input type="checkbox" checked={filters.bundle} onChange={() => update("bundle")} /> Bundles</label>
        <label><input type="checkbox" checked={filters.unmapped} onChange={() => update("unmapped")} /> Unmapped</label>
        <label><input type="checkbox" checked={filters.needReview} onChange={() => update("needReview")} /> Need Review</label>
        <div className="slot-filter-divider" />
        <label><input type="checkbox" checked={filters.candidate} onChange={() => update("candidate")} /> candidate</label>
        <label><input type="checkbox" checked={filters.reviewed} onChange={() => update("reviewed")} /> reviewed</label>
        <label><input type="checkbox" checked={filters.stable} onChange={() => update("stable")} /> stable</label>
      </section>
    );
  }
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
