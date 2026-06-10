import type { ProcessingJob } from "../types";
import { listAnalysisRoles } from "./analysisRoles";

const ANALYSIS_STAGE_LABELS = Object.fromEntries(listAnalysisRoles().flatMap((role) => Object.entries(role.stageLabels)));

export function stageLabel(job: ProcessingJob): string {
  const labels: Record<string, string> = {
    uploaded: "上传中",
    "sample.upload.received": "上传中",
    "sample.upload.validated": "校验上传",
    "sample.source.saved": "保存素材",
    "sample.metadata.probed": "读取元信息",
    "sample.cover.extracted": "生成封面",
    "sample.frames.extracted": "抽帧中",
    "sample.audio.extracted": "提取音频",
    "sample.audio.features.extracted": "分析音频基础特征",
    "sample.audio.separated": "分离人声/伴奏",
    "sample.subtitle.recognized": "识别字幕",
    "sample.artifact.written": "生成产物",
    "shot.input_prepare": "准备切镜输入",
    "shot.contact_sheet": "生成联表",
    "shot.cache_lookup": "检查切镜缓存",
    "shot.raw_video_analyze.thread_start": "启动原始切镜线程",
    "shot.raw_video_analyze.submit": "提交原始切镜分析",
    "shot.raw_video_analyze.collect": "等待原始切镜结果",
    "shot.boundary_transform.thread_acquire": "等待 Transform lease",
    "script_segment.thread_acquire": "等待脚本段落线程",
    "script_segment.turn_submit": "提交脚本段落分析",
    "script_segment.turn_collect": "等待脚本段落结果",
    "rhythm_structure.thread_acquire": "等待节奏结构线程",
    "rhythm_structure.turn_submit": "提交节奏结构分析",
    "rhythm_structure.turn_collect": "等待节奏结构结果",
    "packaging_structure.thread_acquire": "等待包装结构线程",
    "packaging_structure.turn_submit": "提交包装结构分析",
    "packaging_structure.turn_collect": "等待包装结构结果",
    "shot.boundary_transform.submit": "提交切镜结果转换",
    "shot.boundary_transform.collect": "等待转换结果",
    "shot.boundary_transform.validate": "校验转换结果",
    "shot.boundary_transform.sheets": "生成结果联表",
    "shot.boundary_repair.submit": "提交修复分析",
    "shot.boundary_repair.collect": "等待修复结果",
    "shot.boundary_merge": "合并切镜结果",
    "shot.cache_reuse": "复用切镜缓存",
    ...ANALYSIS_STAGE_LABELS,
    processed: "生成产物完成",
  };
  return labels[job?.stage] ?? job?.stage ?? "处理中";
}
