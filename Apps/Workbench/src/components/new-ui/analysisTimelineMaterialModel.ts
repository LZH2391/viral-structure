import { sanitizeText } from "../../utils/format";
import type { AnalysisHistoryItem } from "./analysisHistoryData";
import type { AnalysisTimelineSegmentDetail } from "./analysisTimelineSelection";
import { compactTimelineDetailFields, formatShotNo, formatTimelineTime, positiveTimelineNumber, timelineDetailText, type AnalysisTimelineBlock, type AnalysisTimelineTrack, type AnalysisTimelineTrackTone } from "./analysisTimelineTrackModel";

export function resolveMaterialTimelineTracks(
  materialPack: NonNullable<NonNullable<AnalysisHistoryItem["artifact"]>["userMaterialPack"]> | null,
  shotMeta: Map<string, { index: number; label: string; start: number; end: number }>,
  shotBlocks: AnalysisTimelineBlock[],
): AnalysisTimelineTrack[] {
  const proofByShot = buildProofCoverageByShot(asArray(materialPack?.proofCoverage));
  const sequenceByShot = buildSequenceRecommendationByShot(materialPack?.sequenceRecommendations);
  const cards = [...asArray(materialPack?.shotCards)].sort((a, b) => {
    const left = shotMeta.get(a.shotRef)?.index ?? Number.MAX_SAFE_INTEGER;
    const right = shotMeta.get(b.shotRef)?.index ?? Number.MAX_SAFE_INTEGER;
    return left - right;
  });

  const classBlocks: AnalysisTimelineBlock[] = [];
  const functionBlocks: AnalysisTimelineBlock[] = [];
  const proofBlocks: AnalysisTimelineBlock[] = [];
  const sequenceBlocks: AnalysisTimelineBlock[] = [];

  cards.forEach((card, index) => {
    const range = resolveMaterialCardTimeRange(card, shotMeta, index);
    if (!range) return;
    const shotLabel = card.shotNo || range.label || formatShotNo(card.shotRef, index);
    const proofItems = proofByShot.get(card.shotRef) ?? [];
    const sequenceItems = sequenceByShot.get(card.shotRef) ?? [];
    const shotFunctions = asArray(card.shotFunctions);
    const materialTags = asArray(card.materialTags);
    const materialFields = materialCardBaseFields(card);

    classBlocks.push({
      id: `material-class:${card.shotRef}`,
      label: materialClassLabel(card.shotClass),
      start: range.start,
      end: range.end,
      shotRangeLabel: shotLabel,
      detail: materialDetail({
        id: `material-class:${card.shotRef}`,
        tone: "materialClass",
        title: materialClassLabel(card.shotClass),
        start: range.start,
        end: range.end,
        shotLabel,
        summary: card.visualSummary || card.spokenOrSubtitleSummary || "这个镜头还没有素材摘要。",
        fields: [
          { label: "镜头类型", value: card.shotClass },
          { label: "画面摘要", value: card.visualSummary },
          { label: "口播/字幕", value: card.spokenOrSubtitleSummary },
          ...materialFields,
        ],
      }),
    });

    functionBlocks.push({
      id: `material-function:${card.shotRef}`,
      label: materialFunctionLabel(shotFunctions),
      start: range.start,
      end: range.end,
      shotRangeLabel: shotLabel,
      detail: materialDetail({
        id: `material-function:${card.shotRef}`,
        tone: "materialFunction",
        title: materialFunctionLabel(shotFunctions),
        start: range.start,
        end: range.end,
        shotLabel,
        summary: shotFunctions.length ? `这个镜头可用于${materialFunctionLabel(shotFunctions)}。` : "这个镜头还没有表达功能标签。",
        fields: [
          { label: "表达功能", value: shotFunctions.map(materialFunctionLabel).join(" / ") },
          { label: "素材标签", value: materialTags.join(" / ") },
          ...materialFields,
        ],
      }),
    });

    proofBlocks.push({
      id: `material-proof:${card.shotRef}`,
      label: materialProofLabel(proofItems),
      start: range.start,
      end: range.end,
      shotRangeLabel: shotLabel,
      detail: materialDetail({
        id: `material-proof:${card.shotRef}`,
        tone: "materialProof",
        title: materialProofLabel(proofItems),
        start: range.start,
        end: range.end,
        shotLabel,
        summary: materialProofSummary(proofItems),
        fields: [
          { label: "证明覆盖", value: proofItems.map((item) => `${materialProofNeedLabel(item.proofNeedClass)}：${materialCoverageLabel(item.coverage)}`).join(" / ") },
          { label: "证明理由", value: proofItems.map((item) => item.reason).filter(Boolean).join(" / ") },
          ...materialFields,
        ],
      }),
    });

    sequenceBlocks.push({
      id: `material-sequence:${card.shotRef}`,
      label: materialSequenceLabel(sequenceItems),
      start: range.start,
      end: range.end,
      shotRangeLabel: shotLabel,
      detail: materialDetail({
        id: `material-sequence:${card.shotRef}`,
        tone: "materialSequence",
        title: materialSequenceLabel(sequenceItems),
        start: range.start,
        end: range.end,
        shotLabel,
        summary: materialSequenceSummary(sequenceItems),
        fields: [
          { label: "位置建议", value: sequenceItems.map((item) => `${materialPositionLabel(item.recommendedPosition)}：${materialFitLabel(item.fit)}`).join(" / ") },
          { label: "建议理由", value: sequenceItems.map((item) => item.reason).filter(Boolean).join(" / ") },
          { label: "不适合", value: sequenceItems.flatMap((item) => asArray(item.doNotUseAs)).join(" / ") },
          ...materialFields,
        ],
      }),
    });
  });

  return [
    { key: "shot", label: "镜头轨", emptyLabel: "暂无切镜", blocks: shotBlocks },
    { key: "materialClass", label: "镜头类型", emptyLabel: "暂无镜头类型", blocks: classBlocks },
    { key: "materialFunction", label: "表达功能", emptyLabel: "暂无表达功能", blocks: functionBlocks },
    { key: "materialProof", label: "证明支撑", emptyLabel: "暂无证明支撑", blocks: proofBlocks },
    { key: "materialSequence", label: "成片位置", emptyLabel: "暂无位置建议", blocks: sequenceBlocks },
  ];
}

