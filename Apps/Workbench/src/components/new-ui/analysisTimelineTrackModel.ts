import type { CSSProperties } from "react";
import { runtimeUrl } from "../../api/client";
import { formatSecondsCompact, sanitizeText } from "../../utils/format";
import type { AnalysisHistoryItem } from "./analysisHistoryData";
import type { AnalysisTimelineSegmentDetail } from "./analysisTimelineSelection";
import { buildMaterialCardByShot, resolveMaterialTimelineTracks, resolveShotTimelineDetail } from "./analysisTimelineMaterialModel";

export type AnalysisTimelineTrackTone =
  | "shot"
  | "script"
  | "rhythm"
  | "packaging"
  | "slot"
  | "materialClass"
  | "materialFunction"
  | "materialProof"
  | "materialSequence";

export type AnalysisTimelineBlock = {
  id: string;
  label: string;
  start: number;
  end: number;
  frameUrls?: string[];
  shotBoundaryPercents?: number[];
  shotRangeLabel?: string | null;
  detail?: AnalysisTimelineSegmentDetail;
};

export type AnalysisTimelineTrack = {
  key: AnalysisTimelineTrackTone;
  label: string;
  emptyLabel: string;
  blocks: AnalysisTimelineBlock[];
};

export function resolveAnalysisTimelineTracks(item: AnalysisHistoryItem | null, modeHint: "material" | "structure" | null = null): { duration: number; subtitleBlocks: AnalysisTimelineBlock[]; tracks: AnalysisTimelineTrack[] } {
  const artifact = item?.artifact;
  const shots = artifact?.shotBoundaryAnalysis?.shots ?? [];
  const subtitles = artifact?.subtitles ?? null;
  const userMaterialPack = artifact?.userMaterialPack ?? null;
  const hasStructureResult = Boolean(artifact?.functionSlotAtomizationAnalysis || item?.hasFunctionSlotAtomization || modeHint === "structure");
  const shouldUseMaterialTimeline = Boolean(
    (modeHint === "material" || userMaterialPack || item?.hasUserMaterialPack)
      && !hasStructureResult,
  );
  const scriptSegments = artifact?.scriptSegmentAnalysis?.segments ?? [];
  const rhythmSections = artifact?.rhythmStructureAnalysis?.sections ?? [];
  const packagingBlocks = artifact?.packagingStructureAnalysis?.packagingBlocks ?? [];
  const slots = artifact?.functionSlotAtomizationAnalysis?.slotMap?.slots ?? [];
  const frames = artifact?.frames ?? [];
  const materialCardByShot = buildMaterialCardByShot(userMaterialPack?.shotCards);
  const shotMeta = buildShotTimelineMeta(shots);
  const shotBlocks = shots.map((shot) => ({
    id: shot.id,
    label: formatShotNo(shot.shotNo, shot.index),
    start: shot.start,
    end: shot.end,
    frameUrls: resolveShotFrameUrls(shot.start, shot.end, frames),
    detail: resolveShotTimelineDetail(shot, materialCardByShot.get(shot.id) ?? (shot.shotNo ? materialCardByShot.get(shot.shotNo) : undefined)),
  }));
  const subtitleBlocks = resolveSubtitleTimelineBlocks(subtitles);
  const materialTracks = shouldUseMaterialTimeline
    ? resolveMaterialTimelineTracks(userMaterialPack, shotMeta, shotBlocks)
    : null;
  const scriptBlocks = scriptSegments.map((segment) => ({
    id: segment.segmentId,
    label: segment.label,
    start: segment.start,
    end: segment.end,
    ...withStructureDetailMeta({
      id: segment.segmentId,
      tone: "script",
      label: segment.label,
      start: segment.start,
      end: segment.end,
      shotRefs: segment.shotRefs,
      shotMeta,
      summary: segment.roleInScript || segment.transferableRule || "这个脚本段还没有摘要。",
      fields: [
        { label: "脚本作用", value: segment.roleInScript },
        { label: "迁移规则", value: segment.transferableRule },
        { label: "证据", value: segment.evidence.join(" / ") },
      ],
    }),
  }));
  const rhythmBlocks = rhythmSections.map((section) => ({
    id: section.sectionId,
    label: section.label,
    start: section.start,
    end: section.end,
    ...withStructureDetailMeta({
      id: section.sectionId,
      tone: "rhythm",
      label: section.label,
      start: section.start,
      end: section.end,
      shotRefs: section.shotRefs,
      shotMeta,
      summary: fieldPreview(section.fields) || "这个节奏段还没有摘要。",
      fields: section.fields,
    }),
  }));
  const packagingTimelineBlocks = packagingBlocks.map((block) => ({
    id: block.blockId,
    label: block.label,
    start: block.start,
    end: block.end,
    ...withStructureDetailMeta({
      id: block.blockId,
      tone: "packaging",
      label: block.label,
      start: block.start,
      end: block.end,
      shotRefs: block.shotRefs,
      shotMeta,
      summary: block.packagingFunction || fieldPreview(block.fields) || "这个包装段还没有摘要。",
      fields: [
        { label: "包装作用", value: block.packagingFunction },
        ...block.fields,
      ],
    }),
  }));
  const slotBlocks = resolveSlotTimelineBlocks(slots, shots);
  const materialBlocks = materialTracks?.flatMap((track) => track.blocks) ?? [];
  const duration = Math.max(
    positiveTimelineNumber(artifact?.metadata.durationSeconds),
    maxTimelineEnd(shotBlocks),
    maxTimelineEnd(subtitleBlocks),
    maxTimelineEnd(materialBlocks),
    maxTimelineEnd(scriptBlocks),
    maxTimelineEnd(rhythmBlocks),
    maxTimelineEnd(packagingTimelineBlocks),
    maxTimelineEnd(slotBlocks),
    1,
  );

  return {
    duration,
    subtitleBlocks,
    tracks: materialTracks ?? [
      { key: "shot", label: "镜头轨", emptyLabel: "暂无切镜", blocks: shotBlocks },
      { key: "script", label: "脚本段", emptyLabel: "暂无脚本段", blocks: scriptBlocks },
      { key: "rhythm", label: "节奏段", emptyLabel: "暂无节奏段", blocks: rhythmBlocks },
      { key: "packaging", label: "包装段", emptyLabel: "暂无包装段", blocks: packagingTimelineBlocks },
      { key: "slot", label: "槽位段", emptyLabel: "暂无槽位段", blocks: slotBlocks },
    ],
  };
}

