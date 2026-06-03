#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


SHOT_SECTION_RE = re.compile(r"(^##\s+(?:\d+\.\s+)?Shot 设计\s*\n)(.*?)(?=^##\s+|\Z)", re.M | re.S)
COVER_SECTION_RE = re.compile(r"^##\s+(?:\d+\.\s+)?封面生图提示词\s*\n(.*?)(?=^##\s+|\Z)", re.M | re.S)
TABLE_ROW_RE = re.compile(r"^\|(.+)\|\s*$")
DEFAULT_GROUP_SIZE = 4
DEFAULT_CHARS_PER_SECOND = 6.0
STRATEGY_COLUMN = "素材来源/处理策略"
SELF_DESIGNED_STRATEGY = "self_designed_by_shot_design"
KNOWN_STRATEGIES = {
    "existing_material",
    "existing_material_packaging_caption",
    SELF_DESIGNED_STRATEGY,
    "reuse_transformed_fallback",
}
PLACEHOLDER_DURATION_VALUES = {
    "",
    "待估算",
    "待后置估算",
    "待后置回填",
}


def main() -> None:
    configure_stdio()
    parser = argparse.ArgumentParser(description="Prepare storyboard prompts from shot-design.final.md")
    parser.add_argument("--input", required=True, help="Path to shot-design.final.md")
    parser.add_argument("--output", help="Output storyboard prompt markdown path")
    parser.add_argument("--manifest-output", help="Output storyboard manifest JSON path")
    parser.add_argument("--group-size", type=int, default=DEFAULT_GROUP_SIZE)
    parser.add_argument("--chars-per-second", type=float, default=DEFAULT_CHARS_PER_SECOND)
    parser.add_argument("--duration-script", help="Optional estimate_dialogue_duration.py path")
    parser.add_argument("--no-write-back", action="store_true", help="Do not update the input markdown duration column")
    parser.add_argument("--pretty", action="store_true")
    args = parser.parse_args()

    input_path = Path(args.input).resolve()
    output_path = Path(args.output).resolve() if args.output else input_path.with_name("shot-storyboard-prompts.md")
    manifest_path = Path(args.manifest_output).resolve() if args.manifest_output else input_path.with_name("shot-storyboard-manifest.json")
    if args.group_size <= 0:
      raise ValueError("--group-size must be greater than 0")
    if args.chars_per_second <= 0:
      raise ValueError("--chars-per-second must be greater than 0")

    text = input_path.read_text(encoding="utf-8-sig")
    aspect = detect_aspect(text)
    cover = extract_cover_prompt(text, aspect)
    section = extract_shot_section(text)
    table = parse_markdown_table(section["body"])
    estimates = estimate_durations(table["rows"], args.chars_per_second, resolve_duration_script(args.duration_script))
    rows = apply_duration_estimates(table["rows"], estimates, args.chars_per_second)
    duration_stats = duration_update_stats(table["rows"], rows)
    storyboard_plan = build_storyboard_plan(rows, aspect, args.group_size, input_path, output_path, cover)

    if not args.no_write_back:
        updated_section_body = replace_table_rows(section["body"], table, rows)
        updated_text = text[: section["body_start"]] + updated_section_body + text[section["body_end"] :]
        input_path.write_text(updated_text, encoding="utf-8")

    output_path.write_text(render_storyboard_markdown(storyboard_plan, input_path), encoding="utf-8")
    manifest_path.write_text(json.dumps(storyboard_plan, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    result = {
        "input": str(input_path),
        "output": str(output_path),
        "manifest": str(manifest_path),
        "updatedInput": None if args.no_write_back else str(input_path),
        "shotCount": len(rows),
        "hasCover": storyboard_plan.get("cover") is not None,
        "generatedShotCount": sum(1 for shot in storyboard_plan["shots"] if shot["shouldGenerate"]),
        "materialShotCount": sum(1 for shot in storyboard_plan["shots"] if not shot["shouldGenerate"]),
        "groupSize": args.group_size,
        "groupCount": len(storyboard_plan["storyboardGroups"]),
        "aspect": aspect,
        "warnings": storyboard_plan["warnings"],
        **duration_stats,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2 if args.pretty else None))


def configure_stdio() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")


def detect_aspect(text: str) -> dict[str, str | None]:
    patterns = [
        (r"9\s*:\s*16", "9:16", "竖屏"),
        (r"16\s*:\s*9", "16:9", "横屏"),
        (r"竖屏|竖版", "9:16", "竖屏"),
        (r"横屏|横版", "16:9", "横屏"),
    ]
    for pattern, ratio, orientation in patterns:
        match = re.search(pattern, text, re.I)
        if match:
            return {"ratio": ratio, "orientation": orientation, "source": match.group(0)}
    return {"ratio": None, "orientation": "未明确", "source": None}


def extract_shot_section(text: str) -> dict[str, Any]:
    match = SHOT_SECTION_RE.search(text)
    if not match:
        raise ValueError("Cannot find '## Shot 设计' section")
    return {
        "body": match.group(2),
        "body_start": match.start(2),
        "body_end": match.end(2),
    }


def extract_cover_prompt(text: str, aspect: dict[str, str | None]) -> dict[str, Any] | None:
    match = COVER_SECTION_RE.search(text)
    if not match:
        return None
    try:
        table = parse_key_value_table(match.group(1))
    except ValueError:
        return {
            "coverId": "cover_image",
            "aspect": aspect,
            "purpose": "",
            "coreSellingPoint": "",
            "subjectAndScene": "",
            "visualFocus": "",
            "imagePrompt": "",
            "overlayPackaging": "",
            "avoid": "",
            "warnings": ["封面生图提示词区块存在，但无法解析两列表"],
        }
    cover = {
        "coverId": "cover_image",
        "aspect": aspect,
        "purpose": table.get("封面用途", ""),
        "coreSellingPoint": table.get("核心卖点", ""),
        "subjectAndScene": table.get("主体与场景", ""),
        "visualFocus": table.get("情绪与视觉重点", ""),
        "imagePrompt": table.get("生图提示词", ""),
        "overlayPackaging": table.get("包装文字建议", ""),
        "avoid": table.get("避免项", ""),
        "warnings": [],
    }
    cover["aspectRaw"] = table.get("画幅", "")
    if not cover["imagePrompt"]:
        cover["warnings"].append("封面生图提示词缺少“生图提示词”内容")
    return cover


def parse_key_value_table(section_body: str) -> dict[str, str]:
    row_entries = []
    for line in section_body.splitlines():
        match = TABLE_ROW_RE.match(line.strip())
        if not match:
            continue
        cells = [cell.strip() for cell in split_markdown_row(line)]
        if len(cells) >= 2:
            row_entries.append(cells)
    if len(row_entries) < 3:
        raise ValueError("Cover key-value table not found")
    header = row_entries[0]
    result = {}
    for cells in row_entries[2:]:
        key = str(cells[0] if len(cells) > 0 else "").strip()
        value = str(cells[1] if len(cells) > 1 else "").strip()
        if key:
            result[key] = value
    return result


def parse_markdown_table(section_body: str) -> dict[str, Any]:
    lines = section_body.splitlines()
    row_entries = []
    for index, line in enumerate(lines):
        match = TABLE_ROW_RE.match(line.strip())
        if match:
            cells = split_markdown_row(line)
            row_entries.append({"index": index, "line": line, "cells": cells})
    header_entry = next((entry for entry in row_entries if "shot" in [cell.strip() for cell in entry["cells"]]), None)
    if not header_entry:
        raise ValueError("Shot table header not found")
    header = [cell.strip() for cell in header_entry["cells"]]
    separator_index = header_entry["index"] + 1
    data_entries = [
        entry for entry in row_entries
        if entry["index"] > separator_index and len(entry["cells"]) == len(header)
    ]
    rows = []
    for entry in data_entries:
        row = {header[cell_index]: entry["cells"][cell_index].strip() for cell_index in range(len(header))}
        rows.append(row)
    return {"lines": lines, "header": header, "headerIndex": header_entry["index"], "rows": rows, "dataEntries": data_entries}


def split_markdown_row(line: str) -> list[str]:
    stripped = line.strip()
    if stripped.startswith("|"):
        stripped = stripped[1:]
    if stripped.endswith("|"):
        stripped = stripped[:-1]
    cells = []
    current = []
    escaped = False
    for char in stripped:
        if char == "\\" and not escaped:
            escaped = True
            current.append(char)
            continue
        if char == "|" and not escaped:
            cells.append("".join(current))
            current = []
        else:
            current.append(char)
        escaped = False
    cells.append("".join(current))
    return cells


def estimate_durations(rows: list[dict[str, str]], chars_per_second: float, duration_script: Path | None) -> dict[str, str]:
    if duration_script and duration_script.exists():
        payload = json.dumps(rows, ensure_ascii=False)
        temp_path = None
        try:
            import tempfile

            with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".json", delete=False) as handle:
                temp_path = Path(handle.name)
                handle.write(payload)
            completed = subprocess.run(
                [
                    sys.executable,
                    str(duration_script),
                    "--file",
                    str(temp_path),
                    "--shot-json",
                    "--chars-per-second",
                    str(chars_per_second),
                ],
                check=True,
                capture_output=True,
                text=True,
                encoding="utf-8",
            )
            parsed = json.loads(completed.stdout)
            return {
                str(item.get("shot") or ""): str(item.get("row", {}).get("预计时长") or item.get("预计时长") or "")
                for item in list(parsed.get("items") or [])
            }
        finally:
            if temp_path:
                try:
                    temp_path.unlink()
                except OSError:
                    pass
    return {row.get("shot", ""): fallback_duration(row.get("台词/字幕（若有）", ""), chars_per_second) for row in rows}


