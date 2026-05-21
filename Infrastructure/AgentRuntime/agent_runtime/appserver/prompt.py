from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any


DEFAULT_REVIEWER_INIT_PROMPT = (
    "你是当前 workstream 的 reviewer。"
    "严格遵守附带 skill 的规则，只审查收到的内容，不做调度，不代替 producer。"
    "除非 skill 明确允许，否则不要输出额外解释。"
)


def build_review_prompt(
    part_id: str,
    round_number: int,
    evidence_path: str | Path,
    *,
    shot_ids: list[int] | None = None,
    extra_instruction: str | None = None,
) -> str:
    evidence_text = Path(evidence_path).resolve().read_text(encoding="utf-8")
    return _build_clean_review_package_text(
        part_id=part_id,
        round_number=round_number,
        evidence_text=evidence_text,
        shot_ids=shot_ids,
        extra_instruction=extra_instruction,
    )


_REVIEW_TASK_SKIP_KEYS = {
    "profile_id",
    "review_kind",
    "reviewer_role",
    "producer_slot_id",
    "producer_thread_id",
    "round_index",
    "source_blocking_file",
    "source_motionstyle_file",
    "source_shot_ids",
}
_EVIDENCE_SKIP_KEYS = _REVIEW_TASK_SKIP_KEYS | {
    "group_id",
    "first_image_path",
    "image_paths",
    "job_id",
    "page_url",
}
_REVIEW_TASK_HEADINGS = {"# Review Task", "# 审查任务"}
_DROP_SECTION_HEADINGS = {"# Notes", "# 备注"}
_ID_RANGE_FIELD_KEYS = {
    "shot_ids",
    "core_shot_ids",
    "context_shot_ids",
    "target_shot_ids",
    "source_shot_ids",
    "issue_allowed_shot_ids",
    "issue_allowed_real_shot_ids",
}
_ID_RANGE_FIELD_RE = re.compile(
    r"^(?P<prefix>\s*-?\s*(?P<key>[A-Za-z_]*shot_ids)\s*[:=：]\s*)(?P<value>[^#\n\r]*?)(?P<suffix>\s*)$"
)


def _build_clean_review_package_text(
    *,
    part_id: str,
    round_number: int,
    evidence_text: str,
    shot_ids: list[int] | None,
    extra_instruction: str | None,
) -> str:
    lines = [
        f"part_id={str(part_id).strip()}",
        f"round={int(round_number)}",
        *([f"shot_ids={_format_id_ranges(shot_ids)}"] if shot_ids else []),
        "reviewer_output=final_json_only",
    ]
    extra_text = str(extra_instruction or "").strip()
    if extra_text:
        lines.extend(["", "## 额外指令", extra_text])
    producer_output, body_lines = _clean_evidence_lines(evidence_text)
    if producer_output:
        lines.extend(["", "## Producer Output", producer_output])
    if body_lines:
        lines.extend(["", *body_lines])
    else:
        lines.extend(["", "## Review Evidence", "- 未能从审查证据中解析到有效正文。"])
    return "\n".join(_collapse_blank_lines(lines)).strip()


def _clean_evidence_lines(evidence_text: str) -> tuple[str, list[str]]:
    producer_output = ""
    body_lines: list[str] = []
    in_review_task = False
    dropping_section = False
    for raw_line in str(evidence_text or "").splitlines():
        line = raw_line.rstrip()
        stripped = line.strip()
        if not stripped:
            if body_lines and body_lines[-1] != "":
                body_lines.append("")
            continue
        if stripped.startswith("# "):
            dropping_section = stripped in _DROP_SECTION_HEADINGS
            in_review_task = stripped in _REVIEW_TASK_HEADINGS
            if in_review_task or dropping_section:
                continue
            body_lines.append(stripped)
            continue
        if dropping_section:
            continue
        if in_review_task:
            key, value = _markdown_field(stripped)
            if key == "producer_output":
                producer_output = value if value and value != "<empty>" else ""
            continue
        key, _value = _markdown_field(stripped)
        if key in _EVIDENCE_SKIP_KEYS:
            continue
        if _line_exposes_path_payload(stripped):
            continue
        body_lines.append(line)
    return producer_output, _collapse_blank_lines(body_lines)


def _markdown_field(line: str) -> tuple[str, str]:
    match = re.match(r"^-\s*([^:：]+?)\s*[:：]\s*(.*?)\s*$", str(line or "").strip())
    if match is None:
        return "", ""
    return match.group(1).strip(), match.group(2).strip()


