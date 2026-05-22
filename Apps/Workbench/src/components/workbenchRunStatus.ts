import type { WorkbenchState } from "../types";

export function buildRunStatus(state: WorkbenchState) {
  const latest = state.logs[0];
  if (!latest) return { label: "等待输入", stageId: null, backendTraceId: state.processingJob?.traceId ?? null };
  const labelMap = { info: "运行中", done: "阶段完成", fail: "阶段失败" };
  return { label: labelMap[latest.level] ?? "等待输入", stageId: latest.fields.stageId, backendTraceId: latest.fields.backendTraceId ?? state.processingJob?.traceId ?? null };
}

export function normalizeAnalysisFps(value: number, minAnalysisFps: number, maxAnalysisFps: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return minAnalysisFps;
  return Math.max(minAnalysisFps, Math.min(maxAnalysisFps, Math.round(numeric)));
}