def resolve_duration_script(explicit: str | None) -> Path | None:
    if explicit:
        return Path(explicit).resolve()
    current = Path(__file__).resolve()
    candidate = current.parents[2] / "function-slot-restructure" / "scripts" / "estimate_dialogue_duration.py"
    return candidate if candidate.exists() else None


def fallback_duration(dialogue: str, chars_per_second: float) -> str:
    text = str(dialogue or "").strip()
    if not text or text == "无":
        return "待无台词时长说明"
    cleaned = re.sub(r"\s+", "", text)
    cleaned = re.sub(r"[，。！？、,.!?;；:：\"'“”‘’（）()\[\]【】《》<>…—\-]", "", cleaned)
    seconds = round(len(cleaned) / chars_per_second, 2)
    return f"约 {seconds}s（{len(cleaned)} 字 / {chars_per_second:g} 字每秒）"


def needs_duration_estimate(value: str | None) -> bool:
    normalized = str(value or "").strip()
    if normalized in PLACEHOLDER_DURATION_VALUES:
        return True
    return bool(re.fullmatch(r"待.*估算", normalized))


def apply_duration_estimates(rows: list[dict[str, str]], estimates: dict[str, str], chars_per_second: float) -> list[dict[str, str]]:
    updated = []
    for row in rows:
        next_row = dict(row)
        shot = str(row.get("shot") or "")
        current_duration = row.get("预计时长", "")
        if needs_duration_estimate(current_duration):
            next_row["预计时长"] = estimates.get(shot) or fallback_duration(row.get("台词/字幕（若有）", ""), chars_per_second)
        else:
            next_row["预计时长"] = current_duration
        updated.append(next_row)
    return updated