def _line_exposes_path_payload(line: str) -> bool:
    text = str(line or "")
    lowered = text.lower()
    return "image_paths" in lowered or "first_image_path" in lowered or lowered.startswith("- source_")


def _collapse_blank_lines(lines: list[str]) -> list[str]:
    collapsed: list[str] = []
    for line in lines:
        if line == "" and (not collapsed or collapsed[-1] == ""):
            continue
        collapsed.append(line)
    while collapsed and collapsed[-1] == "":
        collapsed.pop()
    return collapsed


def _format_id_ranges(ids: list[int] | None) -> str:
    ordered = sorted({int(item) for item in list(ids or [])})
    if not ordered:
        return "-"
    ranges: list[str] = []
    start = prev = ordered[0]
    for item in ordered[1:]:
        if item == prev + 1:
            prev = item
            continue
        ranges.append(str(start) if start == prev else f"{start}-{prev}")
        start = prev = item
    ranges.append(str(start) if start == prev else f"{start}-{prev}")
    return ",".join(ranges)


def _compact_id_range_fields(text: str) -> str:
    lines: list[str] = []
    for raw_line in str(text or "").splitlines():
        match = _ID_RANGE_FIELD_RE.match(raw_line)
        if match is None or match.group("key") not in _ID_RANGE_FIELD_KEYS:
            lines.append(raw_line)
            continue
        parsed = _parse_id_selection(match.group("value"))
        if not parsed:
            lines.append(raw_line)
            continue
        lines.append(f"{match.group('prefix')}{_format_id_ranges(parsed)}{match.group('suffix')}")
    return "\n".join(lines)


def _parse_id_selection(value: str) -> list[int]:
    ids: list[int] = []
    for token in re.findall(r"\d+(?:\s*-\s*\d+)?", str(value or "")):
        if "-" in token:
            left, right = [int(item.strip()) for item in token.split("-", 1)]
            if left <= right:
                ids.extend(range(left, right + 1))
            else:
                ids.extend(range(right, left + 1))
        else:
            ids.append(int(token))
    return ids


_FIRST_IMAGE_PATH_RE = re.compile(r"^-\s*first_image_path\s*[:=：]\s*(.+?)\s*$", re.M)
_GROUP_ID_RE = re.compile(r"^-\s*group_id\s*[:=：]\s*(.+?)\s*$", re.M)
_GROUP_HEADING_RE = re.compile(r"^##\s+Group\s+(.+?)\s*$", re.I)
_GROUP_BLOCK_RE = re.compile(r"^##\s+Group\s+(.+?)\s*\n(.*?)(?=^##\s+Group\s+|\Z)", re.I | re.M | re.S)
_IMAGE_PATHS_RE = re.compile(r"^-\s*image_paths\s*[:=：]\s*(.+?)\s*$", re.M)
_SOURCE_SHOT_IDS_RE = re.compile(r"^-\s*source_shot_ids\s*[:=：]\s*(.+?)\s*$", re.M)
_STORYBOARD_RESULTS_RE = re.compile(r"^# Storyboard Results\s*\n(.*?)(?=^# |\Z)", re.M | re.S)
_IMAGE_PATHS_INLINE_RE = re.compile(r"image_paths\s*=\s*(\[.*?\])")
_STORYBOARD_DETAIL_FIELD_RE = re.compile(r"^-\s*([^:：]+?)\s*[:：]\s*(.*?)\s*$")
_STORYBOARD_DETAIL_DROP_KEYS = {"image_paths", "first_image_path"}


def build_review_turn_inputs(
    part_id: str,
    round_number: int,
    evidence_path: str | Path,
    *,
    shot_ids: list[int] | None = None,
    extra_instruction: str | None = None,
) -> list[dict[str, Any]]:
    evidence_file = Path(evidence_path).resolve()
    evidence_text = evidence_file.read_text(encoding="utf-8")
    image_refs = _extract_review_image_refs(evidence_text)
    prompt_text = _build_clean_review_package_text(
        part_id=part_id,
        round_number=round_number,
        evidence_text=evidence_text,
        shot_ids=shot_ids,
        extra_instruction=extra_instruction,
    ).strip()
    inputs: list[dict[str, Any]] = [{"type": "text", "text": prompt_text, "text_elements": []}]
    for image_ref in image_refs:
        inputs.append({"type": "text", "text": _format_storyboard_group_caption(image_ref), "text_elements": []})
        inputs.append({"type": "localImage", "path": image_ref["path"]})
    return inputs