function resolveSubtitleTimelineBlocks(subtitles: NonNullable<AnalysisHistoryItem["artifact"]>["subtitles"] | null | undefined): AnalysisTimelineBlock[] {
  const sourceSegments = subtitles?.segments?.length
    ? subtitles.segments
    : subtitles?.utterances?.map((utterance, index) => ({
      id: `utterance_${index}_${utterance.start}`,
      start: utterance.start,
      end: utterance.end,
      text: utterance.text,
    })) ?? [];

  return sourceSegments
    .map((segment, index) => {
      const start = positiveTimelineNumber(segment.start);
      const rawEnd = positiveTimelineNumber(segment.end);
      const text = timelineDetailText(segment.text);
      const labelText = sanitizeText(segment.text, 96);
      const end = rawEnd > start ? rawEnd : start + estimateSubtitleDuration(text);
      const block: AnalysisTimelineBlock = {
        id: String(segment.id ?? `subtitle_${index}`),
        label: labelText || `字幕 ${index + 1}`,
        start,
        end,
        detail: {
          id: `subtitle:${String(segment.id ?? `subtitle_${index}`)}`,
          tone: "subtitle",
          title: text || `字幕 ${index + 1}`,
          timeLabel: `${formatTimelineTime(start)} - ${formatTimelineTime(end)}`,
          shotRangeLabel: null,
          summary: text || "这条字幕没有文本内容。",
          fields: [],
        },
      };
      return block;
    })
    .filter((block) => block.end > block.start)
    .sort((a, b) => a.start - b.start);
}

function estimateSubtitleDuration(text: string) {
  const length = Math.max(1, text.length);
  return Math.min(4, Math.max(1.2, length / 8));
}