function resolveMaterialCardTimeRange(
  card: MaterialShotCard,
  shotMeta: Map<string, { index: number; label: string; start: number; end: number }>,
  index: number,
) {
  const meta = shotMeta.get(card.shotRef) ?? (card.shotNo ? shotMeta.get(card.shotNo) : undefined);
  if (meta) return meta;
  const start = positiveTimelineNumber(card.timeRange?.start);
  const end = positiveTimelineNumber(card.timeRange?.end);
  if (end > start) return { index, label: card.shotNo ?? formatShotNo(card.shotRef, index), start, end };
  return null;
}

function materialDetail({
  id,
  tone,
  title,
  start,
  end,
  shotLabel,
  summary,
  fields,
}: {
  id: string;
  tone: Exclude<AnalysisTimelineTrackTone, "shot" | "script" | "rhythm" | "packaging" | "slot">;
  title: string;
  start: number;
  end: number;
  shotLabel: string;
  summary: string;
  fields: Array<{ label: string; value: string | null | undefined }>;
}): AnalysisTimelineSegmentDetail {
  return {
    id,
    tone,
    title,
    timeLabel: `${formatTimelineTime(start)} - ${formatTimelineTime(end)}`,
    shotRangeLabel: shotLabel,
    summary: timelineDetailText(summary),
    fields: compactTimelineDetailFields(fields),
  };
}

function materialCardBaseFields(card: MaterialShotCard) {
  return [
    { label: "限制引用", value: asArray(card.constraintRefs).join(" / ") },
  ];
}

function buildProofCoverageByShot(proofCoverage: MaterialProofCoverage[]) {
  const byShot = new Map<string, MaterialProofCoverage[]>();
  proofCoverage.forEach((item) => {
    asArray(item.candidateShots).forEach((shotRef) => {
      const current = byShot.get(shotRef) ?? [];
      current.push(item);
      byShot.set(shotRef, current);
    });
  });
  return byShot;
}

function buildSequenceRecommendationByShot(sequence: NonNullable<NonNullable<AnalysisHistoryItem["artifact"]>["userMaterialPack"]>["sequenceRecommendations"] | null | undefined) {
  const byShot = new Map<string, MaterialSequenceCandidate[]>();
  [
    ...asArray(sequence?.openingCandidates),
    ...asArray(sequence?.middleCandidates),
    ...asArray(sequence?.endingCandidates),
  ].forEach((item) => {
    const current = byShot.get(item.shotRef) ?? [];
    current.push(item);
    byShot.set(item.shotRef, current);
  });
  return byShot;
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
  return labels[String(value ?? "")] ?? (sanitizeText(value, 12) || "未分类");
}

function materialFunctionLabel(values: string[] | string | null | undefined) {
  const source = Array.isArray(values) ? values : [values].filter(Boolean);
  const labels: Record<string, string> = {
    attention_entry: "吸引",
    context_setup: "铺垫",
    problem_visibility: "问题",
    product_visibility: "商品",
    operation_demonstration: "演示",
    process_continuity: "过程",
    result_visibility: "结果",
    comparison_support: "对比",
    trust_support: "信任",
    mechanism_support: "机制",
    emotion_or_reaction: "反应",
    conversion_support: "转化",
    visual_bridge: "衔接",
  };
  const mapped = source.map((value) => labels[String(value)] ?? sanitizeText(value, 8)).filter(Boolean);
  return mapped.slice(0, 2).join(" / ") || "未标注";
}

