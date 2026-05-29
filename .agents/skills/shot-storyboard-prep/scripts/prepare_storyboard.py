#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
import re
import subprocess
import sys
from pathlib import Path
from typing import Any


SHOT_SECTION_RE = re.compile(r"(^## 8\.\s+Shot 设计\s*\n)(.*?)(?=^## \d+\.|\Z)", re.M | re.S)
TABLE_ROW_RE = re.compile(r"^\|(.+)\|\s*$")
DEFAULT_GROUP_SIZE = 4
DEFAULT_CHARS_PER_SECOND = 6.0


def main() -> None:
    configure_stdio()
    parser = argparse.ArgumentParser(description="Prepare storyboard prompts from restructure.final.md")
    parser.add_argument("--input", required=True, help="Path to restructure.final.md")
    parser.add_argument("--output", help="Output storyboard prompt markdown path")
    parser.add_argument("--group-size", type=int, default=DEFAULT_GROUP_SIZE)
    parser.add_argument("--chars-per-second", type=float, default=DEFAULT_CHARS_PER_SECOND)
    parser.add_argument("--duration-script", help="Optional estimate_dialogue_duration.py path")
    parser.add_argument("--no-write-back", action="store_true", help="Do not update the input markdown duration column")
    parser.add_argument("--pretty", action="store_true")
    args = parser.parse_args()

    input_path = Path(args.input).resolve()
    output_path = Path(args.output).resolve() if args.output else input_path.with_name("shot-storyboard-prompts.md")
    if args.group_size <= 0:
      raise ValueError("--group-size must be greater than 0")
    if args.chars_per_second <= 0:
      raise ValueError("--chars-per-second must be greater than 0")

    text = input_path.read_text(encoding="utf-8-sig")
    aspect = detect_aspect(text)
    section = extract_shot_section(text)
    table = parse_markdown_table(section["body"])
    estimates = estimate_durations(table["rows"], args.chars_per_second, resolve_duration_script(args.duration_script))
    rows = apply_duration_estimates(table["rows"], estimates, args.chars_per_second)

    if not args.no_write_back:
        updated_section_body = replace_table_rows(section["body"], table, rows)
        updated_text = text[: section["body_start"]] + updated_section_body + text[section["body_end"] :]
        input_path.write_text(updated_text, encoding="utf-8")

    output_path.write_text(render_storyboard_markdown(rows, aspect, args.group_size, input_path), encoding="utf-8")
    result = {
        "input": str(input_path),
        "output": str(output_path),
        "updatedInput": None if args.no_write_back else str(input_path),
        "shotCount": len(rows),
        "groupSize": args.group_size,
        "groupCount": math.ceil(len(rows) / args.group_size) if rows else 0,
        "aspect": aspect,
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
        raise ValueError("Cannot find '## 8. Shot 设计' section")
    return {
        "body": match.group(2),
        "body_start": match.start(2),
        "body_end": match.end(2),
    }


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


def apply_duration_estimates(rows: list[dict[str, str]], estimates: dict[str, str], chars_per_second: float) -> list[dict[str, str]]:
    updated = []
    for row in rows:
        next_row = dict(row)
        shot = str(row.get("shot") or "")
        next_row["预计时长"] = estimates.get(shot) or fallback_duration(row.get("台词/字幕（若有）", ""), chars_per_second)
        updated.append(next_row)
    return updated


def replace_table_rows(section_body: str, table: dict[str, Any], rows: list[dict[str, str]]) -> str:
    lines = list(table["lines"])
    header = table["header"]
    for entry, row in zip(table["dataEntries"], rows):
        lines[entry["index"]] = "| " + " | ".join(row.get(column, "") for column in header) + " |"
    return "\n".join(lines) + ("\n" if section_body.endswith("\n") else "")


def render_storyboard_markdown(rows: list[dict[str, str]], aspect: dict[str, str | None], group_size: int, source_path: Path) -> str:
    ratio = aspect.get("ratio") or "未明确"
    orientation = aspect.get("orientation") or "未明确"
    lines = [
        "# Shot Storyboard Prompts",
        "",
        f"来源：`{source_path}`",
        f"画幅：{ratio} {orientation}".strip(),
        "",
    ]
    for group_index, start in enumerate(range(0, len(rows), group_size), 1):
        group_rows = pad_storyboard_group(rows[start : start + group_size], group_size, start)
        lines.extend([
            f"## Storyboard Group {group_index:02d}",
            "",
            f"以故事板呈现以下镜头，比例为{ratio}，{orientation}。",
            "",
        ])
        for row in group_rows:
            shot = row.get("shot", "")
            image_prompt = row.get("分镜画面", "")
            overlay = row.get("包装说明", "")
            lines.extend([
                f"### {shot}",
                f"- imagePrompt: {image_prompt}",
                f"- overlayPackaging: {overlay}",
                "",
            ])
    return "\n".join(lines).rstrip() + "\n"


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
