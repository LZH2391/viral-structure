import type { SampleArtifact } from "../../types";
import { formatSecondsCompact, sanitizeText } from "../../utils/format";
import type { AnalysisHistoryItem } from "./analysisHistoryData";

export type WorkflowStageStatus = "done" | "running" | "waiting";
export type WorkflowStageKey =
  | "upload"
  | "shotBoundary"
  | "structureAnalysis"
  | "scriptSegment"
  | "rhythmStructure"
  | "packagingStructure"
  | "functionSlotAtomization"
  | "aggregate";

export type WorkflowStage = {
  key: WorkflowStageKey;
  label: string;
  moduleLabel: string;
  dependencyLabel: string;
  status: WorkflowStageStatus;
};

export type WorkflowStages = [
  WorkflowStage,
  WorkflowStage,
  WorkflowStage,
  WorkflowStage,
  WorkflowStage,
  WorkflowStage,
  WorkflowStage,
];

export type WorkflowDetailMetric = {
  label: string;
  value: string;
};

export type WorkflowDetailCard = {
  title: string;
  meta: string;
  body: string;
};

export type WorkflowDetail = {
  title: string;
  status: WorkflowStageStatus;
  summary: string;
  metrics: WorkflowDetailMetric[];
  cards: WorkflowDetailCard[];
  emptyText: string;
  nextText: string;
};

export function resolveWorkflowDetail(stageKey: WorkflowStageKey, item: AnalysisHistoryItem | null, stages: WorkflowStages, structureStatus: WorkflowStageStatus): WorkflowDetail {
  const artifact = item?.artifact ?? null;
  const stage = stageForKey(stageKey, stages, structureStatus);
  const base = {
    title: stageTitle(stageKey),
    status: stage.status,
  };
  if (!artifact) {
    return {
      ...base,
      summary: "选择历史结果后，这里会展示对应步骤的主要产出。",
      metrics: [],
      cards: [],
      emptyText: "暂无可展示内容。",
      nextText: "",
    };
  }
  if (stageKey === "upload") return resolveUploadDetail(base, artifact);
  if (stageKey === "shotBoundary") return resolveShotBoundaryDetail(base, artifact);
  if (stageKey === "structureAnalysis") return resolveStructureAnalysisDetail(base, artifact, stages);
  if (stageKey === "scriptSegment") return resolveScriptSegmentDetail(base, artifact);
  if (stageKey === "rhythmStructure") return resolveRhythmStructureDetail(base, artifact);
  if (stageKey === "packagingStructure") return resolvePackagingStructureDetail(base, artifact);
  if (stageKey === "functionSlotAtomization") return resolveFunctionSlotAtomizationDetail(base, artifact);
  return resolveAggregateDetail(base, artifact);
}

function stageForKey(stageKey: WorkflowStageKey, stages: WorkflowStages, structureStatus: WorkflowStageStatus): WorkflowStage {
  const found = stages.find((stage) => stage.key === stageKey);
  if (found) return found;
  return {
    key: "structureAnalysis",
    label: "结构分析",
    moduleLabel: "",
    dependencyLabel: "",
    status: structureStatus,
  };
}

function resolveUploadDetail(base: Pick<WorkflowDetail, "title" | "status">, artifact: SampleArtifact): WorkflowDetail {
  const metadata = artifact.metadata;
  const frameCount = artifact.frameOutputSummary?.actualFrameCount ?? artifact.frames.length;
  const options = artifact.processingOptions;
  const optionLabels = [
    options?.enableSubtitleRecognition ? "字幕识别" : null,
    options?.enableAudioFeatureAnalysis ? "音频特征" : null,
    options?.enableAudioSeparation ? "音频分离" : null,
  ].filter(Boolean);
  return {
    ...base,
    summary: "素材已经完成导入和基础处理，可以作为后续切镜和结构分析的输入。",
    metrics: compactMetrics([
      metric("时长", formatSecondsCompact(metadata.durationSeconds)),
      metric("画幅", metadata.width && metadata.height ? `${Math.round(metadata.width)} x ${Math.round(metadata.height)}` : "未知"),
      metric("抽帧", `${formatCount(frameCount)} 帧`),
    ]),
    cards: compactCards([
      card("原始素材", normalizeTitle(artifact.sampleVideo.original.summary) || "视频已导入", "保留原始素材，并生成适合分析使用的标准化版本。"),
      card("处理选项", optionLabels.length ? optionLabels.join(" / ") : "基础处理", "后续步骤会基于这些处理结果继续分析视频结构。"),
    ]),
    emptyText: "还没有素材处理结果。",
    nextText: "下一步可查看切镜结果，确认视频被拆成哪些连续镜头。",
  };
}