def duration_update_stats(original_rows: list[dict[str, str]], updated_rows: list[dict[str, str]]) -> dict[str, int]:
    updated_count = 0
    preserved_count = 0
    for original, updated in zip(original_rows, updated_rows):
        if str(original.get("预计时长", "")).strip() == str(updated.get("预计时长", "")).strip():
            preserved_count += 1
        else:
            updated_count += 1
    return {
        "durationUpdatedCount": updated_count,
        "durationPreservedCount": preserved_count,
    }


def replace_table_rows(section_body: str, table: dict[str, Any], rows: list[dict[str, str]]) -> str:
    lines = list(table["lines"])
    header = table["header"]
    for entry, row in zip(table["dataEntries"], rows):
        lines[entry["index"]] = "| " + " | ".join(row.get(column, "") for column in header) + " |"
    return "\n".join(lines) + ("\n" if section_body.endswith("\n") else "")


def build_storyboard_plan(rows: list[dict[str, str]], aspect: dict[str, str | None], group_size: int, source_path: Path, prompt_path: Path, cover: dict[str, Any] | None = None) -> dict[str, Any]:
    has_strategy_column = any(STRATEGY_COLUMN in row for row in rows)
    warnings = []
    shots = []
    generated_rows = []
    for row in rows:
        strategy_info = parse_strategy(row.get(STRATEGY_COLUMN, ""))
        if has_strategy_column:
            should_generate = strategy_info["strategy"] == SELF_DESIGNED_STRATEGY
        else:
            should_generate = True
            strategy_info = {
                **strategy_info,
                "strategy": "legacy_unclassified",
                "sourceRefs": [],
            }
        if has_strategy_column and not strategy_info["strategy"]:
            warnings.append(f"{row.get('shot', '')}: 素材来源/处理策略未识别，已排除生图 prompt")
        shot = {
            "shotId": row.get("shot", ""),
            "slotSubtype": row.get("slotSubtype 对齐", ""),
            "slotKey": parse_slot_key(row.get("slotSubtype 对齐", "")),
            "strategy": strategy_info["strategy"],
            "strategyRaw": row.get(STRATEGY_COLUMN, ""),
            "sourceRefs": strategy_info["sourceRefs"],
            "shouldGenerate": should_generate,
            "scriptSegment": row.get("脚本段落", ""),
            "rhythmRange": row.get("节奏区间", ""),
            "packagingBlock": row.get("包装块", ""),
            "imagePrompt": row.get("分镜画面", ""),
            "overlayPackaging": row.get("包装说明", ""),
            "dialogue": row.get("台词/字幕（若有）", ""),
            "duration": row.get("预计时长", ""),
            "syncPoint": row.get("必须同步点", ""),
            "proofFunction": row.get("证明功能", ""),
        }
        shots.append(shot)
        if should_generate:
            generated_rows.append(row)
    if not has_strategy_column:
        warnings.append("Shot 表缺少“素材来源/处理策略”列，已按 legacy 行为把所有 shot 写入生图 prompt")

    groups = build_storyboard_groups(generated_rows, group_size)
    if cover:
        warnings.extend(cover.get("warnings") or [])
        if cover.get("imagePrompt"):
            groups.insert(0, build_cover_storyboard_group(cover))
    return {
        "type": "shot-storyboard-prep-manifest",
        "schemaVersion": "shot-storyboard-prep.manifest.v1",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "source": {
            "shotDesignFinalPath": str(source_path),
            "storyboardPromptPath": str(prompt_path),
        },
        "aspect": aspect,
        "cover": cover,
        "groupSize": group_size,
        "warnings": warnings,
        "shots": shots,
        "storyboardGroups": groups,
    }


