import type { FunctionSlotPlanTraceBucket, FunctionSlotPlanTraceRecord } from "../../api/client";
import type { FunctionSlotLibraryGraph } from "../../types/library";
import { shortId } from "../../utils/format";
import { EmptyState } from "./GraphPanels";
import { getTracePlans } from "./planTraceGraphUtils";
import type { GovernanceLayoutMode } from "./types";

export type GraphMode = "structure" | "governance" | "planTrace";

export type LibraryGraphSummary = {
  artifactId: string;
  sampleVideoId?: string | null;
  sourceVideoName?: string | null;
  traceId?: string | null;
  counts?: Record<string, number>;
};

export function StructureGraphReturnBar({ title, onBack }: { title: string; onBack: () => void }) {
  const displayTitle = truncateTitle(title, 10);
  return (
    <button className="slot-graph-return-bar" type="button" aria-label={`回到分析：${title}`} title={title} onClick={onBack}>
      <span className="slot-graph-return-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
          <path d="M15 6 9 12l6 6" />
        </svg>
      </span>
      <span title={title}>{displayTitle}</span>
    </button>
  );
}

export function GraphViewPanel({
  embedded,
  fixedMode,
  mode,
  status,
  governanceLayoutMode,
  onModeChange,
  onLayoutModeChange,
  onRefresh,
}: {
  embedded: boolean;
  fixedMode: boolean;
  mode: GraphMode;
  status: string;
  governanceLayoutMode: GovernanceLayoutMode;
  onModeChange: (mode: GraphMode) => void;
  onLayoutModeChange: (mode: GovernanceLayoutMode) => void;
  onRefresh: () => Promise<void>;
}) {
  return (
    <section className="slot-graph-library-brief" aria-label={embedded ? "库视图设置" : "图谱视图设置"}>
      <div>
        {!embedded && !fixedMode ? <span>图谱模式</span> : null}
        <strong>{graphModeLabel(mode)}</strong>
        <small>{graphModeDescription(mode)}</small>
      </div>
      {!embedded ? (
        <button className="slot-graph-refresh-button" type="button" onClick={() => onRefresh().catch(() => undefined)}>
          刷新
        </button>
      ) : null}
      {!embedded && status ? <p>{status}</p> : null}
      {!fixedMode ? (
        <label className="slot-graph-setting-field">
          <span>图谱模式</span>
          <select className="slot-graph-mode-select" value={mode} onChange={(event) => onModeChange(event.target.value as GraphMode)}>
            <option value="structure">样例结构图</option>
            <option value="governance">语义治理图</option>
            <option value="planTrace">确定方案溯源</option>
          </select>
        </label>
      ) : null}
      <div className="slot-graph-setting-field">
        {embedded ? (
          <div className="slot-graph-layout-options" role="group" aria-label="切换图谱布局">
            <button className={governanceLayoutMode === "force" ? "active" : ""} type="button" onClick={() => onLayoutModeChange("force")}>
              自由散点
            </button>
            <button className={governanceLayoutMode === "columns" ? "active" : ""} type="button" onClick={() => onLayoutModeChange("columns")}>
              列排布
            </button>
          </div>
        ) : (
          <select className="slot-graph-mode-select" value={governanceLayoutMode} onChange={(event) => onLayoutModeChange(event.target.value as GovernanceLayoutMode)}>
            <option value="force">星图散点</option>
            <option value="columns">等距列排版</option>
          </select>
        )}
      </div>
    </section>
  );
}

