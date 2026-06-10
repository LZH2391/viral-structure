import type { FunctionSlotGraphNode } from "../../types/library";

export function isGovernanceNode(node: FunctionSlotGraphNode) {
  return [
    "governanceRoot",
    "slotFamily",
    "slotArchetype",
    "slotSubtype",
    "atomArchetype",
    "atomPattern",
    "bindingPattern",
    "bindingPrinciple",
    "rulePattern",
    "recompositionPolicy",
    "implementationBundle",
    "sourceVariant",
    "sourceSample",
  ].includes(node.type);
}

export function supportValue(support: unknown, key: "variantCount" | "sampleCount") {
  return support && typeof support === "object" ? (support as Record<string, unknown>)[key] : null;
}

export function shortLabel(node: FunctionSlotGraphNode) {
  if (node.type === "governanceRoot") return "治理库";
  if (node.type === "sourceExample") return String(node.label ?? node.id).slice(0, 18);
  if (node.type === "sourceVariant") return sourceVariantLabel(node);
  if (node.type === "sourceSample") return "样例";
  if (node.type === "unmappedVariant") return `unmapped ${node.data.variantKind ?? ""}`.trim();
  if (node.type === "confirmedPlan") return String(node.label ?? "Plan").slice(0, 18);
  if (node.type.startsWith("traced")) return String(node.label ?? node.id).slice(0, 18);
  if (isGovernanceNode(node)) return graphNodeDisplayLabel(node).slice(0, 20);
  if (node.type === "libraryItem") return "样例";
  if (node.type === "slotInstance") return String(node.label ?? node.data.slotId ?? "").slice(0, 20);
  if (node.type === "atomInstance") return String(node.label ?? node.data.atomId ?? "").slice(0, 24);
  if (node.type === "binding") return bindingTypeDisplayLabel(node);
  if (node.type === "slotConcept") return "SlotConcept";
  return node.label;
}

export function graphNodeDisplayLabel(node: FunctionSlotGraphNode) {
  if (node.type === "sourceSample" || node.type === "libraryItem") return "样例";
  const fallback = node.id;
  if (node.type === "binding") return bindingTypeDisplayLabel(node);
  const label = String(node.label ?? fallback);
  if (!isGovernanceNode(node)) return label;
  return cleanGovernanceDisplayLabel(label);
}

export function bindingTypeDisplayLabel(node: FunctionSlotGraphNode) {
  const type = String(node.data.bindingType ?? node.data.type ?? node.label ?? "").trim();
  const label = BINDING_TYPE_LABELS[type] ?? type;
  return label || "绑定关系";
}

const BINDING_TYPE_LABELS: Record<string, string> = {
  sync: "同步",
  support: "支撑",
  require: "依赖",
  substitute: "替换",
  conflict: "冲突",
  carryover: "承接",
};

function cleanGovernanceDisplayLabel(label: string) {
  const cleaned = label
    .replace(/\s+archetyp(?:e)?\s*$/i, "")
    .replace(/\s+archety\s*$/i, "")
    .replace(/\s+archet\s*$/i, "")
    .replace(/\s+(?:candidate\s+)?pattern\s*$/i, "")
    .replace(/\s+candidate\s*$/i, "")
    .trim();
  return cleaned || label;
}

function sourceVariantLabel(node: FunctionSlotGraphNode) {
  const label = typeof node.data.label === "string" && node.data.label.trim() ? node.data.label.trim() : String(node.label ?? node.id);
  return label.length > 18 ? `${label.slice(0, 18)}...` : label;
}

function shortSourceVariant(value: string) {
  const parts = value.split("::");
  return parts.length >= 2 ? parts.slice(-2).join("::") : value.slice(-18);
}