function resolveShotBoundaryDetail(base: Pick<WorkflowDetail, "title" | "status">, artifact: SampleArtifact): WorkflowDetail {
  const analysis = artifact.shotBoundaryAnalysis;
  const shots = analysis?.shots ?? [];
  const reviewCount = shots.filter((shot) => shot.needReview).length;
  return {
    ...base,
    summary: shots.length ? "视频已经拆分成连续镜头，后续结构分析会基于这些镜头展开。" : "切镜完成后会展示镜头数量和主要镜头摘要。",
    metrics: compactMetrics([
      metric("镜头", `${formatCount(shots.length)} 个`),
      metric("覆盖", formatCoverage(shots)),
      metric("需复核", `${formatCount(reviewCount)} 个`),
    ]),
    cards: shots.slice(0, 4).map((shot, index) => card(
      shot.shotNo ?? `镜头 ${String(index + 1).padStart(3, "0")}`,
      `${formatSecondsCompact(shot.start)} - ${formatSecondsCompact(shot.end)}`,
      shot.summary ?? shot.reason ?? "这个镜头还没有摘要。",
    )),
    emptyText: failedText(analysis?.status, "本步未生成有效镜头，可重试切镜。", "切镜完成后会展示镜头列表。"),
    nextText: shots.length ? "切镜完成后，结构分析会并行拆出脚本段落、节奏结构和包装结构。" : "",
  };
}

function resolveStructureAnalysisDetail(base: Pick<WorkflowDetail, "title" | "status">, artifact: SampleArtifact, stages: WorkflowStages): WorkflowDetail {
  const scriptCount = artifact.scriptSegmentAnalysis?.segments?.length ?? 0;
  const rhythmCount = artifact.rhythmStructureAnalysis?.sections?.length ?? 0;
  const packagingCount = artifact.packagingStructureAnalysis?.packagingBlocks?.length ?? 0;
  return {
    ...base,
    summary: "这里汇总三个并行结构分析的完成情况。三项完成后，可以继续进入功能槽位原子化。",
    metrics: compactMetrics([
      metric("脚本段落", `${formatCount(scriptCount)} 段`),
      metric("节奏区间", `${formatCount(rhythmCount)} 段`),
      metric("包装块", `${formatCount(packagingCount)} 个`),
    ]),
    cards: [
      card("脚本段落", structureCardMeta("scriptSegment", stages, `${scriptCount} 段`), "识别视频脚本承担的表达和说服任务。"),
      card("节奏结构", structureCardMeta("rhythmStructure", stages, `${rhythmCount} 段`), "识别观看节奏、注意力推进和高潮位置。"),
      card("包装结构", structureCardMeta("packagingStructure", stages, `${packagingCount} 个包装块`), "识别字幕、标题、标注、证据包装和转化提示。"),
    ],
    emptyText: "结构分析完成后会展示三个子任务的状态。",
    nextText: "可以点开三个子任务分别查看摘要，也可以继续查看功能槽位原子化结果。",
  };
}

function resolveScriptSegmentDetail(base: Pick<WorkflowDetail, "title" | "status">, artifact: SampleArtifact): WorkflowDetail {
  const analysis = artifact.scriptSegmentAnalysis;
  const segments = analysis?.segments ?? [];
  const reviewCount = segments.filter((segment) => segment.needReview).length;
  return {
    ...base,
    summary: segments.length ? "脚本被拆成可迁移的表达段落，重点展示每段承担的叙事或说服任务。" : "脚本段落完成后会展示段落标题、时间段和脚本作用。",
    metrics: compactMetrics([
      metric("段落", `${formatCount(segments.length)} 段`),
      metric("关联镜头", `${formatCount(uniqueCount(segments.flatMap((segment) => segment.shotRefs)))} 个`),
      metric("需复核", `${formatCount(reviewCount)} 段`),
    ]),
    cards: segments.slice(0, 4).map((segment) => card(
      segment.label,
      `${formatSecondsCompact(segment.start)} - ${formatSecondsCompact(segment.end)}`,
      segment.roleInScript || segment.transferableRule || "这个段落还没有摘要。",
    )),
    emptyText: failedText(analysis?.status, "本步未生成有效脚本段落，可重试脚本分析。", "脚本分析完成后会展示段落结构。"),
    nextText: segments.length ? "这部分回答“内容怎么说”，可和节奏、包装一起看结构迁移价值。" : "",
  };
}