export function GraphSourcePanel({
  mode,
  graph,
  items,
  selectedArtifactId,
  planTraceBucket,
  planTraceRecords,
  selectedPlanTraceRecordId,
  selectedPlanIds,
  onSelectArtifact,
  onPlanTraceBucketChange,
  onSelectPlanTraceRecord,
  onSelectedPlanIdsChange,
}: {
  mode: GraphMode;
  graph: FunctionSlotLibraryGraph | null;
  items: LibraryGraphSummary[];
  selectedArtifactId: string | null;
  planTraceBucket: FunctionSlotPlanTraceBucket;
  planTraceRecords: FunctionSlotPlanTraceRecord[];
  selectedPlanTraceRecordId: string | null;
  selectedPlanIds: string[];
  onSelectArtifact: (artifactId: string) => void;
  onPlanTraceBucketChange: (bucket: FunctionSlotPlanTraceBucket) => void;
  onSelectPlanTraceRecord: (recordId: string) => void;
  onSelectedPlanIdsChange: (ids: string[]) => void;
}) {
  if (mode === "governance") return null;
  return (
    <section className="slot-graph-source-panel">
      <div className="section-heading">{sourceHeading(mode)}</div>
      {mode === "planTrace" ? (
        <PlanTracePanel
          graph={graph}
          bucket={planTraceBucket}
          records={planTraceRecords}
          selectedRecordId={selectedPlanTraceRecordId}
          selectedPlanIds={selectedPlanIds}
          onBucketChange={onPlanTraceBucketChange}
          onSelectRecord={onSelectPlanTraceRecord}
          onChange={onSelectedPlanIdsChange}
        />
      ) : (
        <div className="compact-list">
          {items.length ? items.map((item) => {
            const sampleShortId = shortId(item.sampleVideoId ?? item.artifactId);
            const sourceVideoName = stripMediaExtension(item.sourceVideoName) || `样例 ${sampleShortId}`;
            return (
              <button key={item.artifactId} type="button" className={`library-item slot-graph-source-item ${selectedArtifactId === item.artifactId ? "active" : ""}`} title={sourceVideoName} onClick={() => onSelectArtifact(item.artifactId)}>
                <strong className="slot-graph-source-title">{sourceVideoName}</strong>
                <small>{item.counts?.slotCount ?? 0} 槽位 / {item.counts?.atomCount ?? 0} 原子变体 / trace {shortId(item.traceId ?? "")}</small>
              </button>
            );
          }) : <EmptyState text="暂无 FunctionSlotLibrary" />}
        </div>
      )}
    </section>
  );
}

export function GraphLoadingState() {
  return <div className="slot-graph-loading-state" aria-busy="true" />;
}

export function GovernanceSummary({
  graph,
  variant = "panel",
  collapsed = false,
  onToggleCollapsed,
}: {
  graph: FunctionSlotLibraryGraph | null;
  variant?: "panel" | "overlay";
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}) {
  const summary = graph?.summary;
  const governanceCounts = countGovernanceNodes(graph);
  return (
    <section className={`slot-graph-card governance-summary ${variant === "overlay" ? "governance-summary-overlay" : ""}`.trim()}>
      {variant === "overlay" ? (
        <button className="governance-summary-toggle" type="button" onClick={onToggleCollapsed} aria-expanded={!collapsed}>
          <span>治理概览</span>
          <i>{collapsed ? "展开" : "收起"}</i>
        </button>
      ) : null}
      {!collapsed ? (
        <div className="governance-summary-grid">
          <div><b>样例数</b><span>{summary?.sampleCount ?? 0}</span></div>
          <div><b>槽位家族</b><span>{governanceCounts.slotFamily}</span></div>
          <div><b>槽位原型</b><span>{governanceCounts.slotArchetype}</span></div>
          <div><b>槽位变体</b><span>{summary?.slotCount ?? 0}</span></div>
          <div><b>原子原型</b><span>{governanceCounts.atomArchetype}</span></div>
          <div><b>原子模式</b><span>{governanceCounts.atomPattern}</span></div>
          <div><b>原子变体</b><span>{summary?.atomCount ?? 0}</span></div>
          <div><b>绑定关系</b><span>{summary?.bindingCount ?? 0}</span></div>
          <div><b>规则策略</b><span>{summary?.ruleCount ?? 0}</span></div>
          <div><b>待治理原子</b><span>{summary?.unmappedAtomCount ?? 0}</span></div>
          <div><b>未归类绑定</b><span>{summary?.unmappedBindingCount ?? 0}</span></div>
          <div><b>未归类规则</b><span>{summary?.unmappedRuleCount ?? 0}</span></div>
          <div><b>未治理样例</b><span>{(summary?.ungovernedSampleCount ?? 0) > 0 ? "有" : "无"}</span></div>
        </div>
      ) : null}
    </section>
  );
}