def _format_storyboard_group_caption(image_ref: dict[str, str]) -> str:
    basename = Path(image_ref["path"]).name
    return "\n".join(
        [
            f"# 故事板组 {image_ref['label']}",
            f"镜头：{image_ref.get('shot_ids') or '-'}",
            f"附图文件名：{basename}",
            "本组故事板图见下方附图。",
        ]
    )


def _extract_review_image_refs(evidence_text: str) -> list[dict[str, str]]:
    refs: list[dict[str, str]] = []
    seen: set[str] = set()
    section_match = _STORYBOARD_RESULTS_RE.search(evidence_text)
    search_text = section_match.group(1) if section_match is not None else evidence_text
    for block_match in _GROUP_BLOCK_RE.finditer(search_text):
        label = block_match.group(1).strip() or "current group"
        body = block_match.group(2)
        group_match = _GROUP_ID_RE.search(body)
        if group_match is not None:
            label = group_match.group(1).strip() or label
        shot_ids = ""
        source_shots_match = _SOURCE_SHOT_IDS_RE.search(body)
        if source_shots_match is not None:
            shot_ids = source_shots_match.group(1).strip()
        details: list[str] = []
        for raw_line in body.splitlines():
            line = raw_line.strip()
            detail_match = _STORYBOARD_DETAIL_FIELD_RE.match(line)
            if detail_match is None:
                continue
            detail_key = detail_match.group(1).strip()
            detail_value = detail_match.group(2).strip()
            if not detail_value:
                continue
            if detail_key in _STORYBOARD_DETAIL_DROP_KEYS or detail_key.startswith("group_id") or detail_key == "source_shot_ids":
                continue
            details.append(f"{detail_key}：{detail_value}")
        image_paths = _group_image_paths(body)
        for image_path in image_paths:
            if _append_image_ref(refs, seen, label, shot_ids, "\n".join(details), image_path):
                break
    return refs


def _group_image_paths(group_body: str) -> list[str]:
    first_match = _FIRST_IMAGE_PATH_RE.search(group_body)
    candidates: list[str] = []
    if first_match is not None:
        candidates.append(first_match.group(1))
    for image_paths_match in _IMAGE_PATHS_RE.finditer(group_body):
        candidates.extend(_first_existing_path_from_json_list(image_paths_match.group(1)))
    for inline_image_match in _IMAGE_PATHS_INLINE_RE.finditer(group_body):
        candidates.extend(_first_existing_path_from_json_list(inline_image_match.group(1)))
    return candidates


def _append_image_ref(refs: list[dict[str, str]], seen: set[str], label: str, shot_ids: str, details: str, raw_path: str) -> bool:
    value = str(raw_path or "").strip().strip("`").strip()
    if not value or value == "<missing>":
        return False
    candidate = Path(value).resolve()
    if not candidate.exists():
        return False
    normalized = str(candidate)
    if normalized in seen:
        return False
    seen.add(normalized)
    refs.append(
        {
            "label": str(label or "current group").strip(),
            "shot_ids": str(shot_ids or "").strip(),
            "details": str(details or "").strip(),
            "path": normalized,
        }
    )
    return True


def _first_existing_path_from_json_list(raw_value: str) -> list[str]:
    value = str(raw_value or "").strip()
    if not value.startswith("["):
        return [value] if value else []
    try:
        payload = json.loads(value)
    except json.JSONDecodeError:
        return []
    if not isinstance(payload, list):
        return []
    return [str(item).strip() for item in payload if str(item).strip()]


def build_produce_prompt(
    part_id: str,
    round_number: int,
    *,
    shot_ids: list[int],
    context_lines: list[str] | None = None,
    extra_instruction: str | None = None,
) -> str:
    lines = [
        f"part_id={str(part_id).strip()}",
        f"round={int(round_number)}",
        f"shot_ids={_format_id_ranges(shot_ids)}",
    ]
    for item in list(context_lines or []):
        text = _compact_id_range_fields(str(item).strip())
        if text:
            lines.append(text)
    extra_text = str(extra_instruction or "").strip()
    if extra_text:
        lines.append(_compact_id_range_fields(extra_text))
    return "\n".join(lines)