def parse_strategy(value: str) -> dict[str, Any]:
    text = str(value or "").strip().replace("`", "")
    strategy = None
    for candidate in KNOWN_STRATEGIES:
        if re.search(rf"(^|[^A-Za-z0-9_]){re.escape(candidate)}([^A-Za-z0-9_]|$)", text):
            strategy = candidate
            break
    source_refs = []
    for match in re.finditer(r"\b(?:shot|group)_[A-Za-z0-9_\-]+\b", text):
        ref = match.group(0)
        if ref not in source_refs:
            source_refs.append(ref)
    return {
        "strategy": strategy,
        "sourceRefs": source_refs,
    }


def parse_slot_key(value: str) -> str:
    text = str(value or "").strip()
    match = re.search(r"`([^`]*SUB_[^`]*)`", text)
    if match:
        return match.group(1).strip()
    match = re.search(r"\bSUB_[A-Za-z0-9_]+\b", text)
    if match:
        return match.group(0)
    return text.split()[0] if text.split() else "未标明 slot"


def build_storyboard_groups(rows: list[dict[str, str]], group_size: int) -> list[dict[str, Any]]:
    groups = []
    for group_index, start in enumerate(range(0, len(rows), group_size), 1):
        group_rows = pad_storyboard_group(rows[start : start + group_size], group_size, start)
        groups.append({
            "groupId": f"storyboard-group-{group_index:02d}",
            "title": f"{group_index:02d}",
            "shots": [
                {
                    "shotId": row.get("shot", ""),
                    "cellIndex": cell_index + 1,
                    "isPad": str(row.get("shot", "")).startswith("storyboard_blank_pad_"),
                    "imagePrompt": row.get("分镜画面", ""),
                    "overlayPackaging": row.get("包装说明", ""),
                }
                for cell_index, row in enumerate(group_rows)
            ],
        })
    return groups


def build_cover_storyboard_group(cover: dict[str, Any]) -> dict[str, Any]:
    return {
        "groupId": "storyboard-cover",
        "title": "Cover",
        "isCover": True,
        "shots": [{
            "shotId": cover.get("coverId") or "cover_image",
            "cellIndex": 1,
            "isPad": False,
            "isCover": True,
            "imagePrompt": cover.get("imagePrompt", ""),
            "overlayPackaging": cover.get("overlayPackaging", ""),
        }],
    }


