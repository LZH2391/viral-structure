import type { FunctionSlotGraphNode, FunctionSlotLibraryGraph } from "../../types/library";
import { bindingTypeDisplayLabel, graphNodeDisplayLabel, isGovernanceNode, supportValue } from "./graphLabels";

export function nodeDetailRows(node: FunctionSlotGraphNode, graph?: FunctionSlotLibraryGraph | null): Array<[string, unknown]> {
  const data = node.data ?? {};
  if (node.type === "libraryItem") return sampleCountRows(graph?.summary);
  if (node.type === "sourceSample") return sampleCountRows(data.counts);
  if (node.type === "unmappedVariant") return filterDetailRows([["variantKind", data.variantKind], ["reason", data.reason], ["suggestedAction", data.suggestedAction], ["why not pattern", data.reason]]);
  if (node.type === "sourceExample") return filterDetailRows([["planId", data.planId], ["sampleId", data.sampleId], ["sourceAlias", data.sourceAlias]]);
  if (node.type === "sourceVariant") return filterDetailRows([["label", data.label], ["sampleId", data.sampleId], ["kind", data.kind], ["sourceId", data.sourceId], ["labelMissing", data.labelMissing]]);
  if (isGovernanceNode(node)) return filterDetailRows([["id", data.id ?? data.governanceId], ["name", graphNodeDisplayLabel(node)], ["variantCount", supportValue(data.support, "variantCount")], ["sampleCount", supportValue(data.support, "sampleCount")], ["sourceVariantIds", data.sourceVariantIds], ["judgementReason", data.judgementReason], ["differenceNotes", data.differenceNotes], ["riskIfMisclassified", data.riskIfMisclassified]]);
  if (node.type === "confirmedPlan") return filterDetailRows([["planId", data.planId], ["confirmationId", data.confirmationId], ["sourceTurnId", data.sourceTurnId], ["sourceRestructurePath", data.sourceRestructurePath], ["displayJsonPath", data.displayJsonPath], ["evidence", data.evidence]]);
  if (node.type.startsWith("traced")) return filterDetailRows([["planId", data.planId], ["evidence", data.evidence]]);
  if (node.type === "slotInstance") return filterDetailRows([["stableId", data.stableId], ["slotType", data.slotType], ["before", data.viewerStateBefore], ["after", data.viewerStateAfter], ["task", data.persuasionTask]]);
  if (node.type === "atomInstance") return filterDetailRows([["atomId", data.atomId], ["atomType", data.atomType], ["slotId", data.slotId], ["function", data.function], ["claim/pace/proof", data.claimType ?? data.pace ?? data.proofType]]);
  if (node.type === "binding") return filterDetailRows([["bindingId", data.bindingId], ["type", bindingTypeDisplayLabel(node)], ["rule", data.rule], ["risk", data.riskIfBroken], ["confidence", data.confidence]]);
  return filterDetailRows(Object.entries(data));
}

function filterDetailRows(rows: Array<[string, unknown]>) {
  const hiddenLabels = new Set([
    "artifact",
    "variantId",
    "stableId",
    "slotType",
    "shots",
    "sourceVariantIds",
    "variantCount",
    "sampleVideoId",
    "sampleId",
    "sourceAlias",
    "sampleCount",
    "differenceNotes",
    "riskIfMisclassified",
  ]);
  return rows.filter(([label]) => !hiddenLabels.has(label));
}

function sampleCountRows(counts: unknown) {
  const record = counts && typeof counts === "object" ? counts as Record<string, unknown> : {};
  return filterDetailRows([
    ["slots", record.slotCount],
    ["atoms", record.atomCount],
  ]);
}

export function detailFieldDisplayLabel(label: string) {
  return DETAIL_FIELD_LABELS[label] ?? label;
}

const DETAIL_FIELD_LABELS: Record<string, string> = {
  slots: "槽位",
  atoms: "原子变体",
  id: "ID",
  name: "名称",
  label: "名称",
  kind: "类型",
  sourceId: "来源ID",
  labelMissing: "名称缺失",
  variantKind: "待治理类型",
  reason: "原因",
  suggestedAction: "建议动作",
  "why not pattern": "未归类原因",
  judgementReason: "判断原因",
  planId: "方案ID",
  confirmationId: "确认ID",
  sourceTurnId: "来源轮次",
  sourceRestructurePath: "重组文件",
  displayJsonPath: "展示JSON",
  evidence: "证据",
  before: "前置状态",
  after: "后置状态",
  task: "功能任务",
  atomId: "原子ID",
  atomType: "原子类型",
  slotId: "槽位ID",
  function: "功能",
  "claim/pace/proof": "诉求/节奏/证明",
  bindingId: "绑定ID",
  type: "类型",
  rule: "规则",
  risk: "风险",
  confidence: "置信度",
};

export function formatDetailValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "无";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}
