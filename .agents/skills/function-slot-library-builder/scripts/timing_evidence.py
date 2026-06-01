#!/usr/bin/env python3
"""Helpers for rhythm timing evidence in FunctionSlotLibrary."""
from __future__ import annotations

import re
from statistics import mean, median
from typing import Any, Dict, List


PUNCTUATION_RE = re.compile(r"[\s，。！？、,.!?;；:：\"'“”‘’（）()\[\]【】《》<>…—\-]")


def count_dialogue_chars(text: Any) -> int:
    return len(PUNCTUATION_RE.sub("", str(text or "")))


def normalize_number(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number:
        return None
    return round(number, 3)


def normalize_timing_evidence(value: Any) -> Dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    shot_timings = [
        normalize_shot_timing(item)
        for item in value.get("shotTimings", []) or []
        if isinstance(item, dict)
    ]
    shot_timings = [item for item in shot_timings if item is not None]
    total = normalize_number(value.get("totalDurationSec"))
    if total is None and shot_timings:
        total = round(sum(item.get("durationSec") or 0 for item in shot_timings), 3)
    subtitle_char_count = value.get("subtitleCharCount")
    if not isinstance(subtitle_char_count, int):
        subtitle_char_count = sum(item.get("subtitleCharCount") or 0 for item in shot_timings)
    dialogue_density = normalize_number(value.get("dialogueCharsPerSec"))
    if dialogue_density is None and total and total > 0:
        dialogue_density = round(subtitle_char_count / total, 3)
    durations = [item["durationSec"] for item in shot_timings if item.get("durationSec") is not None]
    return {
        "schemaVersion": str(value.get("schemaVersion") or "rhythm_timing_evidence.v1"),
        "source": str(value.get("source") or "function_slot_library"),
        "sourceShotRefs": [item["shotRef"] for item in shot_timings if item.get("shotRef")],
        "shotCount": len(shot_timings),
        "totalDurationSec": total,
        "minShotDurationSec": round(min(durations), 3) if durations else None,
        "maxShotDurationSec": round(max(durations), 3) if durations else None,
        "avgShotDurationSec": round(mean(durations), 3) if durations else None,
        "medianShotDurationSec": round(median(durations), 3) if durations else None,
        "subtitleCharCount": subtitle_char_count,
        "dialogueCharsPerSec": dialogue_density,
        "derivedPace": str(value.get("derivedPace") or derive_pace(durations, total)),
        "shotTimings": shot_timings,
    }


def normalize_shot_timing(value: Dict[str, Any]) -> Dict[str, Any] | None:
    shot_ref = str(value.get("shotRef") or value.get("shotId") or "").strip()
    if not shot_ref:
        return None
    start = normalize_number(value.get("start"))
    end = normalize_number(value.get("end"))
    duration = normalize_number(value.get("durationSec"))
    if duration is None and start is not None and end is not None:
        duration = round(max(0, end - start), 3)
    subtitle_text = str(value.get("subtitleText") or "").strip()
    char_count = value.get("subtitleCharCount")
    if not isinstance(char_count, int):
        char_count = count_dialogue_chars(subtitle_text)
    return {
        "shotRef": shot_ref,
        "start": start,
        "end": end,
        "durationSec": duration,
        "subtitleText": subtitle_text,
        "subtitleCharCount": char_count,
    }


def build_timing_evidence(shot_refs: List[str], shots: Dict[str, Dict[str, Any]], subtitles: List[Dict[str, Any]]) -> Dict[str, Any] | None:
    shot_timings = []
    for shot_ref in shot_refs:
        shot = shots.get(str(shot_ref))
        if not shot:
            continue
        start = normalize_number(shot.get("start"))
        end = normalize_number(shot.get("end"))
        subtitle_text = subtitle_text_for_window(subtitles, start, end)
        shot_timings.append({
            "shotRef": str(shot_ref),
            "start": start,
            "end": end,
            "durationSec": round(max(0, (end or 0) - (start or 0)), 3) if start is not None and end is not None else None,
            "subtitleText": subtitle_text,
            "subtitleCharCount": count_dialogue_chars(subtitle_text),
        })
    if not shot_timings:
        return None
    return normalize_timing_evidence({
        "schemaVersion": "rhythm_timing_evidence.v1",
        "source": "runtime_artifact_shot_boundary_subtitles",
        "shotTimings": shot_timings,
    })


def subtitle_text_for_window(subtitles: List[Dict[str, Any]], start: float | None, end: float | None) -> str:
    if start is None or end is None:
        return ""
    texts = []
    for segment in subtitles:
        seg_start = normalize_number(segment.get("start"))
        seg_end = normalize_number(segment.get("end"))
        if seg_start is None or seg_end is None:
            continue
        if seg_end <= start or seg_start >= end:
            continue
        text = str(segment.get("text") or "").strip()
        if text:
            texts.append(text)
    return " ".join(texts)


def derive_pace(durations: List[float], total: float | None = None) -> str:
    if not durations:
        return "unknown"
    avg = mean(durations)
    if avg <= 1.2:
        return "fast"
    if avg <= 2.4:
        return "medium"
    return "slow"
