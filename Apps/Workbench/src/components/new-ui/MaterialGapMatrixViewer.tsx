import { useMemo, useState } from "react";
import { IconChevronDown } from "@tabler/icons-react";
import type { AgentChatMaterialGapMatrix, AgentChatMaterialGapRow } from "../../types";

type MaterialGapMatrixViewerProps = {
  matrix: AgentChatMaterialGapMatrix;
};

export function MaterialGapMatrixViewer({ matrix }: MaterialGapMatrixViewerProps) {
  const [expanded, setExpanded] = useState(false);
  const rows = matrix.rows ?? [];
  const summary = matrix.summary ?? {};
  const issueCount = (summary.missingCount ?? 0) + (summary.partialCount ?? 0) + (summary.unsafeCount ?? 0);
  const warning = (summary.unsafeCount ?? 0) > 0 || (summary.missingCount ?? 0) >= 3;
  const statusLabel = formatStatus(matrix.status);
  const topMissing = useMemo(() => (summary.topMissingMaterialTypes ?? []).slice(0, 3).map(formatMaterialType).join(" / "), [summary.topMissingMaterialTypes]);

  if (matrix.status && matrix.status !== "processed") {
    return (
      <section className="new-ui-material-gap-result is-error" aria-label="素材缺口矩阵">
        <p>{matrix.message || "素材缺口矩阵生成失败"}</p>
      </section>
    );
  }

  return (
    <section className={`new-ui-material-gap-result ${warning ? "is-warning" : ""}`.trim()} aria-label="素材缺口矩阵">
      <button
        className="new-ui-material-gap-header"
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        <div>
          <span>素材缺口矩阵</span>
          <strong>{summary.slotCount ?? rows.length} 槽位 / {issueCount} 需关注</strong>
        </div>
        <small>{statusLabel}{topMissing ? ` · ${topMissing}` : ""}</small>
        <IconChevronDown aria-hidden="true" />
      </button>
      {expanded ? (
        <div className="new-ui-material-gap-table-wrap">
          <table className="new-ui-material-gap-table">
            <thead>
              <tr>
                <th>槽位</th>
                <th>满足度</th>
                <th>缺口</th>
                <th>影响</th>
                <th>交给 ShotDesign</th>
              </tr>
            </thead>
            <tbody>
              {rows.length ? rows.map((row, index) => (
                <MaterialGapRowItem key={`${row.slotId ?? row.slotSubtype ?? "slot"}_${index}`} row={row} />
              )) : (
                <tr>
                  <td colSpan={5}>暂无槽位缺口判断</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

function MaterialGapRowItem({ row }: { row: AgentChatMaterialGapRow }) {
  const direct = row.directSatisfaction ?? "missing";
  return (
    <tr>
      <td>
        <strong>{row.slotSubtype || row.slotId || "未命名槽位"}</strong>
        {row.slotFunction ? <small>{row.slotFunction}</small> : null}
      </td>
      <td><span className={`new-ui-material-gap-status is-${direct}`}>{formatSatisfaction(direct)}</span></td>
      <td>{formatList(row.missingMaterialTypes, formatMaterialType) || formatList(row.requiredMaterialTypes, formatMaterialType) || "无明显缺口"}</td>
      <td>{row.impact || "暂无影响说明"}</td>
      <td>{row.handoffToShotDesign || "按槽位功能选择素材或补全策略"}</td>
    </tr>
  );
}

function formatList(values?: string[] | null, formatter: (value: string) => string = (value) => value) {
  return (values ?? []).filter(Boolean).map(formatter).join(" / ");
}

function formatStatus(value?: string | null) {
  if (value === "processed") return "已生成";
  if (value === "failed") return "生成失败";
  return value || "未知";
}

function formatSatisfaction(value: string) {
  if (value === "satisfied") return "满足";
  if (value === "partial") return "部分";
  if (value === "missing") return "缺失";
  if (value === "unsafe") return "风险";
  if (value === "not_required") return "不需要";
  return value;
}

function formatMaterialType(value: string) {
  const labels: Record<string, string> = {
    opening_hook_shot: "开头吸引",
    product_closeup_shot: "商品特写",
    usage_process_shot: "使用过程",
    comparison_shot: "对比镜头",
    ending_cta_shot: "结尾 CTA",
  };
  return labels[value] ?? value;
}