function resolveSlotTimelineBlocks(
  slots: NonNullable<NonNullable<AnalysisHistoryItem["artifact"]>["functionSlotAtomizationAnalysis"]>["slotMap"]["slots"],
  shots: NonNullable<NonNullable<AnalysisHistoryItem["artifact"]>["shotBoundaryAnalysis"]>["shots"],
): AnalysisTimelineBlock[] {
  const shotByRef = new Map<string, { label: string; start: number; end: number }>();
  shots.forEach((shot) => {
    const value = { label: formatShotNo(shot.shotNo, shot.index), start: shot.start, end: shot.end };
    shotByRef.set(shot.id, value);
    if (shot.shotNo) shotByRef.set(shot.shotNo, value);
    shotByRef.set(value.label, value);
    shotByRef.set(String(shot.index + 1), value);
  });

  return slots.map((slot, index) => {
    const ranges = slot.sourceRefs.shotRefs
      .map((ref) => shotByRef.get(ref))
      .filter((range): range is { label: string; start: number; end: number } => Boolean(range));
    const start = ranges.length ? Math.min(...ranges.map((range) => range.start)) : index;
    const end = ranges.length ? Math.max(...ranges.map((range) => range.end)) : index + 1;
    const duration = Math.max(end - start, 0);
    const shotBoundaryPercents = ranges
      .sort((a, b) => a.start - b.start)
      .slice(1)
      .map((range) => duration ? clampTimelinePercent(((range.start - start) / duration) * 100) : 0)
      .filter((left) => left > 0 && left < 100);
    const shotRangeLabel = ranges.length ? formatShotRangeLabel(ranges.map((range) => range.label)) : formatShotRangeLabel(slot.sourceRefs.shotRefs);

    return {
      id: slot.slotId,
      label: slot.slotName,
      start,
      end,
      shotBoundaryPercents,
      shotRangeLabel,
      detail: {
        id: `slot:${slot.slotId}`,
        tone: "slot",
        title: slot.slotName,
        timeLabel: `${formatTimelineTime(start)} - ${formatTimelineTime(end)}`,
        shotRangeLabel,
        summary: slot.persuasionTask || slot.slotType || "这个槽位还没有摘要。",
        fields: compactTimelineDetailFields([
          { label: "槽位类型", value: slot.slotType },
          { label: "说服任务", value: slot.persuasionTask },
          { label: "观众状态前", value: slot.viewerStateBefore },
          { label: "观众状态后", value: slot.viewerStateAfter },
          { label: "同步点", value: slot.requiredSyncPoints.join(" / ") },
          { label: "替换规则", value: slot.substitutionRules.join(" / ") },
        ]),
      },
    };
  });
}

function withStructureDetailMeta({
  id,
  tone,
  label,
  start,
  end,
  shotRefs,
  shotMeta,
  summary,
  fields,
}: {
  id: string;
  tone: "script" | "rhythm" | "packaging";
  label: string;
  start: number;
  end: number;
  shotRefs: string[];
  shotMeta: Map<string, { index: number; label: string; start: number; end: number }>;
  summary: string;
  fields: Array<{ label: string; value: string }>;
}) {
  const shotRange = resolveStructureBlockShotMeta(shotRefs, shotMeta);
  return {
    ...shotRange,
    detail: {
      id: `${tone}:${id}`,
      tone,
      title: label,
      timeLabel: `${formatTimelineTime(start)} - ${formatTimelineTime(end)}`,
      shotRangeLabel: shotRange.shotRangeLabel,
      summary: timelineDetailText(summary),
      fields: compactTimelineDetailFields(fields),
    },
  };
}

export function compactTimelineDetailFields(fields: Array<{ label: string; value: string | null | undefined }>) {
  return fields
    .map((field) => ({
      label: field.label,
      value: timelineDetailText(field.value),
    }))
    .filter((field) => field.value);
}

export function timelineDetailText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function fieldPreview(fields: Array<{ label: string; value: string }> | null | undefined) {
  return fields?.map((field) => field.value).filter(Boolean).slice(0, 2).join(" / ") ?? "";
}

function formatShotRangeLabel(shotRefs: string[]) {
  const labels = shotRefs.map((ref, index) => formatShotNo(ref, index)).filter(Boolean);
  if (!labels.length) return null;
  return labels[0] === labels[labels.length - 1] ? labels[0] : `${labels[0]}-${labels[labels.length - 1]}`;
}

export function timelineBlockStyle(block: AnalysisTimelineBlock, duration: number): CSSProperties {
  const start = clampTimelinePercent((block.start / duration) * 100);
  const end = clampTimelinePercent((block.end / duration) * 100);
  const adjustedEnd = Math.max(start + 0.5, end);
  return {
    left: `calc(${start}% + var(--new-ui-analysis-block-gap) / 2)`,
    right: `calc(${100 - adjustedEnd}% + var(--new-ui-analysis-block-gap) / 2)`,
  };
}

function buildShotTimelineMeta(shots: NonNullable<NonNullable<AnalysisHistoryItem["artifact"]>["shotBoundaryAnalysis"]>["shots"]) {
  const byRef = new Map<string, { index: number; label: string; start: number; end: number }>();
  shots.forEach((shot) => {
    const label = formatShotNo(shot.shotNo, shot.index);
    const value = { index: shot.index, label, start: shot.start, end: shot.end };
    byRef.set(shot.id, value);
    byRef.set(label, value);
    if (shot.shotNo) byRef.set(shot.shotNo, value);
    byRef.set(String(shot.index + 1), value);
  });
  return byRef;
}