function PlanTracePanel({
  graph,
  bucket,
  records,
  selectedRecordId,
  selectedPlanIds,
  onBucketChange,
  onSelectRecord,
  onChange,
}: {
  graph: FunctionSlotLibraryGraph | null;
  bucket: FunctionSlotPlanTraceBucket;
  records: FunctionSlotPlanTraceRecord[];
  selectedRecordId: string | null;
  selectedPlanIds: string[];
  onBucketChange: (bucket: FunctionSlotPlanTraceBucket) => void;
  onSelectRecord: (recordId: string) => void;
  onChange: (ids: string[]) => void;
}) {
  const plans = getTracePlans(graph);
  const toggle = (planId: string) => {
    onChange(selectedPlanIds.includes(planId) ? selectedPlanIds.filter((id) => id !== planId) : [...selectedPlanIds, planId]);
  };
  return (
    <section className="slot-graph-card slot-graph-plan-scope">
      <div className="slot-graph-layout-options" role="group" aria-label="切换方案溯源记录分组">
        <button className={bucket === "recent" ? "active" : ""} type="button" onClick={() => onBucketChange("recent")}>
          最近
        </button>
        <button className={bucket === "history" ? "active" : ""} type="button" onClick={() => onBucketChange("history")}>
          历史
        </button>
      </div>
      <div className="compact-list">
        {records.length ? records.map((record) => (
          <button key={record.recordId} type="button" className={`library-item slot-graph-source-item ${selectedRecordId === record.recordId ? "active" : ""}`} title={record.title} onClick={() => onSelectRecord(record.recordId)}>
            <strong className="slot-graph-source-title">{record.title}</strong>
            <small>{record.mode === "multiVersion" ? `${record.variants.length} 个版本` : "单版本"} / {formatRecordTime(record.updatedAt)}</small>
          </button>
        )) : <EmptyState text={bucket === "recent" ? "最近暂无方案" : "暂无历史方案"} />}
      </div>
      <div className="detail-hint">已选 {selectedPlanIds.length} / {graph?.summary.planCount ?? 0} 个方案，{graph?.nodes.length ?? 0} 个节点</div>
      {plans.length ? plans.map((plan) => (
        <label key={plan.planId} className="plan-overlay-option">
          <input type="checkbox" checked={selectedPlanIds.includes(plan.planId)} onChange={() => toggle(plan.planId)} />
          <i style={{ background: plan.color }} />
          <span title={plan.displayJsonPath ?? plan.planId}>{plan.planId}</span>
        </label>
      )) : <EmptyState text="暂无确认方案溯源" />}
    </section>
  );
}

function truncateTitle(title: string, maxChars: number) {
  const chars = Array.from(title.trim());
  return chars.length > maxChars ? `${chars.slice(0, maxChars).join("")}...` : title;
}

function graphModeLabel(mode: GraphMode) {
  if (mode === "governance") return "语义治理库";
  if (mode === "planTrace") return "方案溯源图";
  return "样例结构图";
}

function graphModeDescription(mode: GraphMode) {
  if (mode === "governance") return "查看槽位家族、原型和模式治理关系";
  if (mode === "planTrace") return "查看确定方案回溯到库结构的证据链";
  return "查看单个样例沉淀出的槽位、原子和绑定";
}

function sourceHeading(mode: GraphMode) {
  if (mode === "governance") return "治理概览";
  if (mode === "planTrace") return "方案范围";
  return "样例来源";
}

export function stripMediaExtension(value?: string | null) {
  const text = value?.trim();
  if (!text) return "";
  return text.replace(/\.(mp4|mov|m4v|webm|mkv|avi|wmv|flv|mpeg|mpg)$/i, "");
}

function countGovernanceNodes(graph: FunctionSlotLibraryGraph | null) {
  const counts = {
    slotFamily: 0,
    slotArchetype: 0,
    atomArchetype: 0,
    atomPattern: 0,
  };
  for (const node of graph?.nodes ?? []) {
    if (node.type === "slotFamily") counts.slotFamily += 1;
    if (node.type === "slotArchetype") counts.slotArchetype += 1;
    if (node.type === "atomArchetype") counts.atomArchetype += 1;
    if (node.type === "atomPattern") counts.atomPattern += 1;
  }
  return counts;
}

function formatRecordTime(value: string | null | undefined) {
  if (!value) return "未记录时间";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