function materialProofLabel(items: MaterialProofCoverage[]) {
  if (!items.length) return "无证明";
  return items
    .filter((item) => item.coverage !== "missing")
    .map((item) => materialProofNeedLabel(item.proofNeedClass))
    .slice(0, 2)
    .join(" / ") || "弱证明";
}

function materialProofSummary(items: MaterialProofCoverage[]) {
  if (!items.length) return "这个镜头暂未进入证明候选。";
  return items.map((item) => `${materialProofNeedLabel(item.proofNeedClass)}：${item.reason || materialCoverageLabel(item.coverage)}`).join(" / ");
}

function materialProofNeedLabel(value: string) {
  const labels: Record<string, string> = {
    problem_visibility: "问题",
    product_identity: "商品识别",
    process_demonstration: "过程演示",
    mechanism_support: "机制",
    result_evidence: "结果",
    comparison_evidence: "对比",
    trust_evidence: "信任",
    conversion_support: "转化",
  };
  return labels[value] ?? sanitizeText(value, 10);
}

function materialCoverageLabel(value: string) {
  const labels: Record<string, string> = {
    strong: "强",
    partial: "部分",
    weak: "弱",
    missing: "缺失",
    unknown: "未知",
  };
  return labels[value] ?? sanitizeText(value, 8);
}

function materialSequenceLabel(items: MaterialSequenceCandidate[]) {
  if (!items.length) return "待定";
  return items.map((item) => materialPositionLabel(item.recommendedPosition)).slice(0, 2).join(" / ");
}

function materialSequenceSummary(items: MaterialSequenceCandidate[]) {
  if (!items.length) return "这个镜头暂未进入开头、中段或结尾候选。";
  return items.map((item) => `${materialPositionLabel(item.recommendedPosition)}：${item.reason || materialFitLabel(item.fit)}`).join(" / ");
}

function materialPositionLabel(value: string) {
  const labels: Record<string, string> = {
    opening: "开头",
    middle: "中段",
    ending: "结尾",
  };
  return labels[value] ?? sanitizeText(value, 8);
}

function materialFitLabel(value: string) {
  const labels: Record<string, string> = {
    strong: "强",
    medium: "中",
    weak: "弱",
  };
  return labels[value] ?? sanitizeText(value, 8);
}

function formatMaterialConfidence(value: number) {
  if (!Number.isFinite(value)) return null;
  return `${Math.round(value * 100)}%`;
}

function asArray<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

type MaterialShotCard = NonNullable<NonNullable<AnalysisHistoryItem["artifact"]>["userMaterialPack"]>["shotCards"][number];
type MaterialProofCoverage = NonNullable<NonNullable<AnalysisHistoryItem["artifact"]>["userMaterialPack"]>["proofCoverage"][number];
type MaterialSequenceCandidate = NonNullable<NonNullable<AnalysisHistoryItem["artifact"]>["userMaterialPack"]>["sequenceRecommendations"]["openingCandidates"][number];
type ShotBoundaryShot = NonNullable<NonNullable<AnalysisHistoryItem["artifact"]>["shotBoundaryAnalysis"]>["shots"][number];

export function resolveShotTimelineDetail(shot: ShotBoundaryShot, materialCard: MaterialShotCard | undefined): AnalysisTimelineSegmentDetail {
  const label = formatShotNo(shot.shotNo, shot.index);
  const summary = shot.summary || shot.reason || materialCard?.visualSummary || "这个镜头还没有摘要。";
  const shotFunctions = asArray(materialCard?.shotFunctions);
  return {
    id: `shot:${shot.id}`,
    tone: "shot",
    title: label,
    timeLabel: `${formatTimelineTime(shot.start)} - ${formatTimelineTime(shot.end)}`,
    start: shot.start,
    end: shot.end,
    shotRangeLabel: label,
    summary: timelineDetailText(summary),
    fields: compactTimelineDetailFields([
      { label: "镜头摘要", value: shot.summary },
      { label: "切分原因", value: shot.reason },
      { label: "边界原因", value: shot.endBoundaryReason },
      { label: "素材类型", value: materialCard ? materialClassLabel(materialCard.shotClass) : null },
      { label: "表达功能", value: shotFunctions.length ? shotFunctions.map(materialFunctionLabel).join(" / ") : null },
      { label: "素材摘要", value: materialCard?.visualSummary || materialCard?.spokenOrSubtitleSummary },
    ]),
  };
}

export function buildMaterialCardByShot(cards: MaterialShotCard[] | null | undefined) {
  const byShot = new Map<string, MaterialShotCard>();
  asArray(cards).forEach((card, index) => {
    byShot.set(card.shotRef, card);
    if (card.shotNo) byShot.set(card.shotNo, card);
    byShot.set(formatShotNo(card.shotNo ?? card.shotRef, index), card);
  });
  return byShot;
}
