import { useEffect, useRef, useState } from "react";
import type { FunctionSlotGraphNode, FunctionSlotLibraryGraph } from "../../types/library";
import { shortId } from "../../utils/format";
import { formatDetailValue, graphNodeDisplayLabel, nodeDetailRows } from "./graphUtils";
import type { GovernanceFilterPresetMode, GraphFiltersState } from "./types";

const GOVERNANCE_PRESET_OPTIONS: Array<{ value: GovernanceFilterPresetMode; label: string }> = [
  { value: "light", label: "轻量模式" },
  { value: "default", label: "默认模式" },
  { value: "full", label: "全量模式" },
  { value: "custom", label: "自定义模式" },
];

export function GraphFilters({
  mode,
  filters,
  governancePresetMode,
  onGovernancePresetModeChange,
  onChange,
}: {
  mode: "structure" | "governance" | "planTrace";
  filters: GraphFiltersState;
  governancePresetMode?: GovernanceFilterPresetMode;
  onGovernancePresetModeChange?: (mode: GovernanceFilterPresetMode) => void;
  onChange: (filters: GraphFiltersState) => void;
}) {
  const update = (key: keyof GraphFiltersState) => onChange({ ...filters, [key]: !filters[key] });
  const options = filterOptions(mode);
  return (
    <section className="slot-graph-card">
      <div className="slot-graph-filter-head">
        <div className="section-heading">{mode === "governance" ? "治理层显示" : mode === "planTrace" ? "溯源层显示" : "结构层显示"}</div>
        {mode === "governance" && governancePresetMode && onGovernancePresetModeChange ? (
          <GovernancePresetSelect value={governancePresetMode} onChange={onGovernancePresetModeChange} />
        ) : null}
      </div>
      <div className={`slot-graph-filter-grid ${mode === "governance" ? "governance" : ""}`.trim()}>
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

function GovernancePresetSelect({ value, onChange }: { value: GovernanceFilterPresetMode; onChange: (mode: GovernanceFilterPresetMode) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return undefined;
    const closeOnPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className="slot-graph-filter-preset" ref={rootRef}>
      <button className="slot-graph-preset-trigger" type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        <span>{governancePresetLabel(value)}</span>
        <i aria-hidden="true" />
      </button>
      {open ? (
        <div className="slot-graph-preset-menu" role="listbox" aria-label="治理层显示模式">
          {GOVERNANCE_PRESET_OPTIONS.map((option) => (
            <button
              key={option.value}
              className={option.value === value ? "active" : ""}
              type="button"
              role="option"
              aria-selected={option.value === value}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function governancePresetLabel(value: GovernanceFilterPresetMode) {
  return GOVERNANCE_PRESET_OPTIONS.find((option) => option.value === value)?.label ?? "默认模式";
}

export function NodeInspector({ node, graph }: { node: FunctionSlotGraphNode | null; graph: FunctionSlotLibraryGraph | null }) {
  if (!node) {
    return (
      <section className="new-ui-analysis-workflow-detail slot-graph-inspector" aria-label="图谱节点详情区域" data-node-type="empty">
        <div className="new-ui-analysis-workflow-detail-header">
          <h2 className="new-ui-analysis-workflow-detail-title">详细信息</h2>
          <span className="new-ui-analysis-workflow-detail-status">待选择</span>
        </div>
        <div className="new-ui-analysis-workflow-detail-content">
          <div className="new-ui-analysis-workflow-detail-empty">选择节点查看关键字段。</div>
        </div>
      </section>
    );
  }
  const rows = nodeDetailRows(node);
  const primaryRows = rows.slice(0, 6);
  const secondaryRows = rows.slice(6);
  return (
    <section className="new-ui-analysis-workflow-detail slot-graph-inspector" aria-label={`${graphNodeDisplayLabel(node)}详情区域`} data-node-type={node.type}>
      <div className="new-ui-analysis-workflow-detail-header">
        <h2 className="new-ui-analysis-workflow-detail-title">详细信息</h2>
        <span className="new-ui-analysis-workflow-detail-status">{nodeTypeLabel(node.type)}</span>
      </div>
      <div className="new-ui-analysis-workflow-detail-content">
        <div className="new-ui-analysis-workflow-detail-summary">
          <strong title={graphNodeDisplayLabel(node)}>{graphNodeDisplayLabel(node)}</strong>
          <p>{nodeSummary(node)}</p>
        </div>
        <div className="new-ui-analysis-workflow-detail-metrics" aria-label={`${graphNodeDisplayLabel(node)}基础字段`}>
          <DetailMetric label="节点类型" value={node.type} />
          <DetailMetric label="所属分组" value={node.group} />
          {graph ? <DetailMetric label="artifact" value={shortId(graph.artifactId)} /> : null}
        </div>
        {primaryRows.length ? (
          <div className="new-ui-analysis-workflow-detail-list" aria-label="关键字段">
            {primaryRows.map(([label, value]) => <DetailCard key={label} label={label} value={value} />)}
          </div>
        ) : null}
        {secondaryRows.length ? (
          <details className="slot-graph-inspector-more">
            <summary>更多字段</summary>
            <div className="new-ui-analysis-workflow-detail-list">
              {secondaryRows.map(([label, value]) => <DetailCard key={label} label={label} value={value} />)}
            </div>
          </details>
        ) : null}
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

function DetailMetric({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="new-ui-analysis-workflow-detail-metric">
      <span>{label}</span>
      <strong>{formatDetailValue(value)}</strong>
    </div>
  );
}

function DetailCard({ label, value }: { label: string; value: unknown }) {
  return (
    <article className="new-ui-analysis-workflow-detail-card">
      <strong>{label}</strong>
      <p>{formatDetailValue(value)}</p>
    </article>
  );
}

function nodeSummary(node: FunctionSlotGraphNode) {
  if (node.type === "libraryItem" || node.type === "sourceSample") return "样例来源节点，承载当前图谱的上游样例与追踪信息。";
  if (node.type === "slotInstance") return "槽位实例，描述该样例中的功能任务、前后状态与来源镜头。";
  if (node.type === "atomInstance") return "原子实例，描述槽位下可复用的脚本、节奏或包装结构。";
  if (node.type === "binding") return "绑定关系，说明槽位和原子之间的组合约束与断裂风险。";
  if (node.type === "confirmedPlan") return "确定方案节点，用于回溯方案产物与库结构证据链。";
  if (node.type.startsWith("traced")) return "溯源证据节点，用于标记方案片段对应的库内证据。";
  return "图谱节点，展示当前选中结构单元的关键字段和来源信息。";
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