function resolveRhythmStructureDetail(base: Pick<WorkflowDetail, "title" | "status">, artifact: SampleArtifact): WorkflowDetail {
  const analysis = artifact.rhythmStructureAnalysis;
  const sections = analysis?.sections ?? [];
  const reviewCount = sections.filter((section) => section.needReview).length;
  const summary = analysis?.overview?.summary;
  return {
    ...base,
    summary: summary ? sanitizeText(summary, 96) : "节奏结构完成后会展示整体节奏摘要和主要节奏区间。",
    metrics: compactMetrics([
      metric("区间", `${formatCount(sections.length)} 段`),
      metric("观察", `${formatCount(analysis?.overview?.fields?.length ?? 0)} 条`),
      metric("需复核", `${formatCount(reviewCount)} 段`),
    ]),
    cards: sections.slice(0, 4).map((section) => card(
      section.label,
      `${formatSecondsCompact(section.start)} - ${formatSecondsCompact(section.end)}`,
      fieldPreview(section.fields) || "这个节奏区间还没有摘要。",
    )),
    emptyText: failedText(analysis?.status, "本步未生成有效节奏区间，可重试节奏分析。", "节奏分析完成后会展示节奏段落。"),
    nextText: sections.length ? "这部分回答“观看感受怎么推进”，适合判断高潮和停顿位置。" : "",
  };
}

function resolvePackagingStructureDetail(base: Pick<WorkflowDetail, "title" | "status">, artifact: SampleArtifact): WorkflowDetail {
  const analysis = artifact.packagingStructureAnalysis;
  const blocks = analysis?.packagingBlocks ?? [];
  const reviewCount = blocks.filter((block) => block.needReview).length;
  const summary = analysis?.overview?.summary;
  return {
    ...base,
    summary: summary ? sanitizeText(summary, 96) : "包装结构完成后会展示标题、字幕、标注、证据和转化包装的摘要。",
    metrics: compactMetrics([
      metric("包装块", `${formatCount(blocks.length)} 个`),
      metric("逐镜观察", `${formatCount(analysis?.shotPackagingNotes?.length ?? 0)} 条`),
      metric("需复核", `${formatCount(reviewCount)} 个`),
    ]),
    cards: blocks.slice(0, 4).map((block) => card(
      block.label,
      `${formatSecondsCompact(block.start)} - ${formatSecondsCompact(block.end)}`,
      block.packagingFunction || fieldPreview(block.fields) || "这个包装块还没有摘要。",
    )),
    emptyText: failedText(analysis?.status, "本步未生成有效包装结构，可重试包装分析。", "包装分析完成后会展示包装块。"),
    nextText: blocks.length ? "这部分回答“画面怎么帮内容成立”，适合提取可复用包装方式。" : "",
  };
}

function resolveFunctionSlotAtomizationDetail(base: Pick<WorkflowDetail, "title" | "status">, artifact: SampleArtifact): WorkflowDetail {
  const analysis = artifact.functionSlotAtomizationAnalysis;
  const slots = analysis?.slotMap?.slots ?? [];
  const atomCount = (analysis?.atomInventory?.scriptAtoms?.length ?? 0)
    + (analysis?.atomInventory?.rhythmAtoms?.length ?? 0)
    + (analysis?.atomInventory?.packagingAtoms?.length ?? 0);
  const reviewCount = slots.filter((slot) => slot.needReview).length;
  return {
    ...base,
    summary: slots.length ? "已经把脚本、节奏和包装结果合并成可复用的功能槽位链。" : "原子化完成后会展示功能槽位链和每个槽位承担的任务。",
    metrics: compactMetrics([
      metric("槽位", `${formatCount(slots.length)} 个`),
      metric("原子", `${formatCount(atomCount)} 个`),
      metric("需复核", `${formatCount(reviewCount)} 个`),
    ]),
    cards: slots.slice(0, 4).map((slot) => card(
      slot.slotName || slot.slotId,
      slot.slotType || "功能槽位",
      slot.persuasionTask || stateTransition(slot.viewerStateBefore, slot.viewerStateAfter) || "这个槽位还没有摘要。",
    )),
    emptyText: failedText(analysis?.status, "本步未生成有效槽位链，可重试原子化。", "原子化完成后会展示功能槽位。"),
    nextText: slots.length ? "这一步适合进入结构库、重组方案或后续故事板设计。" : "",
  };
}

