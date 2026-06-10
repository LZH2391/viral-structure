import type { SampleArtifact } from "../../types";
import { formatSecondsCompact } from "../../utils/format";
import type { AnalysisTimelineSegmentDetail } from "./analysisTimelineSelection";
import type { WorkflowDetail, WorkflowDetailCard, WorkflowDetailMetric, WorkflowStageStatus } from "./analysisWorkflowModel";

export function resolveUserMaterialTaggerDetail(base: Pick<WorkflowDetail, "title" | "status">, artifact: SampleArtifact): WorkflowDetail {
  const materialPack = artifact.userMaterialPack;
  const shotCards = materialPack?.shotCards ?? [];
  const proofCount = materialPack?.proofCoverage?.filter((proof) => proof.candidateShots.length || proof.candidateGroups.length).length ?? 0;
  return {
    ...base,
    summary: shotCards.length ? "已经把用户素材拆成可供重组和分镜消费的素材能力包。" : "素材识别完成后会展示镜头分类、证明能力和可用限制。",
    metrics: compactMetrics([
      metric("素材镜头", `${formatCount(shotCards.length)} 个`),
      metric("证明镜头", `${formatCount(proofCount)} 个`),
      metric("能力标签", `${formatCount(uniqueCount(shotCards.flatMap((shot) => shot.materialTags ?? [])))} 个`),
    ]),
    cards: shotCards.map((shot, index) => materialShotDetailCard(shot, index)),
    emptyText: failedText(materialPack?.status, "本步未生成有效素材包，可重试素材识别。", "素材识别完成后会展示素材能力包。"),
    nextText: shotCards.length ? "这部分可直接供结构重组和 shot design 判断素材供给。" : "",
  };
}

export function resolveMaterialAggregateDetail(base: Pick<WorkflowDetail, "title" | "status">, artifact: SampleArtifact): WorkflowDetail {
  const shots = artifact.shotBoundaryAnalysis?.shots ?? [];
  const materialPack = artifact.userMaterialPack;
  const shotCards = materialPack?.shotCards ?? [];
  const materialGroups = materialPack?.materialGroups ?? [];
  const proofCoverage = materialPack?.proofCoverage ?? [];
  const coveredProofCount = proofCoverage.filter((proof) => proof.candidateShots.length || proof.candidateGroups.length).length;
  return {
    ...base,
    summary: shotCards.length ? "素材识别结果已经准备好，可以作为重组和分镜设计的素材供给输入。" : "素材识别完成后会汇总素材镜头、分组和证明覆盖。",
    metrics: compactMetrics([
      metric("切分镜头", `${formatCount(shots.length)} 个`),
      metric("素材卡", `${formatCount(shotCards.length)} 张`),
      metric("素材组", `${formatCount(materialGroups.length)} 组`),
    ]),
    cards: compactCards([
      card("素材能力", "镜头分类 / 功能标签", shotCards.length ? "已生成每个镜头的素材类别、表达功能和使用限制。" : "等待素材识别生成镜头能力卡。"),
      card("证明覆盖", `${formatCount(coveredProofCount)} 类`, coveredProofCount ? "已标出可承担信任、效果或机制证明的候选镜头/素材组。" : "暂未识别到明确证明覆盖。"),
      card("可继续", "重组 / 分镜", shotCards.length ? "后续可以在重组输入中附带该素材包，判断新方案的素材供给。" : "素材包生成后可进入重组输入。"),
    ]),
    emptyText: "完成素材识别后会展示素材能力包总览。",
    nextText: "建议检查素材卡和证明覆盖是否符合目标品类，再进入重组或 Shot 设计。",
  };
}

function metric(label: string, value: string): WorkflowDetailMetric {
  return { label, value };
}

function card(title: string | null | undefined, meta: string | null | undefined, body: string | null | undefined, timelineTarget: AnalysisTimelineSegmentDetail | null = null): WorkflowDetailCard {
  const result: WorkflowDetailCard = {
    title: detailText(title || "未命名"),
    meta: meta == null ? "结果摘要" : detailText(meta),
    body: detailText(body || "暂无摘要。"),
  };
  if (timelineTarget) result.timelineTarget = timelineTarget;
  return result;
}

function materialShotDetailCard(shot: NonNullable<SampleArtifact["userMaterialPack"]>["shotCards"][number], index: number): WorkflowDetailCard {
  const title = shot.shotNo ?? `素材镜头 ${String(index + 1).padStart(3, "0")}`;
  const start = numericTime(shot.timeRange?.start);
  const end = numericTime(shot.timeRange?.end);
  const summary = shot.visualSummary || shot.spokenOrSubtitleSummary || "这个素材镜头还没有摘要。";
  return card(
    title,
    formatMaterialShotTimeRange(shot.timeRange),
    summary,
    {
      id: `shot:${shot.shotRef ?? shot.shotNo ?? index}`,
      tone: "shot",
      title,
      timeLabel: formatMaterialShotTimeRange(shot.timeRange),
      start,
      end,
      shotRangeLabel: title,
      summary: detailText(summary),
      fields: compactTimelineFields([
        { label: "镜头类型", value: materialClassLabel(shot.shotClass) },
        { label: "表达功能", value: (shot.shotFunctions ?? []).map(materialFunctionLabel).join(" / ") },
        { label: "素材标签", value: (shot.materialTags ?? []).join(" / ") },
        { label: "口播/字幕", value: shot.spokenOrSubtitleSummary },
      ]),
    },
  );
}

function compactMetrics(items: Array<WorkflowDetailMetric | null | undefined>) {
  return items.filter((item): item is WorkflowDetailMetric => Boolean(item));
}

function compactCards(items: Array<WorkflowDetailCard | null | undefined>) {
  return items.filter((item): item is WorkflowDetailCard => Boolean(item));
}

function detailText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function formatMaterialShotTimeRange(timeRange: { start: number; end: number } | null | undefined) {
  if (!timeRange || !Number.isFinite(timeRange.start) || !Number.isFinite(timeRange.end)) return "";
  return `${formatSecondsCompact(timeRange.start)} - ${formatSecondsCompact(timeRange.end)}`;
}

function numericTime(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function compactTimelineFields(fields: Array<{ label: string; value: string | null | undefined }>) {
  return fields
    .map((field) => ({ label: field.label, value: detailText(field.value) }))
    .filter((field) => field.value);
}

function materialClassLabel(value: string | null | undefined) {
  const labels: Record<string, string> = {
    product_display: "商品展示",
    usage_process: "使用过程",
    problem_scene: "问题场景",
    result_or_state: "结果状态",
    comparison: "对比",
    trust_evidence: "信任证据",
    human_presence: "人物",
    scene_context: "场景",
    transition_or_filler: "过渡",
    unusable: "不可用",
  };
  return labels[String(value ?? "")] ?? detailText(value);
}

function materialFunctionLabel(value: string | null | undefined) {
  const labels: Record<string, string> = {
    attention_entry: "吸引",
    context_setup: "铺垫",
    problem_visibility: "问题",
    product_recognition: "商品识别",
    product_desire: "种草",
    mechanism_explanation: "机制解释",
    trust_building: "信任",
    result_confirmation: "结果确认",
    conversion_prompt: "转化",
  };
  return labels[String(value ?? "")] ?? detailText(value);
}

function formatCount(value: number) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(Math.max(0, Math.round(value)));
}

function uniqueCount(values: string[]) {
  return new Set(values.filter(Boolean)).size;
}

function failedText(status: string | null | undefined, failed: string, empty: string) {
  return String(status ?? "").toLowerCase() === "failed" ? failed : empty;
}
