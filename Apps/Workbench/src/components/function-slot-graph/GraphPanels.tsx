import type { FunctionSlotGraphNode, FunctionSlotLibraryGraph } from "../../types/library";
import { shortId } from "../../utils/format";
import { formatDetailValue, graphNodeDisplayLabel, nodeDetailRows } from "./graphUtils";
import type { GraphFiltersState } from "./types";

export function GraphFilters({ mode, filters, onChange }: { mode: "structure" | "governance" | "planTrace"; filters: GraphFiltersState; onChange: (filters: GraphFiltersState) => void }) {
  const update = (key: keyof GraphFiltersState) => onChange({ ...filters, [key]: !filters[key] });
  const options = filterOptions(mode);
  return (
    <section className="slot-graph-card">
      <div className="section-heading">{mode === "governance" ? "治理层显示" : mode === "planTrace" ? "溯源层显示" : "结构层显示"}</div>
      <div className="slot-graph-filter-grid">
        {options.map((option) => (
          <label key={option.key} className={filters[option.key] ? "active" : ""}>
            <input type="checkbox" checked={filters[option.key]} onChange={() => update(option.key)} />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </section>
  );
}

export function NodeInspector({ node, graph }: { node: FunctionSlotGraphNode | null; graph: FunctionSlotLibraryGraph | null }) {
  if (!node) return <section className="slot-graph-card"><EmptyState text="选择节点查看详情" /></section>;
  const rows = nodeDetailRows(node);
  const primaryRows = rows.slice(0, 6);
  const secondaryRows = rows.slice(6);
  return (
    <section className="slot-graph-card slot-graph-inspector">
      <div className="slot-graph-inspector-head">
        <span>当前节点</span>
        <strong title={graphNodeDisplayLabel(node)}>{graphNodeDisplayLabel(node)}</strong>
        <div>
          <small>{nodeTypeLabel(node.type)}</small>
          <small>{node.group}</small>
        </div>
      </div>
      <div className="slot-graph-inspector-summary">
        <DetailRow label="节点类型" value={node.type} />
        <DetailRow label="所属分组" value={node.group} />
        {graph ? <DetailRow label="artifact" value={shortId(graph.artifactId)} /> : null}
      </div>
      {primaryRows.length ? (
        <div className="slot-graph-inspector-section">
          <div className="section-heading">关键字段</div>
          <div className="slot-graph-detail-rows">
            {primaryRows.map(([label, value]) => <DetailRow key={label} label={label} value={value} />)}
          </div>
        </div>
      ) : null}
      {secondaryRows.length ? (
        <details className="slot-graph-inspector-more">
          <summary>更多字段</summary>
          <div className="slot-graph-detail-rows">
            {secondaryRows.map(([label, value]) => <DetailRow key={label} label={label} value={value} />)}
          </div>
        </details>
      ) : null}
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

function filterOptions(mode: "structure" | "governance" | "planTrace"): Array<{ key: keyof GraphFiltersState; label: string }> {
  if (mode === "planTrace") {
    return [
      { key: "slotSubtype", label: "槽位子型" },
      { key: "sourceVariant", label: "来源原子" },
    ];
  }
  if (mode === "governance") {
    return [
      { key: "slotFamily", label: "槽位家族" },
      { key: "slotArchetype", label: "槽位原型" },
      { key: "slotSubtype", label: "槽位子型" },
      { key: "atomArchetype", label: "原子原型" },
      { key: "atomPattern", label: "原子模式" },
      { key: "sourceVariant", label: "来源变体" },
      { key: "binding", label: "绑定治理" },
      { key: "rule", label: "规则策略" },
      { key: "bundle", label: "组合包" },
      { key: "unmapped", label: "待治理项" },
    ];
  }
  return [
    { key: "slot", label: "槽位实例" },
    { key: "atom", label: "原子实例" },
    { key: "binding", label: "绑定关系" },
  ];
}

function nodeTypeLabel(type: string) {
  const normalized = type.toLowerCase();
  if (type === "libraryItem" || type === "sourceSample") return "样例";
  if (normalized.includes("slot")) return "槽位";
  if (normalized.includes("atom")) return "原子";
  if (normalized.includes("binding")) return "绑定";
  if (normalized.includes("rule") || normalized.includes("policy")) return "规则";
  if (normalized.includes("plan")) return "方案";
  return "节点";
}