function resolveAggregateDetail(base: Pick<WorkflowDetail, "title" | "status">, artifact: SampleArtifact): WorkflowDetail {
  const shots = artifact.shotBoundaryAnalysis?.shots ?? [];
  const segments = artifact.scriptSegmentAnalysis?.segments ?? [];
  const sections = artifact.rhythmStructureAnalysis?.sections ?? [];
  const blocks = artifact.packagingStructureAnalysis?.packagingBlocks ?? [];
  const slots = artifact.functionSlotAtomizationAnalysis?.slotMap?.slots ?? [];
  return {
    ...base,
    summary: "完整分析结果已经准备好，可以从总览进入具体结构，也可以继续做重组和分镜。",
    metrics: compactMetrics([
      metric("镜头", `${formatCount(shots.length)} 个`),
      metric("结构结果", `${formatCount([segments.length, sections.length, blocks.length].filter(Boolean).length)} 类`),
      metric("槽位链", `${formatCount(slots.length)} 段`),
    ]),
    cards: compactCards([
      card("可查看", "脚本 / 节奏 / 包装", "三类结构结果已生成，可以分别检查摘要。"),
      slots.length ? card("可复用", "功能槽位链", "原子化结果已经形成可迁移的结构表达。") : null,
      card("可继续", "重组和故事板", "后续可以基于槽位链进入新视频方案设计。"),
    ]),
    emptyText: "完成分析后会展示结果总览。",
    nextText: "建议先检查功能槽位链是否符合预期，再进入后续创作流程。",
  };
}

function metric(label: string, value: string): WorkflowDetailMetric {
  return { label, value };
}

function card(title: string | null | undefined, meta: string | null | undefined, body: string | null | undefined): WorkflowDetailCard {
  return {
    title: sanitizeText(title || "未命名", 28),
    meta: sanitizeText(meta || "结果摘要", 34),
    body: sanitizeText(body || "暂无摘要。", 88),
  };
}

function compactMetrics(items: Array<WorkflowDetailMetric | null | undefined>) {
  return items.filter((item): item is WorkflowDetailMetric => Boolean(item));
}

function compactCards(items: Array<WorkflowDetailCard | null | undefined>) {
  return items.filter((item): item is WorkflowDetailCard => Boolean(item));
}

function formatCount(value: number) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(Math.max(0, Math.round(value)));
}

function formatCoverage(shots: NonNullable<SampleArtifact["shotBoundaryAnalysis"]>["shots"]) {
  if (!shots.length) return "0s";
  const start = Math.min(...shots.map((shot) => Number(shot.start) || 0));
  const end = Math.max(...shots.map((shot) => Number(shot.end) || 0));
  return formatSecondsCompact(Math.max(0, end - start));
}

function uniqueCount(values: string[]) {
  return new Set(values.filter(Boolean)).size;
}

function fieldPreview(fields: Array<{ label: string; value: string }> | null | undefined) {
  const first = (fields ?? []).find((field) => String(field.value ?? "").trim());
  if (!first) return "";
  const count = (fields ?? []).filter((field) => String(field.value ?? "").trim()).length;
  return count > 1 ? `${first.label}：${first.value} +${formatCount(count - 1)}` : `${first.label}：${first.value}`;
}

function stateTransition(before: string | null | undefined, after: string | null | undefined) {
  if (!before && !after) return "";
  return `${before || "未知状态"} -> ${after || "未知状态"}`;
}

function structureCardMeta(stageKey: WorkflowStageKey, stages: WorkflowStages, countLabel: string) {
  const stage = stages.find((item) => item.key === stageKey);
  return `${statusLabel(stage?.status ?? "waiting")} / ${countLabel}`;
}

function failedText(status: string | null | undefined, failed: string, empty: string) {
  return String(status ?? "").toLowerCase() === "failed" ? failed : empty;
}