def render_storyboard_markdown(storyboard_plan: dict[str, Any], source_path: Path) -> str:
    aspect = storyboard_plan["aspect"]
    ratio = aspect.get("ratio") or "未明确"
    orientation = aspect.get("orientation") or "未明确"
    reference_image_path = layout_reference_image_path(aspect)
    lines = [
        "# Shot Storyboard Prompts",
        "",
        f"来源：`{source_path}`",
        f"画幅：{ratio} {orientation}".strip(),
        f"referenceImagePath: {reference_image_path}" if reference_image_path else "referenceImagePath: 未明确",
        "参考图说明：参考此四格布局图在对应位置绘制四个镜头；不要生成红线、image1/image2/image3/image4 标签、参考图文字或占位线。",
        "",
    ]
    for group in storyboard_plan["storyboardGroups"]:
        if group.get("isCover"):
            cover = storyboard_plan.get("cover") or {}
            lines.extend([
                "## Storyboard Group Cover",
                "",
                f"以单张封面呈现，比例为{ratio}，{orientation}。",
                "这是短视频封面首图，不是普通分镜帧；画面要清晰呈现主体、产品状态和核心视觉重点。",
                "封面可有标题字/标签等包装层，但不要新增未在方案中确认的功效、价格、保证或证据结论。",
                "生成一张完整封面图；不要生成四格故事板、红线、image 标签或占位线。",
                f"核心卖点：{cover.get('coreSellingPoint') or '未填写'}",
                f"视觉重点：{cover.get('visualFocus') or '未填写'}",
                f"避免项：{cover.get('avoid') or '无'}",
                "referenceImagePath: 未明确",
                "",
            ])
            for row in group["shots"]:
                lines.extend([
                    f"### {row.get('shotId', 'cover_image')}",
                    f"- imagePrompt: {row.get('imagePrompt', '')}",
                    f"- overlayPackaging: {row.get('overlayPackaging', '')}",
                    "",
                ])
            continue
        lines.extend([
            f"## Storyboard Group {group['title']}",
            "",
            f"以故事板呈现以下镜头，比例为{ratio}，{orientation}。",
            "本组四个镜头作为独立故事板生成；人物、产品、场景在本组内保持大致一致即可。",
            "这是短视频分镜示例帧，不是广告海报、电商主图或最终包装成片；画面应像真实拍摄截图/样张，低设计感、自然光、轻量标注。",
            "overlayPackaging 是画面上的包装覆盖层/分镜标注参考，可轻量呈现；不要把整张图设计成宣传海报。",
            f"referenceImagePath: {reference_image_path}" if reference_image_path else "referenceImagePath: 未明确",
            "参考图说明：只参考四格位置安排；最终画面不要出现红线、image1/image2/image3/image4 标签或任何参考图文字。",
            "",
        ])
        for row in group["shots"]:
            shot = row.get("shotId", "")
            image_prompt = row.get("imagePrompt", "")
            overlay = row.get("overlayPackaging", "")
            lines.extend([
                f"### {shot}",
                f"- imagePrompt: {image_prompt}",
                f"- overlayPackaging: {overlay}",
                "",
            ])
    return "\n".join(lines).rstrip() + "\n"


def layout_reference_image_path(aspect: dict[str, str | None]) -> str | None:
    assets_dir = Path(__file__).resolve().parents[1] / "assets"
    ratio = aspect.get("ratio")
    orientation = aspect.get("orientation")
    if ratio == "9:16" or orientation == "竖屏":
        return str((assets_dir / "storyboard-layout-9x16-4grid.png").resolve())
    if ratio == "16:9" or orientation == "横屏":
        return str((assets_dir / "storyboard-layout-16x9-4grid.png").resolve())
    return None


def pad_storyboard_group(rows: list[dict[str, str]], group_size: int, start_index: int) -> list[dict[str, str]]:
    padded = list(rows)
    while padded and len(padded) < group_size:
        pad_number = start_index + len(padded) + 1
        padded.append({
            "shot": f"storyboard_blank_pad_{pad_number:02d}",
            "分镜画面": "纯白空白画面，用于故事板占位保持四格比例；没有人物、产品、文字、图标或包装元素",
            "包装说明": "无",
        })
    return padded


if __name__ == "__main__":
    main()