function resolveStructureBlockShotMeta(
  shotRefs: string[],
  shotMeta: Map<string, { index: number; label: string; start: number; end: number }>,
) {
  const shots = shotRefs
    .map((ref) => shotMeta.get(ref) ?? shotMeta.get(formatShotNo(ref, 0)))
    .filter((shot): shot is { index: number; label: string; start: number; end: number } => Boolean(shot))
    .sort((a, b) => a.index - b.index);
  if (!shots.length) return { shotBoundaryPercents: [], shotRangeLabel: null };

  const start = Math.min(...shots.map((shot) => shot.start));
  const end = Math.max(...shots.map((shot) => shot.end));
  const duration = Math.max(end - start, 0);
  const internalBoundaries = shots
    .slice(1)
    .map((shot) => duration ? clampTimelinePercent(((shot.start - start) / duration) * 100) : 0)
    .filter((left) => left > 0 && left < 100);
  const first = shots[0].label;
  const last = shots[shots.length - 1].label;
  return {
    shotBoundaryPercents: internalBoundaries,
    shotRangeLabel: first === last ? first : `${first}-${last}`,
  };
}

function resolveShotFrameUrls(start: number, end: number, frames: NonNullable<AnalysisHistoryItem["artifact"]>["frames"]) {
  const startTime = positiveTimelineNumber(start);
  const endTime = positiveTimelineNumber(end);
  const matched = frames
    .filter((frame) => {
      const timestamp = Number(frame.timestamp);
      if (!Number.isFinite(timestamp)) return false;
      return timestamp >= startTime && (timestamp < endTime || Math.abs(timestamp - endTime) < 0.001);
    })
    .map((frame) => runtimeUrl(frame.imageUri))
    .filter((url): url is string => Boolean(url));

  if (matched.length) return sampleShotFrameUrls(matched, 6);

  const middle = startTime + Math.max(0, endTime - startTime) / 2;
  let closest: { url: string; distance: number } | null = null;
  for (const frame of frames) {
    const timestamp = Number(frame.timestamp);
    const url = runtimeUrl(frame.imageUri);
    if (!Number.isFinite(timestamp) || !url) continue;
    const distance = Math.abs(timestamp - middle);
    if (!closest || distance < closest.distance) closest = { url, distance };
  }
  return closest ? [closest.url] : [];
}

function sampleShotFrameUrls(urls: string[], maxCount: number) {
  if (urls.length <= maxCount) return urls;
  if (maxCount <= 1) return [urls[Math.floor(urls.length / 2)]];
  return Array.from({ length: maxCount }, (_item, index) => urls[Math.round((index / (maxCount - 1)) * (urls.length - 1))]);
}

export function formatShotNo(value: string | null | undefined, index: number) {
  const text = String(value ?? "").trim();
  const shotNoMatch = /^S(\d+)$/i.exec(text);
  if (shotNoMatch) return `S${String(Number(shotNoMatch[1])).padStart(2, "0")}`;
  return `S${String(index + 1).padStart(2, "0")}`;
}

export function formatShotLabel(value: string) {
  return formatShotNo(value, 0);
}

export function timelineTickStyle(tick: number, duration: number): CSSProperties {
  return {
    left: `${clampTimelinePercent((tick / duration) * 100)}%`,
  };
}

export function timelineTimePercent(time: number, duration: number) {
  return clampTimelinePercent((positiveTimelineNumber(time) / duration) * 100);
}

export function resolveTimelinePointerTimeFromScale(element: HTMLElement, clientX: number, duration: number) {
  const rect = element.getBoundingClientRect();
  if (!rect.width) return 0;
  const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  return duration * ratio;
}

function maxTimelineEnd(blocks: AnalysisTimelineBlock[]) {
  return blocks.reduce((max, block) => Math.max(max, positiveTimelineNumber(block.end)), 0);
}

export function positiveTimelineNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function clampTimelinePercent(value: number) {
  return Math.min(100, Math.max(0, value));
}

export function resolveTimelineTicks(duration: number) {
  const end = Math.max(5, Math.ceil(duration / 5) * 5);
  const ticks: number[] = [];
  for (let second = 0; second <= end; second += 5) {
    ticks.push(second);
  }
  return ticks;
}

export function formatTimelineTime(value: number) {
  return formatSecondsCompact(value);
}

export function formatTimelineTick(value: number) {
  return `${Math.max(0, Math.round(value))}s`;
}