function normalizeTitle(value: string | null | undefined) {
  return String(value ?? "").replace(/\.(mp4|mov|m4v|webm|mkv|avi)$/i, "").trim();
}

export function resolveWorkflowStages(item: AnalysisHistoryItem | null): WorkflowStages {
  const artifact = item?.artifact;
  const sampleRunning = Boolean(item?.isRunning) || isRunningStatus(item?.status);
  const uploadDone = Boolean(item);
  const shotDone = Boolean(artifact?.shotBoundaryAnalysis);
  const scriptDone = Boolean(artifact?.scriptSegmentAnalysis);
  const rhythmDone = Boolean(artifact?.rhythmStructureAnalysis);
  const packagingDone = Boolean(artifact?.packagingStructureAnalysis);
  const atomizationDone = Boolean(artifact?.functionSlotAtomizationAnalysis);
  const structureDone = scriptDone && rhythmDone && packagingDone;

  return [
    {
      key: "upload",
      label: "上传素材",
      moduleLabel: "sample-ingest",
      dependencyLabel: "起点",
      status: statusFor({ done: uploadDone, dependenciesDone: true, running: sampleRunning }),
    },
    {
      key: "shotBoundary",
      label: "切镜",
      moduleLabel: "shot-boundary",
      dependencyLabel: "依赖：上传素材",
      status: statusFor({ done: shotDone, dependenciesDone: uploadDone, running: sampleRunning }),
    },
    {
      key: "scriptSegment",
      label: "脚本段落",
      moduleLabel: "script-segments",
      dependencyLabel: "依赖：切镜",
      status: statusFor({ done: scriptDone, dependenciesDone: shotDone, running: sampleRunning }),
    },
    {
      key: "rhythmStructure",
      label: "节奏结构",
      moduleLabel: "rhythm-structure",
      dependencyLabel: "依赖：切镜",
      status: statusFor({ done: rhythmDone, dependenciesDone: shotDone, running: sampleRunning }),
    },
    {
      key: "packagingStructure",
      label: "包装结构",
      moduleLabel: "packaging-structure",
      dependencyLabel: "依赖：切镜",
      status: statusFor({ done: packagingDone, dependenciesDone: shotDone, running: sampleRunning }),
    },
    {
      key: "functionSlotAtomization",
      label: "功能槽位原子化",
      moduleLabel: "function-slot-atomization",
      dependencyLabel: "依赖：脚本 + 节奏 + 包装",
      status: statusFor({ done: atomizationDone, dependenciesDone: structureDone, running: sampleRunning }),
    },
    {
      key: "aggregate",
      label: "汇总",
      moduleLabel: "workflow.aggregate",
      dependencyLabel: "依赖：功能槽位原子化",
      status: statusFor({ done: atomizationDone, dependenciesDone: atomizationDone, running: sampleRunning }),
    },
  ];
}

function statusFor({ done, dependenciesDone, running }: { done: boolean; dependenciesDone: boolean; running: boolean }): WorkflowStageStatus {
  if (done) return "done";
  if (!dependenciesDone) return "waiting";
  return running ? "running" : "waiting";
}

export function resolveGroupStatus(stages: WorkflowStage[]): WorkflowStageStatus {
  if (stages.every((stage) => stage.status === "done")) return "done";
  if (stages.some((stage) => stage.status === "running")) return "running";
  return "waiting";
}

export function statusLabel(status: WorkflowStageStatus) {
  if (status === "done") return "已完成";
  if (status === "running") return "处理中";
  return "等待中";
}

export function stageTitle(stageKey: WorkflowStageKey) {
  if (stageKey === "upload") return "上传素材";
  if (stageKey === "shotBoundary") return "切镜";
  if (stageKey === "structureAnalysis") return "结构分析";
  if (stageKey === "scriptSegment") return "脚本段落";
  if (stageKey === "rhythmStructure") return "节奏结构";
  if (stageKey === "packagingStructure") return "包装结构";
  if (stageKey === "functionSlotAtomization") return "功能槽位原子化";
  return "汇总";
}

function isRunningStatus(status: string | null | undefined) {
  return ["queued", "pending", "running", "processing", "waiting", "blocked", "cache_waiting"].includes(String(status ?? "").toLowerCase());
}
